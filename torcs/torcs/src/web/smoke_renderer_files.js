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

requireText(byPath["renderer/assets.js"], "GLTFLoader", "GLTF loader import");
requireText(byPath["renderer/assets.js"], "TextureLoader", "texture loader import");
requireText(byPath["renderer/assets.js"], "./web-assets/", "asset manifest base path");
requireText(byPath["renderer/assets.js"], "export class AssetManager", "asset manager export");
requireText(byPath["renderer/assets.js"], "Promise.all(entry.lods.map", "all car LOD loading");
requireText(byPath["renderer/assets.js"], "entry.backgroundTexture", "track background texture loading");

requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_get_snapshot_size", "snapshot size export");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_write_snapshot", "snapshot write export");
requireText(byPath["renderer/runtime.js"], "export const SNAPSHOT", "snapshot layout export");
requireText(byPath["renderer/runtime.js"], "export class TorcsRuntime", "runtime adapter export");

requireText(byPath["renderer/main.js"], "createTorcsRuntime", "runtime factory import");
requireText(byPath["renderer/main.js"], "new AssetManager", "asset manager creation");
requireText(byPath["renderer/main.js"], "new TorcsScene", "scene creation");
requireText(byPath["renderer/main.js"], "runtime.readTrackSamples()", "track sample ingestion");
requireText(byPath["renderer/main.js"], "scene.setTrackAtmosphere(track ? track.entry : null, track ? track.backgroundTexture : null)", "track atmosphere handoff");

requireText(byPath["renderer/scene.js"], "import * as THREE from \"three\"", "Three.js module import");
requireText(byPath["renderer/scene.js"], "new THREE.BoxGeometry", "simulated car box");
requireText(byPath["renderer/scene.js"], "makeRoadMesh(track)", "sampled track road mesh");
requireText(byPath["renderer/scene.js"], "setTrackVisual(model)", "converted track mesh hook");
requireText(byPath["renderer/scene.js"], "setTrackAtmosphere(entry, backgroundTexture = null)", "track atmosphere hook");
requireText(byPath["renderer/scene.js"], "new THREE.Fog(backgroundColor, 300, 600)", "linear TORCS fog range");
requireText(byPath["renderer/scene.js"], "new THREE.CylinderGeometry(900, 900, 260, 36, 1, true)", "background dome geometry");
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
if (byPath["renderer/scene.js"].content.includes("this.car.rotation.set(values[SNAPSHOT.pitch]")) {
	fail("TORCS web renderer smoke test found scalar Euler car body orientation");
}

requireText(byPath["renderer/cameras.js"], "getTorcsPoseQuaternion(values, this.carRotation)", "camera pose matrix conversion");
requireText(byPath["renderer/cameras.js"], "fov: 40", "TORCS chase camera FOV");
requireText(byPath["renderer/cameras.js"], "fov: 67.5", "TORCS onboard camera FOV");
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
checkPng(track.backgroundTexture);
for (const field of ["backgroundColor", "ambientColor", "diffuseColor", "lightPosition"]) {
	if (!Array.isArray(track[field]) || track[field].length !== 3) {
		fail("TORCS web renderer smoke test found malformed track atmosphere metadata", { field });
	}
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
