import { CameraRig } from "./cameras.js";
import { Hud } from "./hud.js";
import { InputController } from "./input.js";
import { AssetManager } from "./assets.js";
import { TorcsAudio } from "./audio.js";
import { DualSenseHaptics } from "./haptics.js";
import { createTorcsRuntime } from "./runtime.js";
import { TorcsScene } from "./scene.js";
import { warnOnce } from "./diagnostics.js";

const elements = {
	canvas: document.getElementById("renderer"),
	state: document.getElementById("state"),
	start: document.getElementById("start"),
	run: document.getElementById("run"),
	step: document.getElementById("step"),
	reset: document.getElementById("reset"),
	audio: document.getElementById("audio"),
	volume: document.getElementById("volume"),
		audioState: document.getElementById("audio-state"),
		haptics: document.getElementById("haptics"),
		rumbleConfigOpen: document.getElementById("rumble-config-open"),
		hapticsIntensity: document.getElementById("haptics-intensity"),
		hapticsTriggerStrength: document.getElementById("haptics-trigger-strength"),
		hapticsState: document.getElementById("haptics-state"),
		rumbleConfigModal: document.getElementById("rumble-config-modal"),
		rumbleConfigClose: document.getElementById("rumble-config-close"),
		rumbleConfigBody: document.getElementById("rumble-config-body"),
		rumbleConfigJson: document.getElementById("rumble-config-json"),
		rumbleConfigReset: document.getElementById("rumble-config-reset"),
		rumbleConfigCopy: document.getElementById("rumble-config-copy"),
		rumbleConfigPaste: document.getElementById("rumble-config-paste"),
		camera: document.getElementById("camera"),
		renderProfile: document.getElementById("render-profile"),
		lightIntensity: document.getElementById("light-intensity"),
		lightIntensityValue: document.getElementById("light-intensity-value"),
		track: document.getElementById("track"),
		car: document.getElementById("car"),
	carCount: document.getElementById("car-count"),
	currentCar: document.getElementById("current-car"),
	steer: document.getElementById("steer"),
	accel: document.getElementById("accel"),
	brake: document.getElementById("brake"),
	clutch: document.getElementById("clutch"),
	gearInput: document.getElementById("gear-input"),
	time: document.getElementById("time"),
	speed: document.getElementById("speed"),
	gear: document.getElementById("gear"),
	rpm: document.getElementById("rpm"),
	position: document.getElementById("position"),
	fuel: document.getElementById("fuel"),
	lap: document.getElementById("lap"),
	currentLap: document.getElementById("current-lap"),
	lastLap: document.getElementById("last-lap"),
	bestLap: document.getElementById("best-lap"),
	topSpeed: document.getElementById("top-speed"),
	progress: document.getElementById("progress"),
	segment: document.getElementById("segment"),
	offset: document.getElementById("offset"),
	map: document.getElementById("track-map"),
	standings: document.getElementById("standings"),
};

const hud = new Hud(elements);
const DEFAULT_TRACK_PATH = "/torcs/data/tracks/e-track-1/e-track-1.xml";
const DEFAULT_CAR_PATH = "/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml";
const DEFAULT_LIGHT_INTENSITY = 1.5;
const RENDER_PROFILES = new Set(["legacy", "modern"]);
let scene = null;
let cameras = null;
let assets = null;
let audio = null;
let haptics = null;
let input = null;
let runtime = null;
let activeRenderProfile = getInitialRenderProfile();
let activeLightIntensity = getInitialLightIntensity();
let running = false;
let lastTime = 0;
let snapshot = null;
let snapshots = [];
let carAssets = new Map();
let selectedCarIndex = 0;

const RUMBLE_CONFIG_SOURCES = [
	{
		id: "engine",
		label: "Engine",
		controls: [
			["gain", "Gain", 0, 2, 0.01],
			["modulationDepth", "Mod", 0, 2, 0.01],
			["rateScale", "Rate", 0.25, 2, 0.01],
		],
	},
	{
		id: "slip",
		label: "Slip",
		controls: [
			["gain", "Gain", 0, 2, 0.01],
			["pulseRate", "Rate", 1, 30, 0.1],
		],
	},
	{
		id: "texture",
		label: "Texture",
		controls: [
			["gain", "Gain", 0, 2, 0.01],
			["noise", "Noise", 0, 2, 0.01],
		],
	},
	{
		id: "gear",
		label: "Gear",
		controls: [
			["gain", "Gain", 0, 2, 0.01],
			["decay", "Decay", 0.02, 0.5, 0.005],
		],
	},
	{
		id: "collision",
		label: "Collision",
		controls: [
			["gain", "Gain", 0, 2, 0.01],
			["decay", "Decay", 0.04, 0.8, 0.005],
		],
	},
	{
		id: "abs",
		label: "ABS",
		controls: [
			["gain", "Gain", 0, 2, 0.01],
			["pulseRate", "Rate", 1, 30, 0.1],
		],
	},
];

function findSnapshotByCarIndex(carIndex) {
	return snapshots.find((values, index) => (values.carIndex ?? index) === carIndex) || null;
}

function normalizeRenderProfile(profile) {
	return RENDER_PROFILES.has(profile) ? profile : "legacy";
}

function getInitialRenderProfile() {
	const params = new URLSearchParams(window.location.search);
	return normalizeRenderProfile(params.get("profile"));
}

function getInitialLightIntensity() {
	const params = new URLSearchParams(window.location.search);
	const value = Number(params.get("lightIntensity"));
	return Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : DEFAULT_LIGHT_INTENSITY;
}

function formatLightIntensity(value) {
	return value.toFixed(2);
}

function formatRumbleConfigJson(config = haptics?.getRumbleConfig?.()) {
	return JSON.stringify(config || {}, null, 2);
}

function updateRumbleConfigJson() {
	if (!elements.rumbleConfigJson || !haptics) {
		return;
	}
	elements.rumbleConfigJson.value = formatRumbleConfigJson();
}

function applyRumbleConfigChange(sourceId, updates) {
	if (!haptics) {
		return;
	}
	haptics.setRumbleConfig({ [sourceId]: updates });
	updateRumbleConfigUi();
}

function updateRumbleConfigUi() {
	if (!elements.rumbleConfigBody || !haptics) {
		return;
	}
	const config = haptics.getRumbleConfig();
	for (const source of RUMBLE_CONFIG_SOURCES) {
		const row = elements.rumbleConfigBody.querySelector(`[data-rumble-source="${source.id}"]`);
		if (!row || !config[source.id]) {
			continue;
		}
		const enabled = row.querySelector(`[data-rumble-enabled="${source.id}"]`);
		const solo = row.querySelector(`[data-rumble-solo="${source.id}"]`);
		if (enabled) {
			enabled.checked = Boolean(config[source.id].enabled);
		}
		if (solo) {
			solo.textContent = config.soloSource === source.id ? "Soloed" : "Solo";
			solo.dataset.active = config.soloSource === source.id ? "true" : "false";
		}
		for (const [key] of source.controls) {
			const input = row.querySelector(`[data-rumble-control="${source.id}.${key}"]`);
			const value = row.querySelector(`[data-rumble-value="${source.id}.${key}"]`);
			if (input) {
				input.value = String(config[source.id][key]);
			}
			if (value) {
				value.textContent = Number(config[source.id][key]).toFixed(key === "decay" ? 3 : 2);
			}
		}
	}
	updateRumbleConfigJson();
}

function buildRumbleConfigUi() {
	if (!elements.rumbleConfigBody || !haptics) {
		return;
	}
	elements.rumbleConfigBody.textContent = "";
	for (const source of RUMBLE_CONFIG_SOURCES) {
		const row = document.createElement("div");
		row.className = "rumble-source-row";
		row.dataset.rumbleSource = source.id;

		const name = document.createElement("div");
		name.className = "rumble-source-name";
		name.textContent = source.label;
		row.append(name);

		const toggles = document.createElement("div");
		toggles.className = "rumble-source-toggles";
		const enabledLabel = document.createElement("label");
		const enabled = document.createElement("input");
		enabled.type = "checkbox";
		enabled.dataset.rumbleEnabled = source.id;
		enabled.addEventListener("change", () => applyRumbleConfigChange(source.id, { enabled: enabled.checked }));
		enabledLabel.append(enabled, " On");
		const solo = document.createElement("button");
		solo.type = "button";
		solo.dataset.rumbleSolo = source.id;
		solo.addEventListener("click", () => {
			const config = haptics.getRumbleConfig();
			haptics.setRumbleConfig({ soloSource: config.soloSource === source.id ? "" : source.id });
			updateRumbleConfigUi();
		});
		toggles.append(enabledLabel, solo);
		row.append(toggles);

		const gain = document.createElement("div");
		gain.className = "rumble-source-controls";
		const extra = document.createElement("div");
		extra.className = "rumble-source-controls";
		source.controls.forEach(([key, label, min, max, step], index) => {
			const controlLabel = document.createElement("label");
			controlLabel.textContent = label;
			const input = document.createElement("input");
			input.type = "range";
			input.min = String(min);
			input.max = String(max);
			input.step = String(step);
			input.dataset.rumbleControl = `${source.id}.${key}`;
			const value = document.createElement("span");
			value.className = "inline-value";
			value.dataset.rumbleValue = `${source.id}.${key}`;
			input.addEventListener("input", () => {
				applyRumbleConfigChange(source.id, { [key]: Number(input.value) });
			});
			controlLabel.append(input, value);
			(index === 0 ? gain : extra).append(controlLabel);
		});
		row.append(gain, extra);
		elements.rumbleConfigBody.append(row);
	}
	updateRumbleConfigUi();
}

function setRumbleConfigOpen(open) {
	if (!elements.rumbleConfigModal) {
		return;
	}
	elements.rumbleConfigModal.classList.toggle("open", open);
	elements.rumbleConfigModal.setAttribute("aria-hidden", open ? "false" : "true");
	if (open) {
		updateRumbleConfigUi();
	}
}

function setEnabled(enabled) {
	elements.start.disabled = !runtime;
	elements.run.disabled = !enabled;
	elements.step.disabled = !enabled;
	elements.reset.disabled = !runtime;
	elements.audio.disabled = !runtime;
	elements.haptics.disabled = !runtime;
	elements.rumbleConfigOpen.disabled = !runtime;
}

function applyControls(controls = input.getControls()) {
	if (runtime) {
		runtime.setControls(controls);
	}
}

function runtimeAssetPath(manifestPath) {
	return manifestPath.startsWith("/torcs/") ? manifestPath : `/torcs/${manifestPath}`;
}

function assetIdFromPath(manifestPath) {
	const parts = manifestPath.split("/");
	const file = parts[parts.length - 1] || "";
	return file.replace(/\.xml$/, "") || manifestPath;
}

function makeAssetLabel(entry, manifestPath) {
	const id = assetIdFromPath(manifestPath);
	const name = entry && entry.name ? entry.name : id;
	return name === id ? name : `${name} (${id})`;
}

function makeAssetOptions(entries, type) {
	return Object.entries(entries || {})
		.map(([manifestPath, entry]) => ({
			value: runtimeAssetPath(manifestPath),
			label: makeAssetLabel(entry, manifestPath),
			category: entry && entry.category ? entry.category : "",
			id: assetIdFromPath(manifestPath),
			type,
		}))
		.sort((a, b) =>
			a.category.localeCompare(b.category) ||
			a.label.localeCompare(b.label) ||
			a.id.localeCompare(b.id));
}

function populateSelect(select, options, preferredValue) {
	const fallbackValue = select.value;
	select.textContent = "";
	for (const item of options) {
		const option = document.createElement("option");
		option.value = item.value;
		option.textContent = item.label;
		if (item.category) {
			option.dataset.category = item.category;
		}
		select.append(option);
	}
	if (options.some((item) => item.value === preferredValue)) {
		select.value = preferredValue;
	} else if (options.some((item) => item.value === fallbackValue)) {
		select.value = fallbackValue;
	}
}

async function populateAssetSelects() {
	try {
		const manifest = await assets.loadManifest();
		const trackOptions = makeAssetOptions(manifest.tracks, "track");
		const carOptions = makeAssetOptions(manifest.cars, "car");
		if (trackOptions.length) {
			populateSelect(elements.track, trackOptions, DEFAULT_TRACK_PATH);
		}
		if (carOptions.length) {
			populateSelect(elements.car, carOptions, DEFAULT_CAR_PATH);
		}
	} catch (error) {
		console.warn("TORCS web renderer asset manifest discovery failed", error);
	}
}

function readAndRender(deltaTime = 0) {
	snapshots = runtime ? runtime.readSnapshots() : [];
	snapshot = findSnapshotByCarIndex(selectedCarIndex) || snapshots[0] || null;
	if (!snapshot) {
		return;
	}
	hud.update(snapshot, snapshots, selectedCarIndex);
	cameras.update(snapshot, input ? input.getCameraLookaround() : "");
	scene.updateCars(snapshots, cameras.camera, selectedCarIndex, carAssets);
	audio.update(snapshot, cameras.camera, deltaTime);
	haptics.update(snapshot, deltaTime);
	scene.render(cameras.camera);
}

async function warnCarVisualFallbacks(assetsByCarIndex, fallbackAsset) {
	if (!assets || !snapshots.length) {
		return;
	}
	await Promise.all(snapshots.map(async (values, index) => {
		const carIndex = values.carIndex ?? index;
		const modelName = values.carModelName || "";
		const expected = await assets.resolveCarPathByModelName(modelName);
		const asset = assetsByCarIndex.get(carIndex);
		if (modelName && (!expected || !asset || !asset.entry || asset.entry.source !== expected)) {
			warnOnce(
				`car-model-visual-fallback:${carIndex}:${modelName}`,
				"TORCS web renderer using selected car visual fallback for runtime car model",
				{
					carIndex,
					modelName,
					expected,
					fallback: fallbackAsset && fallbackAsset.entry ? fallbackAsset.entry.source : "",
				},
			);
		}
	}));
}

function syncCurrentCarOptions() {
	const count = runtime ? runtime.carCount : 0;
	const previous = String(selectedCarIndex);
	elements.currentCar.textContent = "";
	for (let i = 0; i < count; i += 1) {
		const option = document.createElement("option");
		option.value = String(i);
		option.textContent = snapshots[i] && snapshots[i].driverLabel ? snapshots[i].driverLabel : `car ${i + 1}`;
		elements.currentCar.append(option);
	}
	if (count > 0) {
		selectedCarIndex = Math.min(Number(previous) || 0, count - 1);
		elements.currentCar.value = String(selectedCarIndex);
	}
}

function step(deltaTime = 1 / 60) {
	if (!runtime || !runtime.active) {
		return;
	}
	input.update(deltaTime, snapshot);
	applyControls();
	runtime.step(deltaTime);
	readAndRender(deltaTime);
}

function animate(time) {
	const seconds = time * 0.001;
	const delta = Math.min(1 / 30, Math.max(1 / 120, lastTime ? seconds - lastTime : 1 / 60));
	lastTime = seconds;

	if (scene.resize()) {
		cameras.updateProjection();
		hud.resizeMap();
	}
	if (running) {
		step(delta);
	} else if (snapshot) {
		readAndRender();
	}
	requestAnimationFrame(animate);
}

async function loadVisualAssets() {
	try {
		const [track, selectedCarAsset, effects] = await Promise.all([
			assets.loadTrack(elements.track.value),
			assets.loadCar(elements.car.value),
			assets.loadEffects(),
		]);
		carAssets = runtime && runtime.active && snapshots.length
			? await assets.loadCarAssetsForSnapshots(snapshots, elements.car.value)
			: new Map([[selectedCarIndex, selectedCarAsset]]);
		await warnCarVisualFallbacks(carAssets, selectedCarAsset);
		scene.setTrackVisual(track ? track.scene : null);
		scene.setTrackAtmosphere(track ? track.entry : null, track ? track.backgroundTexture : null);
		scene.setCarVisualAssets(carAssets, selectedCarAsset);
		scene.setEffectTextures(effects ? effects.textures : null);
		if (!track) {
			warnOnce(
				`track-visual-fallback:${elements.track.value}`,
				"TORCS web renderer using runtime sampled track geometry fallback",
				{
					track: elements.track.value,
					reason: "converted track visual unavailable",
				},
			);
		}
		if (!selectedCarAsset) {
			warnOnce(
				`car-visual-fallback:${elements.car.value}`,
				"TORCS web renderer using generated car box and wheel fallback",
				{
					car: elements.car.value,
					reason: "converted car asset unavailable",
				},
			);
		}
		return Boolean(track && selectedCarAsset);
	} catch (error) {
		console.warn("TORCS web renderer asset load failed", error);
		scene.setTrackVisual(null);
		scene.setTrackAtmosphere(null, null);
		carAssets = new Map();
		scene.setCarVisualAssets(carAssets, null);
		scene.setEffectTextures(null);
		return false;
	}
}

async function applyRenderProfile(profile, reloadVisuals = false) {
	activeRenderProfile = normalizeRenderProfile(profile);
	elements.renderProfile.value = activeRenderProfile;
	if (scene) {
		scene.setRenderProfile(activeRenderProfile);
	}
	if (assets) {
		assets.setRenderProfile(activeRenderProfile);
	}
	if (reloadVisuals && runtime && runtime.active) {
		hud.setState("loading");
		const hasAssets = await loadVisualAssets();
		hud.setState(hasAssets ? (running ? "running" : "ready") : "debug");
	}
	if (snapshot) {
		readAndRender();
	}
}

function applyLightIntensity(value) {
	const nextIntensity = Number(value);
	activeLightIntensity = Number.isFinite(nextIntensity) ? Math.max(0, Math.min(3, nextIntensity)) : DEFAULT_LIGHT_INTENSITY;
	elements.lightIntensity.value = String(activeLightIntensity);
	elements.lightIntensityValue.textContent = formatLightIntensity(activeLightIntensity);
	if (scene) {
		scene.setLightIntensityScale(activeLightIntensity);
	}
	if (snapshot) {
		readAndRender();
	}
}

async function startSession() {
	if (!runtime) {
		return;
	}
	running = false;
	elements.run.textContent = "Run";
	const carCount = Math.max(1, Math.min(4, Number(elements.carCount.value) || 1));
	const ok = runtime.start(elements.track.value, elements.car.value, carCount);
	if (!ok) {
		hud.setState("failed");
		setEnabled(false);
		return;
	}
	selectedCarIndex = 0;
	if (haptics) {
		haptics.resetDynamics();
	}
	applyControls();
	const trackSamples = runtime.readTrackSamples();
	scene.setTrack(trackSamples);
	cameras.setTrack(trackSamples);
	hud.setTrack(trackSamples);
	snapshots = runtime.readSnapshots();
	snapshot = findSnapshotByCarIndex(selectedCarIndex) || snapshots[0] || null;
	syncCurrentCarOptions();
	cameras.update(snapshot, input ? input.getCameraLookaround() : "");
	scene.updateCars(snapshots, cameras.camera, selectedCarIndex, carAssets);
	hud.setState("ready");
	setEnabled(true);
	const hasAssets = await loadVisualAssets();
	await audio.reload(elements.car.value);
	hud.setState(hasAssets ? "ready" : "debug");
	readAndRender();
}

function bindUi() {
	elements.start.addEventListener("click", startSession);
	elements.step.addEventListener("click", () => step());
	elements.run.addEventListener("click", () => {
		if (!runtime || !runtime.active) {
			return;
		}
		running = !running;
		elements.run.textContent = running ? "Pause" : "Run";
		hud.setState(running ? "running" : "ready");
	});
	elements.reset.addEventListener("click", startSession);
	elements.audio.addEventListener("click", async () => {
		if (audio.enabled) {
			audio.disable();
			return;
		}
		try {
			await audio.enable(elements.car.value);
			if (snapshot) {
				audio.update(snapshot, cameras.camera, 0);
			}
		} catch (error) {
			console.warn("TORCS web audio failed to start", error);
		}
	});
	elements.volume.addEventListener("input", () => {
		audio.setVolume(Number(elements.volume.value));
	});
	elements.haptics.addEventListener("click", async () => {
		if (haptics.enabled) {
			haptics.disable();
			return;
		}
		try {
			await haptics.enable();
			if (snapshot) {
				haptics.update(snapshot, 0);
			}
		} catch (error) {
			console.warn("TORCS web DualSense haptics failed to start", error);
		}
	});
	elements.hapticsIntensity.addEventListener("input", () => {
		haptics.setIntensity(Number(elements.hapticsIntensity.value));
	});
	elements.hapticsTriggerStrength.addEventListener("input", () => {
		haptics.setTriggerStrength(Number(elements.hapticsTriggerStrength.value));
	});
	elements.rumbleConfigOpen.addEventListener("click", () => setRumbleConfigOpen(true));
	elements.rumbleConfigClose.addEventListener("click", () => setRumbleConfigOpen(false));
	elements.rumbleConfigModal.addEventListener("click", (event) => {
		if (event.target === elements.rumbleConfigModal) {
			setRumbleConfigOpen(false);
		}
	});
	elements.rumbleConfigReset.addEventListener("click", () => {
		haptics.resetRumbleConfig();
		updateRumbleConfigUi();
	});
	elements.rumbleConfigCopy.addEventListener("click", async () => {
		const json = formatRumbleConfigJson();
		elements.rumbleConfigJson.value = json;
		try {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				await navigator.clipboard.writeText(json);
			}
		} catch (error) {
			console.warn("TORCS web DualSense rumble config copy failed", error);
		}
	});
	elements.rumbleConfigPaste.addEventListener("click", async () => {
		let json = elements.rumbleConfigJson.value;
		if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
			try {
				const clipboardJson = await navigator.clipboard.readText();
				if (clipboardJson.trim()) {
					json = clipboardJson;
					elements.rumbleConfigJson.value = json;
				}
			} catch (error) {
				console.warn("TORCS web DualSense rumble config clipboard read failed; using textarea JSON", error);
			}
		}
		try {
			haptics.importRumbleConfig(json);
			updateRumbleConfigUi();
		} catch (error) {
			console.warn("TORCS web DualSense rumble config paste failed", error);
		}
	});
	window.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			setRumbleConfigOpen(false);
		}
	});
	elements.camera.addEventListener("change", () => {
		cameras.setMode(elements.camera.value);
		if (snapshot) {
			readAndRender();
		}
	});
		elements.renderProfile.addEventListener("change", () => {
			applyRenderProfile(elements.renderProfile.value, true).catch((error) => {
				console.warn("TORCS web renderer render profile switch failed", error);
				hud.setState("debug");
			});
		});
		elements.lightIntensity.addEventListener("input", () => {
			applyLightIntensity(Number(elements.lightIntensity.value));
		});
		elements.currentCar.addEventListener("change", () => {
		selectedCarIndex = Number(elements.currentCar.value) || 0;
		if (snapshot) {
			readAndRender();
		}
	});
	window.addEventListener("resize", () => {
		scene.resize();
		cameras.updateProjection();
		hud.resizeMap();
		if (snapshot) {
			readAndRender();
		}
	});
}

async function main() {
	setEnabled(false);
	hud.setState("loading");

		try {
			scene = await TorcsScene.create(elements.canvas);
			scene.setRenderProfile(activeRenderProfile);
			applyLightIntensity(activeLightIntensity);
			cameras = new CameraRig(elements.canvas);
			assets = new AssetManager("./web-assets/", scene.renderer, activeRenderProfile);
			elements.renderProfile.value = activeRenderProfile;
		audio = new TorcsAudio("./web-assets/", (status) => {
			elements.audioState.textContent = status;
			elements.audio.textContent = audio.enabled ? "Stop" : "Audio";
		});
		haptics = new DualSenseHaptics((status, diagnostics = {}) => {
			elements.hapticsState.textContent = status;
			elements.hapticsState.title = diagnostics.summary || "";
			elements.haptics.textContent = haptics.enabled ? "Stop" : "Haptics";
		});
		window.torcsHaptics = haptics;
		haptics.setIntensity(Number(elements.hapticsIntensity.value));
		haptics.setTriggerStrength(Number(elements.hapticsTriggerStrength.value));
		buildRumbleConfigUi();
		input = new InputController({
			steer: elements.steer,
			accel: elements.accel,
			brake: elements.brake,
			clutch: elements.clutch,
			gear: elements.gearInput,
		}, applyControls);
		bindUi();

		const [loadedRuntime] = await Promise.all([createTorcsRuntime(), populateAssetSelects()]);
		runtime = loadedRuntime;
		hud.setState("loaded");
		setEnabled(false);
		elements.start.disabled = false;
		cameras.updateProjection();
		requestAnimationFrame(animate);
	} catch (error) {
		console.error(error);
		hud.setState("failed");
	}
}

main();
