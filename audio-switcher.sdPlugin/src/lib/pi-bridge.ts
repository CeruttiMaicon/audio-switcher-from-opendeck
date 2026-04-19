import type { JsonValue } from "@elgato/utils";
import { connection } from "../../node_modules/@elgato/streamdeck/dist/plugin/connection.js";

/**
 * Envia payload ao Property Inspector com contexto e UUID da ação (campo `action`).
 * O protocolo Stream Deck / OpenDeck exige `action` + `context`; sem `action` o host pode
 * descartar a mensagem ao deserializar.
 * Não usar `streamDeck.ui.sendToPropertyInspector()`: o `ui.#action` pode ainda não
 * estar definido quando corre `onPropertyInspectorDidAppear`, e o SDK descarta o envio.
 */
export async function sendToPropertyInspector(
	context: string,
	action: string,
	payload: JsonValue,
): Promise<void> {
	if (!context) {
		console.error("[pipewire-sink-toggle] PI: empty context — message not sent");
		return;
	}
	if (!action) {
		console.error("[pipewire-sink-toggle] PI: empty action UUID — message not sent");
		return;
	}
	await connection.send({
		event: "sendToPropertyInspector",
		action,
		context,
		payload,
	});
}
