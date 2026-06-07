#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(process.argv[2] || ".");

function fail(message, details) {
	console.error(message);
	if (details) {
		console.error(JSON.stringify(details));
	}
	process.exit(1);
}

function read(relativePath) {
	const filePath = path.join(root, relativePath);
	if (!fs.existsSync(filePath)) {
		fail("TORCS web renderer smoke test missing file", { file: relativePath });
	}
	return fs.readFileSync(filePath, "utf8");
}

function requireText(file, text, label) {
	if (!file.content.includes(text)) {
		fail("TORCS web renderer smoke test missing expected content", {
			file: file.path,
			label,
		});
	}
}

function checkJavaScriptSyntax(file) {
	const result = childProcess.spawnSync(process.execPath, ["--input-type=module", "--check"], {
		encoding: "utf8",
		input: file.content,
	});
	if (result.status !== 0) {
		fail("TORCS web renderer smoke test found invalid JavaScript", {
			file: file.path,
			stdout: result.stdout.trim(),
			stderr: result.stderr.trim(),
		});
	}
}

function checkGlb(relativePath) {
	const filePath = path.join(root, "web-assets", relativePath);
	const data = fs.readFileSync(filePath);
	if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2) {
		fail("TORCS web renderer smoke test found invalid GLB", { file: relativePath });
	}
}

function checkPng(relativePath) {
	const filePath = path.join(root, "web-assets", relativePath);
	const data = fs.readFileSync(filePath);
	if (data.length < 8 || data[0] !== 0x89 || data.toString("ascii", 1, 4) !== "PNG") {
		fail("TORCS web renderer smoke test found invalid PNG", { file: relativePath });
	}
}

function checkWav(relativePath) {
	const filePath = path.join(root, "web-assets", relativePath);
	const data = fs.readFileSync(filePath);
	if (data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF" ||
		data.toString("ascii", 8, 12) !== "WAVE") {
		fail("TORCS web renderer smoke test found invalid WAV", { file: relativePath });
	}
}

function checkObjectNames(entry, label) {
	if (!Array.isArray(entry.objectNames) || entry.objectNames.length === 0 ||
		entry.objectNames.some((name) => typeof name !== "string" || name.length === 0)) {
		fail("TORCS web renderer smoke test found missing object names", { label });
	}
}

function checkNumberTriplet(entry, field, label) {
	if (!Array.isArray(entry[field]) || entry[field].length !== 3 ||
		entry[field].some((value) => typeof value !== "number" || !Number.isFinite(value))) {
		fail("TORCS web renderer smoke test found malformed track atmosphere metadata", {
			label,
			field,
		});
	}
}

function extendBounds(bounds, x, z) {
	bounds.minX = Math.min(bounds.minX, x);
	bounds.maxX = Math.max(bounds.maxX, x);
	bounds.minZ = Math.min(bounds.minZ, z);
	bounds.maxZ = Math.max(bounds.maxZ, z);
}

function readGlbJson(relativePath) {
	const filePath = path.join(root, "web-assets", relativePath);
	const data = fs.readFileSync(filePath);
	let offset = 12;
	while (offset < data.length) {
		const length = data.readUInt32LE(offset);
		const kind = data.toString("ascii", offset + 4, offset + 8);
		offset += 8;
		if (kind === "JSON") {
			return JSON.parse(data.subarray(offset, offset + length).toString("utf8"));
		}
		offset += length;
	}
	fail("TORCS web renderer smoke test could not find GLB JSON", { file: relativePath });
	return null;
}

function readPositionBounds(relativePath) {
	const gltf = readGlbJson(relativePath);
	const bounds = {
		minX: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		minZ: Number.POSITIVE_INFINITY,
		maxZ: Number.NEGATIVE_INFINITY,
	};
	for (const mesh of gltf.meshes || []) {
		for (const primitive of mesh.primitives || []) {
			const positionAccessor = gltf.accessors[primitive.attributes.POSITION];
			if (!positionAccessor || !positionAccessor.min || !positionAccessor.max) {
				fail("TORCS web renderer smoke test found GLB position accessor without bounds", {
					file: relativePath,
				});
			}
			extendBounds(bounds, positionAccessor.min[0], positionAccessor.min[2]);
			extendBounds(bounds, positionAccessor.max[0], positionAccessor.max[2]);
		}
	}
	if (!Number.isFinite(bounds.minX)) {
		fail("TORCS web renderer smoke test found GLB without position bounds", { file: relativePath });
	}
	return bounds;
}

async function importAudioModuleForSmoke() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "torcs-audio-smoke-"));
	const rendererDir = path.join(tempDir, "renderer");
	fs.mkdirSync(rendererDir, { recursive: true });
	try {
		const audioSource = byPath["renderer/audio.js"].content.replace(
			"import * as THREE from \"three\";",
			`const THREE = {
\tVector3: class {
\t\tconstructor(x = 0, y = 0, z = 0) {
\t\t\tthis.x = x;
\t\t\tthis.y = y;
\t\t\tthis.z = z;
\t\t}
\t\tset(x, y, z) {
\t\t\tthis.x = x;
\t\t\tthis.y = y;
\t\t\tthis.z = z;
\t\t\treturn this;
\t\t}
\t},
};`,
		);
		fs.writeFileSync(path.join(tempDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
		fs.writeFileSync(path.join(rendererDir, "audio.js"), audioSource, "utf8");
		fs.writeFileSync(path.join(rendererDir, "runtime.js"), byPath["renderer/runtime.js"].content, "utf8");
		const tag = Date.now();
		const audioModule = await import(`${pathToFileURL(path.join(rendererDir, "audio.js")).href}?smoke=${tag}`);
		const runtimeModule = await import(`${pathToFileURL(path.join(rendererDir, "runtime.js")).href}?smoke=${tag}`);
		return {
			...audioModule,
			SNAPSHOT: runtimeModule.SNAPSHOT,
		};
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

function makeAudioSnapshot(SNAPSHOT, overrides = {}) {
	const values = new Array(175).fill(0);
	values[SNAPSHOT.x] = 10;
	values[SNAPSHOT.y] = 20;
	values[SNAPSHOT.z] = 1.5;
	values[SNAPSHOT.yaw] = Math.PI / 3;
	values[SNAPSHOT.speed] = 35;
	values[SNAPSHOT.engineRpm] = 3600;
	values[SNAPSHOT.engineRedline] = 7000;
	values[SNAPSHOT.controlAccel] = 0.8;
	values[SNAPSHOT.gearRatio] = 3.2;
	values[SNAPSHOT.engineSmoke] = 0.7;
	for (let i = 0; i < 4; i += 1) {
		values[SNAPSHOT.wheelRelX0 + i] = i < 2 ? 1.1 : -1.1;
		values[SNAPSHOT.wheelRelY0 + i] = i % 2 === 0 ? 0.7 : -0.7;
		values[SNAPSHOT.wheelRelZ0 + i] = -0.3;
		values[SNAPSHOT.wheelSkidIntensity0 + i] = i === 0 ? 0.42 : 0.02;
		values[SNAPSHOT.wheelSlipAccel0 + i] = 4;
		values[SNAPSHOT.wheelReaction0 + i] = 3200;
		values[SNAPSHOT.wheelRoughnessFrequency0 + i] = 1.2;
		values[SNAPSHOT.wheelRoughness0 + i] = 0.35;
		values[SNAPSHOT.wheelOtherSurfaceContribution0 + i] = 0;
		values[SNAPSHOT.wheelOtherSurfaceKind0 + i] = 0;
		values[SNAPSHOT.wheelOtherRoughnessFrequency0 + i] = 1;
		values[SNAPSHOT.wheelOtherRoughness0 + i] = 0.2;
		values[SNAPSHOT.wheelSurfaceStyle0 + i] = 0;
		values[SNAPSHOT.wheelOtherSurfaceStyle0 + i] = 0;
	}
	for (const [key, value] of Object.entries(overrides)) {
		values[SNAPSHOT[key]] = value;
	}
	return values;
}

function assertAudio(condition, label, details = {}) {
	if (!condition) {
		fail("TORCS web renderer smoke test found audio model behavior mismatch", {
			label,
			...details,
		});
	}
}

async function checkAudioModelBehavior() {
	const audioModule = await importAudioModuleForSmoke();
	const { CarAudioModel, SNAPSHOT } = audioModule;
	const carSound = {
		rpmScale: 1.2,
		turbo: true,
		turboRpm: 100,
		turboLag: 1,
	};

	const activeModel = new CarAudioModel();
	const active = activeModel.update(makeAudioSnapshot(SNAPSHOT), carSound);
	assertAudio(active.engine.volume > 0, "active engine loop", active.engine);
	assertAudio(Math.abs(active.engine.pitch - 7.2) < 0.000001, "engine pitch follows rpm scale", active.engine);
	assertAudio(active.roadRide.volume > 0, "active road ride loop", active.roadRide);
	assertAudio(active.backfireLoop.volume > 0, "active backfire loop", active.backfireLoop);

	const eventModel = new CarAudioModel();
	const eventValues = makeAudioSnapshot(SNAPSHOT, {
		gearChangeEvent: 1,
		collisionEvent: 31,
	});
	const eventState = eventModel.update(eventValues, carSound);
	const eventNames = eventState.events.map((event) => event.name).sort();
	assertAudio(eventState.metalSkid.volume > 0, "latched drag collision loop", eventState.metalSkid);
	for (const name of ["bang", "bottomCrash", "crash", "gearChange"]) {
		assertAudio(eventNames.includes(name), "latched one-shot event", { name, eventNames });
	}

	const repeatedDragCrashModel = new CarAudioModel();
	const firstDragImpact = repeatedDragCrashModel.update(makeAudioSnapshot(SNAPSHOT, {
		collisionEvent: 3,
	}), carSound);
	const continuedDragImpact = repeatedDragCrashModel.update(makeAudioSnapshot(SNAPSHOT, {
		collisionEvent: 3,
	}), carSound);
	assertAudio(
		firstDragImpact.events.some((event) => event.name === "crash"),
		"new drag collision crash event",
		{ events: firstDragImpact.events },
	);
	assertAudio(
		!continuedDragImpact.events.some((event) => event.name === "crash"),
		"continued drag collision suppresses repeated crash",
		{ events: continuedDragImpact.events },
	);

	const mixedModel = new CarAudioModel();
	const mixedValues = makeAudioSnapshot(SNAPSHOT, {
		wheelOtherSurfaceContribution0: 0.4,
		wheelOtherSurfaceKind0: 1,
		wheelOtherRoughnessFrequency0: 1.8,
		wheelOtherRoughness0: 0.9,
		wheelSurfaceStyle0: 1,
	});
	const mixed = mixedModel.update(mixedValues, carSound);
	assertAudio(mixed.roadRide.volume > 0, "mixed surface road loop", mixed.roadRide);
	assertAudio(mixed.grassRide.volume > 0, "mixed surface dirt loop", mixed.grassRide);
	assertAudio(mixed.grassSkid.volume > 0, "mixed surface dirt skid", mixed.grassSkid);
	assertAudio(mixed.curbRide.volume > 0, "curb style loop", mixed.curbRide);
	assertAudio(mixed.skidTyres[0].volume > 0, "wheel skid loop", mixed.skidTyres[0]);

	const stationaryTyres = new CarAudioModel().update(makeAudioSnapshot(SNAPSHOT, {
		speed: 0.2,
	}), carSound);
	assertAudio(stationaryTyres.engine.volume > 0, "stationary engine remains audible", stationaryTyres.engine);
	assertAudio(stationaryTyres.roadRide.volume === 0, "stationary road ride is gated", stationaryTyres.roadRide);
	assertAudio(stationaryTyres.skidTyres.every((tyre) => tyre.volume === 0), "stationary tyre skid is gated", {
		skidTyres: stationaryTyres.skidTyres,
	});

	const spinningTyres = new CarAudioModel().update(makeAudioSnapshot(SNAPSHOT, {
		speed: 0,
		wheelSpinVelocity0: 1,
	}), carSound);
	assertAudio(spinningTyres.skidTyres[0].volume > 0, "wheel spin bypasses stationary tyre gate", spinningTyres.skidTyres[0]);

	const mutedModel = new CarAudioModel();
	mutedModel.update(makeAudioSnapshot(SNAPSHOT, {
		gearChangeEvent: 1,
		collisionEvent: 31,
	}), carSound);
	const muted = mutedModel.update(makeAudioSnapshot(SNAPSHOT, {
		state: 1,
		gearChangeEvent: 1,
		collisionEvent: 31,
	}), carSound);
	assertAudio(muted.engine.volume === 0, "no-simulation engine mute", muted.engine);
	assertAudio(muted.turbo.volume === 0, "no-simulation turbo mute", muted.turbo);
	assertAudio(muted.backfireLoop.volume === 0, "no-simulation backfire mute", muted.backfireLoop);
	assertAudio(muted.metalSkid.volume === 0, "no-simulation collision mute", muted.metalSkid);
	assertAudio(muted.events.length === 0, "no-simulation event mute", { events: muted.events });

	return {
		enginePitch: active.engine.pitch,
		events: eventNames,
	};
}

async function checkTrackAlignment(trackAsset) {
	const createModule = require(path.join(root, "torcs_web_probe.js"));
	const module = await createModule({
		locateFile: (file) => path.join(root, file),
	});
	const sampleBounds = {
		minX: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		minZ: Number.POSITIVE_INFINITY,
		maxZ: Number.NEGATIVE_INFINITY,
	};

	try {
		const start = module.ccall(
			"torcs_web_runtime_start_with_files",
			"number",
			["string", "string"],
			[
				"/torcs/data/tracks/e-track-1/e-track-1.xml",
				"/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml",
			],
		);
		if (start !== 0) {
			fail("TORCS web renderer smoke test could not start alignment runtime", { start });
		}

		const sampleCount = module.ccall("torcs_web_runtime_get_track_sample_count", "number", [], []);
		for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
			for (const side of [0, 2]) {
				const x = module.ccall(
					"torcs_web_runtime_get_track_sample_x",
					"number",
					["number", "number"],
					[sampleIndex, side],
				);
				const y = module.ccall(
					"torcs_web_runtime_get_track_sample_y",
					"number",
					["number", "number"],
					[sampleIndex, side],
				);
				extendBounds(sampleBounds, x, -y);
			}
		}
		if (!Number.isFinite(sampleBounds.minX)) {
			fail("TORCS web renderer smoke test found no track samples");
		}
	} finally {
		module.ccall("torcs_web_runtime_shutdown", null, [], []);
	}

	const glbBounds = readPositionBounds(trackAsset);
	const tolerance = 2.0;
	const containsSamples =
		glbBounds.minX <= sampleBounds.minX + tolerance &&
		glbBounds.maxX >= sampleBounds.maxX - tolerance &&
		glbBounds.minZ <= sampleBounds.minZ + tolerance &&
		glbBounds.maxZ >= sampleBounds.maxZ - tolerance;
	if (!containsSamples) {
		fail("TORCS web renderer smoke test found converted track/sample bounds mismatch", {
			trackAsset,
			glbBounds,
			sampleBounds,
			tolerance,
		});
	}
	return { glbBounds, sampleBounds };
}

const files = [
	"../CMakeLists.txt",
	"torcs_web_renderer.html",
	"renderer/main.js",
	"renderer/assets.js",
	"renderer/runtime.js",
	"renderer/scene.js",
	"renderer/effects.js",
	"renderer/audio.js",
	"renderer/cameras.js",
	"renderer/input.js",
	"renderer/hud.js",
].map((relativePath) => ({
	path: relativePath,
	content: read(relativePath),
}));

const byPath = Object.fromEntries(files.map((file) => [file.path, file]));
files
	.filter((file) => file.path.endsWith(".js"))
	.forEach(checkJavaScriptSyntax);

requireText(byPath["torcs_web_renderer.html"], "./torcs_web_probe.js", "WASM probe script");
requireText(byPath["torcs_web_renderer.html"], "./renderer/main.js", "renderer module entrypoint");
requireText(byPath["torcs_web_renderer.html"], "\"three\"", "Three.js import map");
requireText(byPath["torcs_web_renderer.html"], "\"three/addons/\"", "Three.js addons import map");
requireText(byPath["torcs_web_renderer.html"], "<option value=\"trackside\">Trackside</option>", "trackside camera UI option");
requireText(byPath["torcs_web_renderer.html"], "id=\"audio\"", "audio unlock button");
requireText(byPath["torcs_web_renderer.html"], "id=\"volume\"", "audio volume slider");
requireText(byPath["torcs_web_renderer.html"], "id=\"audio-state\"", "audio status readout");
requireText(byPath["torcs_web_renderer.html"], "id=\"track-map\"", "Phase 5 track map canvas");
requireText(byPath["torcs_web_renderer.html"], "id=\"car-count\"", "Phase 6 car count control");
requireText(byPath["torcs_web_renderer.html"], "id=\"current-car\"", "Phase 6 current car selector");
requireText(byPath["torcs_web_renderer.html"], "id=\"standings\"", "Phase 6 standings panel");
for (const id of ["position", "fuel", "current-lap", "last-lap", "best-lap", "top-speed"]) {
	requireText(byPath["torcs_web_renderer.html"], `id="${id}"`, `Phase 5 HUD field ${id}`);
}

requireText(byPath["renderer/assets.js"], "GLTFLoader", "GLTF loader import");
requireText(byPath["renderer/assets.js"], "TextureLoader", "texture loader import");
requireText(byPath["renderer/assets.js"], "./web-assets/", "asset manifest base path");
requireText(byPath["renderer/assets.js"], "export class AssetManager", "asset manager export");
requireText(byPath["renderer/assets.js"], "Promise.all(entry.lods.map", "all car LOD loading");
requireText(byPath["renderer/assets.js"], "entry.backgroundTexture", "track background texture loading");
requireText(byPath["renderer/assets.js"], "async loadEffects()", "effect texture loading");
requireText(byPath["renderer/assets.js"], "manifest.effects && manifest.effects.textures", "effect texture manifest lookup");
requireText(byPath["renderer/assets.js"], "shadowTexture", "car shadow texture loading");
requireText(byPath["renderer/assets.js"], "renderer.capabilities.getMaxAnisotropy()", "renderer anisotropy capability");
requireText(byPath["renderer/assets.js"], "texture.anisotropy = Math.max(1, this.getMaxAnisotropy())", "anisotropic texture sampling");
requireText(byPath["renderer/assets.js"], "texture.minFilter = THREE.LinearMipmapLinearFilter", "mipmapped distant texture filtering");
requireText(byPath["renderer/assets.js"], "new THREE.MeshLambertMaterial", "legacy matte material conversion");
requireText(byPath["renderer/assets.js"], "TORCS web renderer failed to load track background texture", "background texture load warning");

requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_get_snapshot_size", "snapshot size export");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_write_snapshot", "snapshot write export");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_start_multi_with_files", "Phase 6 multi-car runtime start export");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_get_car_count", "Phase 6 car count export");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_write_car_snapshot", "Phase 6 per-car snapshot export");
requireText(byPath["renderer/runtime.js"], "readSnapshots()", "Phase 6 multi-car snapshot reader");
requireText(byPath["renderer/runtime.js"], "Float64Array.from(values)", "Phase 6 copied per-car snapshot buffer");
requireText(byPath["renderer/runtime.js"], "export const SNAPSHOT", "snapshot layout export");
requireText(byPath["renderer/runtime.js"], "export class TorcsRuntime", "runtime adapter export");

requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_start_multi_with_files'", "Phase 6 multi-car Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_count'", "Phase 6 car-count Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_name_by_index'", "Phase 6 car-name Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_write_car_snapshot'", "Phase 6 per-car snapshot Emscripten export");

requireText(byPath["renderer/runtime.js"], "wheelSkidIntensity0: 116", "Phase 4 skid snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelSurfaceKind0: 120", "Phase 5 wheel surface snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelReaction0: 124", "Phase 5 wheel reaction snapshot field");
requireText(byPath["renderer/runtime.js"], "exhaustCount: 129", "Phase 5 exhaust snapshot field");
requireText(byPath["renderer/runtime.js"], "velocityX: 137", "audio velocity snapshot field");
requireText(byPath["renderer/runtime.js"], "gearRatio: 140", "audio gear ratio snapshot field");
requireText(byPath["renderer/runtime.js"], "gearChangeEvent: 141", "audio gear-change event snapshot field");
requireText(byPath["renderer/runtime.js"], "collisionEvent: 142", "audio collision event snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelRoughnessFrequency0: 143", "audio wheel roughness snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelOtherSurfaceContribution0: 151", "audio mixed-surface snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelSurfaceStyle0: 167", "audio wheel surface style snapshot field");
requireText(byPath["renderer/runtime.js"], "lightCommand: 113", "Phase 4 light snapshot field");
requireText(byPath["renderer/runtime.js"], "collision: 114", "Phase 4 collision snapshot field");

requireText(byPath["renderer/main.js"], "createTorcsRuntime", "runtime factory import");
requireText(byPath["renderer/main.js"], "import { TorcsAudio } from \"./audio.js\"", "audio runtime import");
requireText(byPath["renderer/main.js"], "new AssetManager", "asset manager creation");
requireText(byPath["renderer/main.js"], "new TorcsAudio(\"./web-assets/\"", "audio runtime creation");
requireText(byPath["renderer/main.js"], "new AssetManager(\"./web-assets/\", scene.renderer)", "asset renderer capability handoff");
requireText(byPath["renderer/main.js"], "audio.enabled ? \"Stop\" : \"Audio\"", "audio button start/stop label");
requireText(byPath["renderer/main.js"], "new TorcsScene", "scene creation");
requireText(byPath["renderer/main.js"], "runtime.readTrackSamples()", "track sample ingestion");
requireText(byPath["renderer/main.js"], "runtime.readSnapshots()", "Phase 6 snapshot array ingestion");
requireText(byPath["renderer/main.js"], "scene.updateCars(snapshots, cameras.camera, selectedCarIndex)", "Phase 6 selected-car scene update");
requireText(byPath["renderer/main.js"], "findSnapshotByCarIndex(selectedCarIndex)", "Phase 6 selected-car snapshot lookup");
requireText(byPath["renderer/main.js"], "elements.currentCar.addEventListener", "Phase 6 current-car selector binding");
requireText(byPath["renderer/main.js"], "elements.carCount.value", "Phase 6 car count startup control");
requireText(byPath["renderer/main.js"], "scene.setTrackAtmosphere(track ? track.entry : null, track ? track.backgroundTexture : null)", "track atmosphere handoff");
requireText(byPath["renderer/main.js"], "assets.loadEffects()", "effect texture asset loading");
requireText(byPath["renderer/main.js"], "scene.setEffectTextures(effects ? effects.textures : null)", "effect texture scene handoff");
requireText(byPath["renderer/main.js"], "audio.update(snapshot, cameras.camera, deltaTime)", "snapshot-driven audio update");
requireText(byPath["renderer/main.js"], "audio.enable(elements.car.value)", "user-gesture audio unlock");
requireText(byPath["renderer/main.js"], "hud.setTrack(trackSamples)", "Phase 5 HUD track-map handoff");
requireText(byPath["renderer/main.js"], "input.updateGamepad()", "Phase 5 gamepad polling");

requireText(byPath["renderer/hud.js"], "fmtTime(value)", "Phase 5 lap time formatting");
requireText(byPath["renderer/hud.js"], "setTrack(track)", "Phase 5 track map setup");
requireText(byPath["renderer/hud.js"], "drawMap(values, snapshots = [], selectedCarIndex = 0)", "Phase 6 multi-car track map rendering");
requireText(byPath["renderer/hud.js"], "updateStandings(snapshots, selectedCarIndex)", "Phase 6 standings rendering");
requireText(byPath["renderer/hud.js"], "car.driverName", "Phase 6 standings driver names");
requireText(byPath["renderer/hud.js"], "SNAPSHOT.fuel", "Phase 5 fuel HUD snapshot field");
requireText(byPath["renderer/hud.js"], "SNAPSHOT.currentLapTime", "Phase 5 current lap HUD snapshot field");
requireText(byPath["renderer/hud.js"], "SNAPSHOT.racePosition", "Phase 5 race position HUD snapshot field");

requireText(byPath["renderer/input.js"], "navigator.getGamepads", "Phase 5 browser gamepad API");
requireText(byPath["renderer/input.js"], "updateGamepad()", "Phase 5 gamepad control update");
requireText(byPath["renderer/input.js"], "this.setRangeValue(this.elements.steer, axis(0))", "Phase 5 gamepad steering");
requireText(byPath["renderer/input.js"], "this.changeGear(delta)", "Phase 5 gamepad gear buttons");

requireText(byPath["renderer/audio.js"], "export class TorcsAudio", "audio runtime export");
requireText(byPath["renderer/audio.js"], "export class AudioAssets", "audio asset loader export");
requireText(byPath["renderer/audio.js"], "export class CarAudioModel", "native car sound model export");
requireText(byPath["renderer/audio.js"], "context.createPanner()", "positional Web Audio source");
requireText(byPath["renderer/audio.js"], "context.createBiquadFilter()", "engine low-pass filter");
requireText(byPath["renderer/audio.js"], "decodeAudioData", "manifest sample decoding");
requireText(byPath["renderer/audio.js"], "this.enabled = false;\n\t\t\tthis.raceAudio = null;\n\t\t\tconst raceAudio", "stale audio state cleared before asset load");
requireText(byPath["renderer/audio.js"], "this.setStatus(\"error\")", "audio load failure status");
requireText(byPath["renderer/audio.js"], "this.setStatus(\"off\")", "audio stop status");
requireText(byPath["renderer/audio.js"], "RM_CAR_STATE_NO_SIMU", "native no-simulation mute mask");
requireText(byPath["renderer/audio.js"], "SNAPSHOT.state", "car state audio mute input");
requireText(byPath["renderer/audio.js"], "SNAPSHOT.gearChangeEvent", "latched gear-change event use");
requireText(byPath["renderer/audio.js"], "SNAPSHOT.collisionEvent", "latched collision event use");
requireText(byPath["renderer/audio.js"], "SNAPSHOT.wheelOtherSurfaceContribution0", "mixed-surface audio use");
requireText(byPath["renderer/audio.js"], "SNAPSHOT.wheelSurfaceStyle0", "curb style audio use");

requireText(byPath["renderer/scene.js"], "import * as THREE from \"three\"", "Three.js module import");
requireText(byPath["renderer/scene.js"], "import { TorcsEffects } from \"./effects.js\"", "effects module import");
requireText(byPath["renderer/scene.js"], "new THREE.BoxGeometry", "simulated car box");
requireText(byPath["renderer/scene.js"], "makeRoadMesh(track)", "sampled track road mesh");
requireText(byPath["renderer/scene.js"], "setTrackVisual(model)", "converted track mesh hook");
requireText(byPath["renderer/scene.js"], "setTrackAtmosphere(entry, backgroundTexture = null)", "track atmosphere hook");
requireText(byPath["renderer/scene.js"], "backgroundColor.clone().multiplyScalar(0.8)", "native fog color scaling");
requireText(byPath["renderer/scene.js"], "new THREE.Fog(fogColor, 300, 600)", "linear TORCS fog range");
requireText(byPath["renderer/scene.js"], "const BACKGROUND_RADIUS = 500", "clipping-safe panoramic backdrop radius");
requireText(byPath["renderer/scene.js"], "const BACKGROUND_HEIGHT = BACKGROUND_RADIUS * 2", "native type-4 panoramic backdrop proportions");
requireText(byPath["renderer/scene.js"], "const BACKGROUND_VERTICAL_BIAS = 0", "camera-centered panoramic backdrop");
requireText(byPath["renderer/scene.js"], "texture.repeat.set(-1, 1)", "native background horizontal orientation");
requireText(byPath["renderer/scene.js"], "TORCS web renderer track background texture is configured but unavailable", "missing configured background warning");
requireText(byPath["renderer/scene.js"], "TORCS web renderer skipped background dome because no texture was provided", "background dome skipped warning");
requireText(byPath["renderer/scene.js"], "new THREE.CylinderGeometry(", "background dome geometry");
requireText(byPath["renderer/scene.js"], "camera.position.y + BACKGROUND_HEIGHT * BACKGROUND_VERTICAL_BIAS", "camera-following sky backdrop");
requireText(byPath["renderer/scene.js"], "color: 0xffffff", "unlit untinted background texture");
requireText(byPath["renderer/scene.js"], "torcsToThree(entry.lightPosition[0], entry.lightPosition[1], entry.lightPosition[2])", "track light position conversion");
requireText(byPath["renderer/scene.js"], "setCarVisual(asset)", "converted car LOD hook");
requireText(byPath["renderer/scene.js"], "updateCars(snapshots, camera = null, selectedCarIndex = 0)", "Phase 6 multi-car scene update");
requireText(byPath["renderer/scene.js"], "createOpponentCar(values, carIndex)", "Phase 6 opponent car creation");
requireText(byPath["renderer/scene.js"], "getOpponentColor(carIndex)", "Phase 6 car-zero opponent color");
requireText(byPath["renderer/scene.js"], "getSnapshotCarIndex(values, index) === selectedCarIndex", "Phase 6 selected car primary visual");
requireText(byPath["renderer/scene.js"], "tintClone(item.scene, opponent.color)", "Phase 6 distinct opponent car visual tint");
requireText(byPath["renderer/scene.js"], "setObjectQuaternionFromTorcsPosMat(opponent.root, values)", "Phase 6 opponent pose matrix conversion");
requireText(byPath["renderer/scene.js"], "selectOpponentLod(opponent, camera)", "Phase 6 opponent LOD switching");
requireText(byPath["renderer/scene.js"], "this.carEffects = []", "Phase 6 per-car effect state registry");
requireText(byPath["renderer/scene.js"], "getCarEffects(carIndex)", "Phase 6 car-index effect lookup");
requireText(byPath["renderer/scene.js"], "effects: this.getCarEffects(carIndex)", "Phase 6 opponent uses car-index effect state");
requireText(byPath["renderer/scene.js"], "if (i !== selectedIndex)", "Phase 6 selected effect visibility survives opponent hiding");
requireText(byPath["renderer/scene.js"], "opponent.effects.update(values, opponent.root, camera)", "Phase 6 opponent effect snapshot update");
requireText(byPath["renderer/effects.js"], "setVisible(visible)", "Phase 6 effect visibility control");
requireText(byPath["renderer/scene.js"], "export { getTorcsPoseQuaternion, torcsToThree }", "shared TORCS pose export");
requireText(byPath["renderer/scene.js"], "createGeneratedWheels(values)", "generated wheel fallback");
requireText(byPath["renderer/scene.js"], "setObjectQuaternionFromTorcsPosMat(this.car, values)", "car body pose matrix conversion");
requireText(byPath["renderer/scene.js"], "CAR_ROTATION_MATRIX.multiplyMatrices(TORCS_TO_THREE_BASIS, TORCS_POS_MATRIX)", "TORCS-to-Three body basis conversion");
requireText(byPath["renderer/scene.js"], "wheelBrakeTemp0", "brake heat wheel feedback");
requireText(byPath["renderer/scene.js"], "wheel.camber.rotation.x", "wheel camber transform node");
requireText(byPath["renderer/scene.js"], "wheel.spin.rotation.z", "wheel spin transform node");
requireText(byPath["renderer/scene.js"], "selectCarLod(camera)", "deterministic car LOD switching");
requireText(byPath["renderer/scene.js"], "getCarLodFactor(camera, this.car.position", "TORCS-style car LOD factor");
requireText(byPath["renderer/scene.js"], "lodFactor >= item.lod.threshold", "native car LOD threshold comparison");
requireText(byPath["renderer/scene.js"], "next.lod.wheels !== false", "LOD wheel visibility flag");
requireText(byPath["renderer/scene.js"], "skidMarks: new THREE.Group()", "skid-mark scene group");
requireText(byPath["renderer/scene.js"], "carLights: new THREE.Group()", "car-light scene group");
requireText(byPath["renderer/scene.js"], "smoke: new THREE.Group()", "smoke/fire scene group");
requireText(byPath["renderer/scene.js"], "this.effects = this.createCarEffects(0)", "effects layer creation");
requireText(byPath["renderer/scene.js"], "effects.resetDynamics()", "effects reset on new track/session");
requireText(byPath["renderer/scene.js"], "this.effects.update(values, this.car, camera)", "snapshot-driven effects update");
if (byPath["renderer/scene.js"].content.includes("this.car.rotation.set(values[SNAPSHOT.pitch]")) {
	fail("TORCS web renderer smoke test found scalar Euler car body orientation");
}

requireText(byPath["renderer/effects.js"], "export class TorcsEffects", "effects layer export");
requireText(byPath["renderer/effects.js"], "createShadow()", "planar car shadow effect");
requireText(byPath["renderer/effects.js"], "createSkidMarks()", "dynamic skid-mark strips");
requireText(byPath["renderer/effects.js"], "updateSmoke(values, car, time, deltaTime)", "smoke sprite update");
requireText(byPath["renderer/effects.js"], "updateFire(values, car, time, deltaTime)", "exhaust fire sprite update");
requireText(byPath["renderer/effects.js"], "updateLights(values, car)", "head rear brake light sprites");
requireText(byPath["renderer/effects.js"], "updateCollision(values, car, time)", "collision feedback hook");
requireText(byPath["renderer/effects.js"], "resetDynamics()", "dynamic effect lifecycle reset");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.wheelSkidIntensity0", "skid snapshot field use");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.wheelSurfaceKind0", "surface-aware effect use");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.wheelReaction0", "reaction-aware smoke use");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.exhaustCount", "native exhaust metadata use");
requireText(byPath["renderer/effects.js"], "this.previousEngineLevel - engineLevel", "native RPM-drop fire trigger");
requireText(byPath["renderer/effects.js"], "textures[\"grey-tracks.rgb\"]", "native skid texture use");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.lightCommand", "light snapshot field use");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.collision", "collision snapshot field use");
requireText(byPath["renderer/effects.js"], "makeRadialTexture", "effect texture fallback");

requireText(byPath["renderer/cameras.js"], "getTorcsPoseQuaternion(values, this.carRotation)", "camera pose matrix conversion");
requireText(byPath["renderer/cameras.js"], "fov: 40", "TORCS chase camera FOV");
requireText(byPath["renderer/cameras.js"], "fov: 67.5", "TORCS onboard camera FOV");
requireText(byPath["renderer/cameras.js"], "trackside: {", "fixed trackside camera mode");
requireText(byPath["renderer/cameras.js"], "fov: 30", "TORCS road camera FOV");
requireText(byPath["renderer/cameras.js"], "this.tracksideViews = this.makeTracksideViews(min, max, center, span)", "generated trackside camera placement");
requireText(byPath["renderer/cameras.js"], "selectTracksideView(car)", "nearest trackside camera selection");
requireText(byPath["renderer/cameras.js"], "this.trackView = { center, height: span * 0.78 }", "fixed top alignment camera framing");
requireText(byPath["renderer/main.js"], "cameras.setTrack(trackSamples)", "camera track-sample alignment handoff");
if (byPath["renderer/cameras.js"].content.includes("Math.cos(yaw)")) {
	fail("TORCS web renderer smoke test found scalar-yaw camera direction");
}

const manifest = JSON.parse(read("web-assets/manifest.json"));
const track = manifest.tracks["data/tracks/e-track-1/e-track-1.xml"];
const car = manifest.cars["data/cars/models/kc-2000gt/kc-2000gt.xml"];
if (!track || !car) {
	fail("TORCS web renderer smoke test missing Phase 1 manifest entries");
}
if (!manifest.tracks["data/tracks/g-track-1/g-track-1.xml"] ||
	!manifest.cars["data/cars/models/kc-a110/kc-a110.xml"]) {
	fail("TORCS web renderer smoke test missing selectable multi-asset manifest entries");
}
checkGlb(track.asset);
checkObjectNames(track, track.source);
if (!track.backgroundTexture) {
	fail("TORCS web renderer smoke test found missing background texture metadata");
}
if (typeof track.backgroundType !== "number") {
	fail("TORCS web renderer smoke test found missing background type metadata");
}
checkPng(track.backgroundTexture);
for (const field of ["backgroundColor", "ambientColor", "diffuseColor", "specularColor", "lightPosition"]) {
	checkNumberTriplet(track, field, track.source);
}
if (typeof track.shininess !== "number" || !Number.isFinite(track.shininess)) {
	fail("TORCS web renderer smoke test found malformed track shininess metadata");
}
for (const lod of car.lods) {
	checkGlb(lod.asset);
	checkObjectNames(lod, lod.model);
	if (typeof lod.wheels !== "boolean") {
		fail("TORCS web renderer smoke test found car LOD without wheel metadata", {
			model: lod.model,
		});
	}
}
if (!car.wheelFallback || car.wheelFallback.source !== "runtime-snapshot" ||
	!car.wheelFallback.texture || !(car.wheelFallback.texture in car.textures)) {
	fail("TORCS web renderer smoke test found missing wheel fallback metadata");
}
if (!car.sound || car.sound.engineSample !== "engine-1.wav" ||
	!car.sound.engineAsset || typeof car.sound.rpmScale !== "number" ||
	typeof car.sound.turbo !== "boolean" || typeof car.sound.turboRpm !== "number" ||
	typeof car.sound.turboLag !== "number") {
	fail("TORCS web renderer smoke test found malformed car sound metadata");
}
checkWav(car.sound.engineAsset);
for (const texture of Object.values(track.textures).concat(Object.values(car.textures))) {
	checkPng(texture);
}
const effectTextures = manifest.effects && manifest.effects.textures;
for (const name of ["smoke.rgb", "fire0.rgb", "fire1.rgb", "frontlight1.rgb", "rearlight1.rgb", "breaklight1.rgb", "grey-tracks.rgb"]) {
	if (!effectTextures || !effectTextures[name]) {
		fail("TORCS web renderer smoke test found missing effect texture metadata", { name });
	}
	checkPng(effectTextures[name]);
}
const effectSounds = manifest.effects && manifest.effects.sounds;
for (const name of ["skidTyres", "roadRide", "grassRide", "curbRide", "grassSkid", "metalSkid", "axle", "turbo", "backfireLoop", "backfire", "bang", "bottomCrash", "gearChange"]) {
	const entry = effectSounds && effectSounds[name];
	if (!entry || typeof entry.sample !== "string" || !entry.asset) {
		fail("TORCS web renderer smoke test found missing effect sound metadata", { name });
	}
	checkWav(entry.asset);
}
const crashSounds = manifest.effects && manifest.effects.crashes;
if (!Array.isArray(crashSounds) || crashSounds.length !== 6) {
	fail("TORCS web renderer smoke test found missing crash sound set");
}
crashSounds.forEach((entry, index) => {
	if (!entry || entry.sample !== `crash${index + 1}.wav` || !entry.asset) {
		fail("TORCS web renderer smoke test found malformed crash sound metadata", { index });
	}
	checkWav(entry.asset);
});

Promise.all([checkAudioModelBehavior(), checkTrackAlignment(track.asset)])
	.then(([audioModel, alignment]) => {
		console.log(JSON.stringify({
			rendererFiles: files.length,
			html: "torcs_web_renderer.html",
			entrypoint: "renderer/main.js",
			audioModel,
			webAssetTracks: Object.keys(manifest.tracks).length,
			webAssetCars: Object.keys(manifest.cars).length,
			alignment,
		}));
	})
	.catch((error) => fail("TORCS web renderer smoke test failed", { error: error.message }));
