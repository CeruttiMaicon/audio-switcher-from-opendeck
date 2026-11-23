import { existsSync } from "node:fs";
import {
	action,
	SingletonAction,
	type Action,
	type DialDownEvent,
	type DialRotateEvent,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type PropertyInspectorDidAppearEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { Resvg } from "@resvg/resvg-js";
import { buildMasterVolumeSvg } from "../lib/master-volume-svg.js";
import { sendToPropertyInspector } from "../lib/pi-bridge.js";
import {
	adjustDefaultSinkVolumePercent,
	getDefaultSinkVolume,
	invalidateDefaultSinkVolumeCache,
	setDefaultSinkVolumePercentAbsolute,
	toggleDefaultSinkMute,
} from "../lib/wpctl.js";

/**
 * Fontes explícitas — `loadSystemFonts: true` (default do Resvg) varre Noto CJK etc. e
 * pode prender o event loop a 100% CPU, impedindo keyDown do toggle de sink.
 */
const RESVG_FONT_CANDIDATES = [
	"/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
	"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
	"/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
	"/usr/share/fonts/TTF/DejaVuSans.ttf",
];

const resvgFontFiles = RESVG_FONT_CANDIDATES.filter((p) => existsSync(p));

/** Cache PNG por chave de render (evita Resvg repetido no mesmo frame). */
const pngDataUrlCache = new Map<string, string>();
const PNG_CACHE_MAX = 64;

/** Converte SVG string → data:image/png;base64 (exigido pelo OpenDeck). */
function svgToPngDataUrl(svg: string, size: number, cacheKey?: string): string {
	if (cacheKey) {
		const hit = pngDataUrlCache.get(cacheKey);
		if (hit) {
			return hit;
		}
	}
	try {
		const resvg = new Resvg(svg, {
			fitTo: { mode: "width", value: size },
			font: {
				loadSystemFonts: false,
				fontFiles: resvgFontFiles,
				defaultFontFamily: "DejaVu Sans",
			},
		});
		const png = resvg.render().asPng();
		const url = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
		if (cacheKey) {
			if (pngDataUrlCache.size >= PNG_CACHE_MAX) {
				const oldest = pngDataUrlCache.keys().next().value;
				if (oldest !== undefined) {
					pngDataUrlCache.delete(oldest);
				}
			}
			pngDataUrlCache.set(cacheKey, url);
		}
		return url;
	} catch (err: unknown) {
		console.error("[pipewire-sink-toggle] svgToPngDataUrl falhou:", err);
		return "";
	}
}

/** Face do layout do encoder (200x100), mesmo desenho do preview (anel + % + altifalante). */
function dialFaceDataUrl(pct: number, muted: boolean, unknown: boolean, lite: boolean): string {
	const cacheKey = `dial:${pct}:${muted ? 1 : 0}:${unknown ? 1 : 0}:${lite ? 1 : 0}`;
	const svg = buildMasterVolumeSvg({ percent: pct, muted, unknown, size: 200, height: 100, renderLite: lite });
	return svgToPngDataUrl(svg, 200, cacheKey);
}

export type MasterVolumeSettings = JsonObject & {
	volumeStepPercent?: number;
};

type SendToPluginHandler = NonNullable<SingletonAction<MasterVolumeSettings>["onSendToPlugin"]>;
type SendToPluginEv = Parameters<SendToPluginHandler>[0];

const DIAL_FULL_REPAINT_IDLE_MS = 120;

function masterVolumeSettingsFromPayload(payload: unknown): MasterVolumeSettings {
	if (!payload || typeof payload !== "object") {
		return {};
	}
	const p = payload as Record<string, unknown>;
	const raw = p.settings;
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const s = raw as Record<string, unknown>;
		return {
			volumeStepPercent: typeof s.volumeStepPercent === "number" ? s.volumeStepPercent : undefined,
		};
	}
	return {
		volumeStepPercent: typeof p.volumeStepPercent === "number" ? p.volumeStepPercent : undefined,
	};
}

function clampVolumeStep(raw: unknown): number {
	const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 5;
	return Math.min(25, Math.max(1, Math.round(n)));
}

const lastHostFingerprint = new Map<string, string>();
const shadowLiveVolume = new Map<string, { pct: number; muted: boolean }>();

const dialCachedStep = new Map<string, number>();
const lastDialAction = new Map<string, Action<MasterVolumeSettings>>();
const dialWpctlApplying = new Set<string>();
const dialWpctlDirty = new Set<string>();

type VolumePaintHint = {
	pct: number;
	muted: boolean;
	unknown: boolean;
};

type MasterVolumePaintOpts = {
	dialHot?: boolean;
};

/**
 * Nunca chama `get-volume` aqui: só `hint` explícito ou estado em `shadowLiveVolume`.
 * `hint == null` sem shadow → UI «desconhecida» (sem I/O).
 */
async function paintMasterVolumeMeter(
	action: Action<MasterVolumeSettings>,
	_settings: MasterVolumeSettings,
	hint?: VolumePaintHint | null,
	paintOpts?: MasterVolumePaintOpts,
): Promise<void> {
	let pct: number;
	let muted: boolean;
	let unknown: boolean;

	if (hint != null) {
		pct = hint.pct;
		muted = hint.muted;
		unknown = hint.unknown;
	} else {
		const sh = shadowLiveVolume.get(action.id);
		if (sh) {
			pct = sh.pct;
			muted = sh.muted;
			unknown = false;
		} else {
			pct = 0;
			muted = false;
			unknown = true;
		}
	}


	if (action.isDial() && paintOpts?.dialHot) {
		const fpHot = `dH:${pct}:${muted ? 1 : 0}:${unknown ? 1 : 0}`;
		if (lastHostFingerprint.get(action.id) === fpHot) {
			return;
		}
		lastHostFingerprint.set(action.id, fpHot);
		try {
			await action.setFeedback({ face: dialFaceDataUrl(pct, muted, unknown, true) });
		} catch (err: unknown) {
			console.error("[pipewire-sink-toggle] master-volume dial hot paint:", err);
		}
		return;
	}

	const fpPrefix = action.isDial() ? "dF:" : "k:";
	const fingerprint = `${fpPrefix}${pct}:${muted ? 1 : 0}:${unknown ? 1 : 0}`;
	if (lastHostFingerprint.get(action.id) === fingerprint) {
		return;
	}

	lastHostFingerprint.set(action.id, fingerprint);

	// Encoder: só o pixmap do layout (evita setImage+setFeedback a duplicar Resvg e a
	// realimentar didReceiveSettings no OpenDeck).
	if (action.isDial()) {
		try {
			await action.setFeedback({ face: dialFaceDataUrl(pct, muted, unknown, false) });
		} catch (err: unknown) {
			console.error("[pipewire-sink-toggle] master-volume dial paint:", err);
		}
		return;
	}

	if (action.isKey()) {
		const cacheKey = `key:${pct}:${muted ? 1 : 0}:${unknown ? 1 : 0}`;
		const svgStr = buildMasterVolumeSvg({
			percent: pct,
			muted,
			unknown,
			size: 144,
			renderLite: false,
		});
		const pngDataUrl = svgToPngDataUrl(svgStr, 144, cacheKey);
		if (pngDataUrl) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				await (action as any).setImage(pngDataUrl);
			} catch (err: unknown) {
				console.error("[pipewire-sink-toggle] master-volume setImage:", err);
			}
		}
		return;
	}

	console.warn(
		"[pipewire-sink-toggle] master-volume: unsupported controllerType=%s (expected Keypad or Encoder)",
		action.controllerType,
	);
}

@action({ UUID: "com.maicondev.opendeck.pipewire-sink-toggle.master-volume" })
export class MasterVolumeAction extends SingletonAction<MasterVolumeSettings> {
	private static readonly dialFullRepaintIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();

	private static scheduleDialFullRepaintAfterIdle(contextId: string, action: Action<MasterVolumeSettings>): void {
		if (!action.isDial()) {
			return;
		}
		const prev = MasterVolumeAction.dialFullRepaintIdleTimers.get(contextId);
		if (prev) {
			clearTimeout(prev);
		}
		const t = setTimeout(() => {
			MasterVolumeAction.dialFullRepaintIdleTimers.delete(contextId);
			if (dialWpctlApplying.has(contextId)) {
				return;
			}
			lastHostFingerprint.delete(action.id);
			const sh = shadowLiveVolume.get(contextId);
			void (async () => {
				if (sh) {
					await paintMasterVolumeMeter(
						action,
						{},
						{ pct: sh.pct, muted: sh.muted, unknown: false },
						{ dialHot: false },
					);
				} else {
					await paintMasterVolumeMeter(action, {}, { pct: 0, muted: false, unknown: true }, { dialHot: false });
				}
			})().catch((err: unknown) => {
				console.error("[pipewire-sink-toggle] master-volume dial idle full paint:", err);
			});
		}, DIAL_FULL_REPAINT_IDLE_MS);
		MasterVolumeAction.dialFullRepaintIdleTimers.set(contextId, t);
	}

	private static bumpDialStepCache(contextId: string, step: number): void {
		dialCachedStep.set(contextId, step);
	}

	private static enqueueDialWpctl(contextId: string): void {
		if (dialWpctlApplying.has(contextId)) {
			// Já está a aplicar — marcar como dirty para reaplicar ao terminar.
			dialWpctlDirty.add(contextId);
			return;
		}
		void MasterVolumeAction.runDialWpctlLoop(contextId);
	}

	private static async runDialWpctlLoop(contextId: string): Promise<void> {
		dialWpctlApplying.add(contextId);
		try {
			do {
				dialWpctlDirty.delete(contextId);
				await MasterVolumeAction.applyDialWpctlOnce(contextId);
			} while (dialWpctlDirty.has(contextId));
		} catch (err: unknown) {
			console.error("[pipewire-sink-toggle] master-volume dial wpctl loop:", err);
		} finally {
			dialWpctlApplying.delete(contextId);
			dialWpctlDirty.delete(contextId);
		}
	}

	private static async applyDialWpctlOnce(contextId: string): Promise<void> {
		const action = lastDialAction.get(contextId);
		const sh = shadowLiveVolume.get(contextId);
		if (!action || !sh) {
			return;
		}
		try {
			const ok = await setDefaultSinkVolumePercentAbsolute(sh.pct);
			if (!ok) {
				await action.showAlert();
				invalidateDefaultSinkVolumeCache();
				const vol = await getDefaultSinkVolume();
				lastHostFingerprint.delete(action.id);
				if (vol) {
					shadowLiveVolume.set(contextId, {
						pct: Math.round(vol.fraction * 100),
						muted: vol.muted,
					});
					await paintMasterVolumeMeter(
						action,
						{},
						{
							pct: Math.round(vol.fraction * 100),
							muted: vol.muted,
							unknown: false,
						},
						{ dialHot: false },
					);
				} else {
					shadowLiveVolume.delete(contextId);
					await paintMasterVolumeMeter(action, {}, { pct: 0, muted: false, unknown: true }, { dialHot: false });
				}
			}
		} catch (err: unknown) {
			console.error("[pipewire-sink-toggle] master-volume dial wpctl once:", err);
		}
	}

	private static async ensureShadowForDial(
		contextId: string,
		action: Action<MasterVolumeSettings>,
	): Promise<boolean> {
		if (shadowLiveVolume.has(contextId)) {
			return true;
		}
		const vol = await getDefaultSinkVolume();
		if (!vol) {
			return false;
		}
		shadowLiveVolume.set(contextId, {
			pct: Math.round(vol.fraction * 100),
			muted: vol.muted,
		});
		return true;
	}

	private unregisterSlot(contextId: string): void {
		const idleFull = MasterVolumeAction.dialFullRepaintIdleTimers.get(contextId);
		if (idleFull) {
			clearTimeout(idleFull);
		}
		MasterVolumeAction.dialFullRepaintIdleTimers.delete(contextId);
		lastHostFingerprint.delete(contextId);
		shadowLiveVolume.delete(contextId);
		dialCachedStep.delete(contextId);
		lastDialAction.delete(contextId);
		dialWpctlApplying.delete(contextId);
		dialWpctlDirty.delete(contextId);
	}

	/** Repinta a partir do `shadow` (sem `get-volume`). */
	private async paintFromShadow(action: Action<MasterVolumeSettings>, settings: MasterVolumeSettings): Promise<void> {
		const sh = shadowLiveVolume.get(action.id);
		if (sh) {
			await paintMasterVolumeMeter(action, settings, { pct: sh.pct, muted: sh.muted, unknown: false });
		} else {
			await paintMasterVolumeMeter(action, settings, { pct: 0, muted: false, unknown: true });
		}
	}

	private async applyMuteToggle(action: Action<MasterVolumeSettings>): Promise<void> {
		const ok = await toggleDefaultSinkMute();
		if (!ok) {
			await action.showAlert();
			return;
		}
		const id = action.id;
		const sh = shadowLiveVolume.get(id);
		lastHostFingerprint.delete(id);
		if (sh) {
			shadowLiveVolume.set(id, { pct: sh.pct, muted: !sh.muted });
			await paintMasterVolumeMeter(action, {}, { pct: sh.pct, muted: !sh.muted, unknown: false }, {
				dialHot: false,
			});
		} else {
			await paintMasterVolumeMeter(action, {}, { pct: 0, muted: false, unknown: true }, { dialHot: false });
		}
	}

	override async onKeyDown(ev: KeyDownEvent<MasterVolumeSettings>): Promise<void> {
		await this.applyMuteToggle(ev.action);
	}

	override async onDialDown(ev: DialDownEvent<MasterVolumeSettings>): Promise<void> {
		await this.applyMuteToggle(ev.action);
	}

	override async onWillAppear(ev: WillAppearEvent<MasterVolumeSettings>): Promise<void> {
		const ctx = ev.action.id;
		// Preferir settings do payload — getSettings() reenvia didReceiveSettings e
		// com várias instâncias (perfis) isso enfileira trabalho à toa no arranque.
		const merged = masterVolumeSettingsFromPayload(ev.payload);
		MasterVolumeAction.bumpDialStepCache(ctx, clampVolumeStep(merged.volumeStepPercent));
		lastHostFingerprint.delete(ctx);

		if (ev.action.isDial()) {
			// Limpa estado antigo guardado pelo host (título e layout de versões anteriores) que duplicava o texto.
			await ev.action.setTitle("").catch(() => undefined);
			await ev.action.setFeedbackLayout("layouts/master-volume-encoder.json").catch(() => undefined);
		}

		const vol = await getDefaultSinkVolume();
		if (vol) {
			const pct = Math.round(vol.fraction * 100);
			const muted = vol.muted;
			shadowLiveVolume.set(ctx, { pct, muted });
			await paintMasterVolumeMeter(ev.action, merged, { pct, muted, unknown: false });
		} else {
			shadowLiveVolume.delete(ctx);
			await paintMasterVolumeMeter(ev.action, merged, { pct: 0, muted: false, unknown: true });
		}

		// setTriggerDescription não é suportado pelo OpenDeck (evento desconhecido → timeout).
	}

	override async onWillDisappear(ev: WillDisappearEvent<MasterVolumeSettings>): Promise<void> {
		this.unregisterSlot(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MasterVolumeSettings>): Promise<void> {
		// NÃO chamar action.getSettings() aqui: no protocolo SD isso emite outro
		// didReceiveSettings → loop infinito de WebSocket (100% CPU) e o toggle para.
		const merged = masterVolumeSettingsFromPayload(ev.payload);
		const step = clampVolumeStep(merged.volumeStepPercent);
		const prevStep = dialCachedStep.get(ev.action.id);
		MasterVolumeAction.bumpDialStepCache(ev.action.id, step);

		if (prevStep === step) {
			return;
		}

		lastHostFingerprint.delete(ev.action.id);
		await this.paintFromShadow(ev.action, merged);
	}

	override async onDialRotate(ev: DialRotateEvent<MasterVolumeSettings>): Promise<void> {
		const action = ev.action;
		const id = action.id;
		const ticks = ev.payload.ticks;
		lastDialAction.set(id, action);

		const step = dialCachedStep.get(id) ?? 5;

		if (!shadowLiveVolume.has(id)) {
			const okSeed = await MasterVolumeAction.ensureShadowForDial(id, action);
			if (!okSeed) {
				const delta = ticks * step;
				const ok = await adjustDefaultSinkVolumePercent(delta);
				if (!ok) {
					await action.showAlert();
				}
				return;
			}
		}

		const sh0 = shadowLiveVolume.get(id)!;
		const nextPct = Math.min(100, Math.max(0, Math.round(sh0.pct + ticks * step)));
		shadowLiveVolume.set(id, { pct: nextPct, muted: sh0.muted });

		void paintMasterVolumeMeter(
			action,
			{},
			{ pct: nextPct, muted: sh0.muted, unknown: false },
			{ dialHot: true },
		).catch((err: unknown) => {
			console.error("[pipewire-sink-toggle] master-volume optimistic paint:", err);
		});

		MasterVolumeAction.scheduleDialFullRepaintAfterIdle(id, action);
		MasterVolumeAction.enqueueDialWpctl(id);
	}

	override async onPropertyInspectorDidAppear(
		ev: PropertyInspectorDidAppearEvent<MasterVolumeSettings>,
	): Promise<void> {
		const a = ev.action;
		const send = async (): Promise<void> => {
			const s = await a.getSettings<MasterVolumeSettings>();
			await sendToPropertyInspector(a.id, a.manifestId, {
				event: "masterVolumeSettings",
				volumeStepPercent: clampVolumeStep(s.volumeStepPercent),
			});
		};
		await send().catch((err: unknown) => {
			console.error("[pipewire-sink-toggle] master-volume PI appear:", err);
		});
		setTimeout(() => {
			void send().catch((err: unknown) => {
				console.error("[pipewire-sink-toggle] master-volume PI resend:", err);
			});
		}, 200);
	}

	override async onSendToPlugin(ev: SendToPluginEv): Promise<void> {
		if (!ev.payload || typeof ev.payload !== "object") {
			return;
		}
		const p = ev.payload as { event?: string; volumeStepPercent?: number };
		if (p.event === "saveMasterVolume") {
			const next: MasterVolumeSettings = {
				volumeStepPercent: clampVolumeStep(p.volumeStepPercent),
			};
			await ev.action.setSettings(next);
			MasterVolumeAction.bumpDialStepCache(ev.action.id, next.volumeStepPercent ?? 5);
			lastHostFingerprint.delete(ev.action.id);
			await this.paintFromShadow(ev.action, next);
		}
	}
}
