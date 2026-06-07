#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

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
	"torcs_web_renderer.html",
	"renderer/main.js",
	"renderer/assets.js",
	"renderer/runtime.js",
	"renderer/scene.js",
	"renderer/effects.js",
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
requireText(byPath["renderer/runtime.js"], "export const SNAPSHOT", "snapshot layout export");
requireText(byPath["renderer/runtime.js"], "export class TorcsRuntime", "runtime adapter export");
requireText(byPath["renderer/runtime.js"], "wheelSkidIntensity0: 116", "Phase 4 skid snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelSurfaceKind0: 120", "Phase 5 wheel surface snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelReaction0: 124", "Phase 5 wheel reaction snapshot field");
requireText(byPath["renderer/runtime.js"], "exhaustCount: 129", "Phase 5 exhaust snapshot field");
requireText(byPath["renderer/runtime.js"], "lightCommand: 113", "Phase 4 light snapshot field");
requireText(byPath["renderer/runtime.js"], "collision: 114", "Phase 4 collision snapshot field");

requireText(byPath["renderer/main.js"], "createTorcsRuntime", "runtime factory import");
requireText(byPath["renderer/main.js"], "new AssetManager", "asset manager creation");
requireText(byPath["renderer/main.js"], "new AssetManager(\"./web-assets/\", scene.renderer)", "asset renderer capability handoff");
requireText(byPath["renderer/main.js"], "new TorcsScene", "scene creation");
requireText(byPath["renderer/main.js"], "runtime.readTrackSamples()", "track sample ingestion");
requireText(byPath["renderer/main.js"], "scene.setTrackAtmosphere(track ? track.entry : null, track ? track.backgroundTexture : null)", "track atmosphere handoff");
requireText(byPath["renderer/main.js"], "assets.loadEffects()", "effect texture asset loading");
requireText(byPath["renderer/main.js"], "scene.setEffectTextures(effects ? effects.textures : null)", "effect texture scene handoff");

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
requireText(byPath["renderer/scene.js"], "this.effects = new TorcsEffects(this.groups)", "effects layer creation");
requireText(byPath["renderer/scene.js"], "this.effects.resetDynamics()", "effects reset on new track/session");
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

checkTrackAlignment(track.asset)
	.then((alignment) => {
		console.log(JSON.stringify({
			rendererFiles: files.length,
			html: "torcs_web_renderer.html",
			entrypoint: "renderer/main.js",
			webAssetTracks: Object.keys(manifest.tracks).length,
			webAssetCars: Object.keys(manifest.cars).length,
			alignment,
		}));
	})
	.catch((error) => fail("TORCS web renderer smoke test failed", { error: error.message }));
