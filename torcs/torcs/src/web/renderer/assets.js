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
const MODERN_MATERIAL_PRESETS = Object.freeze({
	body: Object.freeze({
		metalness: 0.08,
		roughness: 0.34,
		ior: 1.5,
		opacity: 1.0,
		clearcoat: 0.72,
		clearcoatRoughness: 0.26,
		envMapIntensity: 1.08,
	}),
	glass: Object.freeze({
		metalness: 0.0,
		roughness: 0.08,
		ior: 1.5,
		opacity: 0.42,
		transmission: 0.22,
		clearcoat: 1.0,
		clearcoatRoughness: 0.05,
		envMapIntensity: 1.2,
	}),
	mirrorGlass: Object.freeze({
		metalness: 0.02,
		roughness: 0.04,
		ior: 1.5,
		opacity: 0.62,
		transmission: 0.08,
		clearcoat: 1.0,
		clearcoatRoughness: 0.03,
		envMapIntensity: 1.35,
	}),
	headlamp: Object.freeze({ metalness: 0.0, roughness: 0.12, ior: 1.5, opacity: 0.16, envMapIntensity: 1.25 }),
	taillamp: Object.freeze({ metalness: 0.0, roughness: 0.22, ior: 1.5, opacity: 0.92, envMapIntensity: 0.95 }),
	exhaust: Object.freeze({ metalness: 0.75, roughness: 0.38, ior: 1.5, opacity: 1.0, color: 0x5c5750, envMapIntensity: 0.85 }),
	blackTrim: Object.freeze({ metalness: 0.04, roughness: 0.78, color: 0x202020, envMapIntensity: 0.45 }),
	interior: Object.freeze({ metalness: 0.02, roughness: 0.84, envMapIntensity: 0.35 }),
	driver: Object.freeze({ metalness: 0.0, roughness: 0.9, envMapIntensity: 0.25 }),
	wheelTire: Object.freeze({ metalness: 0.0, roughness: 0.94, colorScalar: 0.55, envMapIntensity: 0.25 }),
	wheelRim: Object.freeze({ metalness: 0.48, roughness: 0.42, envMapIntensity: 0.85 }),
	wheelBrake: Object.freeze({ metalness: 0.64, roughness: 0.5, envMapIntensity: 0.7 }),
	road: Object.freeze({
		metalness: 0.0,
		roughness: 0.92,
		colorScalar: 0.78,
		envMapIntensity: 0.18,
		wetColorScalar: 0.5,
		wetRoughness: 0.32,
		wetEnvMapIntensity: 0.72,
	}),
	grass: Object.freeze({ metalness: 0.0, roughness: 0.98, colorScalar: 0.88, envMapIntensity: 0.12 }),
	sand: Object.freeze({ metalness: 0.0, roughness: 0.98, colorScalar: 0.95, envMapIntensity: 0.1 }),
	terrain: Object.freeze({ metalness: 0.0, roughness: 0.98, colorScalar: 0.9, envMapIntensity: 0.1 }),
	curb: Object.freeze({
		metalness: 0.0,
		roughness: 0.74,
		colorScalar: 0.9,
		envMapIntensity: 0.22,
		wetColorScalar: 0.64,
		wetRoughness: 0.4,
		wetEnvMapIntensity: 0.62,
	}),
	barrier: Object.freeze({ metalness: 0.18, roughness: 0.66, envMapIntensity: 0.45 }),
	fence: Object.freeze({ metalness: 0.22, roughness: 0.72, envMapIntensity: 0.38 }),
	tireWall: Object.freeze({ metalness: 0.0, roughness: 0.94, colorScalar: 0.7, envMapIntensity: 0.18 }),
	treeFoliage: Object.freeze({ metalness: 0.0, roughness: 1.0, colorScalar: 0.84, envMapIntensity: 0.08 }),
	concrete: Object.freeze({ metalness: 0.0, roughness: 0.88, colorScalar: 0.86, envMapIntensity: 0.16 }),
	building: Object.freeze({ metalness: 0.0, roughness: 0.82, envMapIntensity: 0.22 }),
	sign: Object.freeze({ metalness: 0.0, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0.08, envMapIntensity: 0.25 }),
});
const CAR_PBR_DEFAULTS = MODERN_MATERIAL_PRESETS;
const MATERIAL_DEBUG_COLORS = Object.freeze({
	body: 0x3182bd,
	glass: 0x8dd3ff,
	mirrorGlass: 0x4cc9f0,
	headlamp: 0xfff3a3,
	taillamp: 0xff4d6d,
	exhaust: 0x6c757d,
	blackTrim: 0x222222,
	interior: 0x7f5539,
	driver: 0xffc857,
	wheelTire: 0x111111,
	wheelRim: 0xa7c7e7,
	wheelBrake: 0xb8b8b8,
	road: 0xd1495b,
	grass: 0x6ab04c,
	sand: 0xf2cc8f,
	terrain: 0x8f7a4f,
	curb: 0x4361ee,
	barrier: 0xf77f00,
	fence: 0xb08968,
	tireWall: 0x2f2f2f,
	treeFoliage: 0x2d6a4f,
	concrete: 0xadb5bd,
	building: 0x845ec2,
	sign: 0xffbe0b,
	unclassified: 0xff00ff,
});

function normalizeRuntimePath(path) {
	return path.replace(/^\/torcs\//, "");
}

function normalizeRenderProfile(profile) {
	return RENDER_PROFILES.has(profile) ? profile : "legacy";
}

function clamp01(value) {
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function lerp(from, to, amount) {
	return from + (to - from) * amount;
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
		this.wetness = 0;
		this.materialDebugEnabled = false;
	}

	setRenderProfile(profile) {
		const nextProfile = normalizeRenderProfile(profile);
		if (nextProfile !== this.renderProfile) {
			this.carCache.clear();
		}
		this.renderProfile = nextProfile;
	}

	setWetness(value) {
		const nextWetness = clamp01(Number(value));
		if (nextWetness !== this.wetness) {
			this.carCache.clear();
		}
		this.wetness = nextWetness;
	}

	setMaterialDebugEnabled(enabled) {
		const nextEnabled = Boolean(enabled);
		if (nextEnabled !== this.materialDebugEnabled) {
			this.carCache.clear();
		}
		this.materialDebugEnabled = nextEnabled;
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
		if (this.renderer && typeof this.renderer.getMaxAnisotropy === "function") {
			return this.renderer.getMaxAnisotropy();
		}
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

	makeMaterialDebugMaterial(material, materialClass, parameters) {
		const debugClass = materialClass || "unclassified";
		const needsAlphaMap = parameters.alphaTest > 0 || parameters.transparent || parameters.opacity < 1;
		const debug = new THREE.MeshBasicMaterial({
			name: `debug:${debugClass}:${material.name || "material"}`,
			color: new THREE.Color(MATERIAL_DEBUG_COLORS[debugClass] || MATERIAL_DEBUG_COLORS.unclassified),
			map: needsAlphaMap ? parameters.map || null : null,
			alphaMap: parameters.alphaMap || null,
			alphaTest: parameters.alphaTest,
			transparent: parameters.transparent,
			opacity: parameters.opacity,
			side: parameters.side,
			depthWrite: parameters.depthWrite,
			fog: parameters.fog,
		});
		debug.userData = {
			...material.userData,
			torcsMaterialDebugClass: debugClass,
		};
		return debug;
	}

	isTrackShadowOverlayMaterial(material) {
		return material && material.userData && material.userData.torcsOverlayRole === "trackShadow";
	}

	isTreeFoliageTrackShadowOverlayMaterial(material) {
		return this.isTrackShadowOverlayMaterial(material) &&
			material.userData.torcsMaterialClass === "treeFoliage";
	}

	isTrackSkidOverlayMaterial(material) {
		return material && material.userData && material.userData.torcsOverlayRole === "trackSkid";
	}

	makeTrackShadowOverlayMaterial(material) {
		this.configureMaterialTextureSampling(material);
		const overlay = new THREE.MeshBasicMaterial({
			name: material.name,
			color: new THREE.Color(0x000000),
			map: material.map || null,
			transparent: true,
			opacity: 1.0,
			alphaTest: 0.01,
			side: material.side,
			depthWrite: false,
			depthTest: true,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
			fog: material.fog,
		});
		overlay.userData = { ...material.userData };
		material.dispose();
		return overlay;
	}

	makeTrackSkidOverlayMaterial(material) {
		this.configureMaterialTextureSampling(material);
		const overlay = new THREE.MeshBasicMaterial({
			name: material.name,
			color: new THREE.Color(0xffffff),
			map: material.map || null,
			transparent: true,
			opacity: 1.0,
			side: material.side,
			depthWrite: false,
			depthTest: true,
			polygonOffset: true,
			polygonOffsetFactor: -2,
			polygonOffsetUnits: -2,
			fog: material.fog,
		});
		overlay.userData = { ...material.userData };
		material.dispose();
		return overlay;
	}

	trackOverlayRenderOrder(material) {
		if (this.isTrackSkidOverlayMaterial(material)) {
			return 3;
		}
		if (this.isTrackShadowOverlayMaterial(material)) {
			return 2;
		}
		return 0;
	}

	withPbrDefaults(parameters, defaults) {
		const pbrParameters = {
			...parameters,
			metalness: defaults.metalness,
			roughness: defaults.roughness,
			transparent: defaults.opacity < 1.0 ? true : parameters.transparent,
			opacity: defaults.opacity,
			depthWrite: defaults.opacity < 1.0 ? false : parameters.depthWrite,
		};
		if (defaults.envMapIntensity !== undefined) {
			pbrParameters.envMapIntensity = defaults.envMapIntensity;
		}
		return pbrParameters;
	}

	applyModernPreset(parameters, preset, materialClass) {
		const wettable = materialClass === "road" || materialClass === "curb";
		const wetness = wettable ? this.wetness : 0;
		const colorScalar = wetness > 0 && preset.wetColorScalar !== undefined
			? lerp(preset.colorScalar ?? 1, preset.wetColorScalar, wetness)
			: preset.colorScalar;
		const roughness = wetness > 0 && preset.wetRoughness !== undefined
			? lerp(preset.roughness, preset.wetRoughness, wetness)
			: preset.roughness;
		const envMapIntensity = wetness > 0 && preset.wetEnvMapIntensity !== undefined
			? lerp(preset.envMapIntensity ?? 0, preset.wetEnvMapIntensity, wetness)
			: preset.envMapIntensity;
		const materialParameters = {
			...parameters,
			metalness: preset.metalness,
			roughness,
		};
		if (preset.color !== undefined) {
			materialParameters.color = new THREE.Color(preset.color);
		} else if (colorScalar !== undefined) {
			materialParameters.color = parameters.color.clone().multiplyScalar(colorScalar);
		}
		if (envMapIntensity !== undefined) {
			materialParameters.envMapIntensity = envMapIntensity;
		}
		if (preset.emissive !== undefined) {
			materialParameters.emissive = new THREE.Color(preset.emissive);
			materialParameters.emissiveIntensity = preset.emissiveIntensity || 0;
			materialParameters.emissiveMap = parameters.map || null;
		}
		return materialParameters;
	}

	makePresetMaterial(parameters, materialClass) {
		return this.makeStandardMaterial(
			this.applyModernPreset(parameters, MODERN_MATERIAL_PRESETS[materialClass], materialClass),
		);
	}

	makePbrMaterial(parameters, defaults) {
		const pbrParameters = this.withPbrDefaults(parameters, defaults);
		if (typeof THREE.MeshPhysicalMaterial === "function") {
			return new THREE.MeshPhysicalMaterial({
				...pbrParameters,
				ior: defaults.ior,
				envMapIntensity: defaults.envMapIntensity,
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
				clearcoat: CAR_PBR_DEFAULTS.body.clearcoat,
				clearcoatRoughness: CAR_PBR_DEFAULTS.body.clearcoatRoughness,
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
			depthWrite: false,
		};
		if (typeof THREE.MeshPhysicalMaterial === "function") {
			return new THREE.MeshPhysicalMaterial({
				...glassParameters,
				ior: defaults.ior,
				transmission: defaults.transmission,
				clearcoat: defaults.clearcoat,
				clearcoatRoughness: defaults.clearcoatRoughness,
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
		if (this.materialDebugEnabled) {
			return this.makeMaterialDebugMaterial(material, materialClass, parameters);
		}
		if (materialClass === "body" && context.materialMask) {
			parameters.remasterMaterialMask = context.materialMask;
		}
		switch (materialClass) {
			case "body":
				return this.makePaintMaterial(parameters);
			case "glass":
				return this.makeGlassMaterial(parameters, CAR_PBR_DEFAULTS.glass);
			case "mirrorGlass":
				return this.makeGlassMaterial(parameters, CAR_PBR_DEFAULTS.mirrorGlass);
			case "headlamp":
				return this.makeEmissiveMaterial(parameters, HEADLAMP_EMISSIVE, 1.35, CAR_PBR_DEFAULTS.headlamp);
			case "taillamp":
				return this.makeEmissiveMaterial(parameters, TAILLAMP_EMISSIVE, 1.55, CAR_PBR_DEFAULTS.taillamp);
			case "exhaust":
				return this.makePbrMaterial(this.applyModernPreset(parameters, CAR_PBR_DEFAULTS.exhaust, materialClass), CAR_PBR_DEFAULTS.exhaust);
			case "blackTrim":
				return this.makePresetMaterial(parameters, materialClass);
			case "interior":
				return this.makePresetMaterial(parameters, materialClass);
			case "driver":
				return this.makePresetMaterial(parameters, materialClass);
			case "wheelTire":
				return this.makePresetMaterial(parameters, materialClass);
			case "wheelRim":
				return this.makePresetMaterial(parameters, materialClass);
			case "wheelBrake":
				return this.makePresetMaterial(parameters, materialClass);
			case "road":
				return this.makePresetMaterial(parameters, materialClass);
			case "grass":
			case "sand":
			case "terrain":
				return this.makePresetMaterial(parameters, materialClass);
			case "curb":
				return this.makePresetMaterial(parameters, materialClass);
			case "barrier":
			case "fence":
				return this.makePresetMaterial(parameters, materialClass);
			case "tireWall":
				return this.makePresetMaterial(parameters, materialClass);
			case "treeFoliage":
				return this.makeStandardMaterial({
					...this.applyModernPreset(parameters, CAR_PBR_DEFAULTS.treeFoliage, materialClass),
					side: THREE.DoubleSide,
				});
			case "concrete":
				return this.makePresetMaterial(parameters, materialClass);
			case "building":
				return this.makePresetMaterial(parameters, materialClass);
			case "sign":
				return this.makePresetMaterial(parameters, materialClass);
			default:
				return null;
		}
	}

	makeModernMaterial(material, context = {}) {
		const materialClass = material.userData && material.userData.torcsMaterialClass;
		if (this.materialDebugEnabled) {
			const debug = this.makeModernClassMaterial(material, materialClass || "unclassified", context);
			debug.userData = { ...material.userData, torcsMaterialDebugClass: materialClass || "unclassified" };
			material.dispose();
			return debug;
		}
		const modern = materialClass ? this.makeModernClassMaterial(material, materialClass, context) : null;
		if (!modern) {
			return this.makeLegacyMaterial(material);
		}
		modern.userData = { ...material.userData };
		material.dispose();
		return modern;
	}

	convertMaterial(material, context = {}) {
		if (this.isTrackShadowOverlayMaterial(material)) {
			return this.makeTrackShadowOverlayMaterial(material);
		}
		if (this.isTrackSkidOverlayMaterial(material)) {
			return this.makeTrackSkidOverlayMaterial(material);
		}
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
			const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
			if (sourceMaterials.some((material) => this.isTreeFoliageTrackShadowOverlayMaterial(material))) {
				object.visible = false;
				return;
			}
			if (Array.isArray(object.material)) {
				object.material = object.material.map((material) => this.convertMaterial(material, context));
			} else {
				object.material = this.convertMaterial(object.material, context);
			}
			const materials = Array.isArray(object.material) ? object.material : [object.material];
			const renderOrder = Math.max(...materials.map((material) => this.trackOverlayRenderOrder(material)));
			if (renderOrder > 0) {
				object.renderOrder = renderOrder;
			}
		});
	}

	async loadGltf(relativePath, context = {}) {
		const gltf = await this.loader.loadAsync(`${this.baseUrl}${relativePath}`);
		this.configureSceneMaterials(gltf.scene, context);
		return gltf.scene;
	}

	async loadLocalGltf(file, context = {}) {
		const url = URL.createObjectURL(file);
		try {
			const gltf = await this.loader.loadAsync(url);
			this.configureSceneMaterials(gltf.scene, context);
			return gltf.scene;
		} finally {
			URL.revokeObjectURL(url);
		}
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
		const wheelFallbackTextureName = entry.wheelFallback && entry.wheelFallback.texture;
		const wheelFallbackTexturePath = wheelFallbackTextureName && entry.textures ? entry.textures[wheelFallbackTextureName] : "";
		let wheelFallbackTexture = null;
		if (wheelFallbackTexturePath) {
			try {
				wheelFallbackTexture = await this.loadTexture(wheelFallbackTexturePath);
			} catch (error) {
				console.warn("TORCS web renderer failed to load generated wheel fallback texture", {
					texture: wheelFallbackTextureName,
					asset: wheelFallbackTexturePath,
					error,
				});
			}
		}
		const asset = { entry: carEntry, lods, wheelAsset, shadowTexture, wheelFallbackTexture, materialMask };
		this.carCache.set(source, asset);
		return asset;
	}
}
