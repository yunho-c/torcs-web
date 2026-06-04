import { CameraRig } from "./cameras.js";
import { Hud } from "./hud.js";
import { InputController } from "./input.js";
import { AssetManager } from "./assets.js";
import { createTorcsRuntime } from "./runtime.js";
import { TorcsScene } from "./scene.js";

const elements = {
	canvas: document.getElementById("renderer"),
	state: document.getElementById("state"),
	start: document.getElementById("start"),
	run: document.getElementById("run"),
	step: document.getElementById("step"),
	reset: document.getElementById("reset"),
	camera: document.getElementById("camera"),
	track: document.getElementById("track"),
	car: document.getElementById("car"),
	steer: document.getElementById("steer"),
	accel: document.getElementById("accel"),
	brake: document.getElementById("brake"),
	clutch: document.getElementById("clutch"),
	gearInput: document.getElementById("gear-input"),
	time: document.getElementById("time"),
	speed: document.getElementById("speed"),
	gear: document.getElementById("gear"),
	rpm: document.getElementById("rpm"),
	lap: document.getElementById("lap"),
	progress: document.getElementById("progress"),
	segment: document.getElementById("segment"),
	offset: document.getElementById("offset"),
};

const hud = new Hud(elements);
const scene = new TorcsScene(elements.canvas);
const cameras = new CameraRig(elements.canvas);
const assets = new AssetManager();
let runtime = null;
let running = false;
let lastTime = 0;
let snapshot = null;

function setEnabled(enabled) {
	elements.start.disabled = !runtime;
	elements.run.disabled = !enabled;
	elements.step.disabled = !enabled;
	elements.reset.disabled = !runtime;
}

function applyControls(controls = input.getControls()) {
	if (runtime) {
		runtime.setControls(controls);
	}
}

const input = new InputController({
	steer: elements.steer,
	accel: elements.accel,
	brake: elements.brake,
	clutch: elements.clutch,
	gear: elements.gearInput,
}, applyControls);

function readAndRender() {
	snapshot = runtime ? runtime.readSnapshot() : null;
	if (!snapshot) {
		return;
	}
	hud.update(snapshot);
	scene.updateCar(snapshot);
	cameras.update(snapshot);
	scene.render(cameras.camera);
}

function step(deltaTime = 1 / 60) {
	if (!runtime || !runtime.active) {
		return;
	}
	applyControls();
	runtime.step(deltaTime);
	readAndRender();
}

function animate(time) {
	const seconds = time * 0.001;
	const delta = Math.min(1 / 30, Math.max(1 / 120, lastTime ? seconds - lastTime : 1 / 60));
	lastTime = seconds;

	if (scene.resize()) {
		cameras.updateProjection();
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
		const [track, car] = await Promise.all([
			assets.loadTrack(elements.track.value),
			assets.loadCar(elements.car.value),
		]);
		scene.setTrackVisual(track ? track.scene : null);
		scene.setCarVisual(car ? car.scene : null);
		return Boolean(track && car);
	} catch (error) {
		console.warn("TORCS web renderer asset load failed", error);
		scene.setTrackVisual(null);
		scene.setCarVisual(null);
		return false;
	}
}

async function startSession() {
	if (!runtime) {
		return;
	}
	running = false;
	elements.run.textContent = "Run";
	const ok = runtime.start(elements.track.value, elements.car.value);
	if (!ok) {
		hud.setState("failed");
		setEnabled(false);
		return;
	}
	applyControls();
	scene.setTrack(runtime.readTrackSamples());
	snapshot = runtime.readSnapshot();
	scene.updateCar(snapshot);
	hud.setState("ready");
	setEnabled(true);
	const hasAssets = await loadVisualAssets();
	hud.setState(hasAssets ? "ready" : "debug");
	readAndRender();
}

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
elements.camera.addEventListener("change", () => {
	cameras.setMode(elements.camera.value);
	if (snapshot) {
		readAndRender();
	}
});
window.addEventListener("resize", () => {
	scene.resize();
	cameras.updateProjection();
	if (snapshot) {
		readAndRender();
	}
});

setEnabled(false);
hud.setState("loading");

createTorcsRuntime()
	.then((loadedRuntime) => {
		runtime = loadedRuntime;
		hud.setState("loaded");
		setEnabled(false);
		elements.start.disabled = false;
		cameras.updateProjection();
		requestAnimationFrame(animate);
	})
	.catch((error) => {
		console.error(error);
		hud.setState("failed");
	});
