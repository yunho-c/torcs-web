import * as THREE from "three/webgpu";
import { SNAPSHOT } from "./runtime.js";
import { getTorcsPoseQuaternion, torcsToThree } from "./scene.js";

const CAMERA_MODES = {
	chase: {
		fov: 40,
		near: 1,
		far: 600,
		distance: 10,
		height: 2,
		targetAhead: 9,
		targetHeight: 1.25,
	},
	onboard: {
		fov: 67.5,
		near: 0.3,
		far: 600,
		forwardOffset: 0.35,
		heightScale: 0.62,
		targetAhead: 28,
		targetHeight: 1.2,
	},
	trackside: {
		fov: 30,
		near: 1,
		far: 1000,
		height: 10,
		targetHeight: 1.2,
	},
	top: {
		fov: 45,
		near: 1,
		far: 4000,
	},
};
const CAMERA_LOOKAROUNDS = {
	left: { side: 1, forward: 0 },
	right: { side: -1, forward: 0 },
	front: { side: 0, forward: 1 },
};
const LOOKAROUND_DISTANCE_SCALE = 1.55;
const LOOKAROUND_SIDE_DISTANCE_SCALE = 3.8;
const LOOKAROUND_HEIGHT = 1.8;
const LOOKAROUND_TARGET_HEIGHT = 0.95;

export class CameraRig {
	constructor(canvas) {
		this.mode = "chase";
		this.camera = new THREE.PerspectiveCamera(40, 1, 1, 600);
		this.target = new THREE.Vector3();
		this.carRotation = new THREE.Quaternion();
		this.forward = new THREE.Vector3();
		this.side = new THREE.Vector3();
		this.up = new THREE.Vector3();
		this.trackView = null;
		this.tracksideViews = [];
		this.canvas = canvas;
		this.applyModeSettings();
	}

	setMode(mode) {
		this.mode = Object.hasOwn(CAMERA_MODES, mode) ? mode : "chase";
		this.applyModeSettings();
	}

	setTrack(track) {
		if (!track || !track.bounds) {
			this.trackView = null;
			this.tracksideViews = [];
			return;
		}
		const min = torcsToThree(track.bounds.minX, track.bounds.maxY, 0);
		const max = torcsToThree(track.bounds.maxX, track.bounds.minY, 0);
		const center = new THREE.Vector3(
			(min.x + max.x) * 0.5,
			0,
			(min.z + max.z) * 0.5,
		);
		const span = Math.max(Math.abs(max.x - min.x), Math.abs(max.z - min.z), 100);
		this.trackView = { center, height: span * 0.78 };
		this.tracksideViews = this.makeTracksideViews(min, max, center, span);
	}

	makeTracksideViews(min, max, center, span) {
		const settings = CAMERA_MODES.trackside;
		const margin = Math.max(24, span * 0.16);
		const height = Math.max(settings.height, span * 0.035);
		return [
			new THREE.Vector3(min.x - margin, height, min.z - margin),
			new THREE.Vector3(max.x + margin, height, min.z - margin),
			new THREE.Vector3(max.x + margin, height, max.z + margin),
			new THREE.Vector3(min.x - margin, height, max.z + margin),
		].map((position) => ({
			position,
			center,
		}));
	}

	applyModeSettings() {
		const settings = CAMERA_MODES[this.mode];
		this.camera.fov = settings.fov;
		this.camera.near = settings.near;
		this.camera.far = settings.far;
		this.camera.updateProjectionMatrix();
	}

	updateProjection() {
		const width = Math.max(1, this.canvas.clientWidth);
		const height = Math.max(1, this.canvas.clientHeight);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	update(values, lookaround = "") {
		const car = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z]);
		const hasLookaround = Object.hasOwn(CAMERA_LOOKAROUNDS, lookaround);
		if (hasLookaround) {
			this.updateCarBasis(values);
			this.updateLookaround(values, car, lookaround);
			return;
		}
		if (this.mode === "top") {
			const view = this.trackView || { center: car, height: 260 };
			this.camera.position.set(view.center.x, view.height, view.center.z);
			this.target.set(view.center.x, 0, view.center.z);
			this.camera.up.set(0, 0, -1);
			this.camera.lookAt(this.target);
			return;
		}
		if (this.mode === "trackside") {
			const settings = CAMERA_MODES.trackside;
			const view = this.selectTracksideView(car);
			this.camera.position.copy(view.position);
			this.target.copy(car).lerp(view.center, 0.12);
			this.target.y += settings.targetHeight;
			this.camera.up.set(0, 1, 0);
			this.camera.lookAt(this.target);
			return;
		}

		this.camera.up.set(0, 1, 0);
		this.updateCarBasis(values);

		const settings = CAMERA_MODES[this.mode];
		const carHeight = Math.max(0.1, values[SNAPSHOT.dimensionZ]);
		const cameraPos = car.clone();
		if (this.mode === "onboard") {
			cameraPos
				.addScaledVector(this.forward, settings.forwardOffset)
				.addScaledVector(this.up, Math.max(0.9, carHeight * settings.heightScale));
		} else {
			cameraPos
				.addScaledVector(this.forward, -settings.distance)
				.add(new THREE.Vector3(0, settings.height, 0));
		}

		this.target.copy(car)
			.addScaledVector(this.forward, settings.targetAhead)
			.add(new THREE.Vector3(0, settings.targetHeight, 0));
		this.camera.position.copy(cameraPos);
		this.camera.lookAt(this.target);
	}

	updateCarBasis(values) {
		getTorcsPoseQuaternion(values, this.carRotation);
		this.forward.set(1, 0, 0).applyQuaternion(this.carRotation).normalize();
		this.side.set(0, 0, -1).applyQuaternion(this.carRotation).normalize();
		this.up.set(0, 1, 0).applyQuaternion(this.carRotation).normalize();
	}

	updateLookaround(values, car, lookaround) {
		const view = CAMERA_LOOKAROUNDS[lookaround];
		const dimX = Math.max(0.1, values[SNAPSHOT.dimensionX]);
		const dimY = Math.max(0.1, values[SNAPSHOT.dimensionY]);
		const distance = Math.max(6, dimX * LOOKAROUND_DISTANCE_SCALE, dimY * LOOKAROUND_SIDE_DISTANCE_SCALE);
		this.camera.up.set(0, 1, 0);
		this.target.copy(car).add(new THREE.Vector3(0, LOOKAROUND_TARGET_HEIGHT, 0));
		this.camera.position.copy(car)
			.addScaledVector(this.forward, view.forward * distance)
			.addScaledVector(this.side, view.side * distance)
			.add(new THREE.Vector3(0, LOOKAROUND_HEIGHT, 0));
		this.camera.lookAt(this.target);
	}

	selectTracksideView(car) {
		if (!this.tracksideViews.length) {
			return {
				position: car.clone().add(new THREE.Vector3(-36, 12, -28)),
				center: car,
			};
		}
		let selected = this.tracksideViews[0];
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const view of this.tracksideViews) {
			const dx = view.position.x - car.x;
			const dz = view.position.z - car.z;
			const distance = dx * dx + dz * dz;
			if (distance < bestDistance) {
				bestDistance = distance;
				selected = view;
			}
		}
		return selected;
	}
}
