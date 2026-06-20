import * as THREE from "three/webgpu";
import { SNAPSHOT } from "./runtime.js";
import { warnOnce } from "./diagnostics.js";

const WHEEL_COUNT = 4;
const ROAD_EFFECT_Y = 0.075;
const SHADOW_POINT_COUNT = 6;
const MAX_SMOKE_PARTICLES = 300;
const SKID_MAX_STRIP_BY_WHEEL = 40;
const SKID_MAX_POINT_BY_STRIP = 600;
const SKID_DELTA_T = 0.3;
const SKID_TEXTURE_ADVANCE = 0.01;
const SKID_CONTACT_RADIUS_SCALE = 0.95;
const SKID_Z_OFFSET = 0.012;
const SKID_UNUSED = 1;
const SKID_BEGIN = 2;
const SKID_RUNNING = 3;
const SKID_STOPPED = 4;
const SMOKE_INTERVAL = 0.01;
const SMOKE_LIFE = 2.0;
const FIRE_INTERVAL = SMOKE_INTERVAL * 8;
const FIRE_LIFE = SMOKE_LIFE / 8;
const FIRE_STEP0_LIFE = SMOKE_LIFE / 50;
const COLLISION_FLASH_LIFE = 0.45;
const HEAD_LIGHT_MASK = 0x00000003;
const HEAD1_LIGHT_MASK = 0x00000001;
const HEAD2_LIGHT_MASK = 0x00000002;
const VALID_CAR_LIGHT_TYPES = new Set(["head1", "head2", "rear", "brake", "brake2"]);
const CAR_LIGHT_SPRITES = {
	head1: { texture: "frontlight", color: 0xfff1ca, scale: [5.75, 2.3] },
	head2: { texture: "frontlight", color: 0xfff1ca, scale: [5.75, 2.3] },
	rear: { texture: "rearlight", color: 0xff2a22, scale: [5.5, 2.4] },
	brake: { texture: "brakelight", color: 0xff321f, scale: [3.9, 1.6] },
	brake2: { texture: "brakelight", color: 0xff321f, scale: [3.9, 1.6] },
};

const SURFACE_EFFECTS = [
	{ color: [0, 0, 0], smoke: [0.8, 0.8, 0.8], sensitivity: 0.5, threshold: 0.1, initSpeed: 0.01, lifeCoefficient: 30, speedCoefficient: 0, slingMud: 0 },
	{ color: [0.8, 0.6, 0.35], smoke: [0.8, 0.74, 0.5], sensitivity: 0.9, threshold: 0.05, initSpeed: 0.5, lifeCoefficient: 12.5, speedCoefficient: 0.25, slingMud: 1 },
	{ color: [0.7, 0.55, 0.45], smoke: [0.76, 0.66, 0.56], sensitivity: 0.9, threshold: 0, initSpeed: 0.45, lifeCoefficient: 10, speedCoefficient: 0.5, slingMud: 1 },
	{ color: [0.5, 0.35, 0.15], smoke: [0.65, 0.5, 0.4], sensitivity: 1, threshold: 0.2, initSpeed: 0.4, lifeCoefficient: 30, speedCoefficient: 0.05, slingMud: 1 },
	{ color: [0.6, 0.6, 0.6], smoke: [0.6, 0.6, 0.6], sensitivity: 0.7, threshold: 0.1, initSpeed: 0.35, lifeCoefficient: 20, speedCoefficient: 0.1, slingMud: 1 },
	{ color: [0.75, 0.5, 0.3], smoke: [0.5, 0.55, 0.35], sensitivity: 0.8, threshold: 0.1, initSpeed: 0.3, lifeCoefficient: 25, speedCoefficient: 0, slingMud: 1 },
];

const tempVector = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();

function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}

function makeRadialTexture(inner, outer) {
	const canvas = document.createElement("canvas");
	canvas.width = 64;
	canvas.height = 64;
	const context = canvas.getContext("2d");
	const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 31);
	gradient.addColorStop(0, inner);
	gradient.addColorStop(1, outer);
	context.fillStyle = gradient;
	context.fillRect(0, 0, 64, 64);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function makeSpriteMaterial(texture, color, opacity, additive = false) {
	return new THREE.SpriteMaterial({
		map: texture,
		color,
		transparent: true,
		opacity,
		depthWrite: false,
		blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
	});
}

function torcsToThree(x, y, z = 0) {
	return new THREE.Vector3(x, z, -y);
}

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value);
}

function isValidCarLight(light) {
	return light && VALID_CAR_LIGHT_TYPES.has(light.type) &&
		Array.isArray(light.position) && light.position.length === 3 &&
		light.position.every(isFiniteNumber) &&
		isFiniteNumber(light.size) && light.size > 0;
}

function getCarLightOpacity(type, lightCommand, brake) {
	const head1On = (lightCommand & HEAD1_LIGHT_MASK) !== 0;
	const head2On = (lightCommand & HEAD2_LIGHT_MASK) !== 0;
	switch (type) {
	case "head1":
		return head1On ? 0.72 : 0;
	case "head2":
		return head2On ? 0.72 : 0;
	case "rear":
		return head1On || head2On ? 0.24 : 0;
	case "brake":
	case "brake2":
		return brake * 0.95;
	default:
		return 0;
	}
}

function getCarLightScale(type, size) {
	const spec = CAR_LIGHT_SPRITES[type] || CAR_LIGHT_SPRITES.rear;
	const diameter = Math.max(0.04, size || 0.2);
	return [diameter * spec.scale[0], diameter * spec.scale[1]];
}

function getWheelLocal(values, index, yOffset = 0) {
	return torcsToThree(
		values[SNAPSHOT.wheelRelX0 + index],
		values[SNAPSHOT.wheelRelY0 + index],
		values[SNAPSHOT.wheelRelZ0 + index] + yOffset,
	);
}

function getWheelSkidIntensity(values, index) {
	const rawSkid = getRawWheelSkid(values, index);
	if (rawSkid > 0) {
		return clamp01(Math.tanh(getSurfaceEffect(values, index).sensitivity * rawSkid));
	}
	const slipAccel = Math.abs(values[SNAPSHOT.wheelSlipAccel0 + index] || 0);
	const slipSide = Math.abs(values[SNAPSHOT.wheelSlipSide0 + index] || 0);
	return clamp01(slipAccel * 0.08 + slipSide * 0.035);
}

function getRawWheelSkid(values, index) {
	const explicitSkid = values[SNAPSHOT.wheelSkidIntensity0 + index];
	return Number.isFinite(explicitSkid) ? Math.max(0, explicitSkid) : 0;
}

function getSurfaceEffect(values, index) {
	const kind = Math.trunc(values[SNAPSHOT.wheelSurfaceKind0 + index] || 0);
	return SURFACE_EFFECTS[kind] || SURFACE_EFFECTS[0];
}

function makeColor(rgb) {
	return new THREE.Color(rgb[0], rgb[1], rgb[2]);
}

function makeSkidStrip() {
	return {
		state: SKID_UNUSED,
		points: [],
	};
}

function resetSkidStrip(strip) {
	strip.state = SKID_UNUSED;
	strip.points.length = 0;
}

function makeSkidWheelState() {
	return {
		strips: Array.from({ length: SKID_MAX_STRIP_BY_WHEEL }, makeSkidStrip),
		smoothColor: new THREE.Color(0, 0, 0),
		timeStrip: 0,
		runningSkid: 0,
		nextSkid: 0,
		lastStateOfSkid: 0,
		texState: 0,
	};
}

function resetSkidWheelState(state) {
	for (const strip of state.strips) {
		resetSkidStrip(strip);
	}
	state.smoothColor.setRGB(0, 0, 0);
	state.timeStrip = 0;
	state.runningSkid = 0;
	state.nextSkid = 0;
	state.lastStateOfSkid = 0;
	state.texState = 0;
}

function advanceSkidStrip(state) {
	state.nextSkid = (state.nextSkid + 1) % SKID_MAX_STRIP_BY_WHEEL;
	const next = state.strips[state.nextSkid];
	if (next.state !== SKID_UNUSED || next.points.length > 0) {
		resetSkidStrip(next);
	}
}

function stopSkidStrip(state) {
	if (state.lastStateOfSkid === 0) {
		return;
	}
	state.strips[state.runningSkid].state = SKID_STOPPED;
	state.lastStateOfSkid = 0;
	advanceSkidStrip(state);
}

function startSkidStrip(state) {
	state.runningSkid = state.nextSkid;
	const strip = state.strips[state.runningSkid];
	resetSkidStrip(strip);
	strip.state = SKID_BEGIN;
	state.lastStateOfSkid = 1;
	return strip;
}

function appendSkidPoint(strip, position, uv, color, alpha) {
	strip.points.push({
		position: position.clone(),
		uv,
		color: color.clone(),
		alpha: clamp01(alpha),
	});
}

function worldFromCarLocal(car, local, target = new THREE.Vector3()) {
	return target.copy(local).applyMatrix4(car.matrixWorld);
}

function normalizeGroundDirection(vector, fallbackX, fallbackZ) {
	vector.y = 0;
	if (vector.lengthSq() < 0.000001) {
		vector.set(fallbackX, 0, fallbackZ);
	}
	return vector.normalize();
}

function makeSlipVelocity(car, accelSlip, sideSlip, horizontalScale, verticalSpeed) {
	car.getWorldQuaternion(tempQuaternion);
	const forward = normalizeGroundDirection(tempVector.set(1, 0, 0).applyQuaternion(tempQuaternion), 1, 0);
	const side = normalizeGroundDirection(tempVector2.set(0, 0, -1).applyQuaternion(tempQuaternion), 0, -1);
	return new THREE.Vector3(0, verticalSpeed, 0)
		.addScaledVector(forward, accelSlip * horizontalScale)
		.addScaledVector(side, sideSlip * horizontalScale);
}

function carAssetWarningId(asset) {
	const entry = asset && asset.entry;
	return entry ? entry.xml || entry.source || entry.name || "unknown-car" : "unknown-car";
}

export class TorcsEffects {
	constructor(groups) {
		this.groups = groups;
		this.textures = {
			smoke: makeRadialTexture("rgba(220,220,220,0.82)", "rgba(220,220,220,0)"),
			fire0: makeRadialTexture("rgba(255,230,80,0.95)", "rgba(255,80,20,0)"),
			fire1: makeRadialTexture("rgba(255,130,20,0.95)", "rgba(80,20,0,0)"),
			frontlight: makeRadialTexture("rgba(255,246,210,0.9)", "rgba(255,246,210,0)"),
			rearlight: makeRadialTexture("rgba(255,45,28,0.88)", "rgba(255,0,0,0)"),
			brakelight: makeRadialTexture("rgba(255,58,35,0.95)", "rgba(255,0,0,0)"),
			shadow: null,
			skid: null,
		};
		this.shadow = this.createShadow();
		this.skidMarks = this.createSkidMarks();
		this.lightSprites = this.createLightSprites();
		this.assetLightSprites = [];
		this.collisionFlash = this.createCollisionFlash();
		this.smokeParticles = [];
		this.fireParticles = [];
		this.lastSmokeTime = Array.from({ length: WHEEL_COUNT }, () => 0);
		this.skidWheels = Array.from({ length: WHEEL_COUNT }, makeSkidWheelState);
		this.skidGeometryDirty = false;
		this.lastTime = 0;
		this.previousEngineLevel = null;
		this.fireCount = 0;
		this.lastFireTime = 0;
		this.previousDamage = 0;
		this.collisionUntil = 0;
	}

	setTextures(textures = {}) {
		textures = textures || {};
		this.textures.smoke = textures["smoke.rgb"] || this.textures.smoke;
		this.textures.fire0 = textures["fire0.rgb"] || this.textures.fire0;
		this.textures.fire1 = textures["fire1.rgb"] || this.textures.fire1;
		this.textures.frontlight = textures["frontlight1.rgb"] || textures["frontlight2.rgb"] || this.textures.frontlight;
		this.textures.rearlight = textures["rearlight1.rgb"] || textures["rearlight2.rgb"] || this.textures.rearlight;
		this.textures.brakelight = textures["breaklight1.rgb"] || textures["breaklight2.rgb"] || this.textures.brakelight;
		this.textures.skid = textures["grey-tracks.rgb"] || this.textures.skid;
		this.skidMarks.material.map = this.textures.skid;
		this.skidMarks.material.needsUpdate = true;
		this.refreshSpriteTextures();
	}

	setCarAsset(asset) {
		this.textures.shadow = asset && asset.shadowTexture ? asset.shadowTexture : null;
		this.shadow.material.map = this.textures.shadow;
		this.shadow.material.color.set(this.textures.shadow ? 0xffffff : 0x000000);
		this.shadow.material.opacity = this.textures.shadow ? 0.54 : 0.34;
		this.shadow.material.needsUpdate = true;
		if (asset && !this.textures.shadow) {
			warnOnce(
				`generic-shadow:${carAssetWarningId(asset)}`,
				"TORCS web renderer using generic planar shadow fallback",
				{
					car: carAssetWarningId(asset),
					shadowTexture: asset.entry ? asset.entry.shadowTexture : "",
				},
			);
		}
		this.setAssetLights(asset && asset.entry ? asset.entry.lights : []);
		if (asset && this.assetLightSprites.length === 0) {
			warnOnce(
				`default-light-anchors:${carAssetWarningId(asset)}`,
				"TORCS web renderer using default dimension-based car light anchors",
				{
					car: carAssetWarningId(asset),
					lightCount: asset.entry && Array.isArray(asset.entry.lights) ? asset.entry.lights.length : 0,
				},
			);
		}
	}

	setVisible(visible) {
		this.shadow.visible = visible;
		this.skidMarks.visible = visible;
		this.collisionFlash.visible = visible;
		for (const sprite of Object.values(this.lightSprites)) {
			sprite.visible = visible;
		}
		for (const record of this.assetLightSprites) {
			record.sprite.visible = visible;
		}
		for (const particle of this.smokeParticles) {
			particle.sprite.visible = visible;
		}
		for (const particle of this.fireParticles) {
			particle.sprite.visible = visible;
		}
	}

	resetDynamics() {
		for (const particle of this.smokeParticles) {
			this.groups.smoke.remove(particle.sprite);
			particle.sprite.material.dispose();
		}
		for (const particle of this.fireParticles) {
			this.groups.smoke.remove(particle.sprite);
			particle.sprite.material.dispose();
		}
		this.smokeParticles = [];
		this.fireParticles = [];
		this.lastSmokeTime = Array.from({ length: WHEEL_COUNT }, () => 0);
		for (const state of this.skidWheels) {
			resetSkidWheelState(state);
		}
		this.skidGeometryDirty = true;
		this.lastTime = 0;
		this.previousEngineLevel = null;
		this.fireCount = 0;
		this.lastFireTime = 0;
		this.previousDamage = 0;
		this.collisionUntil = 0;
		this.collisionFlash.material.opacity = 0;
		this.rebuildSkidGeometry();
	}

	createShadow() {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute(SHADOW_POINT_COUNT * 3, 3));
		geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
			1.0, 0.0,
			1.0, 1.0,
			0.5, 0.0,
			0.5, 1.0,
			0.0, 0.0,
			0.0, 1.0,
		], 2));
		geometry.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
		const shadow = new THREE.Mesh(
			geometry,
			new THREE.MeshBasicMaterial({
				color: 0x000000,
				transparent: true,
				opacity: 0.34,
				depthWrite: false,
				depthTest: true,
				side: THREE.DoubleSide,
				map: null,
			}),
		);
		shadow.renderOrder = 5;
		this.groups.shadows.add(shadow);
		return shadow;
	}

	createSkidMarks() {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
		geometry.setAttribute("color", new THREE.Float32BufferAttribute([], 4));
		geometry.setAttribute("uv", new THREE.Float32BufferAttribute([], 2));
		const mesh = new THREE.Mesh(
			geometry,
			new THREE.MeshBasicMaterial({
				vertexColors: true,
				map: this.textures.skid,
				transparent: true,
				opacity: 0.72,
				depthWrite: false,
				side: THREE.DoubleSide,
			}),
		);
		mesh.renderOrder = 4;
		this.groups.skidMarks.add(mesh);
		return mesh;
	}

	createLightSprites() {
		const specs = [
			{ key: "headL", type: "frontlight", color: 0xfff1ca, size: [1.15, 0.46] },
			{ key: "headR", type: "frontlight", color: 0xfff1ca, size: [1.15, 0.46] },
			{ key: "rearL", type: "rearlight", color: 0xff2a22, size: [0.55, 0.24] },
			{ key: "rearR", type: "rearlight", color: 0xff2a22, size: [0.55, 0.24] },
			{ key: "brakeL", type: "brakelight", color: 0xff321f, size: [0.78, 0.32] },
			{ key: "brakeR", type: "brakelight", color: 0xff321f, size: [0.78, 0.32] },
		];
		const sprites = {};
		for (const spec of specs) {
			const sprite = new THREE.Sprite(makeSpriteMaterial(this.textures[spec.type], spec.color, 0, true));
			sprite.scale.set(spec.size[0], spec.size[1], 1);
			sprite.userData.type = spec.type;
			this.groups.carLights.add(sprite);
			sprites[spec.key] = sprite;
		}
		return sprites;
	}

	setAssetLights(lights = []) {
		for (const record of this.assetLightSprites) {
			this.groups.carLights.remove(record.sprite);
			record.sprite.material.dispose();
		}
		this.assetLightSprites = [];
		for (const light of lights || []) {
			if (!isValidCarLight(light)) {
				continue;
			}
			const spec = CAR_LIGHT_SPRITES[light.type];
			const scale = getCarLightScale(light.type, light.size);
			const sprite = new THREE.Sprite(makeSpriteMaterial(this.textures[spec.texture], spec.color, 0, true));
			sprite.scale.set(scale[0], scale[1], 1);
			sprite.userData.type = spec.texture;
			this.groups.carLights.add(sprite);
			this.assetLightSprites.push({
				sprite,
				type: light.type,
				local: torcsToThree(light.position[0], light.position[1], light.position[2]),
			});
		}
	}

	createCollisionFlash() {
		const mesh = new THREE.Mesh(
			new THREE.RingGeometry(1.3, 1.55, 32),
			new THREE.MeshBasicMaterial({
				color: 0xffd37a,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				side: THREE.DoubleSide,
				blending: THREE.AdditiveBlending,
			}),
		);
		mesh.rotation.x = -Math.PI / 2;
		mesh.renderOrder = 30;
		this.groups.smoke.add(mesh);
		return mesh;
	}

	refreshSpriteTextures() {
		for (const sprite of Object.values(this.lightSprites)) {
			sprite.material.map = this.textures[sprite.userData.type];
			sprite.material.needsUpdate = true;
		}
		for (const record of this.assetLightSprites) {
			record.sprite.material.map = this.textures[record.sprite.userData.type];
			record.sprite.material.needsUpdate = true;
		}
		for (const particle of this.smokeParticles) {
			particle.sprite.material.map = this.textures.smoke;
		}
		for (const particle of this.fireParticles) {
			particle.sprite.material.map = particle.kind === 0 ? this.textures.fire0 : this.textures.fire1;
		}
	}

	update(values, car, camera = null) {
		if (!car) {
			return;
		}
		car.updateMatrixWorld(true);
		const time = Number.isFinite(values[SNAPSHOT.time]) ? values[SNAPSHOT.time] : 0;
		const deltaTime = Math.min(0.1, Math.max(0.001, this.lastTime ? time - this.lastTime : 1 / 60));
		this.lastTime = time;
		this.updateShadow(values, car);
		this.updateSkidMarks(values, car);
		this.updateSmoke(values, car, time, deltaTime);
		this.updateFire(values, car, time, deltaTime);
		this.updateLights(values, car);
		this.updateCollision(values, car, time);
		this.updateParticles(this.smokeParticles, this.groups.smoke, deltaTime, camera);
		this.updateParticles(this.fireParticles, this.groups.smoke, deltaTime, camera);
	}

	updateShadow(values, car) {
		const positions = this.shadow.geometry.getAttribute("position");
		let valid = true;
		for (let index = 0; index < SHADOW_POINT_COUNT; index += 1) {
			const x = values[SNAPSHOT.shadowX0 + index];
			const y = values[SNAPSHOT.shadowY0 + index];
			const z = values[SNAPSHOT.shadowZ0 + index];
			if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
				valid = false;
				break;
			}
			const point = torcsToThree(x, y, z);
			positions.setXYZ(index, point.x, point.y, point.z);
		}
		positions.needsUpdate = true;
		this.shadow.geometry.computeBoundingSphere();
		this.shadow.visible = valid;
	}

	updateSkidMarks(values, car) {
		const time = Number.isFinite(values[SNAPSHOT.time]) ? values[SNAPSHOT.time] : 0;
		const speed = values[SNAPSHOT.speed] || 0;
		const absSpeed = Math.abs(speed);
		for (let index = 0; index < WHEEL_COUNT; index += 1) {
			const state = this.skidWheels[index];
			const rawSkid = getRawWheelSkid(values, index);
			const surface = getSurfaceEffect(values, index);
			const intensity = rawSkid > 0.1 ? Math.tanh(surface.sensitivity * rawSkid) : 0;
			const color = state.smoothColor.clone();
			state.smoothColor.lerp(makeColor(surface.color), 0.1);
			if (time - state.timeStrip < SKID_DELTA_T) {
				continue;
			}
			if (absSpeed <= 1 || intensity <= 0.1) {
				if (state.lastStateOfSkid !== 0) {
					stopSkidStrip(state);
					this.skidGeometryDirty = true;
				}
				continue;
			}

			let startingSkid = state.lastStateOfSkid === 0;
			let strip = startingSkid ? startSkidStrip(state) : state.strips[state.runningSkid];
			if (strip.points.length + 2 > SKID_MAX_POINT_BY_STRIP) {
				stopSkidStrip(state);
				startingSkid = true;
				strip = startSkidStrip(state);
			}

			const wheelWidth = Math.max(0.08, values[SNAPSHOT.wheelWidth0 + index] || 0.2);
			const wheelRadius = Math.max(0.08, values[SNAPSHOT.wheelRadius0 + index] || 0.3);
			const tireHeight = Math.max(0.02, wheelRadius - wheelWidth * 0.5 || 0.12);
			const local = getWheelLocal(values, index, -wheelRadius * SKID_CONTACT_RADIUS_SCALE);
			local.x -= tireHeight;
			const slingRight = surface.slingMud;
			const slingLeft = -surface.slingMud;
			const firstOffset = speed >= 0 ? (slingRight + 1) * wheelWidth * 0.5 : (slingLeft - 1) * wheelWidth * 0.5;
			const secondOffset = speed >= 0 ? (slingLeft - 1) * wheelWidth * 0.5 : (slingRight + 1) * wheelWidth * 0.5;
			const first = worldFromCarLocal(car, local.clone().add(new THREE.Vector3(0, 0, firstOffset)));
			const second = worldFromCarLocal(car, local.clone().add(new THREE.Vector3(0, 0, secondOffset)));
			first.y += SKID_Z_OFFSET;
			second.y += SKID_Z_OFFSET;

			const u = state.texState;
			appendSkidPoint(strip, first, [u, 0.75 + slingRight * 0.25], color, intensity);
			appendSkidPoint(strip, second, [u, 0.25 + slingLeft * 0.25], color, intensity);
			strip.state = SKID_RUNNING;
			state.timeStrip = time;
			const wheelSpinVelocity = values[SNAPSHOT.wheelSpinVelocity0 + index] || 0;
			state.texState += SKID_TEXTURE_ADVANCE * wheelSpinVelocity;
			if (startingSkid) {
				state.texState = 0;
			}
			this.skidGeometryDirty = true;
		}
		if (this.skidGeometryDirty) {
			this.rebuildSkidGeometry();
			this.skidGeometryDirty = false;
		}
	}

	rebuildSkidGeometry() {
		const positions = [];
		const colors = [];
		const uvs = [];
		for (const wheel of this.skidWheels) {
			for (const strip of wheel.strips) {
				if (strip.state === SKID_UNUSED || strip.points.length < 4) {
					continue;
				}
				for (let pointIndex = 0; pointIndex <= strip.points.length - 4; pointIndex += 2) {
					const first0 = strip.points[pointIndex];
					const second0 = strip.points[pointIndex + 1];
					const first1 = strip.points[pointIndex + 2];
					const second1 = strip.points[pointIndex + 3];
					for (const point of [first0, second0, first1, first1, second0, second1]) {
						positions.push(point.position.x, point.position.y, point.position.z);
						colors.push(point.color.r, point.color.g, point.color.b, point.alpha);
						uvs.push(point.uv[0], point.uv[1]);
					}
				}
			}
		}
		this.skidMarks.geometry.dispose();
		this.skidMarks.geometry = new THREE.BufferGeometry();
		this.skidMarks.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		this.skidMarks.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
		this.skidMarks.geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
		if (positions.length > 0) {
			this.skidMarks.geometry.computeBoundingSphere();
		}
	}

	updateSmoke(values, car, time, deltaTime) {
		const speed = Math.abs(values[SNAPSHOT.speed] || 0);
		for (let index = 0; index < WHEEL_COUNT; index += 1) {
			const rawSkid = getRawWheelSkid(values, index);
			const surface = getSurfaceEffect(values, index);
			const reaction = Math.max(0, values[SNAPSHOT.wheelReaction0 + index] || 0);
			const spdFx = Math.tanh(0.001 * reaction) * surface.speedCoefficient * speed;
			const emit = rawSkid + 0.025 * Math.random() * spdFx > Math.random() + surface.threshold;
			if (speed < 0.03 || !emit || time - this.lastSmokeTime[index] < SMOKE_INTERVAL || this.smokeParticles.length >= MAX_SMOKE_PARTICLES) {
				continue;
			}
			const intensity = getWheelSkidIntensity(values, index);
			const radius = Math.max(0.08, values[SNAPSHOT.wheelRadius0 + index] || 0.3);
			const world = worldFromCarLocal(car, getWheelLocal(values, index, -radius + 0.1));
			world.y = Math.max(world.y + 0.16, ROAD_EFFECT_Y + 0.16);
			const color = makeColor(surface.smoke);
			const sprite = new THREE.Sprite(makeSpriteMaterial(this.textures.smoke, color, 0.42));
			const size = 0.2 + 0.1 * spdFx + intensity * 1.4;
			sprite.scale.set(size, size, 1);
			sprite.position.copy(world);
			const sideSlip = values[SNAPSHOT.wheelSlipSide0 + index] || 0;
			const accelSlip = values[SNAPSHOT.wheelSlipAccel0 + index] || 0;
			const lifeRand = 1 - Math.random() * Math.random();
			const life = Math.max(0.08, SMOKE_LIFE * (rawSkid * speed + Math.random() * spdFx) / Math.max(1, surface.lifeCoefficient * lifeRand));
			const horizontalScale = surface.initSpeed * 0.08;
			const verticalSpeed = 0.1 + Math.random() * surface.initSpeed;
			this.smokeParticles.push({
				sprite,
				age: 0,
				life,
				velocity: makeSlipVelocity(car, accelSlip, sideSlip, horizontalScale, verticalSpeed),
			});
			this.groups.smoke.add(sprite);
			this.lastSmokeTime[index] = time;
		}
	}

	updateFire(values, car, time, deltaTime) {
		const exhaustCount = Math.min(2, Math.max(0, Math.trunc(values[SNAPSHOT.exhaustCount] || 0)));
		if (exhaustCount <= 0 || Math.abs(values[SNAPSHOT.speed] || 0) <= 3 || time - this.lastFireTime <= FIRE_INTERVAL) {
			return;
		}
		const rpm = Math.max(0, values[SNAPSHOT.engineRpm] || 0);
		const redline = Math.max(1, values[SNAPSHOT.engineRedline] || 1);
		const engineLevel = rpm / redline;
		if (this.previousEngineLevel !== null) {
			const drop = this.previousEngineLevel - engineLevel;
			if (drop > 0.1) {
				this.fireCount = Math.max(this.fireCount, Math.trunc(10 * drop * Math.max(0.1, values[SNAPSHOT.exhaustPower] || 1)));
			}
		}
		this.previousEngineLevel = engineLevel;
		this.lastFireTime = time;
		if (this.fireCount <= 0) {
			return;
		}
		this.fireCount -= 1;
		for (let index = 0; index < exhaustCount; index += 1) {
			const local = torcsToThree(
				values[SNAPSHOT.exhaustX0 + index],
				values[SNAPSHOT.exhaustY0 + index],
				values[SNAPSHOT.exhaustZ0 + index],
			);
			const world = worldFromCarLocal(car, local);
			const sprite = new THREE.Sprite(makeSpriteMaterial(this.textures.fire0, 0xffb24a, 0.85, true));
			sprite.position.copy(world);
			sprite.scale.set(0.8, 0.8, 1);
			this.fireParticles.push({
				sprite,
				kind: 0,
				age: 0,
				life: FIRE_LIFE,
				velocity: new THREE.Vector3().copy(world).sub(car.position).normalize().multiplyScalar(0.035),
			});
			this.groups.smoke.add(sprite);
		}
	}

	updateLights(values, car) {
		const lightCommand = values[SNAPSHOT.lightCommand] || 0;
		const brake = clamp01(values[SNAPSHOT.controlBrake] || 0);
		if (this.assetLightSprites.length > 0) {
			for (const sprite of Object.values(this.lightSprites)) {
				sprite.material.opacity = 0;
			}
			for (const record of this.assetLightSprites) {
				worldFromCarLocal(car, record.local, tempVector2);
				record.sprite.position.copy(tempVector2);
				record.sprite.material.opacity = getCarLightOpacity(record.type, lightCommand, brake);
			}
			return;
		}
		const dimX = Math.max(0.4, values[SNAPSHOT.dimensionX]);
		const dimY = Math.max(0.4, values[SNAPSHOT.dimensionY]);
		const dimZ = Math.max(0.2, values[SNAPSHOT.dimensionZ]);
		const headOn = (lightCommand & HEAD_LIGHT_MASK) !== 0;
		const lightPositions = {
			headL: [dimX * 0.52, dimZ * 0.36, -dimY * 0.28],
			headR: [dimX * 0.52, dimZ * 0.36, dimY * 0.28],
			rearL: [-dimX * 0.54, dimZ * 0.34, -dimY * 0.28],
			rearR: [-dimX * 0.54, dimZ * 0.34, dimY * 0.28],
			brakeL: [-dimX * 0.56, dimZ * 0.38, -dimY * 0.26],
			brakeR: [-dimX * 0.56, dimZ * 0.38, dimY * 0.26],
		};
		for (const [key, local] of Object.entries(lightPositions)) {
			const sprite = this.lightSprites[key];
			worldFromCarLocal(car, tempVector.set(local[0], local[1], local[2]), tempVector2);
			sprite.position.copy(tempVector2);
		}
		this.lightSprites.headL.material.opacity = headOn ? 0.72 : 0;
		this.lightSprites.headR.material.opacity = headOn ? 0.72 : 0;
		this.lightSprites.rearL.material.opacity = 0.24 + brake * 0.22;
		this.lightSprites.rearR.material.opacity = 0.24 + brake * 0.22;
		this.lightSprites.brakeL.material.opacity = brake * 0.95;
		this.lightSprites.brakeR.material.opacity = brake * 0.95;
		for (const record of this.assetLightSprites) {
			record.sprite.material.opacity = 0;
		}
	}

	updateCollision(values, car, time) {
		const collision = values[SNAPSHOT.collision] || 0;
		const damage = values[SNAPSHOT.damage] || 0;
		if (collision !== 0 || damage > this.previousDamage) {
			this.collisionUntil = time + COLLISION_FLASH_LIFE;
		}
		this.previousDamage = damage;
		this.collisionFlash.position.set(car.position.x, ROAD_EFFECT_Y + 0.05, car.position.z);
		this.collisionFlash.scale.setScalar(Math.max(1.2, values[SNAPSHOT.dimensionX] * 0.55));
		this.collisionFlash.material.opacity = clamp01((this.collisionUntil - time) / COLLISION_FLASH_LIFE) * 0.72;
	}

	updateParticles(particles, group, deltaTime, camera) {
		for (let index = particles.length - 1; index >= 0; index -= 1) {
			const particle = particles[index];
			particle.age += deltaTime;
			if (particle.age >= particle.life) {
				group.remove(particle.sprite);
				particle.sprite.material.dispose();
				particles.splice(index, 1);
				continue;
			}
			const t = particle.age / particle.life;
			if (particle.life === FIRE_LIFE && particle.kind === 0 && particle.age >= FIRE_STEP0_LIFE) {
				particle.kind = 1;
				particle.sprite.material.map = this.textures.fire1;
				particle.sprite.material.needsUpdate = true;
			}
			particle.sprite.position.addScaledVector(particle.velocity, deltaTime * 60);
			particle.sprite.material.opacity = (1 - t) * (particle.life <= FIRE_LIFE ? 0.9 : 0.42);
			particle.sprite.scale.multiplyScalar(1 + deltaTime * (particle.life <= FIRE_LIFE ? 1.8 : 0.7));
			if (camera) {
				particle.sprite.quaternion.copy(camera.quaternion);
			}
		}
	}
}
