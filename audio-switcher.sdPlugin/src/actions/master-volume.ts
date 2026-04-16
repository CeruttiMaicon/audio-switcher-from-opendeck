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
import { buildMasterVolumeSvg, masterVolumePercentLabel } from "../lib/master-volume-svg.js";
import { sendToPropertyInspector } from "../lib/pi-bridge.js";
import {
	adjustDefaultSinkVolumePercent,
	getDefaultSinkVolume,
	invalidateDefaultSinkVolumeCache,
	setDefaultSinkVolumePercentAbsolute,
	toggleDefaultSinkMute,
} from "../lib/wpctl.js";

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

function svgImagePayload(svg: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildDialHotStripFace(percent: number, muted: boolean, unknown: boolean): string {
	const w = 200;
	const h = 100;
	if (unknown) {
		return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect fill="#12151c" width="100%" height="100%"/></svg>`;
	}
	const p = Math.min(100, Math.max(0, Math.round(percent)));
	const barW = Math.round((p / 100) * 176);
	const fill = muted ? "#fb923c" : "#38bdf8";
	return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect fill="#12151c" width="100%" height="100%"/><rect x="12" y="44" width="176" height="14" rx="5" fill="#27272a"/><rect x="12" y="44" width="${barW}" height="14" rx="5" fill="${fill}"/></svg>`;
}

/** Data-URLs pré-geradas: zero `encodeURIComponent` no caminho quente do giro. */
const DIAL_HOT_FACE_UNKNOWN = svgImagePayload(buildDialHotStripFace(0, false, true));
const DIAL_HOT_FACE_NORMAL: string[] = Array.from({ length: 101 }, (_, p) =>
	svgImagePayload(buildDialHotStripFace(p, false, false)),
);
const DIAL_HOT_FACE_MUTED: string[] = Array.from({ length: 101 }, (_, p) =>
	svgImagePayload(buildDialHotStripFace(p, true, false)),
);

const lastHostFingerprint = new Map<string, string>();
const shadowLiveVolume = new Map<string, { pct: number; muted: boolean }>();

const dialCachedStep = new Map<string, number>();
const lastDialAction = new Map<string, Action<MasterVolumeSettings>>();
const dialWpctlTail = new Map<string, Promise<void>>();
const dialWpctlApplying = new Set<string>();

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

	const label = masterVolumePercentLabel(unknown, muted, pct);
	const pctColor = unknown ? "#a1a1aa" : muted ? "#fdba74" : "#f8fafc";
	const titleOverlay = unknown ? label : "";

	if (action.isDial() && paintOpts?.dialHot) {
		const fpHot = `dH:${pct}:${muted ? 1 : 0}:${unknown ? 1 : 0}`;
		if (lastHostFingerprint.get(action.id) === fpHot) {
			return;
		}
		lastHostFingerprint.set(action.id, fpHot);
		const idx = Math.min(100, Math.max(0, Math.round(pct)));
		const hotFace = unknown ? DIAL_HOT_FACE_UNKNOWN : muted ? DIAL_HOT_FACE_MUTED[idx] : DIAL_HOT_FACE_NORMAL[idx];
		try {
			await Promise.all([
				action.setTitle(titleOverlay),
				action.setFeedback({
					face: hotFace,
					pct: { value: label, color: pctColor },
				}),
			]);
		} catch (err: unknown) {
			console.error("[pipewire-sink-toggle] master-volume dial hot paint:", err);
		}
		return;
	}

	const ringSize = action.isDial() ? 80 : 144;
	const dialLite = action.isDial();
	const ringSvg = buildMasterVolumeSvg({
		percent: pct,
		muted,
		size: ringSize,
		unknown,
		omitCenterText: false,
		renderLite: dialLite,
	});
	const ringPayload = svgImagePayload(ringSvg);

	const fpPrefix = action.isDial() ? "dF:" : "k:";
	const fingerprint = `${fpPrefix}${pct}:${muted ? 1 : 0}:${unknown ? 1 : 0}`;
	let stripPayload = "";

	if (action.isDial()) {
		const stripSvg = buildMasterVolumeSvg({
			percent: pct,
			muted,
			size: 200,
			height: 100,
			unknown,
			omitCenterText: true,
			renderLite: true,
		});
		stripPayload = svgImagePayload(stripSvg);
	}

	const prevFp = lastHostFingerprint.get(action.id);
	if (prevFp === fingerprint) {
		return;
	}
	lastHostFingerprint.set(action.id, fingerprint);

	if (action.isKey()) {
		await Promise.all([action.setImage(ringPayload), action.setTitle(titleOverlay)]);
		return;
	}
	if (action.isDial()) {
		try {
			await Promise.all([
				action.setImage(ringPayload),
				action.setTitle(titleOverlay),
				action.setFeedback({
					face: stripPayload,
					pct: { value: label, color: pctColor },
				}),
			]);
		} catch (err: unknown) {
			console.error("[pipewire-sink-toggle] master-volume dial paint:", err);
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
		const prev = dialWpctlTail.get(contextId) ?? Promise.resolve();
		const next = prev
			.then(() => MasterVolumeAction.applyDialWpctlOnce(contextId))
			.catch((err: unknown) => {
				console.error("[pipewire-sink-toggle] master-volume dial wpctl chain:", err);
			});
		dialWpctlTail.set(contextId, next);
		void next.finally(() => {
			if (dialWpctlTail.get(contextId) === next) {
				dialWpctlTail.delete(contextId);
			}
		});
	}

	private static async applyDialWpctlOnce(contextId: string): Promise<void> {
		const action = lastDialAction.get(contextId);
		const sh = shadowLiveVolume.get(contextId);
		if (!action || !sh) {
			return;
		}
		dialWpctlApplying.add(contextId);
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
		} finally {
			dialWpctlApplying.delete(contextId);
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
		dialWpctlTail.delete(contextId);
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
		const s0 = await ev.action.getSettings<MasterVolumeSettings>();
		MasterVolumeAction.bumpDialStepCache(ctx, clampVolumeStep(s0.volumeStepPercent));

		const merged: MasterVolumeSettings = { ...masterVolumeSettingsFromPayload(ev.payload), ...s0 };
		lastHostFingerprint.delete(ctx);

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

		if (ev.action.isDial()) {
			const step = clampVolumeStep(s0.volumeStepPercent);
			await ev.action.setTriggerDescription({
				rotate: `Volume: ±${step}% per detent`,
				push: "Toggle mute",
				touch: "Default output volume",
			});
		}
	}

	override async onWillDisappear(ev: WillDisappearEvent<MasterVolumeSettings>): Promise<void> {
		this.unregisterSlot(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MasterVolumeSettings>): Promise<void> {
		const s = masterVolumeSettingsFromPayload(ev.payload);
		const stored = await ev.action.getSettings<MasterVolumeSettings>();
		const merged = { ...stored, ...s };
		MasterVolumeAction.bumpDialStepCache(ev.action.id, clampVolumeStep(merged.volumeStepPercent));
		lastHostFingerprint.delete(ev.action.id);
		await this.paintFromShadow(ev.action, merged);
		if (ev.action.isDial()) {
			const step = clampVolumeStep(merged.volumeStepPercent);
			await ev.action.setTriggerDescription({
				rotate: `Volume: ±${step}% per detent`,
				push: "Toggle mute",
				touch: "Default output volume",
			});
		}
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
			if (ev.action.isDial()) {
				const step = clampVolumeStep(next.volumeStepPercent);
				await ev.action.setTriggerDescription({
					rotate: `Volume: ±${step}% per detent`,
					push: "Toggle mute",
					touch: "Default output volume",
				});
			}
		}
	}
}
