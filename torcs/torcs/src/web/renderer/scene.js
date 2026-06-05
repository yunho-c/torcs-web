import * as THREE from "three";
import { SNAPSHOT } from "./runtime.js";

const ROAD_Y = 0.03;
const WHEEL_ORDER = [0, 1, 2, 3];
const WHEEL_HEAT_COOL = new THREE.Color(0x343936);
const WHEEL_HEAT_HOT = new THREE.Color(0xff5b32);
const DEFAULT_BACKGROUND = new THREE.Color(0x0b0d0c);
const DEFAULT_AMBIENT = new THREE.Color(0xd8e0db);
const DEFAULT_SUN = new THREE.Color(0xfff0d2);
const TORCS_TO_THREE_BASIS = new THREE.Matrix4().set(
	1, 0, 0, 0,
	0, 0, 1, 0,
	0, -1, 0, 0,
	0, 0, 0, 1,
);
const THREE_TO_TORCS_BASIS = new THREE.Matrix4().copy(TORCS_TO_THREE_BASIS).invert();
const TORCS_POS_MATRIX = new THREE.Matrix4();
const CAR_ROTATION_MATRIX = new THREE.Matrix4();

function torcsToThree(x, y, z = 0) {
	return new THREE.Vector3(x, z, -y);
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

function setObjectQuaternionFromTorcsPosMat(object, values) {
	getTorcsPoseQuaternion(values, object.quaternion);
}

function makeLine(points, color, opacity, yOffset = ROAD_Y) {
	const geometry = new THREE.BufferGeometry().setFromPoints(
		points.map((point) => torcsToThree(point.x, point.y, yOffset)),
	);
	const material = new THREE.LineBasicMaterial({
		color,
		transparent: opacity < 1,
		opacity,
	});
	return new THREE.LineLoop(geometry, material);
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

export class TorcsScene {
	constructor(canvas) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.setClearColor(DEFAULT_BACKGROUND, 1);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		this.scene = new THREE.Scene();
		this.scene.background = DEFAULT_BACKGROUND.clone();
		this.scene.fog = new THREE.Fog(DEFAULT_BACKGROUND, 300, 600);

		this.groups = {
			background: new THREE.Group(),
			land: new THREE.Group(),
			cars: new THREE.Group(),
			shadows: new THREE.Group(),
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
		this.carShadow = null;
		this.generatedWheels = [];
		this.footprint = null;
		this.track = null;
		this.trackVisual = null;
		this.backgroundDome = null;
	}

	addLighting() {
		this.ambientLight = new THREE.AmbientLight(DEFAULT_AMBIENT, 1.7);
		this.scene.add(this.ambientLight);
		this.sunLight = new THREE.DirectionalLight(DEFAULT_SUN, 2.2);
		this.sunLight.position.set(-90, 160, 80);
		this.scene.add(this.sunLight);
	}

	addReferenceGrid() {
		const grid = new THREE.GridHelper(720, 48, 0x435047, 0x242a25);
		grid.position.y = -0.01;
		this.groups.land.add(grid);
	}

	setTrack(track) {
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
		const ambientColor = colorFromRgb(entry && entry.ambientColor, DEFAULT_AMBIENT);
		const diffuseColor = colorFromRgb(entry && entry.diffuseColor, DEFAULT_SUN);
		this.renderer.setClearColor(backgroundColor, 1);
		this.scene.background = backgroundColor.clone();
		this.scene.fog = new THREE.Fog(backgroundColor, 300, 600);
		this.ambientLight.color.copy(ambientColor);
		this.ambientLight.intensity = 2.4;
		this.sunLight.color.copy(diffuseColor);
		this.sunLight.intensity = 2.3;

		const lightPosition = entry && Array.isArray(entry.lightPosition)
			? torcsToThree(entry.lightPosition[0], entry.lightPosition[1], entry.lightPosition[2])
			: new THREE.Vector3(-90, 160, 80);
		if (lightPosition.lengthSq() > 0.001) {
			lightPosition.normalize().multiplyScalar(260);
		}
		this.sunLight.position.copy(lightPosition);
		this.setBackgroundDome(backgroundTexture, backgroundColor);
	}

	setBackgroundDome(texture, color) {
		if (this.backgroundDome) {
			this.groups.background.remove(this.backgroundDome);
			if (this.backgroundDome.material.map) {
				this.backgroundDome.material.map.dispose();
			}
			this.backgroundDome.geometry.dispose();
			this.backgroundDome.material.dispose();
			this.backgroundDome = null;
		}
		if (!texture) {
			return;
		}
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.ClampToEdgeWrapping;
		texture.repeat.set(1, 1);
		const geometry = new THREE.CylinderGeometry(900, 900, 260, 36, 1, true);
		const material = new THREE.MeshBasicMaterial({
			map: texture,
			color,
			side: THREE.BackSide,
			depthWrite: false,
			fog: false,
		});
		this.backgroundDome = new THREE.Mesh(geometry, material);
		this.backgroundDome.renderOrder = -1000;
		this.groups.background.add(this.backgroundDome);
	}

	setCarVisual(asset) {
		if (!this.car) {
			return;
		}
		if (this.carVisualRoot) {
			this.car.remove(this.carVisualRoot);
		}
		this.carVisualRoot = null;
		this.carLods = [];
		this.activeCarLod = null;
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

	createCar(values) {
		this.carDimensions = getCarDimensions(values);
		this.car = new THREE.Group();
		this.groups.cars.add(this.car);

		const geometry = new THREE.BoxGeometry(...this.carDimensions);
		const material = new THREE.MeshLambertMaterial({ color: 0xc9483d });
		this.carBox = new THREE.Mesh(geometry, material);
		this.car.add(this.carBox);

		this.carShadow = new THREE.Mesh(
			new THREE.CircleGeometry(1, 32),
			new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false }),
		);
		this.carShadow.rotation.x = -Math.PI / 2;
		this.groups.shadows.add(this.carShadow);

		this.footprint = makeLine([], 0xf3ead6, 0.92, ROAD_Y + 0.08);
		this.groups.cars.add(this.footprint);
		this.createGeneratedWheels(values);
	}

	createGeneratedWheels(values) {
		for (const wheel of this.generatedWheels) {
			this.car.remove(wheel.root);
		}
		this.generatedWheels = [];

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
			const heatMaterial = new THREE.MeshBasicMaterial({
				color: WHEEL_HEAT_COOL.clone(),
				transparent: true,
				opacity: 0.72,
			});
			const heat = new THREE.Mesh(makeWheelGeometry(radius * 0.58, width * 1.08), heatMaterial);
			heat.rotation.x = Math.PI / 2;
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
			});
		}
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
		this.activeCarLod = next;
	}

	updateGeneratedWheels(values) {
		for (let index = 0; index < this.generatedWheels.length; index += 1) {
			const wheel = this.generatedWheels[index];
			const radius = Math.max(0.05, values[SNAPSHOT.wheelRadius0 + index] || wheel.radius);
			const width = Math.max(0.04, values[SNAPSHOT.wheelWidth0 + index] || wheel.width);
			if (Math.abs(radius - wheel.radius) > 0.001 || Math.abs(width - wheel.width) > 0.001) {
				wheel.tire.geometry.dispose();
				wheel.heat.geometry.dispose();
				wheel.tire.geometry = makeWheelGeometry(radius, width);
				wheel.heat.geometry = makeWheelGeometry(radius * 0.58, width * 1.08);
				wheel.spokes.clear();
				wheel.spokes.add(...makeWheelSpokes(radius, width).children);
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
			wheel.spin.rotation.z = values[SNAPSHOT.wheelSpinAngle0 + index];

			const heat = clamp01(values[SNAPSHOT.wheelBrakeTemp0 + index]);
			wheel.heat.material.color.copy(WHEEL_HEAT_COOL).lerp(WHEEL_HEAT_HOT, heat);
			wheel.heat.material.opacity = 0.38 + heat * 0.5;
		}
	}

	updateCar(values, camera = null) {
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

		this.car.position.copy(torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z]));
		setObjectQuaternionFromTorcsPosMat(this.car, values);
		this.selectCarLod(camera);
		this.updateGeneratedWheels(values);

		this.carShadow.position.set(this.car.position.x, ROAD_Y + 0.01, this.car.position.z);
		this.carShadow.scale.set(
			Math.max(1, values[SNAPSHOT.dimensionX] * 0.6),
			Math.max(1, values[SNAPSHOT.dimensionY] * 0.8),
			1,
		);

		const footprintPoints = [];
		const order = [0, 1, 3, 2];
		for (const index of order) {
			footprintPoints.push(torcsToThree(
				values[SNAPSHOT.cornerX0 + index],
				values[SNAPSHOT.cornerY0 + index],
				ROAD_Y + 0.08,
			));
		}
		this.footprint.geometry.dispose();
		this.footprint.geometry = new THREE.BufferGeometry().setFromPoints(footprintPoints);
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
			this.backgroundDome.position.set(camera.position.x, 110, camera.position.z);
		}
		this.renderer.render(this.scene, camera);
	}
}

export { getTorcsPoseQuaternion, torcsToThree };
