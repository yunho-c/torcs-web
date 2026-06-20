import * as THREE from "three/webgpu";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { TorcsEffects } from "./effects.js";
import { SNAPSHOT } from "./runtime.js";
import { warnOnce } from "./diagnostics.js";

const ROAD_Y = 0.03;
const WHEEL_ORDER = [0, 1, 2, 3];
const RIGHT_WHEELS = new Set([0, 2]);
const WHEEL_SPEED_THRESHOLDS = [20, 40, 70];
const WHEEL_HEAT_COOL = new THREE.Color(0x343936);
const WHEEL_HEAT_HOT = new THREE.Color(0xff5b32);
const DEFAULT_BACKGROUND = new THREE.Color(0x0b0d0c);
const DEFAULT_AMBIENT = new THREE.Color(0xd8e0db);
const DEFAULT_SUN = new THREE.Color(0xfff0d2);
const OPPONENT_COLORS = [0x78bdc4, 0xd4ad5f, 0x87b56f, 0xb78bd9];
const RENDER_PROFILES = new Set(["legacy", "modern"]);
const FOG_NEAR = 300;
const FOG_FAR = 1200;
// Keep the panorama inside the chase/onboard camera far plane so it is not clipped.
const BACKGROUND_RADIUS = 500;
const BACKGROUND_HEIGHT = BACKGROUND_RADIUS * 2;
const BACKGROUND_VERTICAL_BIAS = 0;
const DEFAULT_ENVIRONMENT_MAP = "./web/hdri/120_hdrmaps_com_free_2K.exr";
const DEFAULT_SKYBOX_PREFIX = "./web/skybox/arid2";
const DEFAULT_SKYBOX_FACES = ["rt", "lf", "up", "dn", "ft", "bk"];
const DEFAULT_ENVIRONMENT_INTENSITY = 0.8;
const DEFAULT_AMBIENT_INTENSITY = 2.4;
const DEFAULT_SUN_INTENSITY = 2.3;
const TORCS_TO_THREE_BASIS = new THREE.Matrix4().set(
	1, 0, 0, 0,
	0, 0, 1, 0,
	0, -1, 0, 0,
	0, 0, 0, 1,
);
const THREE_TO_TORCS_BASIS = new THREE.Matrix4().copy(TORCS_TO_THREE_BASIS).invert();
const TORCS_POS_MATRIX = new THREE.Matrix4();
const CAR_ROTATION_MATRIX = new THREE.Matrix4();

function torcsToThree(x, y, z = 0, target = new THREE.Vector3()) {
	return target.set(x, z, -y);
}

function normalizeRenderProfile(profile) {
	return RENDER_PROFILES.has(profile) ? profile : "legacy";
}

function getTorcsPoseQuaternion(values, target) {
	const offset = SNAPSHOT.posMat0;

	// PLIB stores row-vector transforms; Three.js uses column-vector matrices.
	TORCS_POS_MATRIX.set(
		values[offset + 0], values[offset + 4], values[offset + 8], 0,
		values[offset + 1], values[offset + 5], values[offset + 9], 0,
		values[offset + 2], values[offset + 6], values[offset + 10], 0,
		0, 0, 0, 1,
	);
	CAR_ROTATION_MATRIX.multiplyMatrices(TORCS_TO_THREE_BASIS, TORCS_POS_MATRIX);
	CAR_ROTATION_MATRIX.multiply(THREE_TO_TORCS_BASIS);
	return target.setFromRotationMatrix(CAR_ROTATION_MATRIX);
}

function getTorcsPosePosition(values, target = new THREE.Vector3()) {
	const offset = SNAPSHOT.posMat0;
	return target.set(
		values[offset + 12],
		values[offset + 14],
		-values[offset + 13],
	);
}

function setObjectQuaternionFromTorcsPosMat(object, values) {
	getTorcsPoseQuaternion(values, object.quaternion);
}

function setObjectPoseFromTorcsPosMat(object, values) {
	getTorcsPosePosition(values, object.position);
	getTorcsPoseQuaternion(values, object.quaternion);
}

function makeLine(points, color, opacity, yOffset = ROAD_Y) {
	const geometry = new THREE.BufferGeometry().setFromPoints(makeClosedLinePoints(points, yOffset));
	const material = new THREE.LineBasicMaterial({
		color,
		transparent: opacity < 1,
		opacity,
	});
	return new THREE.Line(geometry, material);
}

function makeClosedLinePoints(points, yOffset = ROAD_Y) {
	const linePoints = points.map((point) => torcsToThree(point.x, point.y, yOffset));
	if (linePoints.length > 1) {
		linePoints.push(linePoints[0].clone());
	}
	return linePoints;
}

function makeRoadMesh(track) {
	const positions = [];
	const indices = [];
	for (let i = 0; i < track.left.length; i += 1) {
		const left = torcsToThree(track.left[i].x, track.left[i].y, 0);
		const right = torcsToThree(track.right[i].x, track.right[i].y, 0);
		positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
	}
	for (let i = 0; i < track.left.length; i += 1) {
		const next = (i + 1) % track.left.length;
		const left = i * 2;
		const right = left + 1;
		const nextLeft = next * 2;
		const nextRight = nextLeft + 1;
		indices.push(left, right, nextLeft, right, nextRight, nextLeft);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return new THREE.Mesh(
		geometry,
		new THREE.MeshLambertMaterial({ color: 0x30342e, side: THREE.DoubleSide }),
	);
}

function getCarDimensions(values) {
	return [
		Math.max(0.1, values[SNAPSHOT.dimensionX]),
		Math.max(0.1, values[SNAPSHOT.dimensionZ]),
		Math.max(0.1, values[SNAPSHOT.dimensionY]),
	];
}

function getSnapshotCarIndex(values, fallback = 0) {
	return Number.isInteger(values && values.carIndex) ? values.carIndex : fallback;
}

function getOpponentColor(carIndex) {
	const colorIndex = carIndex > 0 ? carIndex - 1 : OPPONENT_COLORS.length - 1;
	return OPPONENT_COLORS[colorIndex % OPPONENT_COLORS.length];
}

function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}

function colorFromRgb(values, fallback) {
	if (!Array.isArray(values) || values.length < 3) {
		return fallback.clone();
	}
	return new THREE.Color(
		clamp01(values[0]),
		clamp01(values[1]),
		clamp01(values[2]),
	);
}

function carAssetWarningId(asset) {
	const entry = asset && asset.entry;
	return entry ? entry.xml || entry.source || entry.name || "unknown-car" : "unknown-car";
}

function getCarLodFactor(camera, position, canvas) {
	if (!camera || !camera.isPerspectiveCamera) {
		return Number.POSITIVE_INFINITY;
	}
	const distance = Math.max(0.001, camera.position.distanceTo(position));
	const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
	const fovRadians = THREE.MathUtils.degToRad(camera.fov * 0.5);
	return height * 0.5 / distance / Math.tan(fovRadians);
}

function makeWheelGeometry(radius, width) {
	return new THREE.CylinderGeometry(
		Math.max(0.05, radius),
		Math.max(0.05, radius),
		Math.max(0.04, width),
		24,
		1,
		false,
	);
}

function makeWheelSpokes(radius, width) {
	const group = new THREE.Group();
	const material = new THREE.MeshBasicMaterial({ color: 0xd8d0bd });
	const spokeLength = Math.max(0.08, radius * 1.5);
	const spokeWidth = Math.max(0.015, radius * 0.08);
	for (let i = 0; i < 3; i += 1) {
		const spoke = new THREE.Mesh(
			new THREE.BoxGeometry(spokeLength, spokeWidth, Math.max(0.02, width * 1.06)),
			material,
		);
		spoke.rotation.z = i * Math.PI / 3;
		group.add(spoke);
	}
	return group;
}

function makeWheelHeatMesh(radius, width, opacity) {
	const heatMaterial = new THREE.MeshBasicMaterial({
		color: WHEEL_HEAT_COOL.clone(),
		transparent: true,
		opacity,
	});
	const heat = new THREE.Mesh(makeWheelGeometry(radius * 0.58, width * 1.08), heatMaterial);
	heat.rotation.x = Math.PI / 2;
	return heat;
}

function tintClone(root, color) {
	const clone = root.clone(true);
	const tint = new THREE.Color(color);
	clone.traverse((node) => {
		if (node.isMesh && node.material) {
			node.material = node.material.clone();
			if (node.material.color) {
				node.material.color.lerp(tint, 0.22);
			}
		}
	});
	return clone;
}

function cloneWheelScene(root, color = null) {
	return color === null || color === undefined ? root.clone(true) : tintClone(root, color);
}

function getWheelAssetKey(asset) {
	const wheelAsset = asset && asset.wheelAsset;
	if (!wheelAsset || !Array.isArray(wheelAsset.states) || wheelAsset.states.length !== 4) {
		return "generated";
	}
	return `${wheelAsset.source}:${wheelAsset.directory}:${wheelAsset.basename}`;
}

function getWheelSpeedState(values, index, thresholds = WHEEL_SPEED_THRESHOLDS) {
	const spinVelocity = Math.abs(values[SNAPSHOT.wheelSpinVelocity0 + index] || 0);
	for (let state = 0; state < thresholds.length; state += 1) {
		if (spinVelocity < thresholds[state]) {
			return state;
		}
	}
	return thresholds.length;
}

export class TorcsScene {
	static async create(canvas) {
		const params = new URLSearchParams(window.location.search);
		const renderer = new THREE.WebGPURenderer({
			canvas,
			antialias: true,
			forceWebGL: params.get("renderer") === "webgl",
		});
		await renderer.init();
		const scene = new TorcsScene(renderer);
		await scene.loadEnvironmentMap(DEFAULT_ENVIRONMENT_MAP);
		return scene;
	}

	constructor(renderer) {
		this.renderer = renderer;
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.setClearColor(DEFAULT_BACKGROUND, 1);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		this.scene = new THREE.Scene();
		this.scene.background = DEFAULT_BACKGROUND.clone();
		this.scene.fog = new THREE.Fog(DEFAULT_BACKGROUND, FOG_NEAR, FOG_FAR);

		this.groups = {
			background: new THREE.Group(),
			land: new THREE.Group(),
			skidMarks: new THREE.Group(),
			shadows: new THREE.Group(),
			cars: new THREE.Group(),
			carLights: new THREE.Group(),
			smoke: new THREE.Group(),
		};
		for (const group of Object.values(this.groups)) {
			this.scene.add(group);
		}

		this.addLighting();
		this.addReferenceGrid();
		this.car = null;
		this.carBox = null;
		this.carVisualRoot = null;
		this.carLods = [];
		this.activeCarLod = null;
		this.carDimensions = null;
		this.generatedWheels = [];
		this.selectedWheelModeKey = "";
		this.opponentCars = [];
		this.carAsset = null;
		this.activeCarVisualAsset = null;
		this.fallbackCarAsset = null;
		this.carAssets = new Map();
		this.effectTextures = null;
		this.footprint = null;
		this.track = null;
		this.trackVisual = null;
			this.backgroundDome = null;
			this.environmentMap = null;
			this.skyboxMap = null;
			this.skyboxLoadPromise = null;
			this.useSkybox = false;
			this.trackBackgroundColor = DEFAULT_BACKGROUND.clone();
			this.trackBackgroundTexture = null;
			this.renderProfile = "legacy";
			this.lightIntensityScale = 1.0;
			this.carEffects = [];
			this.effects = this.createCarEffects(0);
		}

	setRenderProfile(profile) {
		this.renderProfile = normalizeRenderProfile(profile);
	}

	setLightIntensityScale(scale) {
		this.lightIntensityScale = Number.isFinite(scale) ? Math.max(0, scale) : 1.0;
		this.applyTrackLightIntensities();
	}

	applyTrackLightIntensities() {
		if (!this.ambientLight || !this.sunLight) {
			return;
		}
		this.ambientLight.intensity = DEFAULT_AMBIENT_INTENSITY * this.lightIntensityScale;
		this.sunLight.intensity = DEFAULT_SUN_INTENSITY * this.lightIntensityScale;
	}

	addLighting() {
		this.ambientLight = new THREE.AmbientLight(DEFAULT_AMBIENT, DEFAULT_AMBIENT_INTENSITY);
		this.scene.add(this.ambientLight);
		this.sunLight = new THREE.DirectionalLight(DEFAULT_SUN, DEFAULT_SUN_INTENSITY);
		this.sunLight.position.set(-90, 160, 80);
		this.scene.add(this.sunLight);
	}

	async loadEnvironmentMap(relativePath) {
		let sourceTexture = null;
		let pmremGenerator = null;
		try {
			sourceTexture = await new EXRLoader().loadAsync(relativePath);
			sourceTexture.mapping = THREE.EquirectangularReflectionMapping;
			pmremGenerator = new THREE.PMREMGenerator(this.renderer);
			const renderTarget = pmremGenerator.fromEquirectangular(sourceTexture);
			this.environmentMap = renderTarget.texture;
			this.scene.environment = this.environmentMap;
			if ("environmentIntensity" in this.scene) {
				this.scene.environmentIntensity = DEFAULT_ENVIRONMENT_INTENSITY;
			}
		} catch (error) {
			console.warn("TORCS web renderer failed to load HDRI environment map", {
				environmentMap: relativePath,
				error,
			});
		} finally {
			if (sourceTexture) {
				sourceTexture.dispose();
			}
			if (pmremGenerator) {
				pmremGenerator.dispose();
			}
		}
	}

	async loadSkybox(prefix = DEFAULT_SKYBOX_PREFIX) {
		if (this.skyboxMap) {
			return this.skyboxMap;
		}
		if (!this.skyboxLoadPromise) {
			const paths = DEFAULT_SKYBOX_FACES.map((face) => `${prefix}_${face}.jpg`);
			this.skyboxLoadPromise = new THREE.CubeTextureLoader()
				.loadAsync(paths)
				.then((texture) => {
					texture.colorSpace = THREE.SRGBColorSpace;
					texture.mapping = THREE.CubeReflectionMapping;
					this.skyboxMap = texture;
					return texture;
				})
				.catch((error) => {
					this.skyboxLoadPromise = null;
					console.warn("TORCS web renderer failed to load skybox cubemap", {
						skybox: prefix,
						error,
					});
					throw error;
				});
		}
		return this.skyboxLoadPromise;
	}

	async setUseSkybox(enabled) {
		this.useSkybox = Boolean(enabled);
		if (this.useSkybox) {
			await this.loadSkybox();
		}
		this.applyBackgroundMode();
	}

	applyBackgroundMode() {
		if (this.useSkybox && this.skyboxMap) {
			this.removeBackgroundDome();
			this.scene.background = this.skyboxMap;
			this.scene.environment = this.skyboxMap;
			if ("environmentIntensity" in this.scene) {
				this.scene.environmentIntensity = DEFAULT_ENVIRONMENT_INTENSITY;
			}
			return;
		}
		this.scene.background = this.trackBackgroundColor.clone();
		this.scene.environment = this.environmentMap;
		if ("environmentIntensity" in this.scene) {
			this.scene.environmentIntensity = DEFAULT_ENVIRONMENT_INTENSITY;
		}
		this.setBackgroundDome(this.trackBackgroundTexture);
	}

	addReferenceGrid() {
		const grid = new THREE.GridHelper(720, 48, 0x435047, 0x242a25);
		grid.position.y = -0.01;
		this.groups.land.add(grid);
	}

	createCarEffects(carIndex) {
		const effects = new TorcsEffects(this.groups);
		effects.setCarAsset(this.getCarAssetForIndex(carIndex));
		effects.setTextures(this.effectTextures);
		effects.setVisible(false);
		this.carEffects[carIndex] = effects;
		return effects;
	}

	getCarEffects(carIndex) {
		return this.carEffects[carIndex] || this.createCarEffects(carIndex);
	}

	setTrack(track) {
		for (const effects of this.carEffects) {
			if (effects) {
				effects.resetDynamics();
				effects.setVisible(false);
			}
		}
		if (this.track) {
			this.groups.land.remove(this.track);
		}
		const root = new THREE.Group();
		root.add(makeRoadMesh(track));
		root.add(makeLine(track.left, 0xe8e2d0, 0.82));
		root.add(makeLine(track.right, 0xe8e2d0, 0.82));
		root.add(makeLine(track.center, 0x7fc3c9, 0.48, ROAD_Y + 0.03));
		this.track = root;
		this.groups.land.add(root);
	}

	setTrackVisual(model) {
		if (this.trackVisual) {
			this.groups.land.remove(this.trackVisual);
		}
		this.trackVisual = model;
		if (this.trackVisual) {
			this.groups.land.add(this.trackVisual);
		}
	}

	setTrackAtmosphere(entry, backgroundTexture = null) {
		const backgroundColor = colorFromRgb(entry && entry.backgroundColor, DEFAULT_BACKGROUND);
		const fogColor = backgroundColor.clone().multiplyScalar(0.8);
		const ambientColor = colorFromRgb(entry && entry.ambientColor, DEFAULT_AMBIENT);
		const diffuseColor = colorFromRgb(entry && entry.diffuseColor, DEFAULT_SUN);
		this.renderer.setClearColor(backgroundColor, 1);
		this.trackBackgroundColor = backgroundColor.clone();
		this.trackBackgroundTexture = backgroundTexture;
			this.scene.fog = new THREE.Fog(fogColor, FOG_NEAR, FOG_FAR);
			this.ambientLight.color.copy(ambientColor);
			this.sunLight.color.copy(diffuseColor);
			this.applyTrackLightIntensities();

			const lightPosition = entry && Array.isArray(entry.lightPosition)
			? torcsToThree(entry.lightPosition[0], entry.lightPosition[1], entry.lightPosition[2])
			: new THREE.Vector3(-90, 160, 80);
		if (lightPosition.lengthSq() > 0.001) {
			lightPosition.normalize().multiplyScalar(260);
		}
		this.sunLight.position.copy(lightPosition);
		this.applyBackgroundMode();
		if (entry && entry.backgroundTexture && !backgroundTexture) {
			console.warn("TORCS web renderer track background texture is configured but unavailable", {
				background: entry.background,
				backgroundTexture: entry.backgroundTexture,
			});
		}
	}

	removeBackgroundDome() {
		if (this.backgroundDome) {
			this.groups.background.remove(this.backgroundDome);
			this.backgroundDome.geometry.dispose();
			this.backgroundDome.material.dispose();
			this.backgroundDome = null;
		}
	}

	setBackgroundDome(texture) {
		this.removeBackgroundDome();
		if (!texture) {
			console.warn("TORCS web renderer skipped background dome because no texture was provided");
			return;
		}
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.ClampToEdgeWrapping;
		texture.repeat.set(-1, 1);
		texture.offset.x = 1;
		const geometry = new THREE.CylinderGeometry(
			BACKGROUND_RADIUS,
			BACKGROUND_RADIUS,
			BACKGROUND_HEIGHT,
			96,
			1,
			true,
		);
		const material = new THREE.MeshBasicMaterial({
			map: texture,
			color: 0xffffff,
			side: THREE.BackSide,
			depthTest: false,
			depthWrite: false,
			fog: false,
		});
		this.backgroundDome = new THREE.Mesh(geometry, material);
		this.backgroundDome.renderOrder = -1000;
		this.backgroundDome.frustumCulled = false;
		this.groups.background.add(this.backgroundDome);
	}

	getCarAssetForIndex(carIndex) {
		return this.carAssets.get(carIndex) || this.fallbackCarAsset || this.carAsset || null;
	}

	setCarVisual(asset) {
		this.setCarVisualAssets(new Map(), asset);
		this.setSelectedCarVisual(asset);
	}

	setCarVisualAssets(assetsByCarIndex = new Map(), fallbackAsset = null) {
		this.carAssets = assetsByCarIndex instanceof Map ? assetsByCarIndex : new Map();
		this.fallbackCarAsset = fallbackAsset;
		for (let index = 0; index < this.carEffects.length; index += 1) {
			const effects = this.carEffects[index];
			if (effects) {
				effects.setCarAsset(this.getCarAssetForIndex(index));
			}
		}
		for (const opponent of this.opponentCars) {
			if (opponent) {
				this.setOpponentVisual(opponent, this.getCarAssetForIndex(opponent.root.userData.carIndex));
			}
		}
	}

	setSelectedCarVisual(asset) {
		this.carAsset = asset;
		if (!this.car) {
			return;
		}
		if (asset === this.activeCarVisualAsset) {
			return;
		}
		if (this.carVisualRoot) {
			this.car.remove(this.carVisualRoot);
		}
		this.carVisualRoot = null;
		this.carLods = [];
		this.activeCarLod = null;
		this.selectedWheelModeKey = "";
		this.activeCarVisualAsset = asset;
		if (asset && asset.lods && asset.lods.length) {
			this.carVisualRoot = new THREE.Group();
			this.carLods = asset.lods
				.slice()
				.sort((a, b) => b.lod.threshold - a.lod.threshold);
			for (const item of this.carLods) {
				item.scene.visible = false;
				this.carVisualRoot.add(item.scene);
			}
			this.car.add(this.carVisualRoot);
			if (this.carBox) {
				this.carBox.visible = false;
			}
		} else if (this.carBox) {
			this.carBox.visible = true;
		}
	}

	setEffectTextures(textures) {
		this.effectTextures = textures || null;
		for (const effects of this.carEffects) {
			if (effects) {
				effects.setTextures(textures);
			}
		}
	}

	createCar(values) {
		this.carDimensions = getCarDimensions(values);
		this.car = new THREE.Group();
		this.groups.cars.add(this.car);

		const geometry = new THREE.BoxGeometry(...this.carDimensions);
		const material = new THREE.MeshLambertMaterial({ color: 0xc9483d });
		this.carBox = new THREE.Mesh(geometry, material);
		this.car.add(this.carBox);

		this.footprint = makeLine([], 0xf3ead6, 0.92, ROAD_Y + 0.08);
		this.groups.cars.add(this.footprint);
		this.createGeneratedWheels(values);
	}

	clearSelectedWheels() {
		for (const wheel of this.generatedWheels) {
			this.car.remove(wheel.root);
		}
		this.generatedWheels = [];
	}

	createGeneratedWheels(values) {
		this.clearSelectedWheels();

		for (const index of WHEEL_ORDER) {
			const radius = Math.max(0.05, values[SNAPSHOT.wheelRadius0 + index] || 0.32);
			const width = Math.max(0.04, values[SNAPSHOT.wheelWidth0 + index] || 0.18);
			const root = new THREE.Group();
			const steer = new THREE.Group();
			const camber = new THREE.Group();
			const spin = new THREE.Group();
			const tireMaterial = new THREE.MeshLambertMaterial({ color: 0x151716 });
			const tire = new THREE.Mesh(makeWheelGeometry(radius, width), tireMaterial);
			tire.rotation.x = Math.PI / 2;
			const heat = makeWheelHeatMesh(radius, width, 0.72);
			const spokes = makeWheelSpokes(radius, width);
			spin.add(tire, heat, spokes);
			camber.add(spin);
			steer.add(camber);
			root.add(steer);
			this.car.add(root);
			this.generatedWheels.push({
				root,
				steer,
				camber,
				spin,
				tire,
				heat,
				spokes,
				radius,
				width,
				wheelType: "generated",
			});
		}
	}

	createDetailedWheels(values, color = null) {
		this.clearSelectedWheels();
		const wheelAsset = this.carAsset && this.carAsset.wheelAsset;
		for (const index of WHEEL_ORDER) {
			const radius = Math.max(0.05, values[SNAPSHOT.wheelRadius0 + index] || 0.32);
			const width = Math.max(0.04, values[SNAPSHOT.wheelWidth0 + index] || 0.18);
			const root = new THREE.Group();
			const steer = new THREE.Group();
			const camber = new THREE.Group();
			const spin = new THREE.Group();
			const scale = new THREE.Group();
			const sideFlip = new THREE.Group();
			if (RIGHT_WHEELS.has(index)) {
				sideFlip.rotation.y = Math.PI;
			}
			const states = wheelAsset.states.map((state) => {
				const scene = cloneWheelScene(state.scene, color);
				scene.visible = false;
				sideFlip.add(scene);
				return { ...state, scene };
			});
			const heat = makeWheelHeatMesh(radius, width, 0.72);
			spin.add(heat);
			scale.add(sideFlip);
			spin.add(scale);
			camber.add(spin);
			steer.add(camber);
			root.add(steer);
			this.car.add(root);
			this.generatedWheels.push({
				root,
				steer,
				camber,
				spin,
				scale,
				heat,
				states,
				activeState: -1,
				radius,
				width,
				wheelType: "detailed",
				speedThresholds: wheelAsset.speedThresholds || WHEEL_SPEED_THRESHOLDS,
			});
		}
	}

	ensureSelectedWheels(values) {
		if (!this.car) {
			return;
		}
		const nextKey = getWheelAssetKey(this.carAsset);
		if (nextKey === this.selectedWheelModeKey && this.generatedWheels.length === WHEEL_ORDER.length) {
			return;
		}
		if (nextKey === "generated") {
			this.createGeneratedWheels(values);
		} else {
			this.createDetailedWheels(values);
		}
		this.selectedWheelModeKey = nextKey;
	}

	selectCarLod(camera) {
		if (!this.carLods.length) {
			return;
		}
		let next = this.carLods[this.carLods.length - 1];
		if (camera) {
			const lodFactor = getCarLodFactor(camera, this.car.position, this.renderer.domElement);
			for (const item of this.carLods) {
				if (lodFactor >= item.lod.threshold) {
					next = item;
					break;
				}
			}
		} else {
			next = this.carLods[0];
		}
		if (next === this.activeCarLod) {
			return;
		}
		for (const item of this.carLods) {
			item.scene.visible = item === next;
		}
		for (const wheel of this.generatedWheels) {
			wheel.root.visible = next.lod.wheels !== false;
		}
		const usingGeneratedWheels = this.generatedWheels.some((wheel) => wheel.wheelType === "generated");
		if (next.lod.wheels !== false && usingGeneratedWheels) {
			warnOnce(
				`generated-wheels:${carAssetWarningId(this.carAsset)}:${next.lod.model || next.lod.threshold}`,
				"TORCS web renderer using runtime generated wheels for car LOD",
				{
					car: carAssetWarningId(this.carAsset),
					lod: next.lod.model || "",
					threshold: next.lod.threshold,
					wheelAsset: this.carAsset ? this.carAsset.wheelAsset : null,
					wheelFallback: this.carAsset && this.carAsset.entry ? this.carAsset.entry.wheelFallback : null,
				},
			);
		}
		this.activeCarLod = next;
	}

	updateGeneratedWheels(values) {
		for (let index = 0; index < this.generatedWheels.length; index += 1) {
			const wheel = this.generatedWheels[index];
			const radius = Math.max(0.05, values[SNAPSHOT.wheelRadius0 + index] || wheel.radius);
			const width = Math.max(0.04, values[SNAPSHOT.wheelWidth0 + index] || wheel.width);
			const sizeChanged = Math.abs(radius - wheel.radius) > 0.001 || Math.abs(width - wheel.width) > 0.001;
			if (sizeChanged) {
				if (wheel.tire) {
					wheel.tire.geometry.dispose();
					wheel.tire.geometry = makeWheelGeometry(radius, width);
				}
				if (wheel.heat) {
					wheel.heat.geometry.dispose();
					wheel.heat.geometry = makeWheelGeometry(radius * 0.58, width * 1.08);
				}
				if (wheel.spokes) {
					wheel.spokes.clear();
					wheel.spokes.add(...makeWheelSpokes(radius, width).children);
				}
				wheel.radius = radius;
				wheel.width = width;
			}

			wheel.root.position.copy(torcsToThree(
				values[SNAPSHOT.wheelRelX0 + index],
				values[SNAPSHOT.wheelRelY0 + index],
				values[SNAPSHOT.wheelRelZ0 + index],
			));
			wheel.steer.rotation.y = values[SNAPSHOT.wheelSteerAngle0 + index];
			wheel.camber.rotation.x = values[SNAPSHOT.wheelRelRoll0 + index];
			wheel.spin.rotation.z = -(values[SNAPSHOT.wheelSpinAngle0 + index] || 0);
			if (wheel.scale) {
				wheel.scale.scale.set(radius * 2, radius * 2, width);
			}
			if (wheel.states) {
				const nextState = getWheelSpeedState(values, index, wheel.speedThresholds);
				if (nextState !== wheel.activeState) {
					for (const state of wheel.states) {
						state.scene.visible = state.speedIndex === nextState;
					}
					wheel.activeState = nextState;
				}
			}

			const heat = clamp01(values[SNAPSHOT.wheelBrakeTemp0 + index]);
			wheel.heat.material.color.copy(WHEEL_HEAT_COOL).lerp(WHEEL_HEAT_HOT, heat);
			wheel.heat.material.opacity = 0.38 + heat * 0.5;
		}
	}

	createOpponentCar(values, carIndex) {
		const root = new THREE.Group();
		root.userData.carIndex = carIndex;
		this.groups.cars.add(root);
		const dimensions = getCarDimensions(values);
		const color = getOpponentColor(carIndex);
		const box = new THREE.Mesh(
			new THREE.BoxGeometry(...dimensions),
			new THREE.MeshLambertMaterial({ color }),
		);
		root.add(box);
		const opponent = {
			root,
			box,
			dimensions,
			color,
			effects: this.getCarEffects(carIndex),
			visualRoot: null,
			lods: [],
			activeLod: null,
			wheels: [],
			wheelModeKey: "",
			asset: null,
		};
		this.opponentCars[carIndex] = opponent;
		opponent.effects.setVisible(false);
		this.createOpponentWheels(opponent, values);
		this.setOpponentVisual(opponent);
		return opponent;
	}

	createOpponentWheels(opponent, values) {
		for (const wheel of opponent.wheels) {
			opponent.root.remove(wheel.root);
		}
		opponent.wheels = [];
		for (const index of WHEEL_ORDER) {
			const radius = Math.max(0.05, values[SNAPSHOT.wheelRadius0 + index] || 0.32);
			const width = Math.max(0.04, values[SNAPSHOT.wheelWidth0 + index] || 0.18);
			const root = new THREE.Group();
			const steer = new THREE.Group();
			const camber = new THREE.Group();
			const spin = new THREE.Group();
			const tire = new THREE.Mesh(
				makeWheelGeometry(radius, width),
				new THREE.MeshLambertMaterial({ color: 0x151716 }),
			);
			tire.rotation.x = Math.PI / 2;
			const heat = makeWheelHeatMesh(radius, width, 0.52);
			const spokes = makeWheelSpokes(radius, width);
			spin.add(tire, heat, spokes);
			camber.add(spin);
			steer.add(camber);
			root.add(steer);
			opponent.root.add(root);
			opponent.wheels.push({ root, steer, camber, spin, tire, heat, spokes, radius, width, wheelType: "generated" });
		}
		opponent.wheelModeKey = "generated";
	}

	createOpponentDetailedWheels(opponent, values) {
		for (const wheel of opponent.wheels) {
			opponent.root.remove(wheel.root);
		}
		opponent.wheels = [];
		const wheelAsset = opponent.asset && opponent.asset.wheelAsset;
		for (const index of WHEEL_ORDER) {
			const radius = Math.max(0.05, values[SNAPSHOT.wheelRadius0 + index] || 0.32);
			const width = Math.max(0.04, values[SNAPSHOT.wheelWidth0 + index] || 0.18);
			const root = new THREE.Group();
			const steer = new THREE.Group();
			const camber = new THREE.Group();
			const spin = new THREE.Group();
			const scale = new THREE.Group();
			const sideFlip = new THREE.Group();
			if (RIGHT_WHEELS.has(index)) {
				sideFlip.rotation.y = Math.PI;
			}
			const states = wheelAsset.states.map((state) => {
				const scene = cloneWheelScene(state.scene, opponent.color);
				scene.visible = false;
				sideFlip.add(scene);
				return { ...state, scene };
			});
			const heat = makeWheelHeatMesh(radius, width, 0.52);
			spin.add(heat);
			scale.add(sideFlip);
			spin.add(scale);
			camber.add(spin);
			steer.add(camber);
			root.add(steer);
			opponent.root.add(root);
			opponent.wheels.push({
				root,
				steer,
				camber,
				spin,
				scale,
				heat,
				states,
				activeState: -1,
				radius,
				width,
				wheelType: "detailed",
				speedThresholds: wheelAsset.speedThresholds || WHEEL_SPEED_THRESHOLDS,
			});
		}
		opponent.wheelModeKey = getWheelAssetKey(opponent.asset);
	}

	ensureOpponentWheels(opponent, values) {
		const nextKey = getWheelAssetKey(opponent.asset);
		if (nextKey === opponent.wheelModeKey && opponent.wheels.length === WHEEL_ORDER.length) {
			return;
		}
		if (nextKey === "generated") {
			this.createOpponentWheels(opponent, values);
		} else {
			this.createOpponentDetailedWheels(opponent, values);
		}
	}

	setOpponentVisual(opponent, asset = null) {
		if (asset === opponent.asset && (asset ? opponent.visualRoot : opponent.box.visible)) {
			return;
		}
		if (opponent.visualRoot) {
			opponent.root.remove(opponent.visualRoot);
		}
		opponent.asset = asset;
		opponent.visualRoot = null;
		opponent.lods = [];
		opponent.activeLod = null;
		opponent.wheelModeKey = "";
		opponent.effects.setCarAsset(asset);
		if (!asset || !asset.lods || !asset.lods.length) {
			opponent.box.visible = true;
			return;
		}
		opponent.visualRoot = new THREE.Group();
		opponent.lods = asset.lods
			.slice()
			.sort((a, b) => b.lod.threshold - a.lod.threshold)
			.map((item) => ({
				lod: item.lod,
				scene: tintClone(item.scene, opponent.color),
			}));
		for (const item of opponent.lods) {
			item.scene.visible = false;
			opponent.visualRoot.add(item.scene);
		}
		opponent.root.add(opponent.visualRoot);
		opponent.box.visible = false;
	}

	selectOpponentLod(opponent, camera) {
		if (!opponent.lods.length) {
			return;
		}
		let next = opponent.lods[opponent.lods.length - 1];
		if (camera) {
			const lodFactor = getCarLodFactor(camera, opponent.root.position, this.renderer.domElement);
			for (const item of opponent.lods) {
				if (lodFactor >= item.lod.threshold) {
					next = item;
					break;
				}
			}
		}
		if (next === opponent.activeLod) {
			return;
		}
		for (const item of opponent.lods) {
			item.scene.visible = item === next;
		}
		for (const wheel of opponent.wheels) {
			wheel.root.visible = next.lod.wheels !== false;
		}
		const usingGeneratedWheels = opponent.wheels.some((wheel) => wheel.wheelType === "generated");
		if (next.lod.wheels !== false && usingGeneratedWheels) {
			warnOnce(
				`generated-opponent-wheels:${carAssetWarningId(opponent.asset)}:${next.lod.model || next.lod.threshold}`,
				"TORCS web renderer using runtime generated wheels for opponent car LOD",
				{
					car: carAssetWarningId(opponent.asset),
					lod: next.lod.model || "",
					threshold: next.lod.threshold,
					wheelAsset: opponent.asset ? opponent.asset.wheelAsset : null,
					wheelFallback: opponent.asset && opponent.asset.entry ? opponent.asset.entry.wheelFallback : null,
				},
			);
		}
		opponent.activeLod = next;
	}

	updateOpponentWheels(opponent, values) {
		for (let index = 0; index < opponent.wheels.length; index += 1) {
			const wheel = opponent.wheels[index];
			const radius = Math.max(0.05, values[SNAPSHOT.wheelRadius0 + index] || wheel.radius);
			const width = Math.max(0.04, values[SNAPSHOT.wheelWidth0 + index] || wheel.width);
			const sizeChanged = Math.abs(radius - wheel.radius) > 0.001 || Math.abs(width - wheel.width) > 0.001;
			if (sizeChanged) {
				if (wheel.tire) {
					wheel.tire.geometry.dispose();
					wheel.tire.geometry = makeWheelGeometry(radius, width);
				}
				if (wheel.heat) {
					wheel.heat.geometry.dispose();
					wheel.heat.geometry = makeWheelGeometry(radius * 0.58, width * 1.08);
				}
				if (wheel.spokes) {
					wheel.spokes.clear();
					wheel.spokes.add(...makeWheelSpokes(radius, width).children);
				}
				wheel.radius = radius;
				wheel.width = width;
			}
			wheel.root.position.copy(torcsToThree(
				values[SNAPSHOT.wheelRelX0 + index],
				values[SNAPSHOT.wheelRelY0 + index],
				values[SNAPSHOT.wheelRelZ0 + index],
			));
			wheel.steer.rotation.y = values[SNAPSHOT.wheelSteerAngle0 + index];
			wheel.camber.rotation.x = values[SNAPSHOT.wheelRelRoll0 + index];
			wheel.spin.rotation.z = -(values[SNAPSHOT.wheelSpinAngle0 + index] || 0);
			if (wheel.scale) {
				wheel.scale.scale.set(radius * 2, radius * 2, width);
			}
			if (wheel.states) {
				const nextState = getWheelSpeedState(values, index, wheel.speedThresholds);
				if (nextState !== wheel.activeState) {
					for (const state of wheel.states) {
						state.scene.visible = state.speedIndex === nextState;
					}
					wheel.activeState = nextState;
				}
			}
			const heat = clamp01(values[SNAPSHOT.wheelBrakeTemp0 + index]);
			wheel.heat.material.color.copy(WHEEL_HEAT_COOL).lerp(WHEEL_HEAT_HOT, heat);
			wheel.heat.material.opacity = 0.28 + heat * 0.42;
		}
	}

	updateOpponentCar(values, carIndex, camera = null, asset = null) {
		const opponent = this.opponentCars[carIndex] || this.createOpponentCar(values, carIndex);
		this.setOpponentVisual(opponent, asset);
		const nextDimensions = getCarDimensions(values);
		if (nextDimensions.some((value, index) => Math.abs(value - opponent.dimensions[index]) > 0.001)) {
			opponent.box.geometry.dispose();
			opponent.box.geometry = new THREE.BoxGeometry(...nextDimensions);
			opponent.dimensions = nextDimensions;
		}
		setObjectPoseFromTorcsPosMat(opponent.root, values);
		this.ensureOpponentWheels(opponent, values);
		this.selectOpponentLod(opponent, camera);
		this.updateOpponentWheels(opponent, values);
		opponent.effects.setVisible(true);
		opponent.effects.update(values, opponent.root, camera);
	}

	updateCars(snapshots, camera = null, selectedCarIndex = 0, assetsByCarIndex = this.carAssets, cameraOptions = {}) {
		if (!snapshots || !snapshots.length) {
			return;
		}
		if (assetsByCarIndex instanceof Map) {
			this.carAssets = assetsByCarIndex;
		}
		const selected = snapshots.find((values, index) =>
			getSnapshotCarIndex(values, index) === selectedCarIndex) || snapshots[0];
		const selectedIndex = getSnapshotCarIndex(selected, snapshots.indexOf(selected));
		this.updateCar(selected, camera, this.getCarAssetForIndex(selectedIndex), cameraOptions);
		const activeOpponentIndexes = new Set();
		for (let i = 0; i < snapshots.length; i += 1) {
			const carIndex = getSnapshotCarIndex(snapshots[i], i);
			if (carIndex === selectedIndex) {
				continue;
			}
			activeOpponentIndexes.add(carIndex);
			this.updateOpponentCar(snapshots[i], carIndex, camera, this.getCarAssetForIndex(carIndex));
		}
		for (let i = 0; i < this.opponentCars.length; i += 1) {
			if (this.opponentCars[i]) {
				const visible = activeOpponentIndexes.has(i);
				this.opponentCars[i].root.visible = visible;
				if (i !== selectedIndex) {
					this.opponentCars[i].effects.setVisible(visible);
				}
			}
		}
	}

	updateCar(values, camera = null, asset = null, cameraOptions = {}) {
		if (!this.car) {
			this.createCar(values);
		}
		const nextDimensions = getCarDimensions(values);
		const dimensionsChanged = !this.carDimensions ||
			nextDimensions.some((value, index) => Math.abs(value - this.carDimensions[index]) > 0.001);
		if (dimensionsChanged) {
			this.carBox.geometry.dispose();
			this.carBox.geometry = new THREE.BoxGeometry(...nextDimensions);
			this.carDimensions = nextDimensions;
		}

		setObjectPoseFromTorcsPosMat(this.car, values);
		const carIndex = getSnapshotCarIndex(values, 0);
		this.setSelectedCarVisual(asset);
		this.effects = this.getCarEffects(carIndex);
		this.effects.setCarAsset(asset);
		const drawSelectedCar = cameraOptions.drawSelectedCar !== false;
		this.car.visible = drawSelectedCar;
		if (this.footprint) {
			this.footprint.visible = drawSelectedCar;
		}
		this.effects.setVisible(drawSelectedCar);
		this.ensureSelectedWheels(values);
		this.selectCarLod(camera);
		this.updateGeneratedWheels(values);

		const footprintPoints = [];
		const order = [0, 1, 3, 2];
		for (const index of order) {
			footprintPoints.push(torcsToThree(
				values[SNAPSHOT.cornerX0 + index],
				values[SNAPSHOT.cornerY0 + index],
				ROAD_Y + 0.08,
			));
		}
		footprintPoints.push(footprintPoints[0].clone());
		this.footprint.geometry.dispose();
		this.footprint.geometry = new THREE.BufferGeometry().setFromPoints(footprintPoints);
		this.effects.update(values, this.car, camera);
		this.effects.setVisible(drawSelectedCar);
	}

	resize() {
		const canvas = this.renderer.domElement;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		if (canvas.width !== Math.floor(width * this.renderer.getPixelRatio()) ||
			canvas.height !== Math.floor(height * this.renderer.getPixelRatio())) {
			this.renderer.setSize(width, height, false);
			return true;
		}
		return false;
	}

	render(camera) {
		if (this.backgroundDome && camera) {
			this.backgroundDome.position.set(
				camera.position.x,
				camera.position.y + BACKGROUND_HEIGHT * BACKGROUND_VERTICAL_BIAS,
				camera.position.z,
			);
		}
		this.renderer.render(this.scene, camera);
	}
}

export { getTorcsPoseQuaternion, torcsToThree };
