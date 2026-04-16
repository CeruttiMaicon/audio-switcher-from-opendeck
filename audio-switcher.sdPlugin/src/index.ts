import streamDeck from "@elgato/streamdeck";
import { MasterVolumeAction } from "./actions/master-volume.js";
import { SinkToggleAction } from "./actions/sink-toggle.js";

streamDeck.actions.registerAction(new SinkToggleAction());
streamDeck.actions.registerAction(new MasterVolumeAction());

streamDeck.connect().catch((err: unknown) => {
	console.error("[pipewire-sink-toggle] falha ao ligar ao OpenDeck:", err);
	process.exit(1);
});
