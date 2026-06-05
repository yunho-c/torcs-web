import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function normalizeRuntimePath(path) {
	return path.replace(/^\/torcs\//, "");
}

export class AssetManager {
	constructor(baseUrl = "./web-assets/") {
		this.baseUrl = baseUrl;
		this.loader = new GLTFLoader();
		this.textureLoader = new THREE.TextureLoader();
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

	async loadTexture(relativePath) {
		const texture = await this.textureLoader.loadAsync(`${this.baseUrl}${relativePath}`);
		texture.colorSpace = THREE.SRGBColorSpace;
		return texture;
	}

	async loadTrack(trackPath) {
		const manifest = await this.loadManifest();
		const entry = manifest.tracks[normalizeRuntimePath(trackPath)];
		if (!entry) {
			return null;
		}
		const scene = await this.loadGltf(entry.asset);
		const backgroundTexture = entry.backgroundTexture
			? await this.loadTexture(entry.backgroundTexture)
			: null;
		scene.name = entry.name || "track";
		return { entry, scene, backgroundTexture };
	}

	async loadCar(carPath) {
		const manifest = await this.loadManifest();
		const entry = manifest.cars[normalizeRuntimePath(carPath)];
		if (!entry || !entry.lods.length) {
			return null;
		}
		const lods = await Promise.all(entry.lods.map(async (lod) => {
			const scene = await this.loadGltf(lod.asset);
			scene.name = lod.model || entry.name || "car";
			scene.visible = false;
			return { lod, scene };
		}));
		return { entry, lods };
	}
}
