/* global window, document, WebSocket */
(function () {
	"use strict";

	var pluginUUID = null;
	var context = null;
	var actionUUID = null;
	var websocket = null;
	var saveTimer = null;

	var stepEl = document.getElementById("step");
	var stepLabelEl = document.getElementById("stepLabel");

	function clampStep(n) {
		var v = Math.round(Number(n));
		if (!isFinite(v)) {
			return 5;
		}
		return Math.min(25, Math.max(1, v));
	}

	function updateStepFill() {
		var min = Number(stepEl.min);
		var max = Number(stepEl.max);
		var val = Number(stepEl.value);
		var pct = ((val - min) / (max - min)) * 100;
		stepEl.style.setProperty("--fill", pct + "%");
	}

	function renderStepLabel() {
		var v = clampStep(stepEl.value);
		stepLabelEl.textContent = v + "%";
		updateStepFill();
	}

	function sendSave() {
		if (!websocket || websocket.readyState !== WebSocket.OPEN) {
			return;
		}
		websocket.send(
			JSON.stringify({
				event: "sendToPlugin",
				context: context,
				action: actionUUID,
				payload: {
					event: "saveMasterVolume",
					volumeStepPercent: clampStep(stepEl.value),
				},
			}),
		);
	}

	function scheduleSave() {
		if (saveTimer) {
			clearTimeout(saveTimer);
		}
		saveTimer = setTimeout(sendSave, 280);
	}

	stepEl.addEventListener("input", function () {
		renderStepLabel();
		scheduleSave();
	});

	window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, _info, actionInfo) {
		pluginUUID = uuid;
		var ai = JSON.parse(actionInfo);
		context = ai.context;
		actionUUID = ai.action;

		websocket = new WebSocket("ws://127.0.0.1:" + port);

		websocket.onopen = function () {
			websocket.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID }));
			websocket.send(JSON.stringify({ event: "getSettings", context: context }));
		};

		websocket.onmessage = function (evt) {
			var data = JSON.parse(evt.data);
			if (data.event === "sendToPropertyInspector" && data.payload) {
				var pl = data.payload;
				if (pl.event === "masterVolumeSettings") {
					stepEl.value = String(clampStep(pl.volumeStepPercent));
					renderStepLabel();
				}
				return;
			}
			if (data.event === "didReceiveSettings" && data.payload && data.payload.settings) {
				var s = data.payload.settings;
				if (typeof s.volumeStepPercent === "number") {
					stepEl.value = String(clampStep(s.volumeStepPercent));
					renderStepLabel();
				}
			}
		};
	};

	renderStepLabel();
})();
