import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function normalizeRuntimePath(path) {
	return path.replace(/^\/torcs\//, "");
}

export class AssetManager {
	constructor(baseUrl = "./web-assets/") {
		this.baseUrl = baseUrl;
		this.loader = new GLTFLoader();
		this.manifest = null;
	}

	async loadManifest() {
		if (this.manifest) {
			return this.manifest;
		}
		const response = await fetch(`${this.baseUrl}manifest.json`);
		if (!response.ok) {
			throw new Error(`failed to load web asset manifest: ${response.status}`);
		}
		this.manifest = await response.json();
		return this.manifest;
	}

	async loadGltf(relativePath) {
		const gltf = await this.loader.loadAsync(`${this.baseUrl}${relativePath}`);
		return gltf.scene;
	}

	async loadTrack(trackPath) {
		const manifest = await this.loadManifest();
		const entry = manifest.tracks[normalizeRuntimePath(trackPath)];
		if (!entry) {
			return null;
		}
		const scene = await this.loadGltf(entry.asset);
		scene.name = entry.name || "track";
		return { entry, scene };
	}

	async loadCar(carPath) {
		const manifest = await this.loadManifest();
		const entry = manifest.cars[normalizeRuntimePath(carPath)];
		if (!entry || !entry.lods.length) {
			return null;
		}
		const lod = entry.lods[0];
		const scene = await this.loadGltf(lod.asset);
		scene.name = entry.name || "car";
		return { entry, lod, scene };
	}
}
