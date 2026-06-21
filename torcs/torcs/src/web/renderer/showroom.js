import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AssetManager } from "./assets.js";
import { getPostProcessOptions, getPostProcessPresetOverride, TorcsPostProcessPipeline } from "./postprocess.js";

const DEFAULT_ENVIRONMENT_MAP = "./web/hdri/120_hdrmaps_com_free_2K.exr";
const LOCAL_VW_PACK_URL = "./local-showroom-assets/vw/pack.json";
const DEFAULT_DRACO_DECODER_PATH = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
const DEFAULT_BACKGROUND_PRESET_ID = "studio-dark";
const TORCS_PROVIDER = "TORCS";
const VW_PROVIDER = "VW local";
const TORCS_WHEEL_ORDER = [0, 1, 2, 3];
const TORCS_RIGHT_WHEELS = new Set([0, 2]);
const TORCS_WHEEL_TEXTURE_STILL_OFFSET = Object.freeze([0.0, 0.5]);
const TEMP_BOX = new THREE.Box3();
const TEMP_SIZE = new THREE.Vector3();
const TEMP_CENTER = new THREE.Vector3();

const SHOWROOM_BACKGROUND_PRESETS = Object.freeze({
	"studio-dark": Object.freeze({
		displayName: "Studio Dark",
		clearColor: 0x080706,
		sweepTop: "#15080a",
		sweepUpper: "#37090d",
		sweepCenter: "#681116",
		sweepLower: "#230b0c",
		sweepFloorNear: "#11181a",
		sweepFloorFar: "#310b0d",
		sweepWarmGlow: "rgba(231, 56, 47, 0.46)",
		sweepAmberGlow: "rgba(221, 165, 79, 0.17)",
		sweepCoolGlow: "rgba(111, 155, 178, 0.15)",
		sweepVignette: "rgba(0, 0, 0, 0.58)",
		floorColor: 0x14191a,
		floorSheen: "rgba(178, 205, 213, 0.10)",
		shadowCore: "rgba(0, 0, 0, 0.62)",
		shadowPenumbra: "rgba(0, 0, 0, 0.26)",
		environmentIntensity: 1.26,
		toneMappingExposure: 0.9,
		hemisphereIntensity: 1.36,
		keyLightIntensity: 3.38,
		rimLightIntensity: 1.52,
	}),
});

const elements = {
	canvas: document.getElementById("showroom"),
	provider: document.getElementById("provider"),
	modelName: document.getElementById("model-name"),
	counter: document.getElementById("counter"),
	status: document.getElementById("status"),
	previous: document.getElementById("previous-car"),
	next: document.getElementById("next-car"),
	select: document.getElementById("car-select"),
};

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function colorFromArray(values, fallback = 0xffffff) {
	if (!Array.isArray(values) || values.length < 3) {
		return new THREE.Color(fallback);
	}
	return new THREE.Color(
		clamp(values[0], 0, 1),
		clamp(values[1], 0, 1),
		clamp(values[2], 0, 1),
	);
}

function basename(path) {
	const parts = String(path || "").split("/");
	return parts[parts.length - 1] || path;
}

function displayNameForCar(source, entry) {
	const name = entry && entry.name ? entry.name : basename(source).replace(/\.xml$/i, "");
	return name.replace(/[-_]+/g, " ").trim() || "Unknown car";
}

function visibleClone(root) {
	const clone = root.clone(true);
	clone.visible = true;
	clone.traverse((object) => {
		object.visible = true;
	});
	return clone;
}

function cloneWheelFallbackTexture(texture) {
	if (!texture) {
		return null;
	}
	const clone = texture.clone();
	clone.repeat.set(0.5, 0.5);
	clone.offset.set(TORCS_WHEEL_TEXTURE_STILL_OFFSET[0], TORCS_WHEEL_TEXTURE_STILL_OFFSET[1]);
	clone.needsUpdate = true;
	return clone;
}

function makeGeneratedWheel(radius, width, wheelTexture = null) {
	const group = new THREE.Group();
	const capTexture = cloneWheelFallbackTexture(wheelTexture);
	const tireMaterial = new THREE.MeshStandardMaterial({
		color: 0x111111,
		metalness: 0.05,
		roughness: 0.62,
	});
	const capMaterial = capTexture ? new THREE.MeshStandardMaterial({
		color: 0xffffff,
		map: capTexture,
		transparent: true,
		alphaTest: 0.02,
		metalness: 0.18,
		roughness: 0.38,
	}) : null;
	const tire = new THREE.Mesh(
		new THREE.CylinderGeometry(radius, radius, width, 32, 1, false),
		capMaterial ? [tireMaterial, capMaterial, capMaterial] : tireMaterial,
	);
	tire.rotation.x = Math.PI / 2;
	group.add(tire);
	if (!capMaterial) {
		const rim = new THREE.Mesh(
			new THREE.CylinderGeometry(radius * 0.54, radius * 0.54, width * 1.05, 24, 1, false),
			new THREE.MeshStandardMaterial({
				color: 0xcac2b0,
				metalness: 0.72,
				roughness: 0.22,
			}),
		);
		rim.rotation.x = Math.PI / 2;
		group.add(rim);
	}
	return group;
}

function makeDetailedWheel(wheelAsset, wheelIndex, radius, width, wheelFallbackTexture = null) {
	const state = wheelAsset && Array.isArray(wheelAsset.states)
		? wheelAsset.states.find((candidate) => candidate.speedIndex === 0) || wheelAsset.states[0]
		: null;
	const wheel = new THREE.Group();
	if (!state || !state.scene) {
		wheel.add(makeGeneratedWheel(radius, width, wheelFallbackTexture));
		return wheel;
	}
	const sideFlip = new THREE.Group();
	const scale = new THREE.Group();
	const scene = visibleClone(state.scene);
	if (TORCS_RIGHT_WHEELS.has(wheelIndex)) {
		sideFlip.rotation.y = Math.PI;
	}
	sideFlip.add(scene);
	scale.add(sideFlip);
	scale.scale.set(radius * 2, radius * 2, width);
	wheel.add(scale);
	return wheel;
}

function torcsToShowroom(x, y, z = 0, target = new THREE.Vector3()) {
	return target.set(x, z, -y);
}

function loadJson(url, optional = false) {
	return fetch(url, { cache: "no-store" }).then((response) => {
		if (!response.ok) {
			if (optional) {
				return null;
			}
			throw new Error(`failed to load ${url}: ${response.status}`);
		}
		return response.json();
	});
}

function getShowroomBackgroundPreset(id = DEFAULT_BACKGROUND_PRESET_ID) {
	return SHOWROOM_BACKGROUND_PRESETS[id] || SHOWROOM_BACKGROUND_PRESETS[DEFAULT_BACKGROUND_PRESET_ID];
}

function makeCanvasTexture(width, height, paint) {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	paint(context, width, height);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function makeSweepTexture(preset) {
	return makeCanvasTexture(1536, 2048, (context, width, height) => {
		const base = context.createLinearGradient(0, 0, 0, height);
		base.addColorStop(0.0, preset.sweepTop);
		base.addColorStop(0.27, preset.sweepUpper);
		base.addColorStop(0.48, preset.sweepCenter);
		base.addColorStop(0.72, preset.sweepLower);
		base.addColorStop(1.0, preset.sweepFloorNear);
		context.fillStyle = base;
		context.fillRect(0, 0, width, height);

		const warmGlow = context.createRadialGradient(
			width * 0.5,
			height * 0.43,
			width * 0.05,
			width * 0.5,
			height * 0.43,
			width * 0.48,
		);
		warmGlow.addColorStop(0, preset.sweepWarmGlow);
		warmGlow.addColorStop(0.42, "rgba(159, 25, 25, 0.20)");
		warmGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
		context.fillStyle = warmGlow;
		context.fillRect(0, 0, width, height);

		const floorSheen = context.createRadialGradient(
			width * 0.5,
			height * 0.8,
			width * 0.04,
			width * 0.5,
			height * 0.8,
			width * 0.6,
		);
		floorSheen.addColorStop(0, preset.floorSheen);
		floorSheen.addColorStop(0.48, "rgba(255, 255, 255, 0.035)");
		floorSheen.addColorStop(1, "rgba(0, 0, 0, 0)");
		context.fillStyle = floorSheen;
		context.fillRect(0, 0, width, height);

		const floorBlend = context.createLinearGradient(0, height * 0.58, 0, height);
		floorBlend.addColorStop(0, "rgba(0, 0, 0, 0)");
		floorBlend.addColorStop(0.38, "rgba(0, 0, 0, 0)");
		floorBlend.addColorStop(0.82, "rgba(49, 11, 13, 0.42)");
		floorBlend.addColorStop(1, preset.sweepFloorNear);
		context.fillStyle = floorBlend;
		context.fillRect(0, 0, width, height);

		const amberGlow = context.createRadialGradient(
			width * 0.68,
			height * 0.54,
			width * 0.02,
			width * 0.68,
			height * 0.54,
			width * 0.34,
		);
		amberGlow.addColorStop(0, preset.sweepAmberGlow);
		amberGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
		context.fillStyle = amberGlow;
		context.fillRect(0, 0, width, height);

		const coolGlow = context.createRadialGradient(
			width * 0.16,
			height * 0.36,
			width * 0.02,
			width * 0.16,
			height * 0.36,
			width * 0.44,
		);
		coolGlow.addColorStop(0, preset.sweepCoolGlow);
		coolGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
		context.fillStyle = coolGlow;
		context.fillRect(0, 0, width, height);

		const vignette = context.createRadialGradient(
			width * 0.5,
			height * 0.48,
			width * 0.18,
			width * 0.5,
			height * 0.48,
			width * 0.78,
		);
		vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
		vignette.addColorStop(0.66, "rgba(0, 0, 0, 0.08)");
		vignette.addColorStop(1, preset.sweepVignette);
		context.fillStyle = vignette;
		context.fillRect(0, 0, width, height);

		const grainCanvas = document.createElement("canvas");
		grainCanvas.width = width;
		grainCanvas.height = height;
		const grainContext = grainCanvas.getContext("2d");
		const grain = grainContext.createImageData(width, height);
		for (let index = 0; index < grain.data.length; index += 4) {
			const value = 118 + Math.floor(Math.random() * 38);
			grain.data[index] = value;
			grain.data[index + 1] = value;
			grain.data[index + 2] = value;
			grain.data[index + 3] = Math.random() < 0.14 ? 5 : 0;
		}
		grainContext.putImageData(grain, 0, 0);
		context.globalCompositeOperation = "soft-light";
		context.drawImage(grainCanvas, 0, 0);
		context.globalCompositeOperation = "source-over";
	});
}

function makeBackdropGlowTexture(preset) {
	return makeCanvasTexture(1024, 512, (context, width, height) => {
		const glow = context.createRadialGradient(
			width * 0.5,
			height * 0.5,
			width * 0.03,
			width * 0.5,
			height * 0.5,
			width * 0.52,
		);
		glow.addColorStop(0, preset.sweepWarmGlow);
		glow.addColorStop(0.36, "rgba(205, 42, 36, 0.16)");
		glow.addColorStop(1, "rgba(0, 0, 0, 0)");
		context.fillStyle = glow;
		context.fillRect(0, 0, width, height);
	});
}

function makeShadowTexture(preset) {
	return makeCanvasTexture(1024, 512, (context, width, height) => {
		const gradient = context.createRadialGradient(
			width * 0.5,
			height * 0.5,
			width * 0.03,
			width * 0.5,
			height * 0.5,
			width * 0.46,
		);
		gradient.addColorStop(0, preset.shadowCore);
		gradient.addColorStop(0.52, preset.shadowPenumbra);
		gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
		context.fillStyle = gradient;
		context.fillRect(0, 0, width, height);
	});
}

function makeCycloramaGeometry() {
	const width = 46;
	const floorNear = 24;
	const sweepStart = -3.6;
	const radius = 6.4;
	const wallHeight = 24;
	const xSegments = 48;
	const floorSegments = 36;
	const curveSegments = 28;
	const wallSegments = 38;
	const crossSection = [];

	for (let i = 0; i <= floorSegments; i++) {
		const t = i / floorSegments;
		crossSection.push({
			z: floorNear + (sweepStart - floorNear) * t,
			y: 0,
			v: t * 0.48,
		});
	}
	for (let i = 1; i <= curveSegments; i++) {
		const t = i / curveSegments;
		const angle = t * Math.PI * 0.5;
		crossSection.push({
			z: sweepStart - radius * Math.sin(angle),
			y: radius * (1 - Math.cos(angle)),
			v: 0.48 + t * 0.24,
		});
	}
	for (let i = 1; i <= wallSegments; i++) {
		const t = i / wallSegments;
		crossSection.push({
			z: sweepStart - radius,
			y: radius + wallHeight * t,
			v: 0.72 + t * 0.28,
		});
	}

	const vertices = [];
	const uvs = [];
	const indices = [];
	for (let yIndex = 0; yIndex < crossSection.length; yIndex++) {
		const row = crossSection[yIndex];
		for (let xIndex = 0; xIndex <= xSegments; xIndex++) {
			const u = xIndex / xSegments;
			vertices.push((u - 0.5) * width, row.y, row.z);
			uvs.push(u, row.v);
		}
	}
	for (let yIndex = 0; yIndex < crossSection.length - 1; yIndex++) {
		for (let xIndex = 0; xIndex < xSegments; xIndex++) {
			const a = yIndex * (xSegments + 1) + xIndex;
			const b = a + 1;
			const c = a + xSegments + 1;
			const d = c + 1;
			indices.push(a, c, b, b, c, d);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
	geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

function makeStudioStage(preset) {
	const group = new THREE.Group();
	group.name = "showroom studio stage";

	const sweep = new THREE.Mesh(
		makeCycloramaGeometry(),
		new THREE.MeshBasicMaterial({
			map: makeSweepTexture(preset),
			side: THREE.DoubleSide,
			depthWrite: false,
			toneMapped: false,
		}),
	);
	sweep.name = "showroom studio backdrop and showroom studio floor";
	sweep.renderOrder = -120;
	group.add(sweep);

	const glow = new THREE.Mesh(
		new THREE.PlaneGeometry(18, 7.2),
		new THREE.MeshBasicMaterial({
			map: makeBackdropGlowTexture(preset),
			transparent: true,
			depthWrite: false,
			toneMapped: false,
		}),
	);
	glow.name = "showroom studio backdrop glow";
	glow.position.set(0, 3.6, -9.92);
	glow.renderOrder = -110;
	group.add(glow);

	const shadow = new THREE.Mesh(
		new THREE.PlaneGeometry(11.5, 5.8),
		new THREE.MeshBasicMaterial({
			map: makeShadowTexture(preset),
			transparent: true,
			depthWrite: false,
			toneMapped: false,
		}),
	);
	shadow.name = "showroom studio contact shadow";
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.set(0, 0.008, 0.32);
	shadow.renderOrder = 5;
	group.add(shadow);

	return group;
}

class ShowroomScene {
	constructor(canvas, renderer) {
		this.canvas = canvas;
		this.renderer = renderer;
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);
		this.controls = new OrbitControls(this.camera, canvas);
		this.carRoot = new THREE.Group();
		this.activeModel = null;
		this.clock = new THREE.Clock();
		this.backgroundPreset = getShowroomBackgroundPreset();
		this.postProcessPreset = getPostProcessPresetOverride() || "showroom";
		this.configureScene();
		this.configureControls();
		this.postprocess = new TorcsPostProcessPipeline(
			this.renderer,
			this.scene,
			this.camera,
			this.postProcessPreset,
			getPostProcessOptions(this.postProcessPreset),
		);
		window.addEventListener("resize", () => this.resize());
	}

	static async create(canvas) {
		const params = new URLSearchParams(window.location.search);
		const renderer = new THREE.WebGPURenderer({
			canvas,
			antialias: true,
			alpha: true,
			forceWebGL: params.get("renderer") === "webgl",
		});
		await renderer.init();
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.setClearColor(0x000000, 0);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		if ("toneMapping" in renderer) {
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			renderer.toneMappingExposure = getShowroomBackgroundPreset().toneMappingExposure;
		}
		return new ShowroomScene(canvas, renderer);
	}

	configureScene() {
		this.scene.background = new THREE.Color(this.backgroundPreset.clearColor);
		this.scene.add(makeStudioStage(this.backgroundPreset));
		this.scene.add(this.carRoot);
		const hemisphere = new THREE.HemisphereLight(
			0xf3f5ff,
			0x252019,
			this.backgroundPreset.hemisphereIntensity,
		);
		this.scene.add(hemisphere);
		const key = new THREE.DirectionalLight(0xffffff, this.backgroundPreset.keyLightIntensity);
		key.position.set(-4, 7, 8);
		this.scene.add(key);
		const rim = new THREE.DirectionalLight(0x9fc7ff, this.backgroundPreset.rimLightIntensity);
		rim.position.set(5, 3, -6);
		this.scene.add(rim);
		this.loadEnvironmentMap(DEFAULT_ENVIRONMENT_MAP);
	}

	configureControls() {
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.enablePan = false;
		this.controls.minPolarAngle = Math.PI * 0.18;
		this.controls.maxPolarAngle = Math.PI * 0.58;
		this.controls.rotateSpeed = 0.42;
		this.controls.zoomSpeed = 0.62;
		this.controls.target.set(0, 0.72, 0);
		this.camera.position.set(-4.2, 1.7, 6.8);
		this.controls.update();
	}

	async loadEnvironmentMap(path) {
		try {
			const texture = await new EXRLoader().loadAsync(path);
			texture.mapping = THREE.EquirectangularReflectionMapping;
			this.scene.environment = texture;
			if ("environmentIntensity" in this.scene) {
				this.scene.environmentIntensity = this.backgroundPreset.environmentIntensity;
			}
		} catch (error) {
			console.warn("TORCS showroom failed to load studio environment", { path, error });
		}
	}

	setModel(root) {
		if (this.activeModel) {
			this.carRoot.remove(this.activeModel);
		}
		this.activeModel = root;
		this.carRoot.add(root);
		this.resize();
		this.fitModel(root);
	}

	fitModel(root) {
		root.position.set(0, 0, 0);
		root.rotation.set(0, 0, 0);
		root.scale.setScalar(1);
		root.updateWorldMatrix(true, true);
		TEMP_BOX.setFromObject(root);
		if (TEMP_BOX.isEmpty()) {
			return;
		}
		TEMP_BOX.getSize(TEMP_SIZE);
		TEMP_BOX.getCenter(TEMP_CENTER);
		const width = Math.max(TEMP_SIZE.x, 0.1);
		const height = Math.max(TEMP_SIZE.y, 0.1);
		const depth = Math.max(TEMP_SIZE.z, 0.1);
		const scale = Math.min(4.7 / Math.max(width, depth), 2.15 / height);
		root.position.set(-TEMP_CENTER.x * scale, -TEMP_BOX.min.y * scale, -TEMP_CENTER.z * scale);
		root.scale.setScalar(scale);
		root.updateWorldMatrix(true, true);
		TEMP_BOX.setFromObject(root);
		TEMP_BOX.getSize(TEMP_SIZE);
		const span = Math.max(TEMP_SIZE.x, TEMP_SIZE.z, 1.0);
		const targetY = Math.max(0.45, TEMP_SIZE.y * 0.42);
		const aspect = this.camera.aspect || 1;
		const portraitFraming = aspect < 0.75 ? clamp(0.92 / Math.max(aspect, 0.45), 1.0, 2.05) : 1.0;
		this.controls.target.set(0, targetY, 0);
		this.controls.minDistance = Math.max(2.2, span * 0.82 * portraitFraming);
		this.controls.maxDistance = Math.max(7.5, span * 3.8 * portraitFraming);
		this.camera.near = Math.max(0.03, span / 80);
		this.camera.far = Math.max(80, span * 18);
		this.camera.fov = 26;
		this.camera.position.set(
			-span * 0.92 * portraitFraming,
			targetY + span * 0.24,
			span * 1.62 * portraitFraming,
		);
		this.camera.updateProjectionMatrix();
		this.controls.update();
	}

	resize() {
		const width = Math.max(1, this.canvas.clientWidth);
		const height = Math.max(1, this.canvas.clientHeight);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height, false);
	}

	start() {
		this.renderer.setAnimationLoop(() => this.render());
	}

	render() {
		this.resize();
		const delta = this.clock.getDelta();
		if (this.activeModel) {
			this.activeModel.rotation.y += delta * 0.045;
		}
		this.controls.update();
		this.postprocess.render();
	}
}

class TorcsShowroomSource {
	constructor(assetManager) {
		this.assetManager = assetManager;
	}

	async listCars() {
		const manifest = await this.assetManager.loadManifest();
		return Object.entries(manifest.cars || {})
			.map(([source, entry]) => ({
				id: `torcs:${source}`,
				provider: TORCS_PROVIDER,
				displayName: displayNameForCar(source, entry),
				source,
				entry,
				type: "torcs",
			}))
			.sort((left, right) => left.displayName.localeCompare(right.displayName));
	}

	async loadCar(car) {
		const asset = await this.assetManager.loadCar(car.source);
		if (!asset || !asset.lods || !asset.lods.length) {
			throw new Error(`missing TORCS car visual for ${car.source}`);
		}
		const lod = asset.lods[0];
		const root = new THREE.Group();
		const body = visibleClone(lod.scene);
		root.name = car.displayName;
		root.add(body);
		if (!lod.lod || lod.lod.wheels !== false) {
			this.addStaticWheels(root, body, asset);
		}
		return root;
	}

	addStaticWheels(root, body, asset) {
		body.updateWorldMatrix(true, true);
		TEMP_BOX.setFromObject(body);
		if (TEMP_BOX.isEmpty()) {
			return;
		}
		TEMP_BOX.getSize(TEMP_SIZE);
		const length = Math.max(TEMP_SIZE.x, 0.1);
		const height = Math.max(TEMP_SIZE.y, 0.1);
		const width = Math.max(TEMP_SIZE.z, 0.1);
		const fallbackRadius = clamp(Math.min(length * 0.078, width * 0.22, height * 0.34), 0.22, 0.46);
		const fallbackWidth = clamp(width * 0.14, 0.16, 0.34);
		const fallbackLayout = [
			{
				position: [TEMP_BOX.max.x - length * 0.18, -TEMP_BOX.max.z + fallbackWidth * 0.56, fallbackRadius],
				radius: fallbackRadius,
				width: fallbackWidth,
			},
			{
				position: [TEMP_BOX.max.x - length * 0.18, -TEMP_BOX.min.z - fallbackWidth * 0.56, fallbackRadius],
				radius: fallbackRadius,
				width: fallbackWidth,
			},
			{
				position: [TEMP_BOX.min.x + length * 0.24, -TEMP_BOX.max.z + fallbackWidth * 0.56, fallbackRadius],
				radius: fallbackRadius,
				width: fallbackWidth,
			},
			{
				position: [TEMP_BOX.min.x + length * 0.24, -TEMP_BOX.min.z - fallbackWidth * 0.56, fallbackRadius],
				radius: fallbackRadius,
				width: fallbackWidth,
			},
		];
		const layout = Array.isArray(asset.entry && asset.entry.wheelLayout) &&
			asset.entry.wheelLayout.length === TORCS_WHEEL_ORDER.length
			? asset.entry.wheelLayout
			: fallbackLayout;
		const wheels = new THREE.Group();
		wheels.name = "showroom wheels";
		for (const index of TORCS_WHEEL_ORDER) {
			const wheelRecord = layout[index] || fallbackLayout[index];
			const radius = clamp(wheelRecord.radius || fallbackRadius, 0.05, 0.7);
			const wheelWidth = clamp(wheelRecord.width || fallbackWidth, 0.04, 0.5);
			const position = Array.isArray(wheelRecord.position) ? wheelRecord.position : fallbackLayout[index].position;
			const wheelCenterZ = Number.isFinite(position[2]) ? position[2] : radius;
			const wheel = makeDetailedWheel(asset.wheelAsset, index, radius, wheelWidth, asset.wheelFallbackTexture);
			torcsToShowroom(position[0], position[1], wheelCenterZ, wheel.position);
			wheels.add(wheel);
		}
		root.add(wheels);
	}
}

class LocalVwPackSource {
	constructor(pack, baseUrl, release) {
		this.pack = pack;
		this.baseUrl = baseUrl;
		this.release = release;
		this.assetsById = new Map((release.assets || []).map((asset) => [asset.id, asset]));
		this.gltfCache = new Map();
		this.loader = new GLTFLoader();
		const dracoPath = pack.dracoDecoderPath || DEFAULT_DRACO_DECODER_PATH;
		const draco = new DRACOLoader();
		draco.setDecoderPath(dracoPath);
		this.loader.setDRACOLoader(draco);
	}

	static async load(url = LOCAL_VW_PACK_URL) {
		const pack = await loadJson(url, true);
		if (!pack) {
			return null;
		}
		const baseUrl = new URL(".", new URL(url, window.location.href)).href;
		const release = await loadJson(new URL(pack.release || "release.json", baseUrl).href);
		return new LocalVwPackSource(pack, baseUrl, release);
	}

	listCars() {
		return (this.pack.cars || []).map((car) => ({
			...car,
			id: `vw:${car.id}`,
			type: "local-vw",
			provider: this.pack.label || VW_PROVIDER,
			displayName: car.displayName || car.id,
			source: car.id,
		}));
	}

	async loadCar(car) {
		const group = new THREE.Group();
		group.name = car.displayName;
		const parts = Array.isArray(car.parts) ? car.parts : [];
		for (const part of parts) {
			const url = new URL(part.file, this.baseUrl).href;
			const original = await this.loadGltf(url);
			const clone = original.clone(true);
			this.applySceneMaterials(clone, car.scene, part.geometryId);
			group.add(clone);
		}
		return group;
	}

	async loadGltf(url) {
		if (this.gltfCache.has(url)) {
			return this.gltfCache.get(url);
		}
		const gltf = await this.loader.loadAsync(url);
		this.gltfCache.set(url, gltf.scene);
		return gltf.scene;
	}

	applySceneMaterials(root, sceneName, geometryId) {
		const sceneAsset = (this.release.assets || []).find((asset) => {
			return asset.infoType === "SCENE" && asset.info && asset.info.name === sceneName;
		});
		const sceneData = sceneAsset && sceneAsset.info ? sceneAsset.info.data : null;
		if (!sceneData) {
			return;
		}
		const materialByGrouping = new Map(
			((sceneData.default_state && sceneData.default_state.grouping_material) || [])
				.map((entry) => [entry.id, entry.material_id]),
		);
		const groupings = sceneData.groupings || [];
		root.traverse((object) => {
			if (!object.isMesh) {
				return;
			}
			const grouping = this.findGrouping(groupings, object.name, geometryId);
			const materialId = grouping ? materialByGrouping.get(grouping.id) : "";
			const materialAsset = materialId ? this.assetsById.get(materialId) : null;
			const material = this.makeVwMaterial(materialAsset, object.name);
			if (material) {
				object.material = material;
			}
		});
	}

	findGrouping(groupings, objectName, geometryId) {
		let selected = groupings.find((grouping) => {
			return grouping.geometry_id === geometryId &&
				Array.isArray(grouping.object_names) &&
				grouping.object_names.includes(objectName);
		});
		if (selected) {
			return selected;
		}
		selected = groupings.find((grouping) => {
			return Array.isArray(grouping.object_names) && grouping.object_names.includes(objectName);
		});
		if (selected) {
			return selected;
		}
		const semantic = objectName.includes("#") ? objectName.split("#").pop() : objectName;
		return groupings.find((grouping) => grouping.geometry_id === geometryId && grouping.name === semantic) || null;
	}

	makeVwMaterial(materialAsset, objectName) {
		const info = materialAsset && materialAsset.info ? materialAsset.info : {};
		const data = info.data || {};
		const label = `${info.name || ""} ${objectName || ""}`.toLowerCase();
		const glass = /glass|window|windshield|sunroof/.test(label);
		const glow = /glow|drl|light|emissive/.test(label) && !glass;
		const paint = /paint|metallic|car_paint|body/.test(label);
		if (!materialAsset && !glass && !glow && !paint) {
			return null;
		}
		const color = colorFromArray(data.color, glow ? 0xffffff : 0xd8d8d8);
		const opacity = glass ? 0.46 : 1.0;
		const material = new THREE.MeshPhysicalMaterial({
			name: info.name || objectName,
			color,
			metalness: data.metalness ?? (paint ? 0.85 : 0.0),
			roughness: data.roughness ?? (paint ? 0.28 : 0.62),
			clearcoat: data.clearCoat ?? (paint ? 1.0 : 0.0),
			clearcoatRoughness: data.clearCoatRoughness ?? (paint ? 0.05 : 0.25),
			envMapIntensity: data.envMapIntensity ?? (paint ? 1.35 : 1.0),
			transparent: opacity < 1,
			opacity,
			depthWrite: opacity >= 1,
			side: glass ? THREE.DoubleSide : THREE.FrontSide,
			transmission: glass ? 0.24 : 0.0,
			ior: glass ? 1.45 : 1.5,
			emissive: glow ? color : new THREE.Color(0x000000),
			emissiveIntensity: glow ? 1.35 : 0.0,
		});
		return material;
	}
}

class ShowroomApp {
	constructor(scene, torcsSource, localSource) {
		this.scene = scene;
		this.sources = [torcsSource];
		if (localSource) {
			this.sources.push(localSource);
		}
		this.cars = [];
		this.index = 0;
		this.loading = false;
	}

	async initialize() {
		const carsBySource = await Promise.all(this.sources.map(async (source) => source.listCars()));
		this.cars = carsBySource.flat();
		this.populateSelect();
		this.bindControls();
		if (!this.cars.length) {
			this.setStatus("No showroom cars found");
			this.updateUi();
			return;
		}
		await this.showCar(0);
		this.scene.start();
	}

	populateSelect() {
		elements.select.replaceChildren();
		this.cars.forEach((car, index) => {
			const option = document.createElement("option");
			option.value = String(index);
			option.textContent = `${car.provider}: ${car.displayName}`;
			elements.select.append(option);
		});
	}

	bindControls() {
		elements.previous.addEventListener("click", () => this.showCar(this.index - 1));
		elements.next.addEventListener("click", () => this.showCar(this.index + 1));
		elements.select.addEventListener("change", () => this.showCar(Number(elements.select.value) || 0));
		window.addEventListener("keydown", (event) => {
			if (event.key === "ArrowLeft") {
				this.showCar(this.index - 1);
			} else if (event.key === "ArrowRight") {
				this.showCar(this.index + 1);
			}
		});
	}

	async showCar(nextIndex) {
		if (this.loading || !this.cars.length) {
			return;
		}
		const wrappedIndex = (nextIndex + this.cars.length) % this.cars.length;
		const car = this.cars[wrappedIndex];
		this.loading = true;
		this.index = wrappedIndex;
		this.updateUi();
		this.setStatus(`Loading ${car.displayName}`);
		try {
			const source = this.sources.find((candidate) => car.type === "local-vw"
				? candidate instanceof LocalVwPackSource
				: candidate instanceof TorcsShowroomSource);
			const model = await source.loadCar(car);
			this.scene.setModel(model);
			this.setStatus(car.type === "local-vw" ? "Local VW asset pack" : "Generated TORCS asset");
		} catch (error) {
			console.error("TORCS showroom failed to load car", { car, error });
			this.setStatus(`Failed to load ${car.displayName}`);
		} finally {
			this.loading = false;
			this.updateUi();
		}
	}

	updateUi() {
		const car = this.cars[this.index];
		elements.modelName.textContent = car ? car.displayName : "No cars";
		elements.provider.textContent = car ? `${car.provider} showroom` : "TORCS Web Showroom";
		elements.counter.textContent = this.cars.length ? `${this.index + 1} / ${this.cars.length}` : "0 / 0";
		elements.select.value = String(this.index);
		elements.previous.disabled = this.loading || this.cars.length < 2;
		elements.next.disabled = this.loading || this.cars.length < 2;
		elements.select.disabled = this.loading || this.cars.length < 1;
	}

	setStatus(message) {
		elements.status.textContent = message;
	}
}

async function main() {
	const scene = await ShowroomScene.create(elements.canvas);
	const assetManager = new AssetManager("./web-assets/", scene.renderer, "modern");
	const torcsSource = new TorcsShowroomSource(assetManager);
	const localSource = await LocalVwPackSource.load();
	const app = new ShowroomApp(scene, torcsSource, localSource);
	await app.initialize();
}

main().catch((error) => {
	console.error("TORCS showroom startup failed", error);
	elements.status.textContent = "Showroom startup failed";
	elements.modelName.textContent = "Unavailable";
});
