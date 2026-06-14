import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const TEXTURE_MAP_KEYS = [
	"map",
	"alphaMap",
	"aoMap",
	"bumpMap",
	"displacementMap",
	"emissiveMap",
	"envMap",
	"lightMap",
	"metalnessMap",
	"normalMap",
	"roughnessMap",
	"specularMap",
];
const RENDER_PROFILES = new Set(["legacy", "modern"]);

function normalizeRuntimePath(path) {
	return path.replace(/^\/torcs\//, "");
}

function normalizeRenderProfile(profile) {
	return RENDER_PROFILES.has(profile) ? profile : "legacy";
}

export class AssetManager {
	constructor(baseUrl = "./web-assets/", renderer = null, renderProfile = "legacy") {
		this.baseUrl = baseUrl;
		this.renderer = renderer;
		this.renderProfile = normalizeRenderProfile(renderProfile);
		this.loader = new GLTFLoader();
		this.textureLoader = new THREE.TextureLoader();
		this.manifest = null;
	}

	setRenderProfile(profile) {
		this.renderProfile = normalizeRenderProfile(profile);
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

	getMaxAnisotropy() {
		const caps = this.renderer && this.renderer.capabilities;
		return caps && typeof caps.getMaxAnisotropy === "function" ? caps.getMaxAnisotropy() : 1;
	}

	configureTexture(texture) {
		if (!texture) {
			return;
		}
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.anisotropy = Math.max(1, this.getMaxAnisotropy());
		texture.generateMipmaps = true;
		texture.minFilter = THREE.LinearMipmapLinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.needsUpdate = true;
	}

	configureMaterialTextureSampling(material) {
		for (const key of TEXTURE_MAP_KEYS) {
			this.configureTexture(material[key]);
		}
	}

	makeLegacyMaterial(material) {
		this.configureMaterialTextureSampling(material);
		const legacy = new THREE.MeshLambertMaterial({
			name: material.name,
			color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
			map: material.map || null,
			alphaMap: material.alphaMap || null,
			alphaTest: material.alphaTest || 0,
			transparent: material.transparent,
			opacity: material.opacity,
			side: material.side,
			depthWrite: material.depthWrite,
			fog: material.fog,
		});
		legacy.userData = { ...material.userData };
		material.dispose();
		return legacy;
	}

	makeModernMaterial(material) {
		// Modern mode deliberately mirrors legacy materials until remaster-specific
		// material metadata exists. Keep the entrypoint separate for future work.
		return this.makeLegacyMaterial(material);
	}

	convertMaterial(material) {
		if (this.renderProfile === "modern") {
			return this.makeModernMaterial(material);
		}
		return this.makeLegacyMaterial(material);
	}

	configureSceneMaterials(scene) {
		scene.traverse((object) => {
			if (!object.isMesh || !object.material) {
				return;
			}
			if (Array.isArray(object.material)) {
				object.material = object.material.map((material) => this.convertMaterial(material));
			} else {
				object.material = this.convertMaterial(object.material);
			}
		});
	}

	async loadGltf(relativePath) {
		const gltf = await this.loader.loadAsync(`${this.baseUrl}${relativePath}`);
		this.configureSceneMaterials(gltf.scene);
		return gltf.scene;
	}

	async loadTexture(relativePath) {
		const texture = await this.textureLoader.loadAsync(`${this.baseUrl}${relativePath}`);
		this.configureTexture(texture);
		return texture;
	}

	async loadEffects() {
		const manifest = await this.loadManifest();
		const textures = {};
		for (const [name, relativePath] of Object.entries((manifest.effects && manifest.effects.textures) || {})) {
			textures[name] = await this.loadTexture(relativePath);
		}
		return { textures };
	}

	async loadTrack(trackPath) {
		const manifest = await this.loadManifest();
		const entry = manifest.tracks[normalizeRuntimePath(trackPath)];
		if (!entry) {
			return null;
		}
		const scene = await this.loadGltf(entry.asset);
		let backgroundTexture = null;
		if (entry.backgroundTexture) {
			try {
				backgroundTexture = await this.loadTexture(entry.backgroundTexture);
			} catch (error) {
				console.warn("TORCS web renderer failed to load track background texture", {
					texture: entry.backgroundTexture,
					error,
				});
			}
		}
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
		const shadowPath = entry.shadowTexture && entry.textures ? entry.textures[entry.shadowTexture] : "";
		let shadowTexture = null;
		if (shadowPath) {
			shadowTexture = await this.loadTexture(shadowPath);
		}
		return { entry, lods, shadowTexture };
	}
}
