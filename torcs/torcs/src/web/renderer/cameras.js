import * as THREE from "three/webgpu";
import { SNAPSHOT } from "./runtime.js";
import { getTorcsPoseQuaternion, torcsToThree } from "./scene.js";

const PI2 = Math.PI * 2;
const DEFAULT_WORLD = {
	minX: 0,
	minY: 0,
	maxX: 800,
	maxY: 600,
	spanX: 800,
	spanY: 600,
	maxSize: 800,
	centerX: 400,
	centerY: 300,
};

const ALIASES = {
	chase: "f2-behind-near",
	onboard: "f2-bonnet-fixed",
	trackside: "f8-road-fixed",
	top: "f5-up-200",
};

const CAMERA_MODE_GROUPS = [
	{
		label: "F2 - Driver",
		modes: [
			{ id: "f2-behind-very-near", label: "Behind Very Near", type: "behind", fov: 40, minFov: 5, maxFov: 95, near: 1, far: 600, dist: 6, height: 2, relax: 10, drawCurrent: true },
			{ id: "f2-behind-near", label: "Behind Near", type: "behind", fov: 40, minFov: 5, maxFov: 95, near: 1, far: 600, dist: 10, height: 2, relax: 10, drawCurrent: true },
			{ id: "f2-bonnet-fixed", label: "Bonnet With Car", type: "insideFixed", fov: 67.5, minFov: 50, maxFov: 95, near: 0.3, far: 600, anchor: "bonnet", drawCurrent: true },
			{ id: "f2-driver-inside", label: "Driver Inside", type: "inside", fov: 67.5, minFov: 50, maxFov: 95, near: 0.1, far: 600, anchor: "driver", drawCurrent: true },
			{ id: "f2-road-no-car", label: "Road View No Car", type: "insideFixed", fov: 67.5, minFov: 50, maxFov: 95, near: 0.3, far: 600, anchor: "bonnet", drawCurrent: false },
		],
	},
	{
		label: "F3 - Chase",
		modes: [
			{ id: "f3-behind-far", label: "Behind Far", type: "behind", fov: 40, minFov: 5, maxFov: 95, near: 1, far: 600, dist: 20, height: 2, relax: 10, drawCurrent: true },
			{ id: "f3-track-behind", label: "Track Behind", type: "trackBehind", fov: 40, minFov: 5, maxFov: 95, near: 1, far: 1000, dist: 30, height: 5, relax: 5, drawCurrent: true },
			{ id: "f3-low-behind", label: "Low Behind", type: "behind", fov: 40, minFov: 5, maxFov: 95, near: 0.5, far: 600, dist: 8, height: 0.5, relax: 10, drawCurrent: true },
			{ id: "f3-front", label: "Reverse Front", type: "front", fov: 40, minFov: 5, maxFov: 95, near: 0.5, far: 1000, dist: 8, height: 0.5, drawCurrent: true },
		],
	},
	{
		label: "F4 - Side",
		modes: [
			{ id: "f4-side-left-20", label: "Side Left 20", type: "side", fov: 30, minFov: 5, maxFov: 60, near: 1, far: 1000, offset: [0, -20, 3], drawCurrent: true },
			{ id: "f4-side-right-20", label: "Side Right 20", type: "side", fov: 30, minFov: 5, maxFov: 60, near: 1, far: 1000, offset: [0, 20, 3], drawCurrent: true },
			{ id: "f4-side-back-20", label: "Side Back 20", type: "side", fov: 30, minFov: 5, maxFov: 60, near: 1, far: 1000, offset: [-20, 0, 3], drawCurrent: true },
			{ id: "f4-side-front-20", label: "Side Front 20", type: "side", fov: 30, minFov: 5, maxFov: 60, near: 1, far: 1000, offset: [20, 0, 3], drawCurrent: true },
			{ id: "f4-side-left-40", label: "Side Left 40", type: "side", fov: 30, minFov: 5, maxFov: 60, near: 1, far: 1000, offset: [0, -40, 6], drawCurrent: true },
			{ id: "f4-side-right-40", label: "Side Right 40", type: "side", fov: 30, minFov: 5, maxFov: 60, near: 1, far: 1000, offset: [0, 40, 6], drawCurrent: true },
			{ id: "f4-side-back-40", label: "Side Back 40", type: "side", fov: 30, minFov: 5, maxFov: 60, near: 1, far: 1000, offset: [-40, 0, 6], drawCurrent: true },
			{ id: "f4-side-front-40", label: "Side Front 40", type: "side", fov: 30, minFov: 5, maxFov: 60, near: 1, far: 1000, offset: [40, 0, 6], drawCurrent: true },
		],
	},
	{
		label: "F5 - Overhead",
		modes: [
			{ id: "f5-up-200", label: "Overhead 200", type: "up", fov: 67.5, minFov: 1, maxFov: 90, near: 100, far: 1000, distZ: 200, upAxis: 0, drawCurrent: true },
			{ id: "f5-up-250", label: "Overhead 250", type: "up", fov: 67.5, minFov: 1, maxFov: 90, near: 200, far: 1000, distZ: 250, upAxis: 1, drawCurrent: true },
			{ id: "f5-up-350", label: "Overhead 350", type: "up", fov: 67.5, minFov: 1, maxFov: 90, near: 200, far: 1000, distZ: 350, upAxis: 2, drawCurrent: true },
			{ id: "f5-up-400", label: "Overhead 400", type: "up", fov: 67.5, minFov: 1, maxFov: 90, near: 200, far: 1000, distZ: 400, upAxis: 3, drawCurrent: true },
		],
	},
	{
		label: "F6-F11 - Track",
		modes: [
			{ id: "f6-circuit-center", label: "Circuit Center", type: "center", fov: 21, minFov: 2, maxFov: 60, near: 100, far: 1500, distZ: 120, drawCurrent: true },
			{ id: "f7-panorama-top", label: "Panorama Top", type: "panorama", fov: 74, minFov: 1, maxFov: 110, near: 10, farScale: 2, view: 0, drawCurrent: true },
			{ id: "f7-panorama-nw", label: "Panorama NW", type: "panorama", fov: 74, minFov: 1, maxFov: 110, near: 10, farScale: 2, view: 1, drawCurrent: true },
			{ id: "f7-panorama-sw", label: "Panorama SW", type: "panorama", fov: 74, minFov: 1, maxFov: 110, near: 10, farScale: 2, view: 2, drawCurrent: true },
			{ id: "f7-panorama-se", label: "Panorama SE", type: "panorama", fov: 74, minFov: 1, maxFov: 110, near: 10, farScale: 2, view: 3, drawCurrent: true },
			{ id: "f7-panorama-ne", label: "Panorama NE", type: "panorama", fov: 74, minFov: 1, maxFov: 110, near: 10, farScale: 2, view: 4, drawCurrent: true },
			{ id: "f8-road-fixed", label: "Road Fixed FOV", type: "roadFixed", fov: 30, minFov: 5, maxFov: 60, near: 1, far: 1000, drawCurrent: true },
			{ id: "f9-road-zoom", label: "Road Zoom", type: "roadZoom", fov: 9, minFov: 1, maxFov: 90, near: 1, far: 1000, drawCurrent: true },
			{ id: "f10-road-fly", label: "Road Fly", type: "roadFly", fov: 67.5, minFov: 1, maxFov: 90, near: 1, far: 1000, drawCurrent: true },
			{ id: "f11-tv-director", label: "TV Director", type: "tvDirector", fov: 9, minFov: 1, maxFov: 90, near: 1, far: 1000, drawCurrent: true },
		],
	},
];

const CAMERA_MODES = new Map(CAMERA_MODE_GROUPS.flatMap((group) => group.modes.map((mode) => [mode.id, mode])));

const DIAGONAL_LOOKAROUND = Math.SQRT1_2;
const CAMERA_LOOKAROUNDS = {
	left: { side: 1, forward: 0 },
	right: { side: -1, forward: 0 },
	front: { side: 0, forward: 1 },
	backLeft: { side: DIAGONAL_LOOKAROUND, forward: -DIAGONAL_LOOKAROUND },
	backRight: { side: -DIAGONAL_LOOKAROUND, forward: -DIAGONAL_LOOKAROUND },
};
const LOOKAROUND_DISTANCE_SCALE = 1.55;
const LOOKAROUND_SIDE_DISTANCE_SCALE = 3.8;
const LOOKAROUND_HEIGHT = 1.8;
const LOOKAROUND_TARGET_HEIGHT = 0.95;
const ANALOG_LOOK_SIDE_SCALE = 1.8;
const ANALOG_LOOK_FORWARD_SCALE = 0.9;
const DEBUG_FPS_BASE_SPEED = 18;
const DEBUG_FPS_FAST_MULTIPLIER = 4;
const DEBUG_FPS_MOUSE_SENSITIVITY = 0.0022;
const DEBUG_FPS_MAX_PITCH = Math.PI * 0.49;
const NO_SIMU = 0x00000002;

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function unwrapAngle(target, previous) {
	if (!Number.isFinite(previous)) {
		return target;
	}
	if (Math.abs(previous - target) > Math.abs(previous - target + PI2)) {
		return target - PI2;
	}
	if (Math.abs(previous - target) > Math.abs(previous - target - PI2)) {
		return target + PI2;
	}
	return target;
}

function torcsVectorToThree(x, y, z, target = new THREE.Vector3()) {
	return target.set(x, z, -y);
}

function torcsUpForAxis(axis, target = new THREE.Vector3()) {
	switch (axis) {
	case 0:
		return torcsVectorToThree(0, 1, 0, target).normalize();
	case 1:
		return torcsVectorToThree(0, -1, 0, target).normalize();
	case 2:
		return torcsVectorToThree(1, 0, 0, target).normalize();
	case 3:
		return torcsVectorToThree(-1, 0, 0, target).normalize();
	case 4:
		return torcsVectorToThree(0, 0, 1, target).normalize();
	case 5:
		return torcsVectorToThree(0, 0, -1, target).normalize();
	default:
		return torcsVectorToThree(0, 0, 1, target).normalize();
	}
}

function trackWorldFromBounds(track) {
	const bounds = track && track.bounds;
	if (!bounds) {
		return DEFAULT_WORLD;
	}
	const spanX = Math.max(1, bounds.maxX - bounds.minX);
	const spanY = Math.max(1, bounds.maxY - bounds.minY);
	return {
		minX: bounds.minX,
		minY: bounds.minY,
		maxX: bounds.maxX,
		maxY: bounds.maxY,
		spanX,
		spanY,
		maxSize: Math.max(spanX, spanY),
		centerX: bounds.minX + spanX * 0.5,
		centerY: bounds.minY + spanY * 0.5,
	};
}

export function getCameraModeGroups() {
	return CAMERA_MODE_GROUPS;
}

export class CameraRig {
	constructor(canvas) {
		this.mode = "f2-behind-near";
		this.camera = new THREE.PerspectiveCamera(40, 1, 1, 600);
		this.target = new THREE.Vector3();
		this.carRotation = new THREE.Quaternion();
		this.forward = new THREE.Vector3();
		this.side = new THREE.Vector3();
		this.up = new THREE.Vector3();
		this.temp = new THREE.Vector3();
		this.temp2 = new THREE.Vector3();
		this.temp3 = new THREE.Vector3();
		this.trackView = trackWorldFromBounds(null);
		this.canvas = canvas;
		this.angleState = new Map();
		this.flyState = null;
		this.debugFps = {
			enabled: false,
			position: new THREE.Vector3(),
			yaw: 0,
			pitch: 0,
		};
		this.tvState = { current: -1, lastEventTime: 0, lastViewTime: 0 };
		this.drawCurrent = true;
		this.applyModeSettings();
	}

	setMode(mode) {
		const resolved = ALIASES[mode] || mode;
		this.mode = CAMERA_MODES.has(resolved) ? resolved : "f2-behind-near";
		this.applyModeSettings();
	}

	setTrack(track) {
		this.trackView = trackWorldFromBounds(track);
		this.flyState = null;
	}

	getModeSettings() {
		return CAMERA_MODES.get(this.mode) || CAMERA_MODES.get("f2-behind-near");
	}

	getSceneOptions() {
		return { drawSelectedCar: this.debugFps.enabled || this.drawCurrent };
	}

	applyModeSettings() {
		const settings = this.getModeSettings();
		this.camera.fov = settings.fov;
		this.camera.near = settings.near;
		this.camera.far = settings.far || this.trackView.maxSize * (settings.farScale || 2);
		this.camera.updateProjectionMatrix();
		this.drawCurrent = settings.drawCurrent !== false;
	}

	updateProjection() {
		const width = Math.max(1, this.canvas.clientWidth);
		const height = Math.max(1, this.canvas.clientHeight);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	isDebugFpsEnabled() {
		return this.debugFps.enabled;
	}

	setDebugFpsEnabled(enabled) {
		if (Boolean(enabled) === this.debugFps.enabled) {
			return this.debugFps.enabled;
		}
		this.debugFps.enabled = Boolean(enabled);
		if (this.debugFps.enabled) {
			const direction = this.camera.getWorldDirection(this.temp).normalize();
			this.debugFps.position.copy(this.camera.position);
			this.debugFps.pitch = Math.asin(clamp(direction.y, -0.98, 0.98));
			this.debugFps.yaw = Math.atan2(-direction.x, -direction.z);
			this.applyDebugFpsCamera();
		} else {
			this.applyModeSettings();
		}
		return this.debugFps.enabled;
	}

	toggleDebugFps() {
		return this.setDebugFpsEnabled(!this.debugFps.enabled);
	}

	rotateDebugFps(movementX = 0, movementY = 0) {
		if (!this.debugFps.enabled) {
			return false;
		}
		this.debugFps.yaw -= movementX * DEBUG_FPS_MOUSE_SENSITIVITY;
		this.debugFps.pitch = clamp(
			this.debugFps.pitch - movementY * DEBUG_FPS_MOUSE_SENSITIVITY,
			-DEBUG_FPS_MAX_PITCH,
			DEBUG_FPS_MAX_PITCH,
		);
		this.applyDebugFpsCamera();
		return true;
	}

	debugFpsForward(target = new THREE.Vector3()) {
		const cosPitch = Math.cos(this.debugFps.pitch);
		return target.set(
			-Math.sin(this.debugFps.yaw) * cosPitch,
			Math.sin(this.debugFps.pitch),
			-Math.cos(this.debugFps.yaw) * cosPitch,
		).normalize();
	}

	applyDebugFpsCamera() {
		const settings = {
			fov: 72,
			minFov: 45,
			maxFov: 100,
			near: 0.1,
			far: Math.max(2000, this.trackView.maxSize * 3),
		};
		const forward = this.debugFpsForward(this.temp);
		this.applyPerspective(settings);
		this.camera.position.copy(this.debugFps.position);
		this.camera.up.set(0, 1, 0);
		this.target.copy(this.debugFps.position).add(forward);
		this.camera.lookAt(this.target);
		this.drawCurrent = true;
	}

	updateDebugFps(deltaTime = 1 / 60, keyState = new Set()) {
		if (!this.debugFps.enabled) {
			return false;
		}
		const dt = Math.max(0, Math.min(deltaTime, 0.1));
		const forward = this.temp.set(-Math.sin(this.debugFps.yaw), 0, -Math.cos(this.debugFps.yaw)).normalize();
		const right = this.temp2.set(Math.cos(this.debugFps.yaw), 0, -Math.sin(this.debugFps.yaw)).normalize();
		const move = this.temp3.set(0, 0, 0);
		if (keyState.has("KeyW")) {
			move.add(forward);
		}
		if (keyState.has("KeyS")) {
			move.addScaledVector(forward, -1);
		}
		if (keyState.has("KeyD")) {
			move.add(right);
		}
		if (keyState.has("KeyA")) {
			move.addScaledVector(right, -1);
		}
		if (keyState.has("KeyE")) {
			move.y += 1;
		}
		if (keyState.has("KeyQ")) {
			move.y -= 1;
		}
		if (move.lengthSq() > 0) {
			const speed = DEBUG_FPS_BASE_SPEED * (
				keyState.has("ShiftLeft") || keyState.has("ShiftRight") ? DEBUG_FPS_FAST_MULTIPLIER : 1
			);
			this.debugFps.position.addScaledVector(move.normalize(), speed * dt);
		}
		this.applyDebugFpsCamera();
		return true;
	}

	update(values, lookaround = "", snapshots = [values]) {
		if (!values) {
			return;
		}
		const settings = this.getModeSettings();
		this.drawCurrent = settings.drawCurrent !== false;
		this.updateCarBasis(values);
		const car = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z]);
		const keyboardLookaround = typeof lookaround === "string" && Object.hasOwn(CAMERA_LOOKAROUNDS, lookaround) ? lookaround : "";
		const analogLookaround = lookaround && lookaround.type === "gamepad" ? lookaround : null;
		const gamepadPresetLookaround = analogLookaround && Object.hasOwn(CAMERA_LOOKAROUNDS, analogLookaround.preset)
			? analogLookaround.preset
			: "";
		if (keyboardLookaround) {
			this.updateLookaround(values, car, keyboardLookaround);
			return;
		}
		if (gamepadPresetLookaround) {
			this.updateLookaround(values, car, gamepadPresetLookaround, analogLookaround);
			return;
		}
		if (analogLookaround && analogLookaround.front) {
			this.updateLookaround(values, car, "front", analogLookaround);
			return;
		}

		if (settings.type === "tvDirector") {
			values = this.selectTvDirectorSnapshot(values, snapshots);
			this.updateCarBasis(values);
		}

		switch (settings.type) {
		case "inside":
		case "insideFixed":
			this.updateInside(values, settings);
			break;
		case "behind":
			this.updateBehind(values, settings, values[SNAPSHOT.yaw]);
			break;
		case "trackBehind":
			this.updateBehind(values, settings, values[SNAPSHOT.trackTangentAngle]);
			break;
		case "front":
			this.updateFront(values, settings);
			break;
		case "side":
			this.updateSide(values, settings);
			break;
		case "up":
			this.updateUp(values, settings);
			break;
		case "center":
			this.updateCenter(values, settings);
			break;
		case "panorama":
			this.updatePanorama(settings);
			break;
		case "roadFixed":
			this.updateRoadFixed(values, settings);
			break;
		case "roadZoom":
		case "tvDirector":
			this.updateRoadZoom(values, settings);
			break;
		case "roadFly":
			this.updateRoadFly(values, settings);
			break;
		default:
			this.updateBehind(values, CAMERA_MODES.get("f2-behind-near"), values[SNAPSHOT.yaw]);
			break;
		}
		if (analogLookaround) {
			this.applyAnalogLookTarget(values, analogLookaround);
			this.camera.lookAt(this.target);
		}
	}

	updateCarBasis(values) {
		getTorcsPoseQuaternion(values, this.carRotation);
		this.forward.set(1, 0, 0).applyQuaternion(this.carRotation).normalize();
		this.side.set(0, 0, -1).applyQuaternion(this.carRotation).normalize();
		this.up.set(0, 1, 0).applyQuaternion(this.carRotation).normalize();
	}

	applyPerspective(settings, fov = settings.fov, near = settings.near, far = settings.far || this.trackView.maxSize * (settings.farScale || 2)) {
		const nextFov = clamp(fov, settings.minFov || 1, settings.maxFov || 120);
		const nextFar = Math.max(near + 1, far);
		if (this.camera.fov !== nextFov || this.camera.near !== near || this.camera.far !== nextFar) {
			this.camera.fov = nextFov;
			this.camera.near = near;
			this.camera.far = nextFar;
			this.camera.updateProjectionMatrix();
		}
	}

	setCamera(eye, center, up, settings, fov = settings.fov, near = settings.near, far = settings.far || this.trackView.maxSize * (settings.farScale || 2)) {
		this.applyPerspective(settings, fov, near, far);
		this.camera.position.copy(eye);
		this.target.copy(center);
		this.camera.up.copy(up).normalize();
		this.camera.lookAt(this.target);
	}

	localPoint(values, x, y, z, target = new THREE.Vector3()) {
		const offset = SNAPSHOT.posMat0;
		const wx = x * values[offset + 0] + y * values[offset + 4] + z * values[offset + 8] + values[offset + 12];
		const wy = x * values[offset + 1] + y * values[offset + 5] + z * values[offset + 9] + values[offset + 13];
		const wz = x * values[offset + 2] + y * values[offset + 6] + z * values[offset + 10] + values[offset + 14];
		return torcsVectorToThree(wx, wy, wz, target);
	}

	anchor(values, anchor, target = new THREE.Vector3()) {
		const prefix = anchor === "driver" ? SNAPSHOT.driverX : SNAPSHOT.bonnetX;
		return this.localPoint(values, values[prefix], values[prefix + 1], values[prefix + 2], target);
	}

	updateInside(values, settings) {
		const prefix = settings.anchor === "driver" ? SNAPSHOT.driverX : SNAPSHOT.bonnetX;
		const eye = this.localPoint(values, values[prefix], values[prefix + 1], values[prefix + 2], this.temp);
		const center = this.localPoint(values, values[prefix] + 30, values[prefix + 1], values[prefix + 2], this.temp2);
		const up = settings.type === "inside" ? torcsVectorToThree(0, 0, 1, this.temp3) : this.up;
		this.setCamera(eye, center, up, settings);
	}

	smoothAngle(mode, angle, rate) {
		const previous = this.angleState.get(mode);
		const target = unwrapAngle(angle, previous);
		const next = Number.isFinite(previous) ? previous + rate * (target - previous) * 0.01 : target;
		this.angleState.set(mode, next);
		return next;
	}

	updateBehind(values, settings, sourceAngle) {
		const angle = this.smoothAngle(settings.id, sourceAngle || 0, settings.relax || 10);
		const cosA = Math.cos(angle);
		const sinA = Math.sin(angle);
		const x = values[SNAPSHOT.x] - settings.dist * cosA;
		const y = values[SNAPSHOT.y] - settings.dist * sinA;
		const eye = torcsToThree(x, y, values[SNAPSHOT.z] + settings.height, this.temp);
		const center = torcsToThree(
			values[SNAPSHOT.x] + (10 - settings.dist) * cosA,
			values[SNAPSHOT.y] + (10 - settings.dist) * sinA,
			values[SNAPSHOT.z],
			this.temp2,
		);
		this.setCamera(eye, center, torcsVectorToThree(0, 0, 1, this.temp3), settings);
	}

	updateFront(values, settings) {
		const angle = values[SNAPSHOT.yaw] || 0;
		const eye = torcsToThree(
			values[SNAPSHOT.x] + settings.dist * Math.cos(angle),
			values[SNAPSHOT.y] + settings.dist * Math.sin(angle),
			values[SNAPSHOT.z] + settings.height,
			this.temp,
		);
		const center = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z], this.temp2);
		this.setCamera(eye, center, torcsVectorToThree(0, 0, 1, this.temp3), settings);
	}

	updateSide(values, settings) {
		const [dx, dy, dz] = settings.offset;
		const eye = torcsToThree(values[SNAPSHOT.x] + dx, values[SNAPSHOT.y] + dy, values[SNAPSHOT.z] + dz, this.temp);
		const center = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z], this.temp2);
		this.setCamera(eye, center, torcsVectorToThree(0, 0, 1, this.temp3), settings);
	}

	updateUp(values, settings) {
		const eye = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z] + settings.distZ, this.temp);
		const center = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z], this.temp2);
		this.setCamera(eye, center, torcsUpForAxis(settings.upAxis, this.temp3), settings);
	}

	updateCenter(values, settings) {
		const eye = torcsToThree(this.trackView.centerX, this.trackView.minY + this.trackView.spanY * 0.6, settings.distZ, this.temp);
		const center = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z], this.temp2);
		const dd = Math.max(1, eye.distanceTo(center));
		const near = Math.max(1, settings.distZ - values[SNAPSHOT.z] - 5);
		this.setCamera(eye, center, torcsVectorToThree(0, 0, 1, this.temp3), settings, THREE.MathUtils.radToDeg(Math.atan2(settings.fov, dd)), near, dd + settings.far);
	}

	updatePanorama(settings) {
		const w = this.trackView;
		const diag = Math.sqrt(w.spanX * w.spanX + w.spanY * w.spanY);
		const views = [
			[w.centerX, w.centerY, Math.max(w.spanX * 0.5, w.spanY * 2 / 3) + 60, w.centerX, w.centerY, 0, 0],
			[w.minX - w.spanX * 0.5, w.minY - w.spanY * 0.5, diag * 0.25, w.centerX, w.centerY, 0, 4],
			[w.minX - w.spanX * 0.5, w.maxY + w.spanY * 0.5, diag * 0.25, w.centerX, w.centerY, 0, 4],
			[w.maxX + w.spanX * 0.5, w.maxY + w.spanY * 0.5, diag * 0.25, w.centerX, w.centerY, 0, 4],
			[w.maxX + w.spanX * 0.5, w.minY - w.spanY * 0.5, diag * 0.25, w.centerX, w.centerY, 0, 4],
		];
		const view = views[settings.view] || views[0];
		const eye = torcsToThree(view[0], view[1], view[2], this.temp);
		const center = torcsToThree(view[3], view[4], view[5], this.temp2);
		this.setCamera(eye, center, torcsUpForAxis(view[6], this.temp3), settings, settings.fov, settings.near, w.maxSize * 2);
	}

	getRoadCameraEye(values, settings) {
		if (values[SNAPSHOT.roadCamAvailable]) {
			return torcsToThree(values[SNAPSHOT.roadCamX], values[SNAPSHOT.roadCamY], values[SNAPSHOT.roadCamZ], this.temp);
		}
		return torcsToThree(this.trackView.centerX, this.trackView.minY + this.trackView.spanY * 0.6, 120, this.temp);
	}

	updateRoadFixed(values, settings) {
		const eye = this.getRoadCameraEye(values, settings);
		const centerZ = values[SNAPSHOT.roadCamAvailable] ? values[SNAPSHOT.roadCamZ] : values[SNAPSHOT.z];
		const center = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], centerZ, this.temp2);
		this.setCamera(eye, center, torcsVectorToThree(0, 0, 1, this.temp3), settings);
	}

	updateRoadZoom(values, settings) {
		const eye = this.getRoadCameraEye(values, settings);
		const center = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z], this.temp2);
		const dz = center.y - eye.y;
		const dd = Math.max(1, eye.distanceTo(center));
		const near = Math.max(1, dz - 5);
		this.setCamera(eye, center, torcsVectorToThree(0, 0, 1, this.temp3), settings, THREE.MathUtils.radToDeg(Math.atan2(settings.fov, dd)), near, dd + settings.far);
	}

	updateRoadFly(values, settings) {
		if (!this.flyState) {
			this.flyState = {
				eye: torcsToThree(values[SNAPSHOT.x] + 65, values[SNAPSHOT.y] + 65, values[SNAPSHOT.z] + 65),
				offset: new THREE.Vector3(35, 60, -35),
				speed: new THREE.Vector3(),
				timer: 0,
				current: -1,
				lastTime: values[SNAPSHOT.time] || 0,
			};
		}
		const state = this.flyState;
		const time = values[SNAPSHOT.time] || 0;
		let dt = time - state.lastTime;
		state.lastTime = time;
		if (!Number.isFinite(dt) || dt <= 0 || dt > 1) {
			dt = 0.1;
		}
		if (state.current !== values.carIndex || state.timer <= 0) {
			const seed = Math.sin((time + 1) * 12.9898 + (values.carIndex || 0) * 78.233);
			const lateral = seed - Math.floor(seed) - 0.5;
			const vertical = 20 + 35 * Math.abs(lateral);
			state.offset.set(45 * lateral, vertical, 45 * (0.5 - Math.abs(lateral)));
			state.timer = 10 + 5 * Math.abs(lateral);
			state.current = values.carIndex;
		}
		state.timer -= dt;
		const car = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z], this.temp);
		const desired = this.temp2.copy(car).add(state.offset);
		const gain = 200 / (10 + Math.max(1, state.offset.y));
		const damp = 5;
		state.speed.addScaledVector(this.temp3.copy(desired).sub(state.eye).multiplyScalar(gain).addScaledVector(state.speed, -damp), dt);
		state.eye.addScaledVector(state.speed, dt);
		if (state.eye.y < 1) {
			state.eye.y = 1;
			state.speed.y = 0;
		}
		this.setCamera(state.eye, car, torcsVectorToThree(0, 0, 1, this.temp3), settings);
	}

	selectTvDirectorSnapshot(selected, snapshots = []) {
		if (!Array.isArray(snapshots) || !snapshots.length) {
			return selected;
		}
		const now = selected[SNAPSHOT.time] || 0;
		if (this.tvState.current < 0 || now - this.tvState.lastViewTime > 10 || now - this.tvState.lastEventTime > 1) {
			let best = selected;
			let bestPrio = Number.NEGATIVE_INFINITY;
			for (let i = 0; i < snapshots.length; i += 1) {
				const values = snapshots[i];
				if ((values[SNAPSHOT.state] | 0) & NO_SIMU) {
					continue;
				}
				let prio = snapshots.length - i;
				if (values[SNAPSHOT.remainingLaps] === 0 && values[SNAPSHOT.trackDistanceFromStart] > values[SNAPSHOT.trackLength] - 200) {
					prio += 5 * snapshots.length;
				}
				if (Math.abs(values[SNAPSHOT.trackToMiddle]) > values[SNAPSHOT.trackWidth] * 0.5) {
					prio += snapshots.length;
				}
				if (values[SNAPSHOT.collision] || values[SNAPSHOT.collisionEvent]) {
					prio += snapshots.length;
				}
				for (let j = i + 1; j < snapshots.length; j += 1) {
					const other = snapshots[j];
					const gap = Math.abs(other[SNAPSHOT.trackDistanceFromStart] - values[SNAPSHOT.trackDistanceFromStart]);
					if (gap < 10) {
						prio += (10 - gap) * snapshots.length / 10;
					}
				}
				if (prio > bestPrio) {
					bestPrio = prio;
					best = values;
				}
			}
			if (best !== snapshots[this.tvState.current]) {
				this.tvState.lastViewTime = now;
			}
			this.tvState.current = snapshots.indexOf(best);
			this.tvState.lastEventTime = now;
			return best;
		}
		return snapshots[this.tvState.current] || selected;
	}

	updateLookaround(values, car, lookaround, analogLookaround = null) {
		const view = CAMERA_LOOKAROUNDS[lookaround];
		const dimX = Math.max(0.1, values[SNAPSHOT.dimensionX]);
		const dimY = Math.max(0.1, values[SNAPSHOT.dimensionY]);
		const distance = Math.max(6, dimX * LOOKAROUND_DISTANCE_SCALE, dimY * LOOKAROUND_SIDE_DISTANCE_SCALE);
		this.camera.up.set(0, 1, 0);
		this.target.copy(car).add(new THREE.Vector3(0, LOOKAROUND_TARGET_HEIGHT, 0));
		if (analogLookaround) {
			this.applyAnalogLookTarget(values, analogLookaround);
		}
		this.camera.position.copy(car)
			.addScaledVector(this.forward, view.forward * distance)
			.addScaledVector(this.side, view.side * distance)
			.add(new THREE.Vector3(0, LOOKAROUND_HEIGHT, 0));
		this.camera.lookAt(this.target);
	}

	applyAnalogLookTarget(values, lookaround) {
		const dimX = Math.max(0.1, values[SNAPSHOT.dimensionX]);
		const dimY = Math.max(0.1, values[SNAPSHOT.dimensionY]);
		const sideOffset = Math.max(1.2, dimY * ANALOG_LOOK_SIDE_SCALE);
		const forwardOffset = Math.max(2.0, dimX * ANALOG_LOOK_FORWARD_SCALE);
		this.target
			.addScaledVector(this.side, -lookaround.x * sideOffset)
			.addScaledVector(this.forward, -lookaround.y * forwardOffset);
	}
}
