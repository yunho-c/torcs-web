import * as THREE from "three/webgpu";
import { SNAPSHOT } from "./runtime.js";

const WHEEL_COUNT = 4;
const TR_CURB = 1;
const RM_CAR_STATE_NO_SIMU = 0x000000FF;
const VOLUME_CUTOFF = 0.001;
const AUDIO_ROLLOFF_FACTOR = 0.05;
const DEFAULT_ASSET_SOURCE = "torcs";

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function normalizeRuntimePath(path) {
	const source = String(path || "");
	if (source.includes(":")) {
		return source;
	}
	return source.replace(/^\/torcs\//, "");
}

function manifestKeyCandidates(path) {
	const normalized = normalizeRuntimePath(path);
	if (!normalized || normalized.includes(":")) {
		return normalized ? [normalized] : [];
	}
	return [`${DEFAULT_ASSET_SOURCE}:${normalized}`, normalized];
}

function resolveManifestEntry(entries, path) {
	for (const key of manifestKeyCandidates(path)) {
		if (entries && entries[key]) {
			return entries[key];
		}
	}
	return null;
}

function torcsToAudioPosition(values, out = [0, 0, 0]) {
	out[0] = values[SNAPSHOT.x];
	out[1] = values[SNAPSHOT.z];
	out[2] = -values[SNAPSHOT.y];
	return out;
}

function wheelPosition(values, wheelIndex, out = [0, 0, 0]) {
	const yaw = values[SNAPSHOT.yaw];
	const sinYaw = Math.sin(yaw);
	const cosYaw = Math.cos(yaw);
	const relX = values[SNAPSHOT.wheelRelX0 + wheelIndex];
	const relY = values[SNAPSHOT.wheelRelY0 + wheelIndex];
	out[0] = values[SNAPSHOT.x] + relX * cosYaw - relY * sinYaw;
	out[1] = values[SNAPSHOT.z] + values[SNAPSHOT.wheelRelZ0 + wheelIndex];
	out[2] = -(values[SNAPSHOT.y] + relX * sinYaw + relY * cosYaw);
	return out;
}

function setAudioParam(param, value, time) {
	if (param && typeof param.setTargetAtTime === "function") {
		param.setTargetAtTime(value, time, 0.025);
	}
}

function setPannerPosition(panner, position) {
	if ("positionX" in panner) {
		panner.positionX.value = position[0];
		panner.positionY.value = position[1];
		panner.positionZ.value = position[2];
	} else if (typeof panner.setPosition === "function") {
		panner.setPosition(position[0], position[1], position[2]);
	}
}

export class AudioAssets {
	constructor(context, baseUrl = "./web-assets/") {
		this.context = context;
		this.baseUrl = baseUrl;
		this.manifest = null;
		this.buffers = new Map();
	}

	async loadManifest() {
		if (this.manifest) {
			return this.manifest;
		}
		const response = await fetch(`${this.baseUrl}manifest.json`);
		if (!response.ok) {
			throw new Error(`failed to load audio manifest: ${response.status}`);
		}
		this.manifest = await response.json();
		return this.manifest;
	}

	async loadBuffer(relativePath) {
		if (!relativePath) {
			return null;
		}
		if (this.buffers.has(relativePath)) {
			return this.buffers.get(relativePath);
		}
		const response = await fetch(`${this.baseUrl}${relativePath}`);
		if (!response.ok) {
			throw new Error(`failed to load audio sample ${relativePath}: ${response.status}`);
		}
		const data = await response.arrayBuffer();
		const buffer = await this.context.decodeAudioData(data);
		this.buffers.set(relativePath, buffer);
		return buffer;
	}

	async loadRaceAudio(carPath) {
		const manifest = await this.loadManifest();
		const car = resolveManifestEntry(manifest.cars, carPath);
		if (!car || !car.sound) {
			return null;
		}
		const effects = manifest.effects || {};
		const sounds = {};
		for (const [name, entry] of Object.entries(effects.sounds || {})) {
			sounds[name] = await this.loadBuffer(entry.asset);
		}
		const crashes = [];
		for (const entry of effects.crashes || []) {
			crashes.push(await this.loadBuffer(entry.asset));
		}
		return {
			car,
			engine: await this.loadBuffer(car.sound.engineAsset),
			sounds,
			crashes,
		};
	}
}

class LoopSound {
	constructor(context, output, buffer, { filter = false } = {}) {
		this.context = context;
		this.buffer = buffer;
		this.output = output;
		this.gain = context.createGain();
		this.gain.gain.value = 0;
		this.filter = filter ? context.createBiquadFilter() : null;
		this.panner = context.createPanner();
		this.panner.panningModel = "HRTF";
		this.panner.distanceModel = "inverse";
		this.panner.refDistance = 1;
		this.panner.maxDistance = 10000;
		this.panner.rolloffFactor = AUDIO_ROLLOFF_FACTOR;
		if (this.filter) {
			this.filter.type = "lowpass";
			this.filter.frequency.value = 12000;
			this.filter.connect(this.gain);
		}
		this.gain.connect(this.panner);
		this.panner.connect(output);
		this.source = null;
	}

	start() {
		if (this.source || !this.buffer) {
			return;
		}
		this.source = this.context.createBufferSource();
		this.source.buffer = this.buffer;
		this.source.loop = true;
		this.source.playbackRate.value = 1;
		this.source.connect(this.filter || this.gain);
		this.source.start();
	}

	stop() {
		if (!this.source) {
			return;
		}
		this.source.stop();
		this.source.disconnect();
		this.source = null;
	}

	update({ volume = 0, pitch = 1, lowpass = 1, position = [0, 0, 0] }) {
		this.start();
		if (!this.source) {
			return;
		}
		const now = this.context.currentTime;
		setAudioParam(this.gain.gain, clamp(volume, 0, 2), now);
		setAudioParam(this.source.playbackRate, clamp(pitch, 0.05, 4), now);
		if (this.filter) {
			setAudioParam(this.filter.frequency, 300 + clamp(lowpass, 0, 1) * 11000, now);
		}
		setPannerPosition(this.panner, position);
	}

	mute() {
		setAudioParam(this.gain.gain, 0, this.context.currentTime);
	}
}

export class CarAudioModel {
	constructor() {
		this.smoothAccel = 0;
		this.preAxle = 0;
		this.turboVolume = 0;
		this.turboPitch = 0;
		this.backfireVolume = 0;
		this.dragCollisionVolume = 0;
		this.carPosition = [0, 0, 0];
		this.wheelPositions = Array.from({ length: WHEEL_COUNT }, () => [0, 0, 0]);
	}

	reset() {
		this.smoothAccel = 0;
		this.preAxle = 0;
		this.turboVolume = 0;
		this.turboPitch = 0;
		this.backfireVolume = 0;
		this.dragCollisionVolume = 0;
	}

	isOffRoad(kind) {
		return kind > 0;
	}

	update(values, carSound) {
		const speed = Math.max(0, values[SNAPSHOT.speed]);
		const engineRpm = Math.max(0, values[SNAPSHOT.engineRpm]);
		const redline = Math.max(1, values[SNAPSHOT.engineRedline]);
		const accel = clamp(values[SNAPSHOT.controlAccel], 0, 1);
		const rpmScale = carSound.rpmScale || 1;
		const enginePitch = rpmScale * engineRpm / 600;
		const gearRatio = values[SNAPSHOT.gearRatio] || 0;
		const revRatio = engineRpm / redline;
		const revRatio2 = revRatio * revRatio;

		this.carPosition = torcsToAudioPosition(values, this.carPosition);

		const model = {
			engine: {
				volume: 0,
				pitch: enginePitch,
				lowpass: 1,
				position: this.carPosition,
			},
			axle: { volume: 0, pitch: 1, position: this.carPosition },
			turbo: { volume: 0, pitch: 1, position: this.carPosition },
			backfireLoop: { volume: 0, pitch: 1, position: this.carPosition },
			roadRide: { volume: 0, pitch: 1, position: this.carPosition },
			grassRide: { volume: 0, pitch: 1, position: this.carPosition },
			grassSkid: { volume: 0, pitch: 1, position: this.carPosition },
			curbRide: { volume: 0, pitch: 1, position: this.carPosition },
			metalSkid: { volume: 0, pitch: 1, position: this.carPosition },
			skidTyres: Array.from({ length: WHEEL_COUNT }, () => ({ volume: 0, pitch: 1, position: this.carPosition })),
			events: [],
		};

		if ((values[SNAPSHOT.state] | 0) & RM_CAR_STATE_NO_SIMU) {
			this.turboVolume = 0;
			this.backfireVolume = 0;
			this.dragCollisionVolume = 0;
			return model;
		}

		const wheelSpinning = [0, 1, 2, 3].some((wheelIndex) =>
			values[SNAPSHOT.wheelSpinVelocity0 + wheelIndex] > 0.1);

		this.smoothAccel = this.smoothAccel * 0.5 + 0.5 * (accel * 0.99 + 0.01);
		model.engine.volume = 0.65;
		model.engine.lowpass = (0.75 * revRatio2 + 0.25) * this.smoothAccel +
			(1 - this.smoothAccel) * 0.25 * revRatio2;

		model.axle.volume = 0.2 * Math.tanh(100 * Math.abs(this.preAxle - enginePitch));
		model.axle.pitch = (this.preAxle + enginePitch) * 0.05 * Math.abs(gearRatio);
		this.preAxle = (this.preAxle + enginePitch) * 0.5;

		if (carSound.turbo) {
			let turboTargetPitch = 0.1;
			let turboTargetVolume = 0;
			if (engineRpm > carSound.turboRpm) {
				turboTargetPitch = 0.1 + 0.9 * this.smoothAccel;
				turboTargetVolume = 0.1 * this.smoothAccel;
			}
			const turboILag = carSound.turboLag > 0 ? Math.exp(-3 * carSound.turboLag) : 0.05;
			this.turboVolume += 0.1 * (turboTargetVolume - this.turboVolume) * (0.1 + this.smoothAccel);
			this.turboPitch += turboILag * (turboTargetPitch * engineRpm / 600 - this.turboPitch) * this.smoothAccel;
			this.turboPitch -= this.turboPitch * 0.01 * (1 - this.smoothAccel);
			model.turbo.volume = this.turboVolume;
			model.turbo.pitch = this.turboPitch;
		}

		if (values[SNAPSHOT.engineSmoke] > 0 && this.backfireVolume < 0.5) {
			this.backfireVolume += 0.25 * values[SNAPSHOT.engineSmoke];
		}
		model.backfireLoop.pitch = engineRpm / 600;
		this.backfireVolume *= 0.45 + 0.5 * Math.exp(-model.backfireLoop.pitch);
		model.backfireLoop.volume = this.backfireVolume;

		if (speed >= 0.3 || wheelSpinning) {
			for (let wheelIndex = 0; wheelIndex < WHEEL_COUNT; wheelIndex += 1) {
				const wheelSkid = values[SNAPSHOT.wheelSkidIntensity0 + wheelIndex];
				const reaction = values[SNAPSHOT.wheelReaction0 + wheelIndex];
				const roughnessFreq = values[SNAPSHOT.wheelRoughnessFrequency0 + wheelIndex];
				const roughness = values[SNAPSHOT.wheelRoughness0 + wheelIndex];
				const otherContribution = values[SNAPSHOT.wheelOtherSurfaceContribution0 + wheelIndex];
				const otherRoughnessFreq = values[SNAPSHOT.wheelOtherRoughnessFrequency0 + wheelIndex];
				const otherRoughness = values[SNAPSHOT.wheelOtherRoughness0 + wheelIndex];
				const mainKind = values[SNAPSHOT.wheelSurfaceKind0 + wheelIndex];
				const otherKind = values[SNAPSHOT.wheelOtherSurfaceKind0 + wheelIndex];
				const mainStyle = values[SNAPSHOT.wheelSurfaceStyle0 + wheelIndex];
				const otherStyle = values[SNAPSHOT.wheelOtherSurfaceStyle0 + wheelIndex];
				const tmpvol = speed * 0.01;
				const ride = 0.001 * reaction;
				const mainOffroad = this.isOffRoad(mainKind);
				const otherOffroad = this.isOffRoad(otherKind);
				const hasOther = otherContribution > 0;
				let roadContribution = mainOffroad ? 0 : 1;
				let dirtContribution = mainOffroad ? 1 : 0;

				if (hasOther && mainOffroad !== otherOffroad) {
					roadContribution = mainOffroad ? otherContribution : 1 - otherContribution;
					dirtContribution = mainOffroad ? 1 - otherContribution : otherContribution;
				}

				const curbContribution = mainStyle === TR_CURB ? 1 - otherContribution :
					(hasOther && otherStyle === TR_CURB ? otherContribution : 0);
				if (reaction > 0 && curbContribution > 0) {
					const curbFreq = mainStyle === TR_CURB ? roughnessFreq : otherRoughnessFreq;
					const volume = tmpvol * (5 + ride / 3) * curbContribution;
					if (volume > model.curbRide.volume) {
						model.curbRide.volume = volume;
						model.curbRide.pitch = tmpvol * (0.75 + 0.25 * curbFreq);
					}
				}

				if (roadContribution > 0) {
					const roadFreq = !mainOffroad ? roughnessFreq : otherRoughnessFreq;
					const volume = tmpvol * (1 + ride * 0.25) * roadContribution;
					if (volume > model.roadRide.volume) {
						model.roadRide.volume = volume;
						model.roadRide.pitch = tmpvol * (0.75 + 0.25 * roadFreq);
					}
					if (wheelSkid > 0.05) {
						const slipAccel = values[SNAPSHOT.wheelSlipAccel0 + wheelIndex];
						const slip = Math.tanh((slipAccel + 10) * 0.01);
						model.skidTyres[wheelIndex] = {
							volume: (wheelSkid - 0.05) * roadContribution,
							pitch: (0.3 - 0.3 * slip + 0.3 * roadFreq) / (1 + 0.5 * Math.tanh(reaction * 0.0001)),
							position: wheelPosition(values, wheelIndex, this.wheelPositions[wheelIndex]),
						};
					}
				}

				if (dirtContribution > 0) {
					const dirtFreq = mainOffroad ? roughnessFreq : otherRoughnessFreq;
					const dirtRoughness = mainOffroad ? roughness : otherRoughness;
					const volume = (0.5 + 0.2 * Math.tanh(0.5 * dirtRoughness)) * tmpvol * ride * dirtContribution;
					if (volume > model.grassRide.volume) {
						model.grassRide.volume = volume;
						model.grassRide.pitch = tmpvol * (0.5 + 0.5 * dirtFreq);
					}
					if (wheelSkid * dirtContribution > model.grassSkid.volume) {
						model.grassSkid.volume = wheelSkid * dirtContribution;
						model.grassSkid.pitch = 1;
					}
				}
			}
		}

		const collision = values[SNAPSHOT.collisionEvent] | 0;
		const previousDragCollisionVolume = this.dragCollisionVolume;
		let skidMetal = 0;
		if (collision & 1) {
			skidMetal = speed * 0.01;
			model.metalSkid.pitch = 0.5 + 0.5 * skidMetal;
		}
		this.dragCollisionVolume = Math.min(1, 0.9 * this.dragCollisionVolume + skidMetal);
		model.metalSkid.volume = this.dragCollisionVolume;

		if (values[SNAPSHOT.gearChangeEvent] > 0) {
			model.events.push({ name: "gearChange", position: this.carPosition, volume: 0.85 });
		}
		if (collision & 16) {
			model.events.push({ name: "bottomCrash", position: this.carPosition, volume: 0.95 });
		}
		if (collision & 8) {
			model.events.push({ name: "bang", position: this.carPosition, volume: 0.95 });
		}
		if (collision && (!(collision & 1) || ((collision & 2) && skidMetal > previousDragCollisionVolume))) {
			model.events.push({ name: "crash", position: this.carPosition, volume: 1 });
		}
		return model;
	}
}

export class TorcsAudio {
	constructor(baseUrl = "./web-assets/", onStatus = () => {}) {
		this.baseUrl = baseUrl;
		this.onStatus = onStatus;
		this.context = null;
		this.master = null;
		this.assetLoader = null;
		this.raceAudio = null;
		this.model = new CarAudioModel();
		this.loops = new Map();
		this.enabled = false;
		this.muted = false;
		this.volume = 0.7;
		this.crashIndex = 0;
		this.status = "locked";
		this.listenerForward = new THREE.Vector3();
	}

	setStatus(status) {
		this.status = status;
		this.onStatus(status);
	}

	async ensureContext() {
		if (!this.context) {
			const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
			if (!AudioContextCtor) {
				throw new Error("Web Audio is not available");
			}
			this.context = new AudioContextCtor();
			this.master = this.context.createGain();
			this.master.connect(this.context.destination);
			this.assetLoader = new AudioAssets(this.context, this.baseUrl);
			this.setVolume(this.volume);
		}
		if (this.context.state !== "running") {
			await this.context.resume();
		}
	}

	setVolume(volume) {
		this.volume = clamp(Number(volume), 0, 1);
		if (this.master) {
			this.master.gain.value = this.muted ? 0 : this.volume;
		}
	}

	setMuted(muted) {
		this.muted = muted;
		this.setVolume(this.volume);
	}

	async enable(carPath) {
		this.setStatus("loading");
		try {
			await this.ensureContext();
			this.stopLoops();
			this.enabled = false;
			this.raceAudio = null;
			const raceAudio = await this.assetLoader.loadRaceAudio(carPath);
			if (!raceAudio) {
				this.setStatus("unavailable");
				return false;
			}
			this.raceAudio = raceAudio;
			this.enabled = true;
			this.model.reset();
			this.createLoops();
			this.setStatus("active");
			return true;
		} catch (error) {
			this.enabled = false;
			this.raceAudio = null;
			this.stopLoops();
			this.setStatus("error");
			throw error;
		}
	}

	disable() {
		this.enabled = false;
		this.raceAudio = null;
		this.stopLoops();
		this.setStatus("off");
	}

	async reload(carPath) {
		if (!this.enabled) {
			return;
		}
		await this.enable(carPath);
	}

	createLoops() {
		if (!this.context || !this.master || !this.raceAudio) {
			return;
		}
		this.stopLoops();
		const specs = {
			engine: [this.raceAudio.engine, { filter: true }],
			axle: [this.raceAudio.sounds.axle, {}],
			turbo: [this.raceAudio.sounds.turbo, {}],
			backfireLoop: [this.raceAudio.sounds.backfireLoop, {}],
			roadRide: [this.raceAudio.sounds.roadRide, {}],
			grassRide: [this.raceAudio.sounds.grassRide, {}],
			grassSkid: [this.raceAudio.sounds.grassSkid, {}],
			curbRide: [this.raceAudio.sounds.curbRide, {}],
			metalSkid: [this.raceAudio.sounds.metalSkid, {}],
		};
		for (const [name, [buffer, options]] of Object.entries(specs)) {
			this.loops.set(name, new LoopSound(this.context, this.master, buffer, options));
		}
		for (let i = 0; i < WHEEL_COUNT; i += 1) {
			this.loops.set(`skidTyres${i}`, new LoopSound(this.context, this.master, this.raceAudio.sounds.skidTyres));
		}
	}

	stopLoops() {
		for (const loop of this.loops.values()) {
			loop.stop();
		}
		this.loops.clear();
	}

	updateListener(camera) {
		if (!this.context || !camera) {
			return;
		}
		const listener = this.context.listener;
		const pos = camera.position;
		const forward = camera.getWorldDirection ? camera.getWorldDirection(this.listenerForward) : this.listenerForward.set(0, 0, -1);
		const up = camera.up || { x: 0, y: 1, z: 0 };
		if ("positionX" in listener) {
			listener.positionX.value = pos.x;
			listener.positionY.value = pos.y;
			listener.positionZ.value = pos.z;
			listener.forwardX.value = forward.x;
			listener.forwardY.value = forward.y;
			listener.forwardZ.value = forward.z;
			listener.upX.value = up.x;
			listener.upY.value = up.y;
			listener.upZ.value = up.z;
		} else if (typeof listener.setPosition === "function") {
			listener.setPosition(pos.x, pos.y, pos.z);
			listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
		}
	}

	playOneShot(name, position, volume = 1) {
		if (!this.context || !this.master || !this.raceAudio) {
			return;
		}
		let buffer = this.raceAudio.sounds[name];
		if (name === "crash" && this.raceAudio.crashes.length) {
			buffer = this.raceAudio.crashes[this.crashIndex % this.raceAudio.crashes.length];
			this.crashIndex += 1;
		}
		if (!buffer) {
			return;
		}
		const source = this.context.createBufferSource();
		const gain = this.context.createGain();
		const panner = this.context.createPanner();
		source.buffer = buffer;
		gain.gain.value = clamp(volume, 0, 1.5);
		panner.panningModel = "HRTF";
		panner.distanceModel = "inverse";
		panner.refDistance = 1;
		panner.maxDistance = 10000;
		panner.rolloffFactor = AUDIO_ROLLOFF_FACTOR;
		setPannerPosition(panner, position);
		source.connect(gain);
		gain.connect(panner);
		panner.connect(this.master);
		source.start();
		source.onended = () => {
			source.disconnect();
			gain.disconnect();
			panner.disconnect();
		};
	}

	update(values, camera) {
		if (!this.enabled || !values || !this.raceAudio) {
			return;
		}
		this.updateListener(camera);
		const model = this.model.update(values, this.raceAudio.car.sound);
		const loopGain = 0.75;
		for (const [name, state] of Object.entries(model)) {
			if (name === "events" || name === "skidTyres") {
				continue;
			}
			const loop = this.loops.get(name);
			if (loop) {
				loop.update({
					volume: state.volume > VOLUME_CUTOFF ? state.volume * loopGain : 0,
					pitch: state.pitch || 1,
					lowpass: state.lowpass === undefined ? 1 : state.lowpass,
					position: state.position,
				});
			}
		}
		model.skidTyres.forEach((state, index) => {
			const loop = this.loops.get(`skidTyres${index}`);
			if (loop) {
				loop.update({
					volume: state.volume > VOLUME_CUTOFF ? state.volume * loopGain : 0,
					pitch: state.pitch || 1,
					position: state.position,
				});
			}
		});
		for (const event of model.events) {
			this.playOneShot(event.name, event.position, event.volume);
		}
	}
}
