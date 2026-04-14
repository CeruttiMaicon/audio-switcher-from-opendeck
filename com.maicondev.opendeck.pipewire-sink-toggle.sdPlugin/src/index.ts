import streamDeck from "@elgato/streamdeck";
import { SinkToggleAction } from "./actions/sink-toggle.js";

streamDeck.actions.registerAction(new SinkToggleAction());

streamDeck.connect().catch((err: unknown) => {
	console.error("[pipewire-sink-toggle] falha ao ligar ao OpenDeck:", err);
	process.exit(1);
});
