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
		hapticsIntensity: document.getElementById("haptics-intensity"),
		hapticsState: document.getElementById("haptics-state"),
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

function setEnabled(enabled) {
	elements.start.disabled = !runtime;
	elements.run.disabled = !enabled;
	elements.step.disabled = !enabled;
	elements.reset.disabled = !runtime;
	elements.audio.disabled = !runtime;
	elements.haptics.disabled = !runtime;
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
		haptics = new DualSenseHaptics((status) => {
			elements.hapticsState.textContent = status;
			elements.haptics.textContent = haptics.enabled ? "Stop" : "Haptics";
		});
		haptics.setIntensity(Number(elements.hapticsIntensity.value));
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
