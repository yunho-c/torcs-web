import * as THREE from "three/webgpu";
import {
	builtinAOContext,
	colorToDirection,
	directionToColor,
	mrt,
	normalView,
	output,
	pass,
	sample,
	screenUV,
	uniform,
	vec4,
	velocity,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { motionBlur } from "three/addons/tsl/display/MotionBlur.js";
import { warnOnce } from "./diagnostics.js";

const POSTPROCESS_PRESETS = new Set(["none", "race", "showroom"]);
const DEFAULT_RACE_OPTIONS = Object.freeze({
	bloom: 0.08,
	motionBlur: 0.45,
	ao: 0,
});
const DEFAULT_SHOWROOM_OPTIONS = Object.freeze({
	bloom: 0.08,
	motionBlur: 0,
	ao: 1,
});

function clamp(value, min, max, fallback) {
	if (value === null || value === undefined) {
		return fallback;
	}
	const number = Number(value);
	return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function normalizePostProcessPreset(preset, fallback = "none") {
	const normalized = String(preset || "").toLowerCase();
	if (normalized === "0" || normalized === "off" || normalized === "false") {
		return "none";
	}
	return POSTPROCESS_PRESETS.has(normalized) ? normalized : fallback;
}

export function getPostProcessPresetOverride() {
	const params = new URLSearchParams(window.location.search);
	if (!params.has("postprocess")) {
		return null;
	}
	return normalizePostProcessPreset(params.get("postprocess"), "none");
}

export function getPostProcessOptions(preset = "none") {
	const params = new URLSearchParams(window.location.search);
	const defaults = preset === "showroom" ? DEFAULT_SHOWROOM_OPTIONS : DEFAULT_RACE_OPTIONS;
	return {
		bloom: clamp(params.get("bloom"), 0, 3, defaults.bloom),
		motionBlur: clamp(params.get("motionBlur"), 0, 2, defaults.motionBlur),
		ao: clamp(params.get("ao"), 0, 2, defaults.ao),
	};
}

export class TorcsPostProcessPipeline {
	constructor(renderer, scene, camera = null, preset = "none", options = {}) {
		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.preset = normalizePostProcessPreset(preset, "none");
		this.options = {
			...getPostProcessOptions(this.preset),
			...options,
		};
		this.pipeline = null;
		this.disabled = false;
		this.disabledReason = "";
	}

	setCamera(camera) {
		if (camera === this.camera) {
			return;
		}
		this.camera = camera;
		this.pipeline = null;
	}

	setEnabled(enabled) {
		this.disabled = !enabled;
		if (this.disabled) {
			this.pipeline = null;
		}
	}

	setPreset(preset, options = {}) {
		const nextPreset = normalizePostProcessPreset(preset, "none");
		this.options = {
			...getPostProcessOptions(nextPreset),
			...options,
		};
		if (nextPreset === this.preset) {
			return;
		}
		this.preset = nextPreset;
		this.pipeline = null;
		this.disabled = false;
		this.disabledReason = "";
	}

	dispose() {
		this.pipeline = null;
	}

	render() {
		if (this.disabled || this.preset === "none" || !this.camera) {
			this.renderRaw();
			return;
		}

		try {
			this.ensurePipeline();
			this.pipeline.render();
		} catch (error) {
			this.disabled = true;
			this.disabledReason = error && error.message ? error.message : String(error);
			warnOnce("webgpu-postprocess-disabled", "TORCS WebGPU postprocessing disabled; falling back to raw rendering", {
				preset: this.preset,
				reason: this.disabledReason,
			});
			this.renderRaw();
		}
	}

	renderRaw() {
		if (this.camera) {
			this.renderer.render(this.scene, this.camera);
		}
	}

	ensurePipeline() {
		if (this.pipeline) {
			return;
		}
		if (!THREE.RenderPipeline) {
			throw new Error("THREE.RenderPipeline is unavailable");
		}
		if (this.preset === "race") {
			this.pipeline = this.createRacePipeline();
			return;
		}
		if (this.preset === "showroom") {
			this.pipeline = this.createShowroomPipeline();
			return;
		}
		throw new Error(`unsupported postprocess preset: ${this.preset}`);
	}

	createRacePipeline() {
		const scenePass = pass(this.scene, this.camera);
		scenePass.setMRT(mrt({ output, velocity }));
		const sceneColor = scenePass.getTextureNode("output");
		const motionVector = scenePass.getTextureNode("velocity").mul(uniform(this.options.motionBlur));
		let finalColor = this.options.motionBlur > 0
			? motionBlur(sceneColor, motionVector)
			: sceneColor;
		if (this.options.bloom > 0) {
			const bloomPass = bloom(sceneColor);
			bloomPass.strength.value = this.options.bloom;
			bloomPass.threshold.value = 0.78;
			bloomPass.radius.value = 0.18;
			finalColor = finalColor.add(bloomPass);
		}
		const vignette = screenUV.distance(0.5).remap(0.72, 1).mul(1.35).clamp().oneMinus();
		const pipeline = new THREE.RenderPipeline(this.renderer);
		pipeline.outputNode = vec4(finalColor.mul(vignette).rgb, finalColor.a);
		return pipeline;
	}

	createShowroomPipeline() {
		let scenePass = pass(this.scene, this.camera);
		let sceneColor = scenePass.getTextureNode();
		if (this.options.ao > 0) {
			const prePass = pass(this.scene, this.camera);
			prePass.name = "TORCS Showroom AO Pre-Pass";
			prePass.transparent = false;
			prePass.setMRT(mrt({ output: directionToColor(normalView), velocity }));
			const normalTexture = prePass.getTexture("output");
			normalTexture.type = THREE.UnsignedByteType;
			const prePassNormal = sample((uv) => {
				return colorToDirection(prePass.getTextureNode().sample(uv));
			});
			const prePassDepth = prePass.getTextureNode("depth");
			const aoPass = ao(prePassDepth, prePassNormal, this.camera);
			aoPass.resolutionScale = 0.5;
			aoPass.useTemporalFiltering = true;
			const aoNode = aoPass.getTextureNode().sample(screenUV).r;
			scenePass = pass(this.scene, this.camera);
			scenePass.contextNode = builtinAOContext(aoNode.mul(uniform(this.options.ao)));
			sceneColor = scenePass.getTextureNode();
		}
		let finalColor = sceneColor;
		if (this.options.bloom > 0) {
			const bloomPass = bloom(sceneColor);
			bloomPass.strength.value = this.options.bloom;
			bloomPass.threshold.value = 0.88;
			bloomPass.radius.value = 0.28;
			finalColor = finalColor.add(bloomPass);
		}
		const pipeline = new THREE.RenderPipeline(this.renderer);
		pipeline.outputNode = finalColor;
		return pipeline;
	}
}
