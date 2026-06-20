import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AssetManager } from "./assets.js";

const DEFAULT_ENVIRONMENT_MAP = "./web/hdri/120_hdrmaps_com_free_2K.exr";
const LOCAL_VW_PACK_URL = "./local-showroom-assets/vw/pack.json";
const DEFAULT_DRACO_DECODER_PATH = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
const TORCS_PROVIDER = "TORCS";
const VW_PROVIDER = "VW local";
const TORCS_WHEEL_ORDER = [0, 1, 2, 3];
const TORCS_RIGHT_WHEELS = new Set([0, 2]);
const TEMP_BOX = new THREE.Box3();
const TEMP_SIZE = new THREE.Vector3();
const TEMP_CENTER = new THREE.Vector3();

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

function makeGeneratedWheel(radius, width) {
	const group = new THREE.Group();
	const tire = new THREE.Mesh(
		new THREE.CylinderGeometry(radius, radius, width, 32, 1, false),
		new THREE.MeshStandardMaterial({
			color: 0x111111,
			metalness: 0.05,
			roughness: 0.62,
		}),
	);
	tire.rotation.x = Math.PI / 2;
	const rim = new THREE.Mesh(
		new THREE.CylinderGeometry(radius * 0.54, radius * 0.54, width * 1.05, 24, 1, false),
		new THREE.MeshStandardMaterial({
			color: 0xcac2b0,
			metalness: 0.72,
			roughness: 0.22,
		}),
	);
	rim.rotation.x = Math.PI / 2;
	group.add(tire, rim);
	return group;
}

function makeDetailedWheel(wheelAsset, wheelIndex, radius, width) {
	const state = wheelAsset && Array.isArray(wheelAsset.states)
		? wheelAsset.states.find((candidate) => candidate.speedIndex === 0) || wheelAsset.states[0]
		: null;
	const wheel = new THREE.Group();
	if (!state || !state.scene) {
		wheel.add(makeGeneratedWheel(radius, width));
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

function makeShadowTexture() {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 512;
	const context = canvas.getContext("2d");
	const gradient = context.createRadialGradient(256, 256, 12, 256, 256, 246);
	gradient.addColorStop(0, "rgba(0, 0, 0, 0.42)");
	gradient.addColorStop(0.45, "rgba(0, 0, 0, 0.20)");
	gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
	context.fillStyle = gradient;
	context.fillRect(0, 0, canvas.width, canvas.height);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

function makeStudioFloor() {
	const group = new THREE.Group();
	const floor = new THREE.Mesh(
		new THREE.CircleGeometry(18, 96),
		new THREE.MeshStandardMaterial({
			color: 0x1a1d1d,
			metalness: 0.0,
			roughness: 0.72,
		}),
	);
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = -0.015;
	group.add(floor);

	const shadow = new THREE.Mesh(
		new THREE.PlaneGeometry(8, 8),
		new THREE.MeshBasicMaterial({
			map: makeShadowTexture(),
			transparent: true,
			depthWrite: false,
		}),
	);
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.y = 0.005;
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
		this.configureScene();
		this.configureControls();
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
			renderer.toneMappingExposure = 0.82;
		}
		return new ShowroomScene(canvas, renderer);
	}

	configureScene() {
		this.scene.add(makeStudioFloor());
		this.scene.add(this.carRoot);
		const hemisphere = new THREE.HemisphereLight(0xf3f5ff, 0x252019, 1.4);
		this.scene.add(hemisphere);
		const key = new THREE.DirectionalLight(0xffffff, 3.0);
		key.position.set(-4, 7, 8);
		this.scene.add(key);
		const rim = new THREE.DirectionalLight(0x9fc7ff, 1.2);
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
				this.scene.environmentIntensity = 1.1;
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
		this.controls.target.set(0, targetY, 0);
		this.controls.minDistance = Math.max(2.2, span * 0.82);
		this.controls.maxDistance = Math.max(7.5, span * 3.8);
		this.camera.near = Math.max(0.03, span / 80);
		this.camera.far = Math.max(80, span * 18);
		this.camera.fov = 26;
		this.camera.position.set(-span * 0.92, targetY + span * 0.24, span * 1.62);
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
		this.renderer.render(this.scene, this.camera);
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
			const wheel = makeDetailedWheel(asset.wheelAsset, index, radius, wheelWidth);
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
