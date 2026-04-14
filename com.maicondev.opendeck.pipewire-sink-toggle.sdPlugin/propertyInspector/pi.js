/* global window, document, WebSocket */
(function () {
	"use strict";

	var pluginUUID = null;
	var context = null;
	var actionUUID = null;
	var websocket = null;
	var saveTimer = null;
	var lastSinks = [];
	var pendingSettings = null;

	var primaryEl = document.getElementById("primary");
	var secondaryEl = document.getElementById("secondary");
	var statusEl = document.getElementById("status");

	function setStatus(kind, message) {
		statusEl.className = "";
		statusEl.textContent = "";
		if (!message) {
			statusEl.style.display = "none";
			return;
		}
		statusEl.style.display = "block";
		statusEl.classList.add(kind === "error" ? "is-error" : "is-ok");
		statusEl.textContent = message;
	}

	function populateSelect(selectEl, sinks, keepValue) {
		var prev = keepValue !== undefined ? keepValue : selectEl.value;
		while (selectEl.firstChild) {
			selectEl.removeChild(selectEl.firstChild);
		}
		var ph = document.createElement("option");
		ph.value = "";
		ph.textContent = "— Escolher dispositivo —";
		selectEl.appendChild(ph);
		for (var i = 0; i < sinks.length; i++) {
			var s = sinks[i];
			var o = document.createElement("option");
			o.value = s.name;
			o.textContent = s.name + (s.isDefault ? "  · predefinido" : "");
			selectEl.appendChild(o);
		}
		var ok = false;
		for (var j = 0; j < selectEl.options.length; j++) {
			if (selectEl.options[j].value === prev) {
				ok = true;
				break;
			}
		}
		selectEl.value = ok ? prev : "";
	}

	function applySinks(sinks, errorMsg) {
		lastSinks = sinks || [];
		if (errorMsg) {
			setStatus("error", errorMsg);
			populateSelect(primaryEl, [], "");
			populateSelect(secondaryEl, [], "");
			return;
		}
		if (!lastSinks.length) {
			setStatus("error", "Nenhum sink encontrado em wpctl status.");
			populateSelect(primaryEl, [], "");
			populateSelect(secondaryEl, [], "");
			return;
		}
		setStatus("ok", lastSinks.length + " dispositivo(s) de saída encontrados.");
		var p = primaryEl.value;
		var q = secondaryEl.value;
		if (pendingSettings) {
			p = pendingSettings.primaryName || "";
			q = pendingSettings.secondaryName || "";
		}
		populateSelect(primaryEl, lastSinks, p);
		populateSelect(secondaryEl, lastSinks, q);
		pendingSettings = null;
	}

	function sendSettings() {
		if (!websocket || websocket.readyState !== WebSocket.OPEN) {
			return;
		}
		// Persistir via plugin (setSettings no processo Node). O canal setSettings só do PI
		// falha em alguns hosts; o Stream Deck SDK grava perfil quando o plugin chama setSettings.
		websocket.send(
			JSON.stringify({
				event: "sendToPlugin",
				context: context,
				action: actionUUID,
				payload: {
					event: "saveSettings",
					primaryName: primaryEl.value,
					secondaryName: secondaryEl.value,
				},
			}),
		);
	}

	function scheduleSave() {
		if (saveTimer) {
			clearTimeout(saveTimer);
		}
		saveTimer = setTimeout(sendSettings, 350);
	}

	function requestSinks() {
		if (!websocket || websocket.readyState !== WebSocket.OPEN) {
			return;
		}
		setStatus("ok", "A pedir lista ao plugin…");
		websocket.send(
			JSON.stringify({
				event: "sendToPlugin",
				context: context,
				action: actionUUID,
				payload: { event: "requestSinks" },
			}),
		);
	}

	function applySettings(s) {
		if (!lastSinks.length) {
			pendingSettings = {
				primaryName: (s && s.primaryName) || "",
				secondaryName: (s && s.secondaryName) || "",
			};
			return;
		}
		pendingSettings = null;
		populateSelect(primaryEl, lastSinks, (s && s.primaryName) || "");
		populateSelect(secondaryEl, lastSinks, (s && s.secondaryName) || "");
	}

	// OpenDeck passa o 2.º argumento como contexto da instância (não o UUID do plugin).
	window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, _info, actionInfo) {
		pluginUUID = uuid;
		var ai = JSON.parse(actionInfo);
		context = ai.context;
		actionUUID = ai.action;

		websocket = new WebSocket("ws://127.0.0.1:" + port);

		websocket.onopen = function () {
			websocket.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID }));
			websocket.send(JSON.stringify({ event: "getSettings", context: context }));
			requestSinks();
		};

		websocket.onmessage = function (evt) {
			var data = JSON.parse(evt.data);
			if (data.event === "sendToPropertyInspector" && data.payload) {
				var pl = data.payload;
				if (pl.event === "sinksList") {
					applySinks(pl.sinks || [], pl.error);
				}
				return;
			}
			if (data.event === "didReceiveSettings" && data.payload && data.payload.settings) {
				applySettings(data.payload.settings);
			}
		};
	};

	document.getElementById("save").addEventListener("click", function () {
		sendSettings();
		setStatus("ok", "Definições guardadas.");
	});
	document.getElementById("reload").addEventListener("click", requestSinks);
	primaryEl.addEventListener("change", scheduleSave);
	secondaryEl.addEventListener("change", scheduleSave);
})();
