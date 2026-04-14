import {
	action,
	SingletonAction,
	type Action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type PropertyInspectorDidAppearEvent,
	type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { sendToPropertyInspector } from "../lib/pi-bridge.js";
import { findSinkByConfiguredName, getDefaultSinkId, listSinks, setDefaultSink } from "../lib/wpctl.js";

export type SinkSettings = JsonObject & {
	primaryName?: string;
	secondaryName?: string;
};

type SendToPluginHandler = NonNullable<SingletonAction<SinkSettings>["onSendToPlugin"]>;
type SendToPluginEv = Parameters<SendToPluginHandler>[0];

/** Lê primary/secondary do payload do host (flat ou aninhado em `settings`). */
function sinkSettingsFromInstancePayload(payload: unknown): SinkSettings {
	if (!payload || typeof payload !== "object") {
		return {};
	}
	const p = payload as Record<string, unknown>;
	const raw = p.settings;
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const s = raw as Record<string, unknown>;
		return {
			primaryName: typeof s.primaryName === "string" ? s.primaryName : "",
			secondaryName: typeof s.secondaryName === "string" ? s.secondaryName : "",
		};
	}
	return {
		primaryName: typeof p.primaryName === "string" ? p.primaryName : "",
		secondaryName: typeof p.secondaryName === "string" ? p.secondaryName : "",
	};
}

@action({ UUID: "com.maicondev.opendeck.pipewire-sink-toggle.toggle" })
export class SinkToggleAction extends SingletonAction<SinkSettings> {
	override async onWillAppear(ev: WillAppearEvent<SinkSettings>): Promise<void> {
		await this.syncFromSystem(ev.action, sinkSettingsFromInstancePayload(ev.payload));
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SinkSettings>): Promise<void> {
		await this.syncFromSystem(ev.action, sinkSettingsFromInstancePayload(ev.payload));
	}

	override async onKeyDown(ev: KeyDownEvent<SinkSettings>): Promise<void> {
		const s = sinkSettingsFromInstancePayload(ev.payload);
		const primaryName = s.primaryName ?? "";
		const secondaryName = s.secondaryName ?? "";

		const sinks = await listSinks();
		if (!sinks.length) {
			await ev.action.showAlert();
			return;
		}

		const primaryHit = findSinkByConfiguredName(sinks, primaryName);
		const secondaryHit = findSinkByConfiguredName(sinks, secondaryName);

		if (!primaryHit || !secondaryHit) {
			console.error(
				"[pipewire-sink-toggle] sink não encontrado — primary %j -> %s | secondary %j -> %s",
				primaryName,
				primaryHit ? `${primaryHit.id} (${primaryHit.name})` : "null",
				secondaryName,
				secondaryHit ? `${secondaryHit.id} (${secondaryHit.name})` : "null",
			);
			await ev.action.showAlert();
			return;
		}

		const defaultId = getDefaultSinkId(sinks);
		if (defaultId == null) {
			console.error("[pipewire-sink-toggle] nenhum sink predefinido (*) em wpctl status");
			await ev.action.showAlert();
			return;
		}

		let targetId: number;
		if (defaultId === primaryHit.id) {
			targetId = secondaryHit.id;
		} else if (defaultId === secondaryHit.id) {
			targetId = primaryHit.id;
		} else {
			console.log(
				"[pipewire-sink-toggle] default id=%s não coincide com primary (%s) nem secondary (%s); a definir primary",
				defaultId,
				primaryHit.id,
				secondaryHit.id,
			);
			targetId = primaryHit.id;
		}

		console.log(
			"[pipewire-sink-toggle] keyDown: default atual=%s (%s) | alvo=%s | comando wpctl set-default %s",
			defaultId,
			sinks.find((x) => x.id === defaultId)?.name ?? "?",
			targetId,
			targetId,
		);

		const ok = await setDefaultSink(targetId);
		if (!ok) {
			await ev.action.showAlert();
			return;
		}

		const newState: 0 | 1 = targetId === primaryHit.id ? 0 : 1;
		await ev.action.setState(newState);
	}

	override async onPropertyInspectorDidAppear(
		ev: PropertyInspectorDidAppearEvent<SinkSettings>,
	): Promise<void> {
		const a = ev.action;
		await this.sendSinksListToInspector(a).catch((err: unknown) => {
			console.error("[pipewire-sink-toggle] PI appear / envio sinks:", err);
		});
		// Reenvio: por vezes o socket do PI ainda não está associado ao contexto.
		setTimeout(() => {
			void this.sendSinksListToInspector(a).catch((err: unknown) => {
				console.error("[pipewire-sink-toggle] PI reenvio sinks:", err);
			});
		}, 200);
	}

	override async onSendToPlugin(ev: SendToPluginEv): Promise<void> {
		if (!ev.payload || typeof ev.payload !== "object") {
			return;
		}
		const p = ev.payload as { event?: string; primaryName?: string; secondaryName?: string };
		if (p.event === "saveSettings") {
			const next: SinkSettings = {
				primaryName: typeof p.primaryName === "string" ? p.primaryName : "",
				secondaryName: typeof p.secondaryName === "string" ? p.secondaryName : "",
			};
			await ev.action.setSettings(next);
			await this.syncFromSystem(ev.action, next);
			return;
		}
		if (p.event === "requestSinks") {
			await this.sendSinksListToInspector(ev.action).catch((err: unknown) => {
				console.error("[pipewire-sink-toggle] requestSinks:", err);
			});
		}
	}

	private async syncFromSystem(action: Action<SinkSettings>, settings: SinkSettings): Promise<void> {
		const sinks = await listSinks();
		if (!sinks.length) {
			return;
		}

		const defaultId = getDefaultSinkId(sinks);
		const primaryName = settings.primaryName ?? "";
		const secondaryName = settings.secondaryName ?? "";
		const defaultSink = defaultId != null ? sinks.find((x) => x.id === defaultId) : undefined;

		console.log(
			"[pipewire-sink-toggle] sync: default id=%s nome=%j | primary=%j secondary=%j",
			defaultId ?? "?",
			defaultSink?.name ?? "?",
			primaryName,
			secondaryName,
		);

		let state: 0 | 1 = 0;
		if (defaultSink) {
			const pf = primaryName.trim().toLowerCase();
			const sf = secondaryName.trim().toLowerCase();
			const dn = defaultSink.name.toLowerCase();
			const isP = pf.length > 0 && (dn === pf || dn.includes(pf));
			const isS = sf.length > 0 && (dn === sf || dn.includes(sf));
			if (isP && !isS) {
				state = 0;
			} else if (isS && !isP) {
				state = 1;
			} else if (isP && isS) {
				console.log("[pipewire-sink-toggle] sync: nome default contém ambos os fragmentos — estado 0");
				state = 0;
			} else {
				console.log(
					"[pipewire-sink-toggle] sync: default não contém primary nem secondary — estado 0 (primário)",
				);
				state = 0;
			}
		}

		if (!action.isKey()) {
			return;
		}
		try {
			await action.setState(state);
		} catch (err: unknown) {
			console.error("[pipewire-sink-toggle] setState:", err);
		}
	}

	private async sendSinksListToInspector(action: Action<SinkSettings>): Promise<void> {
		const context = action.id;
		const actionUuid = action.manifestId;
		const sinks = await listSinks();
		if (!sinks.length) {
			await sendToPropertyInspector(context, actionUuid, {
				event: "sinksList",
				sinks: [],
				error:
					"Não foi possível listar saídas de áudio. Instale PipeWire (pacote pipewire; comandos pw-dump e wpctl no PATH) e reinicie o OpenDeck.",
			});
			return;
		}
		const list = sinks.map((s) => ({
			id: s.id,
			name: s.name,
			isDefault: s.isDefault,
		}));
		console.log(
			"[pipewire-sink-toggle] PI: a enviar %s sinks (context=%s action=%s)",
			list.length,
			context,
			actionUuid,
		);
		await sendToPropertyInspector(context, actionUuid, {
			event: "sinksList",
			sinks: list,
		});
	}
}
