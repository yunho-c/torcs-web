import { Dualsense, TriggerEffect, AudioOutput, findDualsenseAudioDevices } from "dualsense-ts";
import { SNAPSHOT } from "./runtime.js";

const WHEEL_COUNT = 4;
const FRNT_RGT = 0;
const FRNT_LFT = 1;
const REAR_RGT = 2;
const REAR_LFT = 3;
const LEFT_WHEELS = [FRNT_LFT, REAR_LFT];
const RIGHT_WHEELS = [FRNT_RGT, REAR_RGT];
const TR_CURB = 1;
const RM_CAR_STATE_NO_SIMU = 0x000000FF;
const DEFAULT_CYLINDERS = 4;
const HAPTIC_GAIN_RAMP = 0.025;
const TWO_PI = Math.PI * 2;
const FALLBACK_REASONS = {
	noAudioContext: "no-audio-context",
	enumerationFailed: "audio-device-enumeration-failed",
	audioLabelsRedacted: "audio-device-labels-redacted",
	noDualSenseAudioOutput: "no-dualsense-audio-output",
	sinkFailed: "audio-sink-failed",
};
const DUALSENSE_AUDIO_LABELS = ["wireless controller", "dualsense"];
const HAPTIC_TRANSPORT = {
	hidRumble: "hid-rumble",
	pcmDebug: "pcm-debug",
	unavailable: "unavailable",
};

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function finite(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function smoothstep(edge0, edge1, value) {
	const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}

function setAudioParam(param, value, time, ramp = HAPTIC_GAIN_RAMP) {
	if (param && typeof param.setTargetAtTime === "function") {
		param.setTargetAtTime(value, time, ramp);
	} else if (param) {
		param.value = value;
	}
}

function createNoiseBuffer(context) {
	const length = Math.max(1, Math.floor(context.sampleRate));
	const buffer = context.createBuffer(1, length, context.sampleRate);
	const data = buffer.getChannelData(0);
	let pink = 0;
	for (let i = 0; i < length; i += 1) {
		const white = Math.random() * 2 - 1;
		pink = pink * 0.92 + white * 0.08;
		data[i] = clamp(white * 0.55 + pink * 0.45, -1, 1);
	}
	return buffer;
}

function looksLikeDualSenseLabel(label) {
	const lower = String(label || "").toLowerCase();
	return DUALSENSE_AUDIO_LABELS.some((pattern) => lower.includes(pattern));
}

function makeOutputPair(context, merger, leftLevel = 0.5, rightLevel = 0.5) {
	const left = context.createGain();
	const right = context.createGain();
	left.gain.value = leftLevel;
	right.gain.value = rightLevel;
	left.connect(merger, 0, 0);
	right.connect(merger, 0, 1);
	return { left, right };
}

class StereoOscillator {
	constructor(context, merger, type, frequency, leftLevel = 0.5, rightLevel = 0.5) {
		this.context = context;
		this.oscillator = context.createOscillator();
		this.gain = context.createGain();
		const outputs = makeOutputPair(context, merger, leftLevel, rightLevel);
		this.left = outputs.left;
		this.right = outputs.right;
		this.oscillator.type = type;
		this.oscillator.frequency.value = frequency;
		this.gain.gain.value = 0;
		this.oscillator.connect(this.gain);
		this.gain.connect(this.left);
		this.gain.connect(this.right);
		this.oscillator.start();
	}

	update({ frequency, gain, left = 0.5, right = 0.5 }) {
		const now = this.context.currentTime;
		setAudioParam(this.oscillator.frequency, clamp(frequency, 20, 260), now, 0.02);
		setAudioParam(this.gain.gain, clamp(gain, 0, 1), now);
		setAudioParam(this.left.gain, clamp(left, 0, 1), now);
		setAudioParam(this.right.gain, clamp(right, 0, 1), now);
	}

	stop() {
		try {
			this.oscillator.stop();
		} catch (_) {
			// The oscillator may already be stopped during teardown.
		}
		this.oscillator.disconnect();
		this.gain.disconnect();
		this.left.disconnect();
		this.right.disconnect();
	}
}

class StereoNoise {
	constructor(context, merger, buffer, leftLevel = 1, rightLevel = 0) {
		this.context = context;
		this.source = context.createBufferSource();
		this.filter = context.createBiquadFilter();
		this.gain = context.createGain();
		const outputs = makeOutputPair(context, merger, leftLevel, rightLevel);
		this.left = outputs.left;
		this.right = outputs.right;
		this.source.buffer = buffer;
		this.source.loop = true;
		this.filter.type = "lowpass";
		this.filter.frequency.value = 90;
		this.gain.gain.value = 0;
		this.source.connect(this.filter);
		this.filter.connect(this.gain);
		this.gain.connect(this.left);
		this.gain.connect(this.right);
		this.source.start();
	}

	update({ gain, frequency }) {
		const now = this.context.currentTime;
		setAudioParam(this.gain.gain, clamp(gain, 0, 1), now);
		setAudioParam(this.filter.frequency, clamp(frequency, 50, 260), now, 0.02);
	}

	stop() {
		try {
			this.source.stop();
		} catch (_) {
			// The source may already be stopped during teardown.
		}
		this.source.disconnect();
		this.filter.disconnect();
		this.gain.disconnect();
		this.left.disconnect();
		this.right.disconnect();
	}
}

class HapticSynthGraph {
	constructor(context) {
		this.context = context;
		this.master = context.createGain();
		this.merger = context.createChannelMerger(2);
		this.noiseBuffer = createNoiseBuffer(context);
		this.engine = new StereoOscillator(context, this.merger, "sawtooth", 80, 0.5, 0.5);
		this.slipLeft = new StereoOscillator(context, this.merger, "sine", 70, 1, 0);
		this.slipRight = new StereoOscillator(context, this.merger, "sine", 70, 0, 1);
		this.textureLeft = new StereoNoise(context, this.merger, this.noiseBuffer, 1, 0);
		this.textureRight = new StereoNoise(context, this.merger, this.noiseBuffer, 0, 1);
		this.master.gain.value = 0;
		this.merger.connect(this.master);
		this.master.connect(context.destination);
	}

	setIntensity(intensity) {
		setAudioParam(this.master.gain, clamp(intensity, 0, 1), this.context.currentTime, 0.05);
	}

	update(model) {
		this.engine.update({
			frequency: model.engine.frequency,
			gain: model.engine.amplitude,
			left: 0.5,
			right: 0.5,
		});
		this.slipLeft.update({
			frequency: 68 + 6 * model.left.slip,
			gain: model.left.slip * 0.34,
			left: 1,
			right: 0,
		});
		this.slipRight.update({
			frequency: 68 + 6 * model.right.slip,
			gain: model.right.slip * 0.34,
			left: 0,
			right: 1,
		});
		this.textureLeft.update({
			gain: model.left.texture * 0.28,
			frequency: model.left.textureFrequency,
		});
		this.textureRight.update({
			gain: model.right.texture * 0.28,
			frequency: model.right.textureFrequency,
		});
	}

	playTransient({ left = 1, right = 1, gain = 0.6, duration = 0.035, frequency = 70, type = "square" } = {}) {
		const oscillator = this.context.createOscillator();
		const gainNode = this.context.createGain();
		const outputs = makeOutputPair(this.context, this.merger, left, right);
		const now = this.context.currentTime;
		oscillator.type = type;
		oscillator.frequency.value = frequency;
		gainNode.gain.setValueAtTime(0, now);
		gainNode.gain.linearRampToValueAtTime(clamp(gain, 0, 1), now + 0.004);
		gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
		oscillator.connect(gainNode);
		gainNode.connect(outputs.left);
		gainNode.connect(outputs.right);
		oscillator.start(now);
		oscillator.stop(now + duration + 0.01);
		oscillator.onended = () => {
			oscillator.disconnect();
			gainNode.disconnect();
			outputs.left.disconnect();
			outputs.right.disconnect();
		};
	}

	dispose() {
		this.engine.stop();
		this.slipLeft.stop();
		this.slipRight.stop();
		this.textureLeft.stop();
		this.textureRight.stop();
		this.master.disconnect();
		this.merger.disconnect();
	}
}

export class DualSenseTelemetryModel {
	constructor({ cylinders = DEFAULT_CYLINDERS } = {}) {
		this.cylinders = cylinders;
		this.leftSlip = 0;
		this.rightSlip = 0;
		this.leftTexture = 0;
		this.rightTexture = 0;
		this.previousGearEvent = 0;
		this.previousCollisionEvent = 0;
	}

	reset() {
		this.leftSlip = 0;
		this.rightSlip = 0;
		this.leftTexture = 0;
		this.rightTexture = 0;
		this.previousGearEvent = 0;
		this.previousCollisionEvent = 0;
	}

	readWheel(values, wheelIndex) {
		const otherContribution = clamp(finite(values[SNAPSHOT.wheelOtherSurfaceContribution0 + wheelIndex]), 0, 0.5);
		const mainSurface = finite(values[SNAPSHOT.wheelSurfaceKind0 + wheelIndex]);
		const otherSurface = finite(values[SNAPSHOT.wheelOtherSurfaceKind0 + wheelIndex]);
		const mainStyle = finite(values[SNAPSHOT.wheelSurfaceStyle0 + wheelIndex]);
		const otherStyle = finite(values[SNAPSHOT.wheelOtherSurfaceStyle0 + wheelIndex]);
		const mainOffroad = mainSurface > 0 ? 1 : 0;
		const otherOffroad = otherSurface > 0 ? 1 : 0;
		const offroad = mainOffroad * (1 - otherContribution) + otherOffroad * otherContribution;
		const curb = (mainStyle === TR_CURB ? 1 - otherContribution : 0) +
			(otherStyle === TR_CURB ? otherContribution : 0);
		return {
			skid: clamp(finite(values[SNAPSHOT.wheelSkidIntensity0 + wheelIndex]), 0, 1.5),
			slipAccel: Math.abs(finite(values[SNAPSHOT.wheelSlipAccel0 + wheelIndex])),
			slipSide: Math.abs(finite(values[SNAPSHOT.wheelSlipSide0 + wheelIndex])),
			reaction: Math.max(0, finite(values[SNAPSHOT.wheelReaction0 + wheelIndex])),
			roughness: Math.max(
				finite(values[SNAPSHOT.wheelRoughness0 + wheelIndex]),
				finite(values[SNAPSHOT.wheelOtherRoughness0 + wheelIndex]) * otherContribution,
			),
			roughnessFrequency: Math.max(
				finite(values[SNAPSHOT.wheelRoughnessFrequency0 + wheelIndex], 1),
				finite(values[SNAPSHOT.wheelOtherRoughnessFrequency0 + wheelIndex], 1) * otherContribution,
			),
			offroad,
			curb,
		};
	}

	sideModel(values, wheels, previousSlip, previousTexture) {
		const speed = Math.max(0, finite(values[SNAPSHOT.speed]));
		const speedNorm = clamp(speed / 70, 0, 1);
		let slip = 0;
		let texture = 0;
		let textureFrequency = 80;
		let frontSlip = 0;

		for (const wheelIndex of wheels) {
			const wheel = this.readWheel(values, wheelIndex);
			const slipSignal = Math.max(
				wheel.skid,
				wheel.slipSide * 0.075,
				wheel.slipAccel * 0.015,
			);
			const slipLevel = smoothstep(0.055, 0.45, slipSignal);
			const reactionLevel = Math.tanh(wheel.reaction * 0.00028);
			const surfaceTexture = speedNorm * reactionLevel * (
				0.025 +
				clamp(wheel.roughness * 1.8, 0, 0.55) +
				0.48 * clamp(wheel.offroad, 0, 1) +
				0.7 * clamp(wheel.curb, 0, 1)
			);
			slip = Math.max(slip, slipLevel);
			texture = Math.max(texture, surfaceTexture);
			textureFrequency = Math.max(textureFrequency, 80 + 45 * wheel.roughnessFrequency + 70 * wheel.curb + 55 * wheel.offroad);
			if (wheelIndex === FRNT_LFT || wheelIndex === FRNT_RGT) {
				frontSlip = Math.max(frontSlip, slipLevel);
			}
		}

		return {
			slip: previousSlip * 0.72 + slip * 0.28,
			texture: previousTexture * 0.66 + clamp(texture, 0, 1) * 0.34,
			textureFrequency: clamp(textureFrequency, 70, 230),
			frontSlip,
		};
	}

	update(values, deltaTime = 1 / 60) {
		if (!values || ((finite(values[SNAPSHOT.state]) | 0) & RM_CAR_STATE_NO_SIMU)) {
			this.leftSlip *= 0.7;
			this.rightSlip *= 0.7;
			this.leftTexture *= 0.7;
			this.rightTexture *= 0.7;
			return this.makeSilentModel();
		}

		const rpm = Math.max(0, finite(values[SNAPSHOT.engineRpm]));
		const redline = Math.max(1, finite(values[SNAPSHOT.engineRedline], 7000));
		const throttle = clamp(finite(values[SNAPSHOT.controlAccel]), 0, 1);
		const brake = clamp(finite(values[SNAPSHOT.controlBrake]), 0, 1);
		const revRatio = clamp(rpm / redline, 0, 1.25);
		const engineFrequency = clamp((rpm / 60) * (this.cylinders / 2), 30, 220);
		const engineAmplitude = clamp((0.025 + throttle * 0.11) * (0.35 + 0.65 * revRatio), 0, 0.16);
		const left = this.sideModel(values, LEFT_WHEELS, this.leftSlip, this.leftTexture);
		const right = this.sideModel(values, RIGHT_WHEELS, this.rightSlip, this.rightTexture);
		const gearEvent = finite(values[SNAPSHOT.gearChangeEvent]) | 0;
		const collisionEvent = finite(values[SNAPSHOT.collisionEvent]) | 0;
		const gearPulse = gearEvent > this.previousGearEvent || gearEvent > 0 && this.previousGearEvent === 0;
		const collisionPulse = collisionEvent !== 0 && collisionEvent !== this.previousCollisionEvent;
		const frontSlip = Math.max(left.frontSlip, right.frontSlip);
		const absPulse = brake > 0.45 && frontSlip > 0.32;

		this.leftSlip = left.slip;
		this.rightSlip = right.slip;
		this.leftTexture = left.texture;
		this.rightTexture = right.texture;
		this.previousGearEvent = gearEvent;
		this.previousCollisionEvent = collisionEvent;

		return {
			deltaTime,
			engine: {
				frequency: engineFrequency,
				amplitude: engineAmplitude,
			},
			left,
			right,
			transients: {
				gear: gearPulse,
				collision: collisionPulse,
			},
			rumble: {
				left: clamp(engineAmplitude * 1.8 + left.slip * 0.6 + left.texture * 0.45 + (gearPulse ? 0.22 : 0) + (collisionPulse ? 0.65 : 0), 0, 1),
				right: clamp(engineAmplitude * 1.8 + right.slip * 0.6 + right.texture * 0.45 + (gearPulse ? 0.22 : 0) + (collisionPulse ? 0.65 : 0), 0, 1),
			},
			triggers: {
				throttle: {
					effect: TriggerEffect.Feedback,
					position: 0.18,
					strength: clamp(0.22 + throttle * 0.42 + revRatio * 0.12, 0, 0.82),
				},
				brake: absPulse ? {
					effect: TriggerEffect.Vibration,
					position: 0.08,
					amplitude: clamp(0.45 + frontSlip * 0.45, 0, 1),
					frequency: 32 + Math.round(18 * frontSlip),
				} : {
					effect: TriggerEffect.Feedback,
					position: 0.12,
					strength: clamp(0.45 + brake * 0.42, 0, 0.92),
				},
				absPulse,
			},
		};
	}

	makeSilentModel() {
		return {
			deltaTime: 1 / 60,
			engine: { frequency: 70, amplitude: 0 },
			left: { slip: this.leftSlip, texture: this.leftTexture, textureFrequency: 90, frontSlip: 0 },
			right: { slip: this.rightSlip, texture: this.rightTexture, textureFrequency: 90, frontSlip: 0 },
			transients: { gear: false, collision: false },
			rumble: { left: 0, right: 0 },
			triggers: {
				throttle: { effect: TriggerEffect.Feedback, position: 0.18, strength: 0.18 },
				brake: { effect: TriggerEffect.Feedback, position: 0.12, strength: 0.45 },
				absPulse: false,
			},
		};
	}
}

class HidRumbleSynth {
	constructor() {
		this.time = 0;
		this.gearPulse = 0;
		this.collisionPulse = 0;
		this.noiseSeed = 0x6d2b79f5;
	}

	reset() {
		this.time = 0;
		this.gearPulse = 0;
		this.collisionPulse = 0;
		this.noiseSeed = 0x6d2b79f5;
	}

	nextNoise() {
		this.noiseSeed = (Math.imul(this.noiseSeed, 1664525) + 1013904223) >>> 0;
		return this.noiseSeed / 0xffffffff;
	}

	update(model, intensity = 1, deltaTime = 1 / 30) {
		const dt = clamp(finite(deltaTime, 1 / 30), 1 / 120, 1 / 15);
		this.time += dt;
		if (model.transients.gear) {
			this.gearPulse = 1;
		}
		if (model.transients.collision) {
			this.collisionPulse = 1;
		}

		const engineRate = 7 + clamp(model.engine.frequency / 22, 0, 9);
		const engineMod = 0.68 + 0.32 * (0.5 + 0.5 * Math.sin(TWO_PI * engineRate * this.time));
		const slipPulse = 0.62 + 0.38 * Math.abs(Math.sin(TWO_PI * 13.5 * this.time));
		const absPulse = model.triggers && model.triggers.absPulse ?
			0.5 + 0.5 * Math.abs(Math.sin(TWO_PI * 15.5 * this.time)) :
			0;
		const leftNoise = 0.45 + 0.55 * this.nextNoise();
		const rightNoise = 0.45 + 0.55 * this.nextNoise();
		const centerBurst = this.gearPulse * 0.3 + this.collisionPulse * 0.85 + absPulse * 0.24;
		const engine = model.engine.amplitude * 1.7 * engineMod;
		const left = engine +
			model.left.slip * 0.58 * slipPulse +
			model.left.texture * 0.54 * leftNoise +
			centerBurst;
		const right = engine +
			model.right.slip * 0.58 * slipPulse +
			model.right.texture * 0.54 * rightNoise +
			centerBurst;

		this.gearPulse *= Math.exp(-dt / 0.085);
		this.collisionPulse *= Math.exp(-dt / 0.16);

		return {
			left: clamp(left * intensity, 0, 1),
			right: clamp(right * intensity, 0, 1),
		};
	}
}

export class DualSenseHaptics {
	constructor(onStatus = () => {}) {
		this.onStatus = onStatus;
		this.controller = null;
		this.context = null;
		this.graph = null;
		this.model = new DualSenseTelemetryModel();
		this.rumbleSynth = new HidRumbleSynth();
		this.enabled = false;
		this.pcmDebugEnabled = false;
		this.status = "locked";
		this.intensity = 0.65;
		this.lastRumbleUpdate = 0;
		this.lastTriggerSignature = "";
		this.diagnostics = {
			status: this.status,
			fallbackReason: "",
			webHid: typeof navigator !== "undefined" && Boolean(navigator.hid),
			audioContext: typeof window !== "undefined" && Boolean(window.AudioContext || window.webkitAudioContext),
			mediaDevices: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices),
			controllerRequested: false,
			controllerConnectionActive: false,
			controllerWireless: false,
			audioRoutingConfigured: false,
			hapticTransport: HAPTIC_TRANSPORT.unavailable,
			pcmDebugAvailable: false,
			pcmDebugEnabled: false,
			audioEnumeration: "not-started",
			audioOutputCount: 0,
			audioInputCount: 0,
			mediaDeviceCount: 0,
			mediaAudioOutputCount: 0,
			mediaAudioInputCount: 0,
			mediaLabelsRedacted: false,
			mediaAudioOutputs: [],
			audioOutputs: [],
			selectedSinkId: "",
			sinkStrategy: "",
			sinkError: "",
			summary: "DualSense haptics not started",
		};
	}

	setDiagnostic(updates = {}) {
		this.diagnostics = {
			...this.diagnostics,
			...updates,
			status: updates.status || this.status,
		};
	}

	getDiagnostics() {
		return {
			...this.diagnostics,
			controllerConnectionActive: Boolean(this.controller && this.controller.connection && this.controller.connection.active),
			controllerWireless: Boolean(this.controller && this.controller.wireless),
			pcmDebugEnabled: this.pcmDebugEnabled,
			status: this.status,
		};
	}

	logDiagnostics(label = "TORCS DualSense haptics diagnostics") {
		console.info(label, this.getDiagnostics());
	}

	setStatus(status, updates = {}) {
		this.status = status;
		this.setDiagnostic({ ...updates, status });
		this.onStatus(status, this.getDiagnostics());
	}

	async inspectMediaDevices() {
		if (typeof navigator === "undefined" ||
			!navigator.mediaDevices ||
			typeof navigator.mediaDevices.enumerateDevices !== "function") {
			this.setDiagnostic({
				mediaDeviceCount: 0,
				mediaAudioOutputCount: 0,
				mediaAudioInputCount: 0,
				mediaLabelsRedacted: false,
				mediaAudioOutputs: [],
			});
			return [];
		}
		const devices = await navigator.mediaDevices.enumerateDevices();
		const audioOutputs = devices.filter((device) => device.kind === "audiooutput");
		const audioInputs = devices.filter((device) => device.kind === "audioinput");
		const redacted = audioOutputs.length > 0 && audioOutputs.every((device) => !device.label);
		this.setDiagnostic({
			mediaDeviceCount: devices.length,
			mediaAudioOutputCount: audioOutputs.length,
			mediaAudioInputCount: audioInputs.length,
			mediaLabelsRedacted: redacted,
			mediaAudioOutputs: audioOutputs.map((output) => ({
				label: output.label || "",
				looksLikeDualSense: looksLikeDualSenseLabel(output.label),
				deviceId: output.deviceId ? "[available]" : "",
				groupId: output.groupId ? "[available]" : "",
			})),
		});
		return devices;
	}

	async requestAudioDeviceLabelAccess() {
		if (typeof navigator === "undefined" ||
			!navigator.mediaDevices ||
			typeof navigator.mediaDevices.getUserMedia !== "function") {
			this.setDiagnostic({
				summary: "Browser cannot request microphone permission to reveal audio device labels",
			});
			this.logDiagnostics("TORCS DualSense haptics label access unavailable");
			return this.getDiagnostics();
		}
		let stream = null;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			this.setDiagnostic({
				summary: "Audio device labels unlocked; retrying DualSense audio discovery",
			});
			await this.inspectMediaDevices();
			this.logDiagnostics("TORCS DualSense haptics after audio label access");
			return this.getDiagnostics();
		} catch (error) {
			this.setDiagnostic({
				sinkError: error && error.message ? error.message : String(error),
				summary: "Microphone permission was not granted, so audio device labels may remain hidden",
			});
			this.logDiagnostics("TORCS DualSense haptics label access failed");
			return this.getDiagnostics();
		} finally {
			if (stream) {
				for (const track of stream.getTracks()) {
					track.stop();
				}
			}
		}
	}

	setIntensity(intensity) {
		this.intensity = clamp(Number(intensity), 0, 1);
		if (this.graph) {
			this.graph.setIntensity(this.intensity);
		}
	}

	configureControllerAudio() {
		if (!this.controller || !this.controller.audio) {
			return;
		}
		try {
			this.controller.audio.setOutput(AudioOutput.Speaker);
			this.controller.audio.setSpeakerVolume(1);
			this.controller.audio.setHeadphoneVolume(0);
			this.controller.audio.muteSpeaker(false);
			this.controller.audio.muteHeadphone(true);
			if (this.controller.powerSave) {
				this.controller.powerSave.audio = true;
				this.controller.powerSave.haptics = true;
				this.controller.powerSave.hapticsMuted = false;
			}
			this.setDiagnostic({ audioRoutingConfigured: true });
		} catch (error) {
			this.setDiagnostic({
				audioRoutingConfigured: false,
				sinkError: error && error.message ? error.message : String(error),
			});
		}
	}

	configureControllerHaptics() {
		if (!this.controller || !this.controller.powerSave) {
			return;
		}
		try {
			this.controller.powerSave.haptics = true;
			this.controller.powerSave.hapticsMuted = false;
			this.setDiagnostic({
				hapticTransport: HAPTIC_TRANSPORT.hidRumble,
			});
		} catch (error) {
			this.setDiagnostic({
				sinkError: error && error.message ? error.message : String(error),
			});
		}
	}

	async waitForControllerConnection(timeoutMs = 1800) {
		const start = performance.now();
		while (performance.now() - start < timeoutMs) {
			if (this.controller && this.controller.connection && this.controller.connection.active) {
				return true;
			}
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		return Boolean(this.controller && this.controller.connection && this.controller.connection.active);
	}

	async requestController() {
		if (!this.controller) {
			this.controller = new Dualsense();
			if (this.controller.connection && typeof this.controller.connection.on === "function") {
				this.controller.connection.on("change", ({ active }) => {
					this.setDiagnostic({
						controllerConnectionActive: Boolean(active),
						controllerWireless: Boolean(this.controller.wireless),
					});
					if (!active && this.enabled) {
						this.setStatus("disconnected", {
							summary: "DualSense disconnected; waiting for reconnection",
						});
					} else if (active && this.enabled) {
						this.setStatus("active", {
							hapticTransport: HAPTIC_TRANSPORT.hidRumble,
							summary: "DualSense HID rumble haptics active",
						});
						this.applyTriggerFeedback(this.model.makeSilentModel());
					}
				});
			}
		}
		const provider = this.controller.hid && this.controller.hid.provider;
		if (provider && typeof provider.getRequest === "function") {
			const requestDevice = provider.getRequest();
			if (typeof requestDevice === "function") {
				await requestDevice();
			}
		} else if (provider && typeof provider.connect === "function") {
			await Promise.resolve(provider.connect());
		}
		await this.waitForControllerConnection();
		if (!this.controller.connection || !this.controller.connection.active) {
			throw new Error("DualSense HID connection was not activated");
		}
		this.setDiagnostic({
			controllerRequested: true,
			controllerConnectionActive: Boolean(this.controller.connection && this.controller.connection.active),
			controllerWireless: Boolean(this.controller.wireless),
		});
		return this.controller;
	}

	async createAudioContext() {
		const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextCtor) {
			this.setDiagnostic({
				fallbackReason: FALLBACK_REASONS.noAudioContext,
				summary: "Web Audio is unavailable for DualSense speaker PCM debug",
			});
			return null;
		}
		let outputs = [];
		let inputs = [];
		let mediaDevices = [];
		try {
			mediaDevices = await this.inspectMediaDevices();
			const devices = await findDualsenseAudioDevices();
			outputs = devices && Array.isArray(devices.outputs) ? devices.outputs : [];
			inputs = devices && Array.isArray(devices.inputs) ? devices.inputs : [];
			this.setDiagnostic({
				audioEnumeration: "ok",
				audioOutputCount: outputs.length,
				audioInputCount: inputs.length,
				pcmDebugAvailable: outputs.length > 0,
				audioOutputs: outputs.map((output) => ({
					label: output.label || "",
					deviceId: output.deviceId ? "[available]" : "",
					groupId: output.groupId ? "[available]" : "",
				})),
			});
		} catch (error) {
			console.warn("TORCS DualSense haptics could not enumerate DualSense audio devices", error);
			this.setDiagnostic({
				audioEnumeration: "error",
				fallbackReason: FALLBACK_REASONS.enumerationFailed,
				sinkError: error && error.message ? error.message : String(error),
				summary: "DualSense speaker PCM debug device enumeration failed",
			});
		}
		const sinkId = outputs.length ? outputs[0].deviceId : "";
		if (!sinkId) {
			if (this.diagnostics.mediaLabelsRedacted) {
				this.setDiagnostic({
					fallbackReason: FALLBACK_REASONS.audioLabelsRedacted,
					summary: "Audio output labels are hidden; run window.torcsHaptics.requestAudioDeviceLabelAccess() before enabling PCM debug",
				});
				return null;
			}
			const possibleDualSenseOutput = mediaDevices.some((device) =>
				device.kind === "audiooutput" && looksLikeDualSenseLabel(device.label));
			if (possibleDualSenseOutput) {
				this.setDiagnostic({
					fallbackReason: FALLBACK_REASONS.noDualSenseAudioOutput,
					summary: "A DualSense-like audio output was visible but dualsense-ts did not return it for PCM debug; inspect mediaAudioOutputs",
				});
				return null;
			}
			this.setDiagnostic({
				fallbackReason: FALLBACK_REASONS.noDualSenseAudioOutput,
				summary: "No DualSense USB speaker PCM debug output was found",
			});
			return null;
		}
		this.setDiagnostic({
			selectedSinkId: "[available]",
		});
		if (sinkId) {
			try {
				const context = new AudioContextCtor({ sinkId });
				this.setDiagnostic({
					sinkStrategy: "constructor-sinkId",
					fallbackReason: "",
					pcmDebugAvailable: true,
					summary: "DualSense speaker PCM debug active",
				});
				return context;
			} catch (constructorError) {
				const context = new AudioContextCtor();
				if (typeof context.setSinkId !== "function") {
					this.setDiagnostic({
						fallbackReason: FALLBACK_REASONS.sinkFailed,
						sinkStrategy: "unavailable",
						sinkError: constructorError && constructorError.message ? constructorError.message : String(constructorError),
						summary: "Browser could not route Web Audio to the DualSense speaker PCM debug output",
					});
					await context.close();
					return null;
				}
				try {
					await context.setSinkId(sinkId);
					this.setDiagnostic({
						sinkStrategy: "setSinkId",
						fallbackReason: "",
						pcmDebugAvailable: true,
						summary: "DualSense speaker PCM debug active",
					});
					return context;
				} catch (setSinkError) {
					this.setDiagnostic({
						fallbackReason: FALLBACK_REASONS.sinkFailed,
						sinkStrategy: "setSinkId-failed",
						sinkError: setSinkError && setSinkError.message ? setSinkError.message : String(setSinkError),
						summary: "Browser refused the DualSense speaker PCM debug output",
					});
					await context.close();
					return null;
				}
			}
		}
		return null;
	}

	async enablePcmDebug() {
		if (!this.controller || !this.controller.connection || !this.controller.connection.active) {
			await this.requestController();
		}
		if (!this.context) {
			this.context = await this.createAudioContext();
		}
		if (!this.context) {
			this.pcmDebugEnabled = false;
			this.setDiagnostic({
				pcmDebugEnabled: false,
			});
			return false;
		}
		this.configureControllerAudio();
		if (this.context.state !== "running") {
			await this.context.resume();
		}
		if (!this.graph) {
			this.graph = new HapticSynthGraph(this.context);
		}
		this.graph.setIntensity(this.intensity);
		this.pcmDebugEnabled = true;
		this.setDiagnostic({
			pcmDebugEnabled: true,
			pcmDebugAvailable: true,
			summary: "DualSense speaker PCM debug active",
		});
		this.logDiagnostics("TORCS DualSense PCM debug enabled");
		return true;
	}

	disablePcmDebug() {
		this.pcmDebugEnabled = false;
		this.disposeGraph();
		this.setDiagnostic({
			pcmDebugEnabled: false,
			summary: this.enabled ? "DualSense HID rumble haptics active" : "DualSense speaker PCM debug disabled",
		});
	}

	async enable() {
		this.setStatus("loading", {
			fallbackReason: "",
			sinkError: "",
			hapticTransport: HAPTIC_TRANSPORT.unavailable,
			summary: "Requesting DualSense HID access",
		});
		try {
			await this.requestController();
			this.enabled = true;
			this.model.reset();
			this.rumbleSynth.reset();
			this.configureControllerHaptics();
			this.setControllerLight(true);
			this.applyTriggerFeedback(this.model.makeSilentModel());
			this.setStatus("active", {
				fallbackReason: "",
				hapticTransport: HAPTIC_TRANSPORT.hidRumble,
				summary: "DualSense HID rumble haptics active",
			});
			this.logDiagnostics();
			return true;
		} catch (error) {
			this.enabled = false;
			this.setStatus("error", {
				sinkError: error && error.message ? error.message : String(error),
				summary: "DualSense haptics failed to start",
			});
			this.disposeGraph();
			this.logDiagnostics("TORCS DualSense haptics startup failed");
			throw error;
		}
	}

	disable() {
		this.enabled = false;
		this.stopControllerOutputs();
		this.disposeGraph();
		this.model.reset();
		this.rumbleSynth.reset();
		this.setStatus("off", {
			hapticTransport: HAPTIC_TRANSPORT.unavailable,
			summary: "DualSense haptics disabled",
		});
	}

	async reload() {
		if (!this.enabled) {
			return;
		}
		this.model.reset();
		this.rumbleSynth.reset();
		this.stopControllerOutputs();
		this.applyTriggerFeedback(this.model.makeSilentModel());
	}

	resetDynamics() {
		this.model.reset();
		this.rumbleSynth.reset();
		this.lastTriggerSignature = "";
	}

	disposeGraph() {
		if (this.graph) {
			this.graph.dispose();
			this.graph = null;
		}
		if (this.context) {
			this.context.close().catch(() => {});
			this.context = null;
		}
		this.pcmDebugEnabled = false;
	}

	setControllerLight(active) {
		try {
			if (this.controller && this.controller.lightbar) {
				this.controller.lightbar.set(active ? { r: 120, g: 189, b: 196 } : { r: 0, g: 0, b: 0 });
			}
		} catch (_) {
			// Lightbar support varies by connection state.
		}
	}

	stopControllerOutputs() {
		try {
			if (this.controller) {
				if (typeof this.controller.rumble === "function") {
					this.controller.rumble(0);
				}
				if (typeof this.controller.resetTriggerFeedback === "function") {
					this.controller.resetTriggerFeedback();
				}
			}
			this.setControllerLight(false);
		} catch (_) {
			// Output reset is best effort when the device disconnects.
		}
		this.lastTriggerSignature = "";
	}

	applyTriggerFeedback(model) {
		if (!this.controller || !model || !model.triggers) {
			return;
		}
		const signature = JSON.stringify(model.triggers);
		if (signature === this.lastTriggerSignature) {
			return;
		}
		this.lastTriggerSignature = signature;
		try {
			if (this.controller.right && this.controller.right.trigger && this.controller.right.trigger.feedback) {
				this.controller.right.trigger.feedback.set(model.triggers.throttle);
			}
			if (this.controller.left && this.controller.left.trigger && this.controller.left.trigger.feedback) {
				this.controller.left.trigger.feedback.set(model.triggers.brake);
			}
		} catch (error) {
			console.warn("TORCS DualSense haptics trigger feedback failed", error);
		}
	}

	updateRumble(model) {
		if (!this.controller || !model || !this.enabled) {
			return;
		}
		const now = performance.now();
		if (now - this.lastRumbleUpdate < 33) {
			return;
		}
		const rumbleDelta = this.lastRumbleUpdate > 0 ? (now - this.lastRumbleUpdate) / 1000 : model.deltaTime;
		this.lastRumbleUpdate = now;
		try {
			const rumble = this.rumbleSynth.update(model, this.intensity, rumbleDelta);
			if (this.controller.left && typeof this.controller.left.rumble === "function") {
				this.controller.left.rumble(rumble.left);
			}
			if (this.controller.right && typeof this.controller.right.rumble === "function") {
				this.controller.right.rumble(rumble.right);
			}
		} catch (error) {
			console.warn("TORCS DualSense haptics rumble synthesis failed", error);
		}
	}

	update(values, deltaTime = 1 / 60) {
		if (!this.enabled || !values) {
			return;
		}
		const model = this.model.update(values, deltaTime);
		if (this.pcmDebugEnabled && this.graph) {
			this.graph.update(model);
			if (model.transients.gear) {
				this.graph.playTransient({ left: 1, right: 1, gain: 0.58, duration: 0.038 });
			}
			if (model.transients.collision) {
				this.graph.playTransient({ left: 1, right: 1, gain: 0.9, duration: 0.055, frequency: 62 });
			}
		}
		this.updateRumble(model);
		this.applyTriggerFeedback(model);
	}
}
