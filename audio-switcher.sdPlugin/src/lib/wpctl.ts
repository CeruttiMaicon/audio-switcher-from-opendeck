import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** PATH extra: processos do OpenDeck / Flatpak por vezes herdam PATH mínimo sem /usr/bin. */
function childEnv(): NodeJS.ProcessEnv {
	const extra = "/usr/bin:/bin:/usr/local/bin";
	const p = process.env.PATH?.trim() ? process.env.PATH : extra;
	return { ...process.env, PATH: `${p}:${extra}` };
}

export type ParsedSink = {
	id: number;
	name: string;
	isDefault: boolean;
};

/**
 * Extrai o bloco "Audio" até "Video" ou "Settings" (exclusivo).
 */
function extractAudioSection(full: string): string | null {
	const m = full.match(
		/^(?:Audio|Áudio)\s*\r?\n([\s\S]*?)(?=^(?:Video|Vídeo|Settings|Definições)\s*$)/im,
	);
	return m?.[1] ?? null;
}

/**
 * Dentro do bloco Audio, extrai linhas entre "Sinks:" e "Sources:".
 */
function extractSinksSubsection(audio: string): string | null {
	// ├ (U+251C) ou + (árvore ASCII em alguns terminais)
	const m = audio.match(/(?:├|\+)[─\-]\s*Sinks:\s*\r?\n([\s\S]*?)(?=^\s*(?:├|\+)[─\-]\s*Sources:)/m);
	return m?.[1] ?? null;
}

/**
 * Interpreta uma linha de sink no output de `wpctl status`.
 * Formato típico: " │  *   36. Nome ..." ou " │      44. Nome ..."
 */
export function parseSinkLine(line: string): ParsedSink | null {
	const trimmed = line.trimEnd();
	// `│` (wpctl típico) ou `|` (ASCII em alguns ambientes)
	const m = trimmed.match(/^\s*[│|]\s*(?:(\*\s+))?(\d+)\.\s+(.+)$/);
	if (!m) {
		return null;
	}
	const isDefault = Boolean(m[1]);
	const id = Number(m[2]);
	const name = m[3].trim();
	if (!Number.isFinite(id) || !name) {
		return null;
	}
	return { id, name, isDefault };
}

export function parseSinksFromStatus(text: string): ParsedSink[] {
	const audio = extractAudioSection(text);
	if (!audio) {
		console.error("[pipewire-sink-toggle] secção Audio não encontrada em wpctl status");
		return [];
	}
	const block = extractSinksSubsection(audio);
	if (!block) {
		console.error("[pipewire-sink-toggle] secção Sinks não encontrada em wpctl status");
		return [];
	}
	const sinks: ParsedSink[] = [];
	for (const line of block.split(/\r?\n/)) {
		const parsed = parseSinkLine(line);
		if (parsed) {
			sinks.push(parsed);
		}
	}
	return sinks;
}

export function getDefaultSinkId(sinks: ParsedSink[]): number | null {
	const d = sinks.find((s) => s.isDefault);
	return d?.id ?? null;
}

type PwDumpEntry = {
	id?: unknown;
	info?: { props?: Record<string, unknown> };
};

/**
 * Lista sinks a partir da saída JSON de `pw-dump` (mais fiável que parsear `wpctl status`).
 */
export function parseSinksFromPwDump(data: unknown): ParsedSink[] {
	if (!Array.isArray(data)) {
		return [];
	}
	const sinks: ParsedSink[] = [];
	for (const raw of data) {
		const o = raw as PwDumpEntry;
		if (typeof o?.id !== "number") {
			continue;
		}
		const props = o.info?.props;
		if (!props || props["media.class"] !== "Audio/Sink") {
			continue;
		}
		const desc = props["node.description"];
		const nick = props["node.nick"];
		const name =
			(typeof desc === "string" && desc.trim()) ||
			(typeof nick === "string" && nick.trim()) ||
			`Sink ${o.id}`;
		sinks.push({ id: o.id, name, isDefault: false });
	}
	sinks.sort((a, b) => a.id - b.id);
	return sinks;
}

async function runPwDump(): Promise<unknown[] | null> {
	try {
		const { stdout, stderr } = await execFileAsync("pw-dump", [], {
			encoding: "utf8",
			maxBuffer: 50 * 1024 * 1024,
			env: childEnv(),
		});
		if (stderr?.trim()) {
			console.log("[pipewire-sink-toggle] pw-dump stderr:", stderr.trim());
		}
		const parsed: unknown = JSON.parse(stdout);
		return Array.isArray(parsed) ? parsed : null;
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException & { stderr?: string };
		console.error("[pipewire-sink-toggle] pw-dump falhou:", err.message);
		if (err.stderr) {
			console.error("[pipewire-sink-toggle] stderr:", String(err.stderr).trim());
		}
		return null;
	}
}

/** ID numérico do sink predefinido (o mesmo que `wpctl` usa em set-default). */
export async function getDefaultSinkIdFromInspect(): Promise<number | null> {
	try {
		const { stdout } = await execFileAsync("wpctl", ["inspect", "@DEFAULT_AUDIO_SINK@"], {
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			env: childEnv(),
		});
		const m = stdout.match(/^id\s+(\d+),/m);
		if (!m) {
			return null;
		}
		const id = Number(m[1]);
		return Number.isFinite(id) ? id : null;
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException;
		console.error("[pipewire-sink-toggle] wpctl inspect @DEFAULT_AUDIO_SINK@ falhou:", err.message);
		return null;
	}
}

function applyDefaultFlag(sinks: ParsedSink[], defaultId: number | null): void {
	if (defaultId == null) {
		return;
	}
	for (const s of sinks) {
		s.isDefault = s.id === defaultId;
	}
}

/**
 * Lista sinks de saída: tenta `pw-dump` (JSON), depois `wpctl status` (texto).
 */
export async function listSinks(): Promise<ParsedSink[]> {
	const dump = await runPwDump();
	if (dump) {
		const fromDump = parseSinksFromPwDump(dump);
		if (fromDump.length > 0) {
			applyDefaultFlag(fromDump, await getDefaultSinkIdFromInspect());
			console.log("[pipewire-sink-toggle] listSinks: %s sink(s) via pw-dump", fromDump.length);
			return fromDump;
		}
	}

	const text = await runWpctlStatus();
	if (!text) {
		return [];
	}
	const fromStatus = parseSinksFromStatus(text);
	if (fromStatus.length > 0) {
		const marked = fromStatus.some((s) => s.isDefault);
		if (!marked) {
			applyDefaultFlag(fromStatus, await getDefaultSinkIdFromInspect());
		}
		console.log("[pipewire-sink-toggle] listSinks: %s sink(s) via wpctl status", fromStatus.length);
	}
	return fromStatus;
}

/**
 * Match: o nome completo do sink (wpctl) contém o fragmento configurado (case-insensitive).
 */
export function findSinkByPartialName(sinks: ParsedSink[], fragment: string): { id: number; name: string } | null {
	const f = fragment.trim().toLowerCase();
	if (!f) {
		return null;
	}
	const hits = sinks.filter((s) => s.name.toLowerCase().includes(f));
	if (hits.length === 0) {
		return null;
	}
	if (hits.length > 1) {
		console.log(
			`[pipewire-sink-toggle] vários sinks correspondem a "${fragment}": ${hits.map((h) => `${h.id} (${h.name})`).join("; ")} — a usar o primeiro (${hits[0].id})`,
		);
	}
	return { id: hits[0].id, name: hits[0].name };
}

/**
 * Resolve sink: igualdade exacta (ignora maiúsculas) e depois substring como antes.
 */
export function findSinkByConfiguredName(sinks: ParsedSink[], configured: string): { id: number; name: string } | null {
	const t = configured.trim();
	if (!t) {
		return null;
	}
	const lower = t.toLowerCase();
	const exact = sinks.find((s) => s.name.toLowerCase() === lower);
	if (exact) {
		return { id: exact.id, name: exact.name };
	}
	return findSinkByPartialName(sinks, t);
}

export async function runWpctlStatus(): Promise<string | null> {
	try {
		const { stdout, stderr } = await execFileAsync("wpctl", ["status"], {
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
			env: childEnv(),
		});
		if (stderr?.trim()) {
			console.log("[pipewire-sink-toggle] wpctl status stderr:", stderr.trim());
		}
		return stdout;
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException & { stderr?: string };
		console.error("[pipewire-sink-toggle] wpctl status falhou:", err.message);
		if (err.stderr) {
			console.error("[pipewire-sink-toggle] stderr:", String(err.stderr).trim());
		}
		return null;
	}
}

export async function setDefaultSink(id: number): Promise<boolean> {
	const args = ["set-default", String(id)];
	console.log("[pipewire-sink-toggle] comando: wpctl", args.join(" "));
	try {
		const { stderr } = await execFileAsync("wpctl", args, { encoding: "utf8", env: childEnv() });
		if (stderr?.trim()) {
			console.log("[pipewire-sink-toggle] wpctl set-default stderr:", stderr.trim());
		}
		return true;
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException & { stderr?: string };
		console.error("[pipewire-sink-toggle] wpctl set-default falhou:", err.message);
		if (err.stderr) {
			console.error("[pipewire-sink-toggle] stderr:", String(err.stderr).trim());
		}
		return false;
	}
}

export type DefaultSinkVolume = {
	/** 0..1 */
	fraction: number;
	muted: boolean;
};

/**
 * Lê volume do sink predefinido (`wpctl get-volume @DEFAULT_AUDIO_SINK@`).
 */
export async function getDefaultSinkVolume(): Promise<DefaultSinkVolume | null> {
	try {
		const { stdout, stderr } = await execFileAsync("wpctl", ["get-volume", "@DEFAULT_AUDIO_SINK@"], {
			encoding: "utf8",
			maxBuffer: 256 * 1024,
			env: childEnv(),
		});
		if (stderr?.trim()) {
			console.log("[pipewire-sink-toggle] wpctl get-volume stderr:", stderr.trim());
		}
		const line = stdout.trim();
		const m = line.match(/Volume:\s*([\d.]+)/i);
		if (!m) {
			console.error("[pipewire-sink-toggle] wpctl get-volume: formato inesperado:", JSON.stringify(line));
			return null;
		}
		const fraction = Number(m[1]);
		if (!Number.isFinite(fraction)) {
			return null;
		}
		const muted = /\[\s*MUTED\s*\]/i.test(line);
		return { fraction: Math.min(1, Math.max(0, fraction)), muted };
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException & { stderr?: string };
		console.error("[pipewire-sink-toggle] wpctl get-volume falhou:", err.message);
		if (err.stderr) {
			console.error("[pipewire-sink-toggle] stderr:", String(err.stderr).trim());
		}
		return null;
	}
}

/**
 * Ajusta o volume do sink predefinido em pontos percentuais (ex.: +15 ou -5), via `wpctl set-volume … N%+` / `N%-`.
 */
export async function adjustDefaultSinkVolumePercent(signedPercent: number): Promise<boolean> {
	const n = Math.round(Math.abs(signedPercent));
	if (n <= 0) {
		return true;
	}
	const sign = signedPercent > 0 ? "+" : "-";
	const spec = `${n}%${sign}`;
	try {
		const { stderr } = await execFileAsync("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", spec], {
			encoding: "utf8",
			env: childEnv(),
		});
		if (stderr?.trim()) {
			console.log("[pipewire-sink-toggle] wpctl set-volume stderr:", stderr.trim());
		}
		/* Não invalidar cache aqui: durante rajadas de rotação isso forçava `get-volume` em cascata
		 * (poll + resync) e deixava tudo pesado. O plugin usa `shadowLiveVolume` + resync explícito. */
		return true;
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException & { stderr?: string };
		console.error("[pipewire-sink-toggle] wpctl set-volume falhou:", err.message, spec);
		if (err.stderr) {
			console.error("[pipewire-sink-toggle] stderr:", String(err.stderr).trim());
		}
		return false;
	}
}

/**
 * Define volume absoluto 0–100% (`wpctl set-volume … 0.65` — 1.0 = 100%).
 * Um único processo por destino, em vez de vários passos relativos.
 */
export async function setDefaultSinkVolumePercentAbsolute(percent0to100: number): Promise<boolean> {
	const p = Math.min(100, Math.max(0, Math.round(percent0to100)));
	const frac = p / 100;
	try {
		const { stderr } = await execFileAsync("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", String(frac)], {
			encoding: "utf8",
			env: childEnv(),
		});
		if (stderr?.trim()) {
			console.log("[pipewire-sink-toggle] wpctl set-volume (absolute) stderr:", stderr.trim());
		}
		return true;
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException & { stderr?: string };
		console.error("[pipewire-sink-toggle] wpctl set-volume (absolute) falhou:", err.message, frac);
		if (err.stderr) {
			console.error("[pipewire-sink-toggle] stderr:", String(err.stderr).trim());
		}
		return false;
	}
}

/** Short-lived cache + single in-flight read to avoid wpctl storms during dial spins + polling. */
let defaultSinkVolumeCache: { value: DefaultSinkVolume; at: number } | null = null;
let defaultSinkVolumeInFlight: Promise<DefaultSinkVolume | null> | null = null;
const DEFAULT_SINK_VOLUME_CACHE_TTL_MS = 500;

export function invalidateDefaultSinkVolumeCache(): void {
	defaultSinkVolumeCache = null;
}

/**
 * Same as {@link getDefaultSinkVolume} but coalesces overlapping reads (poll + UI) within `DEFAULT_SINK_VOLUME_CACHE_TTL_MS`.
 */
export async function getDefaultSinkVolumeCached(): Promise<DefaultSinkVolume | null> {
	const now = Date.now();
	if (defaultSinkVolumeCache && now - defaultSinkVolumeCache.at < DEFAULT_SINK_VOLUME_CACHE_TTL_MS) {
		return defaultSinkVolumeCache.value;
	}
	if (!defaultSinkVolumeInFlight) {
		defaultSinkVolumeInFlight = getDefaultSinkVolume().finally(() => {
			defaultSinkVolumeInFlight = null;
		});
	}
	const result = await defaultSinkVolumeInFlight;
	if (result) {
		defaultSinkVolumeCache = { value: result, at: Date.now() };
	}
	return result;
}

/**
 * Alterna mute do sink predefinido (`wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle`).
 */
export async function toggleDefaultSinkMute(): Promise<boolean> {
	try {
		const { stderr } = await execFileAsync("wpctl", ["set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"], {
			encoding: "utf8",
			env: childEnv(),
		});
		if (stderr?.trim()) {
			console.log("[pipewire-sink-toggle] wpctl set-mute stderr:", stderr.trim());
		}
		invalidateDefaultSinkVolumeCache();
		return true;
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException & { stderr?: string };
		console.error("[pipewire-sink-toggle] wpctl set-mute falhou:", err.message);
		if (err.stderr) {
			console.error("[pipewire-sink-toggle] stderr:", String(err.stderr).trim());
		}
		return false;
	}
}
