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
	"clearcoatMap",
	"clearcoatRoughnessMap",
];
const RENDER_PROFILES = new Set(["legacy", "modern"]);
const HEADLAMP_EMISSIVE = new THREE.Color(0xfff0c8);
const TAILLAMP_EMISSIVE = new THREE.Color(0xff2424);
const CAR_PBR_DEFAULTS = Object.freeze({
	body: Object.freeze({ metalness: 0.75, roughness: 0.1, ior: 1.5, opacity: 1.0 }),
	glass: Object.freeze({ metalness: 0.75, roughness: 0.025, ior: 1.5, opacity: 0.5 }),
	headlamp: Object.freeze({ metalness: 0.0, roughness: 0.025, ior: 1.5, opacity: 0.05 }),
	taillamp: Object.freeze({ metalness: 0.0, roughness: 0.1, ior: 1.5, opacity: 1.0 }),
	exhaust: Object.freeze({ metalness: 0.9, roughness: 0.1, ior: 1.5, opacity: 1.0 }),
});

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
		this.carCache = new Map();
	}

	setRenderProfile(profile) {
		const nextProfile = normalizeRenderProfile(profile);
		if (nextProfile !== this.renderProfile) {
			this.carCache.clear();
		}
		this.renderProfile = nextProfile;
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

	configureTexture(texture, colorSpace = THREE.SRGBColorSpace) {
		if (!texture) {
			return;
		}
		texture.colorSpace = colorSpace;
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

	makeModernBaseParameters(material) {
		this.configureMaterialTextureSampling(material);
		return {
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
		};
	}

	makeStandardMaterial(parameters) {
		return new THREE.MeshStandardMaterial(parameters);
	}

	withPbrDefaults(parameters, defaults) {
		return {
			...parameters,
			metalness: defaults.metalness,
			roughness: defaults.roughness,
			transparent: defaults.opacity < 1.0 ? true : parameters.transparent,
			opacity: defaults.opacity,
			depthWrite: defaults.opacity < 1.0 ? false : parameters.depthWrite,
		};
	}

	makePbrMaterial(parameters, defaults) {
		const pbrParameters = this.withPbrDefaults(parameters, defaults);
		if (typeof THREE.MeshPhysicalMaterial === "function") {
			return new THREE.MeshPhysicalMaterial({
				...pbrParameters,
				ior: defaults.ior,
			});
		}
		return this.makeStandardMaterial(pbrParameters);
	}

	makePaintMaterial(parameters) {
		const { remasterMaterialMask, ...materialParameters } = parameters;
		const maskedParameters = remasterMaterialMask ? {
			...materialParameters,
			clearcoatMap: remasterMaterialMask,
			roughnessMap: remasterMaterialMask,
		} : materialParameters;
		const pbrParameters = this.withPbrDefaults(maskedParameters, CAR_PBR_DEFAULTS.body);
		if (typeof THREE.MeshPhysicalMaterial === "function") {
			return new THREE.MeshPhysicalMaterial({
				...pbrParameters,
				ior: CAR_PBR_DEFAULTS.body.ior,
				clearcoat: 0.85,
				clearcoatRoughness: 0.22,
			});
		}
		const { clearcoatMap, ...standardParameters } = pbrParameters;
		return this.makeStandardMaterial(standardParameters);
	}

	makeGlassMaterial(parameters, defaults = CAR_PBR_DEFAULTS.glass) {
		const glassParameters = {
			...this.withPbrDefaults(parameters, defaults),
			color: new THREE.Color(0xc8d7df),
			transparent: true,
			side: THREE.DoubleSide,
			depthWrite: false,
		};
		if (typeof THREE.MeshPhysicalMaterial === "function") {
			return new THREE.MeshPhysicalMaterial({
				...glassParameters,
				ior: defaults.ior,
				transmission: 0.28,
				clearcoat: 1.0,
				clearcoatRoughness: 0.04,
			});
		}
		return this.makeStandardMaterial(glassParameters);
	}

	makeEmissiveMaterial(parameters, color, intensity, defaults) {
		const emissiveParameters = {
			...this.withPbrDefaults(parameters, defaults),
			emissive: color,
			emissiveIntensity: intensity,
			emissiveMap: parameters.map || null,
		};
		if (typeof THREE.MeshPhysicalMaterial === "function") {
			return new THREE.MeshPhysicalMaterial({
				...emissiveParameters,
				ior: defaults.ior,
			});
		}
		return this.makeStandardMaterial(emissiveParameters);
	}

	makeModernClassMaterial(material, materialClass, context = {}) {
		const parameters = this.makeModernBaseParameters(material);
		if (materialClass === "body" && context.materialMask) {
			parameters.remasterMaterialMask = context.materialMask;
		}
		switch (materialClass) {
			case "body":
				return this.makePaintMaterial(parameters);
			case "glass":
				return this.makeGlassMaterial(parameters, CAR_PBR_DEFAULTS.glass);
			case "mirrorGlass":
				return this.makeGlassMaterial(parameters, CAR_PBR_DEFAULTS.glass);
			case "headlamp":
				return this.makeEmissiveMaterial(parameters, HEADLAMP_EMISSIVE, 1.35, CAR_PBR_DEFAULTS.headlamp);
			case "taillamp":
				return this.makeEmissiveMaterial(parameters, TAILLAMP_EMISSIVE, 1.55, CAR_PBR_DEFAULTS.taillamp);
			case "exhaust":
				return this.makePbrMaterial({
					...parameters,
					color: new THREE.Color(0x5c5750),
				}, CAR_PBR_DEFAULTS.exhaust);
			case "blackTrim":
				return this.makeStandardMaterial({
					...parameters,
					color: new THREE.Color(0x202020),
					metalness: 0.08,
					roughness: 0.68,
				});
			case "interior":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.05,
					roughness: 0.76,
				});
			case "driver":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.0,
					roughness: 0.82,
				});
			case "wheelTire":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.0,
					roughness: 0.88,
				});
			case "wheelRim":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.55,
					roughness: 0.36,
				});
			case "wheelBrake":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.75,
					roughness: 0.42,
				});
			case "road":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.0,
					roughness: 0.82,
				});
			case "grass":
			case "sand":
			case "terrain":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.0,
					roughness: 0.94,
				});
			case "curb":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.0,
					roughness: 0.64,
				});
			case "barrier":
			case "fence":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.28,
					roughness: 0.56,
				});
			case "tireWall":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.0,
					roughness: 0.88,
				});
			case "treeFoliage":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.0,
					roughness: 0.96,
					side: THREE.DoubleSide,
				});
			case "concrete":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.0,
					roughness: 0.78,
				});
			case "building":
				return this.makeStandardMaterial({
					...parameters,
					metalness: 0.02,
					roughness: 0.72,
				});
			case "sign":
				return this.makeStandardMaterial({
					...parameters,
					emissive: new THREE.Color(0xffffff),
					emissiveIntensity: 0.12,
					emissiveMap: parameters.map || null,
					metalness: 0.0,
					roughness: 0.48,
				});
			default:
				return null;
		}
	}

	makeModernMaterial(material, context = {}) {
		const materialClass = material.userData && material.userData.torcsMaterialClass;
		const modern = materialClass ? this.makeModernClassMaterial(material, materialClass, context) : null;
		if (!modern) {
			return this.makeLegacyMaterial(material);
		}
		modern.userData = { ...material.userData };
		material.dispose();
		return modern;
	}

	convertMaterial(material, context = {}) {
		if (this.renderProfile === "modern") {
			return this.makeModernMaterial(material, context);
		}
		return this.makeLegacyMaterial(material);
	}

	configureSceneMaterials(scene, context = {}) {
		scene.traverse((object) => {
			if (!object.isMesh || !object.material) {
				return;
			}
			if (Array.isArray(object.material)) {
				object.material = object.material.map((material) => this.convertMaterial(material, context));
			} else {
				object.material = this.convertMaterial(object.material, context);
			}
		});
	}

	async loadGltf(relativePath, context = {}) {
		const gltf = await this.loader.loadAsync(`${this.baseUrl}${relativePath}`);
		this.configureSceneMaterials(gltf.scene, context);
		return gltf.scene;
	}

	async loadTexture(relativePath, colorSpace = THREE.SRGBColorSpace) {
		const texture = await this.textureLoader.loadAsync(`${this.baseUrl}${relativePath}`);
		this.configureTexture(texture, colorSpace);
		return texture;
	}

	async loadDataTexture(relativePath) {
		return this.loadTexture(relativePath, THREE.NoColorSpace);
	}

	async resolveCarPathByModelName(modelName) {
		if (!modelName) {
			return "";
		}
		const manifest = await this.loadManifest();
		const source = `data/cars/models/${modelName}/${modelName}.xml`;
		return manifest.cars && manifest.cars[source] ? source : "";
	}

	async loadCarForModelName(modelName, fallbackCarPath = "") {
		const source = await this.resolveCarPathByModelName(modelName);
		if (source) {
			const asset = await this.loadCar(source);
			if (asset) {
				return asset;
			}
		}
		return this.loadCar(fallbackCarPath);
	}

	async loadCarAssetsForSnapshots(snapshots = [], fallbackCarPath = "") {
		const assets = new Map();
		const models = new Map();
		for (const values of snapshots || []) {
			const carIndex = Number.isFinite(values && values.carIndex) ? values.carIndex : assets.size;
			models.set(carIndex, values && values.carModelName ? values.carModelName : "");
		}
		await Promise.all(Array.from(models.entries()).map(async ([carIndex, modelName]) => {
			assets.set(carIndex, await this.loadCarForModelName(modelName, fallbackCarPath));
		}));
		return assets;
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
		const source = normalizeRuntimePath(carPath);
		if (this.carCache.has(source)) {
			return this.carCache.get(source);
		}
		const entry = manifest.cars[source];
		if (!entry || !entry.lods.length) {
			return null;
		}
		const carEntry = { ...entry, source };
		const materialMask = entry.materialMask ? await this.loadDataTexture(entry.materialMask) : null;
		const lods = await Promise.all(entry.lods.map(async (lod) => {
			const scene = await this.loadGltf(lod.asset, { materialMask });
			scene.name = lod.model || entry.name || "car";
			scene.visible = false;
			return { lod, scene };
		}));
		let wheelAsset = null;
		if (entry.wheelAsset && Array.isArray(entry.wheelAsset.states)) {
			const states = await Promise.all(entry.wheelAsset.states.map(async (state) => {
				const scene = await this.loadGltf(state.asset);
				scene.name = `${entry.name || "car"} wheel ${state.speedIndex}`;
				scene.visible = false;
				return { ...state, scene };
			}));
			wheelAsset = { ...entry.wheelAsset, states };
		}
		const shadowPath = entry.shadowTexture && entry.textures ? entry.textures[entry.shadowTexture] : "";
		let shadowTexture = null;
		if (shadowPath) {
			shadowTexture = await this.loadTexture(shadowPath);
		}
		const asset = { entry: carEntry, lods, wheelAsset, shadowTexture, materialMask };
		this.carCache.set(source, asset);
		return asset;
	}
}
