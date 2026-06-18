#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(process.argv[2] || ".");

function fail(message, details) {
	console.error(message);
	if (details) {
		console.error(JSON.stringify(details));
	}
	process.exit(1);
}

function read(relativePath) {
	const filePath = path.join(root, relativePath);
	if (!fs.existsSync(filePath)) {
		fail("TORCS web renderer smoke test missing file", { file: relativePath });
	}
	return fs.readFileSync(filePath, "utf8");
}

function requireText(file, text, label) {
	if (!file.content.includes(text)) {
		fail("TORCS web renderer smoke test missing expected content", {
			file: file.path,
			label,
		});
	}
}

function checkJavaScriptSyntax(file) {
	const result = childProcess.spawnSync(process.execPath, ["--input-type=module", "--check"], {
		encoding: "utf8",
		input: file.content,
	});
	if (result.status !== 0) {
		fail("TORCS web renderer smoke test found invalid JavaScript", {
			file: file.path,
			stdout: result.stdout.trim(),
			stderr: result.stderr.trim(),
		});
	}
}

function checkGlb(relativePath) {
	const filePath = path.join(root, "web-assets", relativePath);
	const data = fs.readFileSync(filePath);
	if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2) {
		fail("TORCS web renderer smoke test found invalid GLB", { file: relativePath });
	}
}

function checkPng(relativePath) {
	const filePath = path.join(root, "web-assets", relativePath);
	const data = fs.readFileSync(filePath);
	if (data.length < 8 || data[0] !== 0x89 || data.toString("ascii", 1, 4) !== "PNG") {
		fail("TORCS web renderer smoke test found invalid PNG", { file: relativePath });
	}
}

function checkWav(relativePath) {
	const filePath = path.join(root, "web-assets", relativePath);
	const data = fs.readFileSync(filePath);
	if (data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF" ||
		data.toString("ascii", 8, 12) !== "WAVE") {
		fail("TORCS web renderer smoke test found invalid WAV", { file: relativePath });
	}
}

function checkExr(relativePath) {
	const filePath = path.join(root, relativePath);
	const data = fs.readFileSync(filePath);
	if (data.length < 16 || data.readUInt32LE(0) !== 0x01312f76) {
		fail("TORCS web renderer smoke test found invalid EXR", { file: relativePath });
	}
}

function checkObjectNames(entry, label) {
	if (!Array.isArray(entry.objectNames) || entry.objectNames.length === 0 ||
		entry.objectNames.some((name) => typeof name !== "string" || name.length === 0)) {
		fail("TORCS web renderer smoke test found missing object names", { label });
	}
}

function checkMaterialMetadata(entry, expectedClasses, label) {
	if (!Array.isArray(entry.materialClasses) ||
		entry.materialClasses.some((name) => typeof name !== "string" || name.length === 0)) {
		fail("TORCS web renderer smoke test found malformed material classes", {
			label,
		});
	}
	for (const expectedClass of expectedClasses) {
		if (!entry.materialClasses.includes(expectedClass)) {
			fail("TORCS web renderer smoke test missing expected material class", {
				label,
				expectedClass,
				classes: entry.materialClasses,
			});
		}
	}
	if (!Array.isArray(entry.materials) || entry.materials.length < expectedClasses.length) {
		fail("TORCS web renderer smoke test found missing material records", {
			label,
		});
	}
	for (const material of entry.materials) {
		if (!material || typeof material.class !== "string" ||
			!Array.isArray(material.objectNames) || material.objectNames.length === 0) {
			fail("TORCS web renderer smoke test found malformed material record", {
				label,
				material,
			});
		}
	}
}

function checkNumberTriplet(entry, field, label) {
	if (!Array.isArray(entry[field]) || entry[field].length !== 3 ||
		entry[field].some((value) => typeof value !== "number" || !Number.isFinite(value))) {
		fail("TORCS web renderer smoke test found malformed track atmosphere metadata", {
			label,
			field,
		});
	}
}

function checkCarLights(entry, expectedTypes, label) {
	if (!Array.isArray(entry.lights)) {
		fail("TORCS web renderer smoke test found malformed car light metadata", { label });
	}
	for (const expectedType of expectedTypes) {
		if (!entry.lights.some((light) => light && light.type === expectedType)) {
			fail("TORCS web renderer smoke test missing expected car light type", {
				label,
				expectedType,
				lights: entry.lights,
			});
		}
	}
	for (const light of entry.lights) {
		if (!light || typeof light.type !== "string" ||
			!Array.isArray(light.position) || light.position.length !== 3 ||
			light.position.some((value) => typeof value !== "number" || !Number.isFinite(value)) ||
			typeof light.size !== "number" || !Number.isFinite(light.size) || light.size <= 0) {
			fail("TORCS web renderer smoke test found malformed car light", {
				label,
				light,
			});
		}
	}
}

function extendBounds(bounds, x, z) {
	bounds.minX = Math.min(bounds.minX, x);
	bounds.maxX = Math.max(bounds.maxX, x);
	bounds.minZ = Math.min(bounds.minZ, z);
	bounds.maxZ = Math.max(bounds.maxZ, z);
}

function readGlbJson(relativePath) {
	const filePath = path.join(root, "web-assets", relativePath);
	const data = fs.readFileSync(filePath);
	let offset = 12;
	while (offset < data.length) {
		const length = data.readUInt32LE(offset);
		const kind = data.toString("ascii", offset + 4, offset + 8);
		offset += 8;
		if (kind === "JSON") {
			return JSON.parse(data.subarray(offset, offset + length).toString("utf8"));
		}
		offset += length;
	}
	fail("TORCS web renderer smoke test could not find GLB JSON", { file: relativePath });
	return null;
}

function readPositionBounds(relativePath) {
	const gltf = readGlbJson(relativePath);
	const bounds = {
		minX: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		minZ: Number.POSITIVE_INFINITY,
		maxZ: Number.NEGATIVE_INFINITY,
	};
	for (const mesh of gltf.meshes || []) {
		for (const primitive of mesh.primitives || []) {
			const positionAccessor = gltf.accessors[primitive.attributes.POSITION];
			if (!positionAccessor || !positionAccessor.min || !positionAccessor.max) {
				fail("TORCS web renderer smoke test found GLB position accessor without bounds", {
					file: relativePath,
				});
			}
			extendBounds(bounds, positionAccessor.min[0], positionAccessor.min[2]);
			extendBounds(bounds, positionAccessor.max[0], positionAccessor.max[2]);
		}
	}
	if (!Number.isFinite(bounds.minX)) {
		fail("TORCS web renderer smoke test found GLB without position bounds", { file: relativePath });
	}
	return bounds;
}

async function importAudioModuleForSmoke() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "torcs-audio-smoke-"));
	const rendererDir = path.join(tempDir, "renderer");
	fs.mkdirSync(rendererDir, { recursive: true });
	try {
		const audioSource = byPath["renderer/audio.js"].content.replace(
			"import * as THREE from \"three/webgpu\";",
			`const THREE = {
\tVector3: class {
\t\tconstructor(x = 0, y = 0, z = 0) {
\t\t\tthis.x = x;
\t\t\tthis.y = y;
\t\t\tthis.z = z;
\t\t}
\t\tset(x, y, z) {
\t\t\tthis.x = x;
\t\t\tthis.y = y;
\t\t\tthis.z = z;
\t\t\treturn this;
\t\t}
\t},
};`,
		);
		fs.writeFileSync(path.join(tempDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
		fs.writeFileSync(path.join(rendererDir, "audio.js"), audioSource, "utf8");
		fs.writeFileSync(path.join(rendererDir, "runtime.js"), byPath["renderer/runtime.js"].content, "utf8");
		const tag = Date.now();
		const audioModule = await import(`${pathToFileURL(path.join(rendererDir, "audio.js")).href}?smoke=${tag}`);
		const runtimeModule = await import(`${pathToFileURL(path.join(rendererDir, "runtime.js")).href}?smoke=${tag}`);
		return {
			...audioModule,
			SNAPSHOT: runtimeModule.SNAPSHOT,
		};
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

async function importInputModuleForSmoke() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "torcs-input-smoke-"));
	const rendererDir = path.join(tempDir, "renderer");
	fs.mkdirSync(rendererDir, { recursive: true });
	try {
		fs.writeFileSync(path.join(tempDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
		fs.writeFileSync(path.join(rendererDir, "input.js"), byPath["renderer/input.js"].content, "utf8");
		fs.writeFileSync(path.join(rendererDir, "runtime.js"), byPath["renderer/runtime.js"].content, "utf8");
		const tag = Date.now();
		return await import(`${pathToFileURL(path.join(rendererDir, "input.js")).href}?smoke=${tag}`);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

function makeAudioSnapshot(SNAPSHOT, overrides = {}) {
	const values = new Array(193).fill(0);
	values[SNAPSHOT.x] = 10;
	values[SNAPSHOT.y] = 20;
	values[SNAPSHOT.z] = 1.5;
	values[SNAPSHOT.yaw] = Math.PI / 3;
	values[SNAPSHOT.speed] = 35;
	values[SNAPSHOT.engineRpm] = 3600;
	values[SNAPSHOT.engineRedline] = 7000;
	values[SNAPSHOT.controlAccel] = 0.8;
	values[SNAPSHOT.gearRatio] = 3.2;
	values[SNAPSHOT.engineSmoke] = 0.7;
	for (let i = 0; i < 4; i += 1) {
		values[SNAPSHOT.wheelRelX0 + i] = i < 2 ? 1.1 : -1.1;
		values[SNAPSHOT.wheelRelY0 + i] = i % 2 === 0 ? 0.7 : -0.7;
		values[SNAPSHOT.wheelRelZ0 + i] = -0.3;
		values[SNAPSHOT.wheelSkidIntensity0 + i] = i === 0 ? 0.42 : 0.02;
		values[SNAPSHOT.wheelSlipAccel0 + i] = 4;
		values[SNAPSHOT.wheelReaction0 + i] = 3200;
		values[SNAPSHOT.wheelRoughnessFrequency0 + i] = 1.2;
		values[SNAPSHOT.wheelRoughness0 + i] = 0.35;
		values[SNAPSHOT.wheelOtherSurfaceContribution0 + i] = 0;
		values[SNAPSHOT.wheelOtherSurfaceKind0 + i] = 0;
		values[SNAPSHOT.wheelOtherRoughnessFrequency0 + i] = 1;
		values[SNAPSHOT.wheelOtherRoughness0 + i] = 0.2;
		values[SNAPSHOT.wheelSurfaceStyle0 + i] = 0;
		values[SNAPSHOT.wheelOtherSurfaceStyle0 + i] = 0;
	}
	for (const [key, value] of Object.entries(overrides)) {
		values[SNAPSHOT[key]] = value;
	}
	return values;
}

function makeInputElement(value, min = "0", max = "1") {
	return {
		value: String(value),
		min,
		max,
		addEventListener() {},
	};
}

function makeInputElements() {
	return {
		steer: makeInputElement(0, "-1", "1"),
		accel: makeInputElement(0),
		brake: makeInputElement(0),
		clutch: makeInputElement(0),
		gear: makeInputElement(1, "-1", "5"),
	};
}

function makeInputSnapshot(time, speed) {
	const values = new Array(193).fill(0);
	values[0] = time;
	values[7] = speed;
	return values;
}

function makeGamepad({ axes = [], axis0 = 0, brake = 0, accel = 0, pressed = [] } = {}) {
	const buttons = Array.from({ length: 16 }, (_, index) => ({
		value: pressed.includes(index) ? 1 : 0,
	}));
	buttons[6].value = brake;
	buttons[7].value = accel;
	return {
		connected: true,
		axes: Array.from({ length: Math.max(8, axes.length) }, (_, index) => {
			const fallback = index === 0 ? axis0 : 0;
			return axes[index] ?? fallback;
		}),
		buttons,
	};
}

function assertInput(condition, label, details = {}) {
	if (!condition) {
		fail("TORCS web renderer smoke test found input behavior mismatch", {
			label,
			...details,
		});
	}
}

async function checkInputControllerBehavior() {
	const { InputController } = await importInputModuleForSmoke();
	const oldWindow = globalThis.window;
	globalThis.window = { addEventListener() {} };
	try {
		const changes = [];
		const elements = makeInputElements();
		const input = new InputController(elements, (controls) => changes.push({ ...controls }));

		input.keys.add("ArrowLeft");
		input.syncKeyboard(1 / 60, makeInputSnapshot(2, 0));
		const firstSteer = Number(elements.steer.value);
		assertInput(firstSteer < 0 && firstSteer > -0.05, "keyboard steering ramps instead of jumping", { firstSteer });
		input.syncKeyboard(1 / 60, makeInputSnapshot(2, 0));
		assertInput(Number(elements.steer.value) < firstSteer, "held keyboard steering accumulates", {
			firstSteer,
			secondSteer: Number(elements.steer.value),
		});

		input.keys.clear();
		input.syncKeyboard(0, makeInputSnapshot(2, 0));
		assertInput(Number(elements.steer.value) === 0, "keyboard steering release returns to neutral");

		input.keys.add("ArrowUp");
		input.syncKeyboard(1 / 60, makeInputSnapshot(2, 0));
		assertInput(Math.abs(Number(elements.accel.value) - 0.2) < 0.000001, "keyboard throttle uses TORCS digital slew limit", {
			accel: Number(elements.accel.value),
		});
		input.syncKeyboard(1 / 60, makeInputSnapshot(2, 0));
		assertInput(Math.abs(Number(elements.accel.value) - 0.4) < 0.000001, "keyboard throttle slew continues while held", {
			accel: Number(elements.accel.value),
		});

		input.keys.clear();
		input.syncKeyboard(0, makeInputSnapshot(2, 0));
		input.handleKey({
			code: "ArrowUp",
			repeat: false,
			preventDefault() {},
		}, true);
		assertInput(Number(elements.accel.value) === 0, "keydown records held pedal without applying an extra event-frame slew", {
			accel: Number(elements.accel.value),
		});
		input.update(1 / 60, makeInputSnapshot(2, 0));
		assertInput(Math.abs(Number(elements.accel.value) - 0.2) < 0.000001, "first frame after keydown uses one TORCS digital pedal slew step", {
			accel: Number(elements.accel.value),
		});
		input.handleKey({
			code: "KeyQ",
			repeat: false,
			preventDefault() {},
		}, false);
		assertInput(Math.abs(Number(elements.accel.value) - 0.2) < 0.000001, "unrelated key release does not increase held pedal", {
			accel: Number(elements.accel.value),
		});
		input.handleKey({
			code: "ArrowUp",
			repeat: false,
			preventDefault() {},
		}, false);
		input.handleKey({
			code: "KeyE",
			repeat: false,
			preventDefault() {},
		}, true);
		assertInput(Number(elements.gear.value) === 1, "keyboard upshift waits for native release edge", {
			gear: Number(elements.gear.value),
		});
		input.handleKey({
			code: "KeyE",
			repeat: false,
			preventDefault() {},
		}, false);
		assertInput(Number(elements.gear.value) === 2, "keyboard upshift applies on release", {
			gear: Number(elements.gear.value),
		});

		input.handleKey({
			code: "BracketLeft",
			shiftKey: false,
			repeat: false,
			preventDefault() {},
		}, true);
		assertInput(input.getCameraLookaround() === "left", "left lookaround key is held temporarily", {
			lookaround: input.getCameraLookaround(),
		});
		input.handleKey({
			code: "BracketRight",
			shiftKey: false,
			repeat: false,
			preventDefault() {},
		}, true);
		assertInput(input.getCameraLookaround() === "right", "right lookaround key overrides while held", {
			lookaround: input.getCameraLookaround(),
		});
		input.handleKey({
			code: "BracketRight",
			shiftKey: false,
			repeat: false,
			preventDefault() {},
		}, false);
		assertInput(input.getCameraLookaround() === "left", "lookaround release returns to previous held direction", {
			lookaround: input.getCameraLookaround(),
		});
		input.handleKey({
			code: "BracketLeft",
			shiftKey: false,
			repeat: false,
			preventDefault() {},
		}, false);
		input.handleKey({
			code: "BracketLeft",
			shiftKey: true,
			repeat: false,
			preventDefault() {},
		}, true);
		assertInput(input.getCameraLookaround() === "backLeft", "shift-left lookaround key uses rear-left 45 degree camera", {
			lookaround: input.getCameraLookaround(),
		});
		input.handleKey({
			code: "BracketRight",
			shiftKey: true,
			repeat: false,
			preventDefault() {},
		}, true);
		assertInput(input.getCameraLookaround() === "backRight", "shift-right lookaround key uses rear-right 45 degree camera", {
			lookaround: input.getCameraLookaround(),
		});
		input.handleKey({
			code: "BracketRight",
			shiftKey: true,
			repeat: false,
			preventDefault() {},
		}, false);
		assertInput(input.getCameraLookaround() === "backLeft", "shift lookaround release returns to previous held 45 degree direction", {
			lookaround: input.getCameraLookaround(),
		});
		input.handleKey({
			code: "BracketLeft",
			shiftKey: true,
			repeat: false,
			preventDefault() {},
		}, false);
		input.handleKey({
			code: "Backslash",
			shiftKey: false,
			repeat: false,
			preventDefault() {},
		}, true);
		assertInput(input.getCameraLookaround() === "front", "front lookaround key is held temporarily", {
			lookaround: input.getCameraLookaround(),
		});
		input.handleKey({
			code: "Backslash",
			shiftKey: false,
			repeat: false,
			preventDefault() {},
		}, false);
		assertInput(input.getCameraLookaround() === "", "lookaround release returns to normal camera", {
			lookaround: input.getCameraLookaround(),
		});

		const idleElements = makeInputElements();
		const idleInput = new InputController(idleElements, () => {});
		const oldNavigator = globalThis.navigator;
		globalThis.navigator = {};
		try {
			idleInput.update(1 / 60, makeInputSnapshot(2, 0));
			idleInput.handleKey({
				code: "ArrowUp",
				repeat: false,
				preventDefault() {},
			}, true);
			assertInput(Number(idleElements.accel.value) === 0, "idle keydown waits for the frame update before applying pedal slew", {
				accel: Number(idleElements.accel.value),
			});
			idleInput.update(1 / 60, makeInputSnapshot(2, 0));
			assertInput(Math.abs(Number(idleElements.accel.value) - 0.2) < 0.000001, "idle keydown uses cached race time for pedal slew", {
				accel: Number(idleElements.accel.value),
			});
		} finally {
			globalThis.navigator = oldNavigator;
		}

		const keyboardWithIdleGamepadElements = makeInputElements();
		const keyboardWithIdleGamepad = new InputController(keyboardWithIdleGamepadElements, () => {});
		keyboardWithIdleGamepad.getGamepad = () => makeGamepad();
		keyboardWithIdleGamepad.keys.add("ArrowLeft");
		keyboardWithIdleGamepad.update(1 / 60, makeInputSnapshot(2, 0));
		const idleGamepadSteer = Number(keyboardWithIdleGamepadElements.steer.value);
		assertInput(idleGamepadSteer < 0 && idleGamepadSteer > -0.05, "idle connected gamepad does not suppress keyboard steering", {
			idleGamepadSteer,
		});

		const keyboardWithRightStickElements = makeInputElements();
		const keyboardWithRightStick = new InputController(keyboardWithRightStickElements, () => {});
		keyboardWithRightStick.getGamepad = () => makeGamepad({ axes: [0, 0, 0.65, -0.4] });
		keyboardWithRightStick.keys.add("ArrowLeft");
		keyboardWithRightStick.update(1 / 60, makeInputSnapshot(2, 0));
		const rightStickDriftSteer = Number(keyboardWithRightStickElements.steer.value);
		assertInput(rightStickDriftSteer < 0 && rightStickDriftSteer > -0.05, "unmapped gamepad axes do not suppress keyboard steering", {
			rightStickDriftSteer,
		});
		const rightStickLook = keyboardWithRightStick.getCameraLookaround();
		assertInput(rightStickLook && rightStickLook.type === "gamepad" && rightStickLook.x > 0 && rightStickLook.y < 0,
			"right stick creates analog camera lookaround while keyboard drives", {
				rightStickLook,
			});

		const gamepadLookElements = makeInputElements();
		const gamepadLookInput = new InputController(gamepadLookElements, () => {});
		let lookGamepad = makeGamepad({ axes: [0, 0, -0.7, 0.45] });
		gamepadLookInput.getGamepad = () => lookGamepad;
		assertInput(gamepadLookInput.update(1 / 60, makeInputSnapshot(2, 0)), "right stick alone updates camera lookaround state");
		const analogLook = gamepadLookInput.getCameraLookaround();
		assertInput(analogLook && analogLook.type === "gamepad" && analogLook.x < 0 && analogLook.y > 0 && analogLook.front === false,
			"right stick axes are exposed as smooth camera lookaround", {
				analogLook,
			});
		assertInput(Number(gamepadLookElements.steer.value) === 0 &&
			Number(gamepadLookElements.accel.value) === 0 &&
			Number(gamepadLookElements.brake.value) === 0,
		"right stick alone does not change driving controls", {
			steer: Number(gamepadLookElements.steer.value),
			accel: Number(gamepadLookElements.accel.value),
			brake: Number(gamepadLookElements.brake.value),
		});
		lookGamepad = makeGamepad({ pressed: [11] });
		gamepadLookInput.update(1 / 60, makeInputSnapshot(2, 0));
		const frontLook = gamepadLookInput.getCameraLookaround();
		assertInput(frontLook && frontLook.type === "gamepad" && frontLook.front === true,
			"right stick press toggles front lookaround", {
				frontLook,
			});
		gamepadLookInput.update(1 / 60, makeInputSnapshot(2, 0));
		const heldFrontLook = gamepadLookInput.getCameraLookaround();
		assertInput(heldFrontLook && heldFrontLook.front === true, "held right stick press does not repeat toggle", {
			heldFrontLook,
		});
		lookGamepad = makeGamepad();
		gamepadLookInput.update(1 / 60, makeInputSnapshot(2, 0));
		lookGamepad = makeGamepad({ axes: [0, 0, 0.3, -0.3], pressed: [11] });
		gamepadLookInput.update(1 / 60, makeInputSnapshot(2, 0));
		const blendedFrontLook = gamepadLookInput.getCameraLookaround();
		assertInput(blendedFrontLook && blendedFrontLook.type === "gamepad" && blendedFrontLook.front === false &&
			blendedFrontLook.x > 0 && blendedFrontLook.y < 0,
		"second right stick press toggles front off while preserving analog look", {
			blendedFrontLook,
		});
		lookGamepad = makeGamepad({ axes: [0, 0, 0.6, 0] });
		gamepadLookInput.handleKey({
			code: "BracketLeft",
			shiftKey: false,
			repeat: false,
			preventDefault() {},
		}, true);
		assertInput(gamepadLookInput.getCameraLookaround() === "left", "keyboard lookaround overrides gamepad lookaround", {
			lookaround: gamepadLookInput.getCameraLookaround(),
		});
		gamepadLookInput.handleKey({
			code: "BracketLeft",
			shiftKey: false,
			repeat: false,
			preventDefault() {},
		}, false);

		input.keys.add("ArrowLeft");
		input.syncKeyboard(0.2, makeInputSnapshot(2, 0));
		const lowSpeedSteer = Math.abs(Number(elements.steer.value));
		input.keys.clear();
		input.syncKeyboard(0, makeInputSnapshot(2, 0));
		input.keys.add("ArrowLeft");
		input.syncKeyboard(0.2, makeInputSnapshot(2, 100));
		const highSpeedSteer = Math.abs(Number(elements.steer.value));
		assertInput(highSpeedSteer < lowSpeedSteer, "keyboard steering is speed-sensitive", {
			lowSpeedSteer,
			highSpeedSteer,
		});

		input.keys.clear();
		input.syncKeyboard(0, makeInputSnapshot(2, 0));
		elements.gear.value = "1";
		input.updateGamepad(makeGamepad({ axis0: 0.54, brake: 0.35, accel: 0.8, pressed: [5] }));
		const shapedSteer = Number(elements.steer.value);
		assertInput(shapedSteer > 0.2 && shapedSteer < 0.54, "gamepad steering applies dead-zone and sensitivity", {
			shapedSteer,
		});
		assertInput(Math.abs(Number(elements.accel.value) - 0.8) < 0.000001, "gamepad right trigger controls throttle", {
			accel: Number(elements.accel.value),
		});
		assertInput(Math.abs(Number(elements.brake.value) - 0.35) < 0.000001, "gamepad left trigger controls brake", {
			brake: Number(elements.brake.value),
		});
		input.updateGamepad(makeGamepad({ axes: [0, 0, 0, 0, 0.42, 0.73], brake: 1, accel: 1, pressed: [5] }));
		assertInput(Math.abs(Number(elements.accel.value) - 0.73) < 0.000001, "gamepad trigger axis fallback controls throttle depth", {
			accel: Number(elements.accel.value),
		});
		assertInput(Math.abs(Number(elements.brake.value) - 0.42) < 0.000001, "gamepad trigger axis fallback controls brake depth", {
			brake: Number(elements.brake.value),
		});
		const throttleLeakElements = makeInputElements();
		const throttleLeakInput = new InputController(throttleLeakElements, () => {});
		throttleLeakInput.updateGamepad(makeGamepad({ axes: [0, 0, 0, 0, 0, 0, 0.66, 0.42], brake: 1 }));
		assertInput(Number(throttleLeakElements.accel.value) === 0,
			"brake button suppresses stray throttle-axis fallback", {
				accel: Number(throttleLeakElements.accel.value),
			});
		assertInput(Math.abs(Number(throttleLeakElements.brake.value) - 0.42) < 0.000001,
			"brake button still allows brake-axis fallback depth", {
				brake: Number(throttleLeakElements.brake.value),
			});
		const brakeLeakElements = makeInputElements();
		const brakeLeakInput = new InputController(brakeLeakElements, () => {});
		brakeLeakInput.updateGamepad(makeGamepad({ axes: [0, 0, 0, 0, 0.42, 0, 0.66, 0.44], accel: 1 }));
		assertInput(Math.abs(Number(brakeLeakElements.accel.value) - 0.66) < 0.000001,
			"throttle button still allows throttle-axis fallback depth", {
				accel: Number(brakeLeakElements.accel.value),
			});
		assertInput(Number(brakeLeakElements.brake.value) === 0,
			"throttle button suppresses stray brake-axis fallback", {
				brake: Number(brakeLeakElements.brake.value),
			});
		const signedTriggerElements = makeInputElements();
		const signedTriggerInput = new InputController(signedTriggerElements, () => {});
		signedTriggerInput.updateGamepad(makeGamepad({ axes: [0, 0, 0, 0, 0, 0, -1, -1] }));
		signedTriggerInput.updateGamepad(makeGamepad({ axes: [0, 0, 0, 0, 0, 0, 0.5, 0] }));
		assertInput(Math.abs(Number(signedTriggerElements.brake.value) - 0.5) < 0.000001,
			"signed gamepad trigger axis fallback normalizes brake depth", {
				brake: Number(signedTriggerElements.brake.value),
			});
		assertInput(Math.abs(Number(signedTriggerElements.accel.value) - 0.75) < 0.000001,
			"signed gamepad trigger axis fallback normalizes throttle depth", {
				accel: Number(signedTriggerElements.accel.value),
			});
		const triggerNoiseInput = new InputController(makeInputElements(), () => {});
		assertInput(!triggerNoiseInput.hasGamepadInput(makeGamepad({ axes: [0, 0, 0, 0, 0.01, 0.01] })),
			"gamepad trigger axis fallback ignores idle noise");
		const rightStickOnlyElements = makeInputElements();
		const rightStickOnlyInput = new InputController(rightStickOnlyElements, () => {});
		rightStickOnlyInput.updateGamepad(makeGamepad({ axes: [0, 0, 0.65, -0.65] }));
		assertInput(Number(rightStickOnlyElements.accel.value) === 0 && Number(rightStickOnlyElements.brake.value) === 0,
			"right stick axes are not treated as trigger fallbacks", {
				accel: Number(rightStickOnlyElements.accel.value),
				brake: Number(rightStickOnlyElements.brake.value),
			});
		assertInput(Number(elements.gear.value) === 1, "gamepad shoulder waits for native release edge", {
			gear: Number(elements.gear.value),
		});
		input.updateGamepad(makeGamepad({ pressed: [5] }));
		assertInput(Number(elements.gear.value) === 1, "held gamepad shift button does not repeat", {
			gear: Number(elements.gear.value),
		});
		input.updateGamepad(makeGamepad());
		assertInput(Number(elements.gear.value) === 2, "gamepad shoulder upshifts on release", {
			gear: Number(elements.gear.value),
		});
		input.updateGamepad(makeGamepad({ pressed: [4] }));
		assertInput(Number(elements.gear.value) === 2, "gamepad shoulder downshift waits for release", {
			gear: Number(elements.gear.value),
		});
		input.updateGamepad(makeGamepad());
		assertInput(Number(elements.gear.value) === 1, "gamepad shoulder downshifts on release", {
			gear: Number(elements.gear.value),
		});

		const disconnectElements = makeInputElements();
		const disconnectInput = new InputController(disconnectElements, () => {});
		let connectedGamepad = makeGamepad({ axis0: 0.8, accel: 0.75 });
		disconnectInput.getGamepad = () => connectedGamepad;
		disconnectInput.update(1 / 60, makeInputSnapshot(2, 0));
		assertInput(Number(disconnectElements.accel.value) > 0, "active gamepad controls apply before disconnect", {
			accel: Number(disconnectElements.accel.value),
		});
		connectedGamepad = null;
		disconnectInput.update(1 / 60, makeInputSnapshot(2, 0));
		assertInput(Number(disconnectElements.steer.value) === 0 && Number(disconnectElements.accel.value) === 0 &&
			Number(disconnectElements.brake.value) === 0, "disconnecting an active gamepad releases controls", {
			steer: Number(disconnectElements.steer.value),
			accel: Number(disconnectElements.accel.value),
			brake: Number(disconnectElements.brake.value),
		});

		const heldShiftDisconnectElements = makeInputElements();
		const heldShiftDisconnectInput = new InputController(heldShiftDisconnectElements, () => {});
		connectedGamepad = makeGamepad({ pressed: [5] });
		heldShiftDisconnectInput.getGamepad = () => connectedGamepad;
		heldShiftDisconnectInput.update(1 / 60, makeInputSnapshot(2, 0));
		assertInput(Number(heldShiftDisconnectElements.gear.value) === 1, "gamepad shift waits for release before disconnect", {
			gear: Number(heldShiftDisconnectElements.gear.value),
		});
		connectedGamepad = null;
		heldShiftDisconnectInput.update(1 / 60, makeInputSnapshot(2, 0));
		connectedGamepad = makeGamepad({ pressed: [5] });
		heldShiftDisconnectInput.update(1 / 60, makeInputSnapshot(2, 0));
		assertInput(Number(heldShiftDisconnectElements.gear.value) === 1, "gamepad shift latch clears on disconnect without stale release", {
			gear: Number(heldShiftDisconnectElements.gear.value),
		});
		connectedGamepad = makeGamepad();
		heldShiftDisconnectInput.update(1 / 60, makeInputSnapshot(2, 0));
		assertInput(Number(heldShiftDisconnectElements.gear.value) === 2, "reconnected gamepad shift releases once", {
			gear: Number(heldShiftDisconnectElements.gear.value),
		});

		return {
			changes: changes.length,
			firstSteer,
			shapedSteer,
		};
	} finally {
		globalThis.window = oldWindow;
	}
}

function assertAudio(condition, label, details = {}) {
	if (!condition) {
		fail("TORCS web renderer smoke test found audio model behavior mismatch", {
			label,
			...details,
		});
	}
}

async function checkAudioModelBehavior() {
	const audioModule = await importAudioModuleForSmoke();
	const { CarAudioModel, SNAPSHOT } = audioModule;
	const carSound = {
		rpmScale: 1.2,
		turbo: true,
		turboRpm: 100,
		turboLag: 1,
	};

	const activeModel = new CarAudioModel();
	const active = activeModel.update(makeAudioSnapshot(SNAPSHOT), carSound);
	assertAudio(active.engine.volume > 0, "active engine loop", active.engine);
	assertAudio(Math.abs(active.engine.pitch - 7.2) < 0.000001, "engine pitch follows rpm scale", active.engine);
	assertAudio(active.roadRide.volume > 0, "active road ride loop", active.roadRide);
	assertAudio(active.backfireLoop.volume > 0, "active backfire loop", active.backfireLoop);

	const eventModel = new CarAudioModel();
	const eventValues = makeAudioSnapshot(SNAPSHOT, {
		gearChangeEvent: 1,
		collisionEvent: 31,
	});
	const eventState = eventModel.update(eventValues, carSound);
	const eventNames = eventState.events.map((event) => event.name).sort();
	assertAudio(eventState.metalSkid.volume > 0, "latched drag collision loop", eventState.metalSkid);
	for (const name of ["bang", "bottomCrash", "crash", "gearChange"]) {
		assertAudio(eventNames.includes(name), "latched one-shot event", { name, eventNames });
	}

	const repeatedDragCrashModel = new CarAudioModel();
	const firstDragImpact = repeatedDragCrashModel.update(makeAudioSnapshot(SNAPSHOT, {
		collisionEvent: 3,
	}), carSound);
	const continuedDragImpact = repeatedDragCrashModel.update(makeAudioSnapshot(SNAPSHOT, {
		collisionEvent: 3,
	}), carSound);
	assertAudio(
		firstDragImpact.events.some((event) => event.name === "crash"),
		"new drag collision crash event",
		{ events: firstDragImpact.events },
	);
	assertAudio(
		!continuedDragImpact.events.some((event) => event.name === "crash"),
		"continued drag collision suppresses repeated crash",
		{ events: continuedDragImpact.events },
	);

	const mixedModel = new CarAudioModel();
	const mixedValues = makeAudioSnapshot(SNAPSHOT, {
		wheelOtherSurfaceContribution0: 0.4,
		wheelOtherSurfaceKind0: 1,
		wheelOtherRoughnessFrequency0: 1.8,
		wheelOtherRoughness0: 0.9,
		wheelSurfaceStyle0: 1,
	});
	const mixed = mixedModel.update(mixedValues, carSound);
	assertAudio(mixed.roadRide.volume > 0, "mixed surface road loop", mixed.roadRide);
	assertAudio(mixed.grassRide.volume > 0, "mixed surface dirt loop", mixed.grassRide);
	assertAudio(mixed.grassSkid.volume > 0, "mixed surface dirt skid", mixed.grassSkid);
	assertAudio(mixed.curbRide.volume > 0, "curb style loop", mixed.curbRide);
	assertAudio(mixed.skidTyres[0].volume > 0, "wheel skid loop", mixed.skidTyres[0]);

	const stationaryTyres = new CarAudioModel().update(makeAudioSnapshot(SNAPSHOT, {
		speed: 0.2,
	}), carSound);
	assertAudio(stationaryTyres.engine.volume > 0, "stationary engine remains audible", stationaryTyres.engine);
	assertAudio(stationaryTyres.roadRide.volume === 0, "stationary road ride is gated", stationaryTyres.roadRide);
	assertAudio(stationaryTyres.skidTyres.every((tyre) => tyre.volume === 0), "stationary tyre skid is gated", {
		skidTyres: stationaryTyres.skidTyres,
	});

	const spinningTyres = new CarAudioModel().update(makeAudioSnapshot(SNAPSHOT, {
		speed: 0,
		wheelSpinVelocity0: 1,
	}), carSound);
	assertAudio(spinningTyres.skidTyres[0].volume > 0, "wheel spin bypasses stationary tyre gate", spinningTyres.skidTyres[0]);

	const mutedModel = new CarAudioModel();
	mutedModel.update(makeAudioSnapshot(SNAPSHOT, {
		gearChangeEvent: 1,
		collisionEvent: 31,
	}), carSound);
	const muted = mutedModel.update(makeAudioSnapshot(SNAPSHOT, {
		state: 1,
		gearChangeEvent: 1,
		collisionEvent: 31,
	}), carSound);
	assertAudio(muted.engine.volume === 0, "no-simulation engine mute", muted.engine);
	assertAudio(muted.turbo.volume === 0, "no-simulation turbo mute", muted.turbo);
	assertAudio(muted.backfireLoop.volume === 0, "no-simulation backfire mute", muted.backfireLoop);
	assertAudio(muted.metalSkid.volume === 0, "no-simulation collision mute", muted.metalSkid);
	assertAudio(muted.events.length === 0, "no-simulation event mute", { events: muted.events });

	return {
		enginePitch: active.engine.pitch,
		events: eventNames,
	};
}

async function checkTrackAlignment(trackAsset) {
	const createModule = require(path.join(root, "torcs_web_probe.js"));
	const module = await createModule({
		locateFile: (file) => path.join(root, file),
	});
	const sampleBounds = {
		minX: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		minZ: Number.POSITIVE_INFINITY,
		maxZ: Number.NEGATIVE_INFINITY,
	};

	try {
		const start = module.ccall(
			"torcs_web_runtime_start_with_files",
			"number",
			["string", "string"],
			[
				"/torcs/data/tracks/e-track-1/e-track-1.xml",
				"/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml",
			],
		);
		if (start !== 0) {
			fail("TORCS web renderer smoke test could not start alignment runtime", { start });
		}

		const sampleCount = module.ccall("torcs_web_runtime_get_track_sample_count", "number", [], []);
		for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
			for (const side of [0, 2]) {
				const x = module.ccall(
					"torcs_web_runtime_get_track_sample_x",
					"number",
					["number", "number"],
					[sampleIndex, side],
				);
				const y = module.ccall(
					"torcs_web_runtime_get_track_sample_y",
					"number",
					["number", "number"],
					[sampleIndex, side],
				);
				extendBounds(sampleBounds, x, -y);
			}
		}
		if (!Number.isFinite(sampleBounds.minX)) {
			fail("TORCS web renderer smoke test found no track samples");
		}
	} finally {
		module.ccall("torcs_web_runtime_shutdown", null, [], []);
	}

	const glbBounds = readPositionBounds(trackAsset);
	const tolerance = 2.0;
	const containsSamples =
		glbBounds.minX <= sampleBounds.minX + tolerance &&
		glbBounds.maxX >= sampleBounds.maxX - tolerance &&
		glbBounds.minZ <= sampleBounds.minZ + tolerance &&
		glbBounds.maxZ >= sampleBounds.maxZ - tolerance;
	if (!containsSamples) {
		fail("TORCS web renderer smoke test found converted track/sample bounds mismatch", {
			trackAsset,
			glbBounds,
			sampleBounds,
			tolerance,
		});
	}
	return { glbBounds, sampleBounds };
}

async function checkMultiCarModelMetadata() {
	const createModule = require(path.join(root, "torcs_web_probe.js"));
	const module = await createModule({
		locateFile: (file) => path.join(root, file),
	});
	try {
		const start = module.ccall(
			"torcs_web_runtime_start_multi_with_files",
			"number",
			["string", "string", "number"],
			[
				"/torcs/data/tracks/e-track-1/e-track-1.xml",
				"/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml",
				4,
			],
		);
		if (start !== 0) {
			fail("TORCS web renderer smoke test could not start multi-car runtime", { start });
		}
		const models = [];
		const drivers = [];
		for (let carIndex = 0; carIndex < 4; carIndex += 1) {
			models.push(module.ccall("torcs_web_runtime_get_car_model_name_by_index", "string", ["number"], [carIndex]));
			drivers.push(module.ccall("torcs_web_runtime_get_car_name_by_index", "string", ["number"], [carIndex]));
		}
		if (models[0] !== "kc-2000gt" || models[1] !== "kc-a110" || new Set(models).size < 3) {
			fail("TORCS web renderer smoke test found malformed multi-car model metadata", { models, drivers });
		}
		if (drivers[1] === models[1]) {
			fail("TORCS web renderer smoke test found model metadata collapsed into driver display name", { models, drivers });
		}
		return { models, drivers };
	} finally {
		module.ccall("torcs_web_runtime_shutdown", null, [], []);
	}
}

const files = [
	"../CMakeLists.txt",
	"torcs_web_renderer.html",
	"renderer/main.js",
	"renderer/diagnostics.js",
	"renderer/assets.js",
	"renderer/runtime.js",
	"renderer/scene.js",
	"renderer/effects.js",
	"renderer/audio.js",
	"renderer/cameras.js",
	"renderer/input.js",
	"renderer/hud.js",
].map((relativePath) => ({
	path: relativePath,
	content: read(relativePath),
}));

const byPath = Object.fromEntries(files.map((file) => [file.path, file]));
files
	.filter((file) => file.path.endsWith(".js"))
	.forEach(checkJavaScriptSyntax);

requireText(byPath["torcs_web_renderer.html"], "./torcs_web_probe.js", "WASM probe script");
requireText(byPath["torcs_web_renderer.html"], "./renderer/main.js", "renderer module entrypoint");
requireText(byPath["torcs_web_renderer.html"], "\"three\"", "Three.js import map");
requireText(byPath["torcs_web_renderer.html"], "three@0.183.0/build/three.webgpu.js", "WebGPU three.js import map");
requireText(byPath["torcs_web_renderer.html"], "\"three/webgpu\"", "Three.js WebGPU import map");
requireText(byPath["torcs_web_renderer.html"], "\"three/tsl\"", "Three.js TSL import map");
requireText(byPath["torcs_web_renderer.html"], "\"three/addons/\"", "Three.js addons import map");
requireText(byPath["torcs_web_renderer.html"], "<option value=\"trackside\">Trackside</option>", "trackside camera UI option");
requireText(byPath["torcs_web_renderer.html"], "id=\"audio\"", "audio unlock button");
requireText(byPath["torcs_web_renderer.html"], "id=\"volume\"", "audio volume slider");
requireText(byPath["torcs_web_renderer.html"], "id=\"audio-state\"", "audio status readout");
requireText(byPath["torcs_web_renderer.html"], "id=\"track-map\"", "Phase 5 track map canvas");
requireText(byPath["torcs_web_renderer.html"], "id=\"car-count\"", "Phase 6 car count control");
requireText(byPath["torcs_web_renderer.html"], "id=\"current-car\"", "Phase 6 current car selector");
requireText(byPath["torcs_web_renderer.html"], "id=\"standings\"", "Phase 6 standings panel");
requireText(byPath["torcs_web_renderer.html"], "id=\"render-profile\"", "render profile selector");
requireText(byPath["torcs_web_renderer.html"], "id=\"light-intensity\"", "light intensity slider");
requireText(byPath["torcs_web_renderer.html"], "id=\"light-intensity-value\"", "light intensity value readout");
requireText(byPath["torcs_web_renderer.html"], "<option value=\"legacy\" selected>Legacy</option>", "legacy render profile default");
requireText(byPath["torcs_web_renderer.html"], "<option value=\"modern\">Modern</option>", "modern render profile option");
for (const id of ["position", "fuel", "current-lap", "last-lap", "best-lap", "top-speed"]) {
	requireText(byPath["torcs_web_renderer.html"], `id="${id}"`, `Phase 5 HUD field ${id}`);
}

requireText(byPath["renderer/assets.js"], "GLTFLoader", "GLTF loader import");
requireText(byPath["renderer/assets.js"], "TextureLoader", "texture loader import");
requireText(byPath["renderer/assets.js"], "./web-assets/", "asset manifest base path");
requireText(byPath["renderer/assets.js"], "export class AssetManager", "asset manager export");
requireText(byPath["renderer/assets.js"], "Promise.all(entry.lods.map", "all car LOD loading");
requireText(byPath["renderer/assets.js"], "entry.backgroundTexture", "track background texture loading");
requireText(byPath["renderer/assets.js"], "async loadEffects()", "effect texture loading");
requireText(byPath["renderer/assets.js"], "manifest.effects && manifest.effects.textures", "effect texture manifest lookup");
requireText(byPath["renderer/assets.js"], "shadowTexture", "car shadow texture loading");
requireText(byPath["renderer/assets.js"], "typeof this.renderer.getMaxAnisotropy === \"function\"", "WebGPU renderer anisotropy capability");
requireText(byPath["renderer/assets.js"], "typeof caps.getMaxAnisotropy === \"function\"", "guarded renderer anisotropy capability");
requireText(byPath["renderer/assets.js"], "this.carCache = new Map()", "cached car visual asset storage");
requireText(byPath["renderer/assets.js"], "resolveCarPathByModelName(modelName)", "runtime car model name manifest resolver");
requireText(byPath["renderer/assets.js"], "loadCarAssetsForSnapshots(snapshots = [], fallbackCarPath = \"\")", "per-snapshot car visual asset loading");
requireText(byPath["renderer/assets.js"], "texture.anisotropy = Math.max(1, this.getMaxAnisotropy())", "anisotropic texture sampling");
requireText(byPath["renderer/assets.js"], "texture.minFilter = THREE.LinearMipmapLinearFilter", "mipmapped distant texture filtering");
requireText(byPath["renderer/assets.js"], "new THREE.MeshLambertMaterial", "legacy matte material conversion");
requireText(byPath["renderer/assets.js"], "setRenderProfile(profile)", "asset render profile setter");
requireText(byPath["renderer/assets.js"], "makeModernMaterial(material, context = {})", "modern material adapter entrypoint");
requireText(byPath["renderer/assets.js"], "torcsMaterialClass", "remaster material metadata lookup");
requireText(byPath["renderer/assets.js"], "makeModernClassMaterial(material, materialClass, context = {})", "modern material class adapter");
requireText(byPath["renderer/assets.js"], "CAR_PBR_DEFAULTS", "car PBR material defaults");
requireText(byPath["renderer/assets.js"], "body: Object.freeze({ metalness: 0.75, roughness: 0.1, ior: 1.5, opacity: 1.0 })", "body PBR defaults");
requireText(byPath["renderer/assets.js"], "glass: Object.freeze({ metalness: 0.75, roughness: 0.025, ior: 1.5, opacity: 0.5 })", "glass PBR defaults");
requireText(byPath["renderer/assets.js"], "headlamp: Object.freeze({ metalness: 0.0, roughness: 0.025, ior: 1.5, opacity: 0.05 })", "headlamp PBR defaults");
requireText(byPath["renderer/assets.js"], "taillamp: Object.freeze({ metalness: 0.0, roughness: 0.1, ior: 1.5, opacity: 1.0 })", "taillamp PBR defaults");
requireText(byPath["renderer/assets.js"], "exhaust: Object.freeze({ metalness: 0.9, roughness: 0.1, ior: 1.5, opacity: 1.0 })", "exhaust PBR defaults");
requireText(byPath["renderer/assets.js"], "case \"road\":", "modern track road material class");
requireText(byPath["renderer/assets.js"], "case \"treeFoliage\":", "modern track tree material class");
requireText(byPath["renderer/assets.js"], "MeshPhysicalMaterial", "modern physical material support");
requireText(byPath["renderer/assets.js"], "materialMask", "car material mask loading");
requireText(byPath["renderer/assets.js"], "loadDataTexture(relativePath)", "material mask data texture loading");
requireText(byPath["renderer/assets.js"], "clearcoatMap: remasterMaterialMask", "paint clearcoat mask binding");
requireText(byPath["renderer/assets.js"], "roughnessMap: remasterMaterialMask", "paint roughness mask binding");
requireText(byPath["renderer/assets.js"], "torcsOverlayRole === \"trackShadow\"", "track shadow overlay material detection");
requireText(byPath["renderer/assets.js"], "makeTrackShadowOverlayMaterial(material)", "track shadow overlay material adapter");
requireText(byPath["renderer/assets.js"], "new THREE.MeshBasicMaterial", "unlit track shadow overlay material");
requireText(byPath["renderer/assets.js"], "polygonOffset: true", "track shadow overlay z-fighting guard");
requireText(byPath["renderer/assets.js"], "const source = normalizeRuntimePath(carPath)", "car asset source path annotation");
requireText(byPath["renderer/assets.js"], "const asset = { entry: carEntry, lods, wheelAsset, shadowTexture, materialMask }", "loaded car entry source metadata");
requireText(byPath["renderer/assets.js"], "entry.wheelAsset.states.map", "detailed wheel asset loading");
requireText(byPath["renderer/assets.js"], "case \"wheelTire\":", "modern wheel tire material class");
requireText(byPath["renderer/assets.js"], "case \"wheelRim\":", "modern wheel rim material class");
requireText(byPath["renderer/assets.js"], "return this.makeLegacyMaterial(material)", "modern profile preserves legacy visual baseline");
requireText(byPath["renderer/assets.js"], "TORCS web renderer failed to load track background texture", "background texture load warning");
requireText(byPath["renderer/diagnostics.js"], "export function warnOnce", "one-shot warning helper export");
requireText(byPath["renderer/diagnostics.js"], "emittedWarnings.has(key)", "one-shot warning dedupe");
requireText(byPath["renderer/main.js"], "TORCS web renderer using runtime sampled track geometry fallback", "track visual fallback warning");
requireText(byPath["renderer/main.js"], "TORCS web renderer using generated car box and wheel fallback", "car visual fallback warning");
requireText(byPath["renderer/main.js"], "populateAssetSelects()", "manifest-driven asset select discovery");
requireText(byPath["renderer/main.js"], "Object.entries(entries || {})", "manifest asset option enumeration");
requireText(byPath["renderer/main.js"], "DEFAULT_TRACK_PATH", "default track selection preservation");
requireText(byPath["renderer/main.js"], "DEFAULT_CAR_PATH", "default car selection preservation");
requireText(byPath["renderer/main.js"], "const DEFAULT_LIGHT_INTENSITY = 1.5", "default light intensity tuning");
requireText(byPath["renderer/main.js"], "getInitialRenderProfile()", "query-string render profile initialization");
requireText(byPath["renderer/main.js"], "params.get(\"profile\")", "render profile query parameter");
requireText(byPath["renderer/main.js"], "getInitialLightIntensity()", "query-string light intensity initialization");
requireText(byPath["renderer/main.js"], "params.get(\"lightIntensity\")", "light intensity query parameter");

requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_get_snapshot_size", "snapshot size export");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_write_snapshot", "snapshot write export");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_start_multi_with_files", "Phase 6 multi-car runtime start export");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_get_car_count", "Phase 6 car count export");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_write_car_snapshot", "Phase 6 per-car snapshot export");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_get_car_model_name_by_index", "runtime car model-name call");
requireText(byPath["renderer/runtime.js"], "values.carModelName = this.getCarModelName(i)", "snapshot car model-name metadata");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_get_car_driver_kind", "robot driver-kind runtime call");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_get_car_driver_module", "robot driver-module runtime call");
requireText(byPath["renderer/runtime.js"], "torcs_web_runtime_get_car_driver_robot_index", "robot driver-index runtime call");
requireText(byPath["renderer/runtime.js"], "driverLabel", "browser driver metadata label");
requireText(byPath["renderer/runtime.js"], "readSnapshots()", "Phase 6 multi-car snapshot reader");
requireText(byPath["renderer/runtime.js"], "Float64Array.from(values)", "Phase 6 copied per-car snapshot buffer");
requireText(byPath["renderer/runtime.js"], "export const SNAPSHOT", "snapshot layout export");
requireText(byPath["renderer/runtime.js"], "shadowX0: 175", "native shadow X snapshot offset");
requireText(byPath["renderer/runtime.js"], "shadowY0: 181", "native shadow Y snapshot offset");
requireText(byPath["renderer/runtime.js"], "shadowZ0: 187", "native shadow Z snapshot offset");
requireText(byPath["renderer/runtime.js"], "export class TorcsRuntime", "runtime adapter export");

requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_start_multi_with_files'", "Phase 6 multi-car Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_count'", "Phase 6 car-count Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_name_by_index'", "Phase 6 car-name Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_model_name_by_index'", "car model-name Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_driver_kind'", "robot driver-kind Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_driver_module'", "robot driver-module Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_driver_robot_index'", "robot driver-index Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_driver_new_track_count'", "robot new-track count Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_driver_new_race_count'", "robot new-race count Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_get_car_driver_drive_count'", "robot drive count Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_runtime_write_car_snapshot'", "Phase 6 per-car snapshot Emscripten export");
requireText(byPath["../CMakeLists.txt"], "torcs_inferno2", "inferno2 static driver target");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_check_inferno2_module'", "inferno2 module-check Emscripten export");
requireText(byPath["../CMakeLists.txt"], "'_torcs_web_check_inferno2_setup_data'", "inferno2 setup-data Emscripten export");
requireText(byPath["../CMakeLists.txt"], "TORCS_WEB_CAR_CATEGORY_CONFIGS", "car category XML preload discovery");
requireText(byPath["../CMakeLists.txt"], "TORCS_WEB_INFERNO2_CONFIGS", "inferno2 XML preload discovery");
requireText(byPath["../CMakeLists.txt"], "TORCS_WEB_TRACK_CONFIGS", "dynamic track XML preload discovery");
requireText(byPath["../CMakeLists.txt"], "TORCS_WEB_CAR_CONFIGS", "dynamic car XML preload discovery");

requireText(byPath["renderer/runtime.js"], "wheelSkidIntensity0: 116", "Phase 4 skid snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelSurfaceKind0: 120", "Phase 5 wheel surface snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelReaction0: 124", "Phase 5 wheel reaction snapshot field");
requireText(byPath["renderer/runtime.js"], "exhaustCount: 129", "Phase 5 exhaust snapshot field");
requireText(byPath["renderer/runtime.js"], "velocityX: 137", "audio velocity snapshot field");
requireText(byPath["renderer/runtime.js"], "gearRatio: 140", "audio gear ratio snapshot field");
requireText(byPath["renderer/runtime.js"], "gearChangeEvent: 141", "audio gear-change event snapshot field");
requireText(byPath["renderer/runtime.js"], "collisionEvent: 142", "audio collision event snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelRoughnessFrequency0: 143", "audio wheel roughness snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelOtherSurfaceContribution0: 151", "audio mixed-surface snapshot field");
requireText(byPath["renderer/runtime.js"], "wheelSurfaceStyle0: 167", "audio wheel surface style snapshot field");
requireText(byPath["renderer/runtime.js"], "lightCommand: 113", "Phase 4 light snapshot field");
requireText(byPath["renderer/runtime.js"], "collision: 114", "Phase 4 collision snapshot field");

requireText(byPath["renderer/main.js"], "createTorcsRuntime", "runtime factory import");
requireText(byPath["renderer/main.js"], "import { TorcsAudio } from \"./audio.js\"", "audio runtime import");
requireText(byPath["renderer/main.js"], "new AssetManager", "asset manager creation");
requireText(byPath["renderer/main.js"], "new TorcsAudio(\"./web-assets/\"", "audio runtime creation");
requireText(byPath["renderer/main.js"], "new AssetManager(\"./web-assets/\", scene.renderer, activeRenderProfile)", "asset render profile handoff");
requireText(byPath["renderer/main.js"], "audio.enabled ? \"Stop\" : \"Audio\"", "audio button start/stop label");
requireText(byPath["renderer/main.js"], "scene = await TorcsScene.create(elements.canvas)", "async WebGPU scene creation");
requireText(byPath["renderer/main.js"], "scene.setRenderProfile(activeRenderProfile)", "scene render profile handoff");
requireText(byPath["renderer/main.js"], "scene.setLightIntensityScale(activeLightIntensity)", "scene light intensity handoff");
requireText(byPath["renderer/main.js"], "elements.renderProfile.addEventListener", "render profile selector binding");
requireText(byPath["renderer/main.js"], "applyRenderProfile(elements.renderProfile.value, true)", "render profile visual asset reload");
requireText(byPath["renderer/main.js"], "elements.lightIntensity.addEventListener", "light intensity slider binding");
requireText(byPath["renderer/main.js"], "runtime.readTrackSamples()", "track sample ingestion");
requireText(byPath["renderer/main.js"], "runtime.readSnapshots()", "Phase 6 snapshot array ingestion");
requireText(byPath["renderer/main.js"], "scene.updateCars(snapshots, cameras.camera, selectedCarIndex, carAssets)", "Phase 6 selected-car scene update with per-car visual assets");
requireText(byPath["renderer/main.js"], "loadCarAssetsForSnapshots(snapshots, elements.car.value)", "runtime car model visual asset loading");
requireText(byPath["renderer/main.js"], "TORCS web renderer using selected car visual fallback for runtime car model", "per-car visual fallback warning");
requireText(byPath["renderer/main.js"], "findSnapshotByCarIndex(selectedCarIndex)", "Phase 6 selected-car snapshot lookup");
requireText(byPath["renderer/main.js"], "elements.currentCar.addEventListener", "Phase 6 current-car selector binding");
requireText(byPath["renderer/main.js"], "elements.carCount.value", "Phase 6 car count startup control");
requireText(byPath["renderer/main.js"], "scene.setTrackAtmosphere(track ? track.entry : null, track ? track.backgroundTexture : null)", "track atmosphere handoff");
requireText(byPath["renderer/main.js"], "assets.loadEffects()", "effect texture asset loading");
requireText(byPath["renderer/main.js"], "scene.setEffectTextures(effects ? effects.textures : null)", "effect texture scene handoff");
requireText(byPath["renderer/main.js"], "audio.update(snapshot, cameras.camera, deltaTime)", "snapshot-driven audio update");
requireText(byPath["renderer/main.js"], "audio.enable(elements.car.value)", "user-gesture audio unlock");
requireText(byPath["renderer/main.js"], "hud.setTrack(trackSamples)", "Phase 5 HUD track-map handoff");
requireText(byPath["renderer/main.js"], "input.update(deltaTime, snapshot)", "TORCS-faithful per-frame input polling");
requireText(byPath["renderer/main.js"], "input ? input.getCameraLookaround() : \"\"", "temporary camera lookaround handoff");

requireText(byPath["renderer/hud.js"], "fmtTime(value)", "Phase 5 lap time formatting");
requireText(byPath["renderer/hud.js"], "setTrack(track)", "Phase 5 track map setup");
requireText(byPath["renderer/hud.js"], "drawMap(values, snapshots = [], selectedCarIndex = 0)", "Phase 6 multi-car track map rendering");
requireText(byPath["renderer/hud.js"], "updateStandings(snapshots, selectedCarIndex)", "Phase 6 standings rendering");
requireText(byPath["renderer/hud.js"], "car.driverName", "Phase 6 standings driver names");
requireText(byPath["renderer/hud.js"], "SNAPSHOT.fuel", "Phase 5 fuel HUD snapshot field");
requireText(byPath["renderer/hud.js"], "SNAPSHOT.currentLapTime", "Phase 5 current lap HUD snapshot field");
requireText(byPath["renderer/hud.js"], "SNAPSHOT.racePosition", "Phase 5 race position HUD snapshot field");

requireText(byPath["renderer/input.js"], "navigator.getGamepads", "Phase 5 browser gamepad API");
requireText(byPath["renderer/input.js"], "updateGamepad(", "Phase 5 gamepad control update");
requireText(byPath["renderer/input.js"], "KEYBOARD_STEER_SPEED_SENSITIVITY", "TORCS keyboard speed-sensitive steering");
requireText(byPath["renderer/input.js"], "DIGITAL_PEDAL_INC_RATE", "TORCS digital pedal slew rate");
requireText(byPath["renderer/input.js"], "GAMEPAD_GEAR_BUTTONS", "DualSense-compatible gamepad gear buttons");
requireText(byPath["renderer/input.js"], "this.setRangeValue(this.elements.steer, axis(0))", "Phase 5 gamepad steering");
requireText(byPath["renderer/input.js"], "this.changeGear(delta)", "Phase 5 gamepad gear buttons");
requireText(byPath["renderer/input.js"], "\"BracketLeft\", \"left\"", "left camera lookaround key");
requireText(byPath["renderer/input.js"], "\"BracketRight\", \"right\"", "right camera lookaround key");
requireText(byPath["renderer/input.js"], "\"BracketLeft\", \"backLeft\"", "shift-left rear diagonal camera lookaround key");
requireText(byPath["renderer/input.js"], "\"BracketRight\", \"backRight\"", "shift-right rear diagonal camera lookaround key");
requireText(byPath["renderer/input.js"], "\"Backslash\", \"front\"", "front camera lookaround key");
requireText(byPath["renderer/input.js"], "getCameraLookaround()", "temporary camera lookaround state");
requireText(byPath["renderer/input.js"], "const GAMEPAD_LOOK_X_AXIS = 2", "right stick horizontal lookaround axis");
requireText(byPath["renderer/input.js"], "const GAMEPAD_LOOK_Y_AXIS = 3", "right stick vertical lookaround axis");
requireText(byPath["renderer/input.js"], "const GAMEPAD_LOOK_BUTTON = 11", "right stick press look-from-front toggle");
requireText(byPath["renderer/input.js"], "updateGamepadLook(gamepad = this.getGamepad())", "gamepad camera lookaround polling");

requireText(byPath["renderer/audio.js"], "export class TorcsAudio", "audio runtime export");
requireText(byPath["renderer/audio.js"], "export class AudioAssets", "audio asset loader export");
requireText(byPath["renderer/audio.js"], "export class CarAudioModel", "native car sound model export");
requireText(byPath["renderer/audio.js"], "context.createPanner()", "positional Web Audio source");
requireText(byPath["renderer/audio.js"], "const AUDIO_ROLLOFF_FACTOR = 0.05", "reduced distance audio attenuation");
requireText(byPath["renderer/audio.js"], "panner.rolloffFactor = AUDIO_ROLLOFF_FACTOR", "shared positional audio rolloff");
requireText(byPath["renderer/audio.js"], "context.createBiquadFilter()", "engine low-pass filter");
requireText(byPath["renderer/audio.js"], "decodeAudioData", "manifest sample decoding");
requireText(byPath["renderer/audio.js"], "this.enabled = false;\n\t\t\tthis.raceAudio = null;\n\t\t\tconst raceAudio", "stale audio state cleared before asset load");
requireText(byPath["renderer/audio.js"], "this.setStatus(\"error\")", "audio load failure status");
requireText(byPath["renderer/audio.js"], "this.setStatus(\"off\")", "audio stop status");
requireText(byPath["renderer/audio.js"], "RM_CAR_STATE_NO_SIMU", "native no-simulation mute mask");
requireText(byPath["renderer/audio.js"], "SNAPSHOT.state", "car state audio mute input");
requireText(byPath["renderer/audio.js"], "SNAPSHOT.gearChangeEvent", "latched gear-change event use");
requireText(byPath["renderer/audio.js"], "SNAPSHOT.collisionEvent", "latched collision event use");
requireText(byPath["renderer/audio.js"], "SNAPSHOT.wheelOtherSurfaceContribution0", "mixed-surface audio use");
requireText(byPath["renderer/audio.js"], "SNAPSHOT.wheelSurfaceStyle0", "curb style audio use");

requireText(byPath["renderer/scene.js"], "import * as THREE from \"three/webgpu\"", "Three.js WebGPU module import");
requireText(byPath["renderer/scene.js"], "import { TorcsEffects } from \"./effects.js\"", "effects module import");
requireText(byPath["renderer/scene.js"], "new THREE.WebGPURenderer", "WebGPU renderer creation");
requireText(byPath["renderer/scene.js"], "await renderer.init()", "async WebGPU renderer initialization");
requireText(byPath["renderer/scene.js"], "return new THREE.Line(geometry, material)", "WebGPU-compatible closed line primitive");
requireText(byPath["renderer/scene.js"], "forceWebGL: params.get(\"renderer\") === \"webgl\"", "forced WebGL fallback option");
requireText(byPath["renderer/scene.js"], "EXRLoader", "HDRI EXR loader import");
requireText(byPath["renderer/scene.js"], "120_hdrmaps_com_free_2K.exr", "canonical HDRI environment asset");
requireText(byPath["renderer/scene.js"], "new THREE.PMREMGenerator(this.renderer)", "HDRI PMREM generation");
requireText(byPath["renderer/scene.js"], "this.scene.environment = this.environmentMap", "HDRI environment map binding");
requireText(byPath["renderer/scene.js"], "new THREE.BoxGeometry", "simulated car box");
requireText(byPath["renderer/scene.js"], "makeRoadMesh(track)", "sampled track road mesh");
requireText(byPath["renderer/scene.js"], "setTrackVisual(model)", "converted track mesh hook");
requireText(byPath["renderer/scene.js"], "setTrackAtmosphere(entry, backgroundTexture = null)", "track atmosphere hook");
requireText(byPath["renderer/scene.js"], "setRenderProfile(profile)", "scene render profile setter");
requireText(byPath["renderer/scene.js"], "setLightIntensityScale(scale)", "interactive light intensity setter");
requireText(byPath["renderer/scene.js"], "DEFAULT_AMBIENT_INTENSITY * this.lightIntensityScale", "scaled ambient intensity");
requireText(byPath["renderer/scene.js"], "DEFAULT_SUN_INTENSITY * this.lightIntensityScale", "scaled sun intensity");
requireText(byPath["renderer/scene.js"], "this.renderProfile = \"legacy\"", "legacy scene render profile default");
requireText(byPath["renderer/scene.js"], "backgroundColor.clone().multiplyScalar(0.8)", "native fog color scaling");
requireText(byPath["renderer/scene.js"], "const FOG_NEAR = 300", "linear TORCS fog start");
requireText(byPath["renderer/scene.js"], "const FOG_FAR = 1200", "reduced linear TORCS fog range");
requireText(byPath["renderer/scene.js"], "new THREE.Fog(fogColor, FOG_NEAR, FOG_FAR)", "linear TORCS fog range");
requireText(byPath["renderer/scene.js"], "const BACKGROUND_RADIUS = 500", "clipping-safe panoramic backdrop radius");
requireText(byPath["renderer/scene.js"], "const BACKGROUND_HEIGHT = BACKGROUND_RADIUS * 2", "native type-4 panoramic backdrop proportions");
requireText(byPath["renderer/scene.js"], "const BACKGROUND_VERTICAL_BIAS = 0", "camera-centered panoramic backdrop");
requireText(byPath["renderer/scene.js"], "texture.repeat.set(-1, 1)", "native background horizontal orientation");
requireText(byPath["renderer/scene.js"], "TORCS web renderer track background texture is configured but unavailable", "missing configured background warning");
requireText(byPath["renderer/scene.js"], "TORCS web renderer skipped background dome because no texture was provided", "background dome skipped warning");
requireText(byPath["renderer/scene.js"], "new THREE.CylinderGeometry(", "background dome geometry");
requireText(byPath["renderer/scene.js"], "camera.position.y + BACKGROUND_HEIGHT * BACKGROUND_VERTICAL_BIAS", "camera-following sky backdrop");
requireText(byPath["renderer/scene.js"], "color: 0xffffff", "unlit untinted background texture");
requireText(byPath["renderer/scene.js"], "torcsToThree(entry.lightPosition[0], entry.lightPosition[1], entry.lightPosition[2])", "track light position conversion");
requireText(byPath["renderer/scene.js"], "setCarVisual(asset)", "converted car LOD hook");
requireText(byPath["renderer/scene.js"], "setCarVisualAssets(assetsByCarIndex = new Map(), fallbackAsset = null)", "per-car visual asset map hook");
requireText(byPath["renderer/scene.js"], "getCarAssetForIndex(carIndex)", "car-index visual asset lookup");
requireText(byPath["renderer/scene.js"], "updateCars(snapshots, camera = null, selectedCarIndex = 0, assetsByCarIndex = this.carAssets)", "Phase 6 multi-car scene update");
requireText(byPath["renderer/scene.js"], "createOpponentCar(values, carIndex)", "Phase 6 opponent car creation");
requireText(byPath["renderer/scene.js"], "getOpponentColor(carIndex)", "Phase 6 car-zero opponent color");
requireText(byPath["renderer/scene.js"], "getSnapshotCarIndex(values, index) === selectedCarIndex", "Phase 6 selected car primary visual");
requireText(byPath["renderer/scene.js"], "asset.lods", "opponent uses assigned car asset LODs");
requireText(byPath["renderer/scene.js"], "tintClone(item.scene, opponent.color)", "Phase 6 distinct opponent car visual tint");
requireText(byPath["renderer/scene.js"], "setObjectQuaternionFromTorcsPosMat(opponent.root, values)", "Phase 6 opponent pose matrix conversion");
requireText(byPath["renderer/scene.js"], "selectOpponentLod(opponent, camera)", "Phase 6 opponent LOD switching");
requireText(byPath["renderer/scene.js"], "this.carEffects = []", "Phase 6 per-car effect state registry");
requireText(byPath["renderer/scene.js"], "getCarEffects(carIndex)", "Phase 6 car-index effect lookup");
requireText(byPath["renderer/scene.js"], "effects: this.getCarEffects(carIndex)", "Phase 6 opponent uses car-index effect state");
requireText(byPath["renderer/scene.js"], "if (i !== selectedIndex)", "Phase 6 selected effect visibility survives opponent hiding");
requireText(byPath["renderer/scene.js"], "opponent.effects.update(values, opponent.root, camera)", "Phase 6 opponent effect snapshot update");
requireText(byPath["renderer/effects.js"], "setVisible(visible)", "Phase 6 effect visibility control");
requireText(byPath["renderer/scene.js"], "export { getTorcsPoseQuaternion, torcsToThree }", "shared TORCS pose export");
requireText(byPath["renderer/scene.js"], "createGeneratedWheels(values)", "generated wheel fallback");
requireText(byPath["renderer/scene.js"], "createDetailedWheels(values", "detailed wheel asset rig");
requireText(byPath["renderer/scene.js"], "getWheelSpeedState(values, index", "native wheel speed-state selection");
requireText(byPath["renderer/scene.js"], "const WHEEL_SPEED_THRESHOLDS = [20, 40, 70]", "native wheel speed thresholds");
requireText(byPath["renderer/scene.js"], "wheel.scale.scale.set(radius * 2, radius * 2, width)", "native wheel radius and width scaling");
requireText(byPath["renderer/scene.js"], "RIGHT_WHEELS.has(index)", "right-side detailed wheel flip");
requireText(byPath["renderer/scene.js"], "TORCS web renderer using runtime generated wheels for car LOD", "selected car generated wheel warning");
requireText(byPath["renderer/scene.js"], "TORCS web renderer using runtime generated wheels for opponent car LOD", "opponent generated wheel warning");
requireText(byPath["renderer/scene.js"], "setObjectQuaternionFromTorcsPosMat(this.car, values)", "car body pose matrix conversion");
requireText(byPath["renderer/scene.js"], "CAR_ROTATION_MATRIX.multiplyMatrices(TORCS_TO_THREE_BASIS, TORCS_POS_MATRIX)", "TORCS-to-Three body basis conversion");
requireText(byPath["renderer/scene.js"], "wheelBrakeTemp0", "brake heat wheel feedback");
requireText(byPath["renderer/scene.js"], "wheel.camber.rotation.x", "wheel camber transform node");
requireText(byPath["renderer/scene.js"], "wheel.spin.rotation.z = -(values[SNAPSHOT.wheelSpinAngle0 + index] || 0)", "wheel spin transform node");
requireText(byPath["renderer/scene.js"], "selectCarLod(camera)", "deterministic car LOD switching");
requireText(byPath["renderer/scene.js"], "getCarLodFactor(camera, this.car.position", "TORCS-style car LOD factor");
requireText(byPath["renderer/scene.js"], "lodFactor >= item.lod.threshold", "native car LOD threshold comparison");
requireText(byPath["renderer/scene.js"], "next.lod.wheels !== false", "LOD wheel visibility flag");
requireText(byPath["renderer/scene.js"], "skidMarks: new THREE.Group()", "skid-mark scene group");
requireText(byPath["renderer/scene.js"], "carLights: new THREE.Group()", "car-light scene group");
requireText(byPath["renderer/scene.js"], "smoke: new THREE.Group()", "smoke/fire scene group");
requireText(byPath["renderer/scene.js"], "this.effects = this.createCarEffects(0)", "effects layer creation");
requireText(byPath["renderer/scene.js"], "effects.resetDynamics()", "effects reset on new track/session");
requireText(byPath["renderer/scene.js"], "this.effects.update(values, this.car, camera)", "snapshot-driven effects update");
if (byPath["renderer/scene.js"].content.includes("this.car.rotation.set(values[SNAPSHOT.pitch]")) {
	fail("TORCS web renderer smoke test found scalar Euler car body orientation");
}
if (byPath["renderer/scene.js"].content.includes("WebGLRenderer")) {
	fail("TORCS web renderer smoke test found legacy WebGLRenderer creation");
}
if (byPath["renderer/scene.js"].content.includes("LineLoop")) {
	fail("TORCS web renderer smoke test found unsupported WebGPU LineLoop usage");
}
if (byPath["renderer/effects.js"].content.includes("CircleGeometry")) {
	fail("TORCS web renderer smoke test found fixed circular car shadow geometry");
}

requireText(byPath["renderer/effects.js"], "export class TorcsEffects", "effects layer export");
requireText(byPath["renderer/effects.js"], "createShadow()", "height-adaptive car shadow effect");
requireText(byPath["renderer/effects.js"], "new THREE.BufferGeometry()", "dynamic car shadow geometry");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.shadowX0", "native shadow vertex snapshot use");
requireText(byPath["renderer/effects.js"], "SHADOW_POINT_COUNT", "native six-point shadow strip");
requireText(byPath["renderer/effects.js"], "createSkidMarks()", "dynamic skid-mark strips");
requireText(byPath["renderer/effects.js"], "updateSmoke(values, car, time, deltaTime)", "smoke sprite update");
requireText(byPath["renderer/effects.js"], "updateFire(values, car, time, deltaTime)", "exhaust fire sprite update");
requireText(byPath["renderer/effects.js"], "updateLights(values, car)", "head rear brake light sprites");
requireText(byPath["renderer/effects.js"], "asset.entry ? asset.entry.lights : []", "manifest-driven car light metadata handoff");
requireText(byPath["renderer/effects.js"], "this.assetLightSprites.length > 0", "authored car light sprite path");
requireText(byPath["renderer/effects.js"], "torcsToThree(light.position[0], light.position[1], light.position[2])", "TORCS car light coordinate conversion");
requireText(byPath["renderer/effects.js"], "getCarLightOpacity(record.type, lightCommand, brake)", "authored car light state mapping");
requireText(byPath["renderer/effects.js"], "updateCollision(values, car, time)", "collision feedback hook");
requireText(byPath["renderer/effects.js"], "resetDynamics()", "dynamic effect lifecycle reset");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.wheelSkidIntensity0", "skid snapshot field use");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.wheelSurfaceKind0", "surface-aware effect use");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.wheelReaction0", "reaction-aware smoke use");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.exhaustCount", "native exhaust metadata use");
requireText(byPath["renderer/effects.js"], "this.previousEngineLevel - engineLevel", "native RPM-drop fire trigger");
requireText(byPath["renderer/effects.js"], "makeSlipVelocity(car, accelSlip, sideSlip, horizontalScale, verticalSpeed)", "car-oriented smoke particle velocity");
requireText(byPath["renderer/effects.js"], "velocity: new THREE.Vector3().copy(world).sub(car.position).normalize().multiplyScalar(0.035)", "independent exhaust fire velocity vector");
requireText(byPath["renderer/effects.js"], "textures[\"grey-tracks.rgb\"]", "native skid texture use");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.lightCommand", "light snapshot field use");
requireText(byPath["renderer/effects.js"], "SNAPSHOT.collision", "collision snapshot field use");
requireText(byPath["renderer/effects.js"], "makeRadialTexture", "effect texture fallback");
requireText(byPath["renderer/effects.js"], "TORCS web renderer using generic planar shadow fallback", "generic shadow fallback warning");
requireText(byPath["renderer/effects.js"], "TORCS web renderer using default dimension-based car light anchors", "default light anchor fallback warning");
if (byPath["renderer/effects.js"].content.includes("velocity: tempVector.copy(world).sub(car.position)")) {
	fail("TORCS web renderer smoke test found shared tempVector exhaust fire velocity");
}
if (byPath["renderer/effects.js"].content.includes("sideSlip * surface.initSpeed * 0.08,\n\t\t\t\t).multiplyScalar(deltaTime * 60)")) {
	fail("TORCS web renderer smoke test found spawn-time-scaled smoke velocity");
}
if (byPath["renderer/effects.js"].content.includes("headL: [dimX * 0.52") &&
	!byPath["renderer/effects.js"].content.includes("this.assetLightSprites.length > 0")) {
	fail("TORCS web renderer smoke test found only hardcoded car light placement");
}

requireText(byPath["renderer/cameras.js"], "getTorcsPoseQuaternion(values, this.carRotation)", "camera pose matrix conversion");
requireText(byPath["renderer/cameras.js"], "fov: 40", "TORCS chase camera FOV");
requireText(byPath["renderer/cameras.js"], "fov: 67.5", "TORCS onboard camera FOV");
requireText(byPath["renderer/cameras.js"], "trackside: {", "fixed trackside camera mode");
requireText(byPath["renderer/cameras.js"], "fov: 30", "TORCS road camera FOV");
requireText(byPath["renderer/cameras.js"], "this.tracksideViews = this.makeTracksideViews(min, max, center, span)", "generated trackside camera placement");
requireText(byPath["renderer/cameras.js"], "selectTracksideView(car)", "nearest trackside camera selection");
requireText(byPath["renderer/cameras.js"], "this.trackView = { center, height: span * 0.78 }", "fixed top alignment camera framing");
requireText(byPath["renderer/cameras.js"], "CAMERA_LOOKAROUNDS", "temporary camera lookaround modes");
requireText(byPath["renderer/cameras.js"], "backLeft: { side: DIAGONAL_LOOKAROUND, forward: -DIAGONAL_LOOKAROUND }", "rear-left diagonal camera lookaround mode");
requireText(byPath["renderer/cameras.js"], "backRight: { side: -DIAGONAL_LOOKAROUND, forward: -DIAGONAL_LOOKAROUND }", "rear-right diagonal camera lookaround mode");
requireText(byPath["renderer/cameras.js"], "updateLookaround(values, car, lookaround, analogLookaround = null)", "temporary car-relative lookaround camera");
requireText(byPath["renderer/cameras.js"], "applyAnalogLookTarget(values, lookaround)", "right stick analog camera look target");
requireText(byPath["renderer/cameras.js"], "analogLookaround && analogLookaround.front", "right stick press front camera override");
requireText(byPath["renderer/main.js"], "cameras.setTrack(trackSamples)", "camera track-sample alignment handoff");
if (byPath["renderer/cameras.js"].content.includes("Math.cos(yaw)")) {
	fail("TORCS web renderer smoke test found scalar-yaw camera direction");
}

const manifest = JSON.parse(read("web-assets/manifest.json"));
const track = manifest.tracks["data/tracks/e-track-1/e-track-1.xml"];
const car = manifest.cars["data/cars/models/kc-2000gt/kc-2000gt.xml"];
const car7Trb1 = manifest.cars["data/cars/models/car7-trb1/car7-trb1.xml"];
if (!track || !car) {
	fail("TORCS web renderer smoke test missing Phase 1 manifest entries");
}
if (!car7Trb1 || !Array.isArray(car7Trb1.lods) || car7Trb1.lods.length === 0) {
	fail("TORCS web renderer smoke test missing car7-trb1 remaster reference asset");
}
if (car7Trb1.materialMask !== "cars/car7-trb1/car7-trb1-material-mask.png") {
	fail("TORCS web renderer smoke test found missing car7-trb1 material mask metadata", {
		materialMask: car7Trb1.materialMask,
	});
}
if (!car7Trb1.wheelAsset || car7Trb1.wheelAsset.source !== "torcs-detailed-wheel-acc" ||
	car7Trb1.wheelAsset.directory !== "trb1-5" || car7Trb1.wheelAsset.basename !== "wheel" ||
	!Array.isArray(car7Trb1.wheelAsset.states) || car7Trb1.wheelAsset.states.length !== 4) {
	fail("TORCS web renderer smoke test found missing car7-trb1 detailed wheel metadata", {
		wheelAsset: car7Trb1.wheelAsset,
	});
}
if (JSON.stringify(car7Trb1.wheelAsset.speedThresholds) !== JSON.stringify([20, 40, 70])) {
	fail("TORCS web renderer smoke test found unexpected car7-trb1 wheel speed thresholds", {
		speedThresholds: car7Trb1.wheelAsset.speedThresholds,
	});
}
if (!manifest.tracks["data/tracks/g-track-1/g-track-1.xml"] ||
	!manifest.cars["data/cars/models/kc-a110/kc-a110.xml"]) {
	fail("TORCS web renderer smoke test missing selectable multi-asset manifest entries");
}
checkGlb(track.asset);
checkObjectNames(track, track.source);
if (!track.backgroundTexture) {
	fail("TORCS web renderer smoke test found missing background texture metadata");
}
if (typeof track.backgroundType !== "number") {
	fail("TORCS web renderer smoke test found missing background type metadata");
}
checkPng(track.backgroundTexture);
checkPng(car7Trb1.materialMask);
for (const [index, state] of car7Trb1.wheelAsset.states.entries()) {
	if (state.speedIndex !== index || !state.asset ||
		!Array.isArray(state.materialClasses) || !state.materialClasses.includes("wheelTire")) {
		fail("TORCS web renderer smoke test found malformed car7-trb1 wheel state", state);
	}
	checkGlb(state.asset);
}
checkExr("web/hdri/120_hdrmaps_com_free_2K.exr");
for (const field of ["backgroundColor", "ambientColor", "diffuseColor", "specularColor", "lightPosition"]) {
	checkNumberTriplet(track, field, track.source);
}
if (typeof track.shininess !== "number" || !Number.isFinite(track.shininess)) {
	fail("TORCS web renderer smoke test found malformed track shininess metadata");
}
for (const lod of car.lods) {
	checkGlb(lod.asset);
	checkObjectNames(lod, lod.model);
	if (typeof lod.wheels !== "boolean") {
		fail("TORCS web renderer smoke test found car LOD without wheel metadata", {
			model: lod.model,
		});
	}
}
checkCarLights(car, ["head1", "rear", "brake"], car.name);
checkCarLights(car7Trb1, ["rear", "brake2"], car7Trb1.name);
checkMaterialMetadata(track, ["road", "grass", "barrier", "treeFoliage"], track.source);
checkMaterialMetadata(car7Trb1.lods[0], ["body", "glass", "headlamp", "taillamp", "exhaust"], car7Trb1.lods[0].model);
if (!car.wheelFallback || car.wheelFallback.source !== "runtime-snapshot" ||
	!car.wheelFallback.texture || !(car.wheelFallback.texture in car.textures)) {
	fail("TORCS web renderer smoke test found missing wheel fallback metadata");
}
if (!car.sound || car.sound.engineSample !== "engine-1.wav" ||
	!car.sound.engineAsset || typeof car.sound.rpmScale !== "number" ||
	typeof car.sound.turbo !== "boolean" || typeof car.sound.turboRpm !== "number" ||
	typeof car.sound.turboLag !== "number") {
	fail("TORCS web renderer smoke test found malformed car sound metadata");
}
checkWav(car.sound.engineAsset);
for (const texture of Object.values(track.textures).concat(Object.values(car.textures))) {
	checkPng(texture);
}
const effectTextures = manifest.effects && manifest.effects.textures;
for (const name of ["smoke.rgb", "fire0.rgb", "fire1.rgb", "frontlight1.rgb", "rearlight1.rgb", "breaklight1.rgb", "grey-tracks.rgb"]) {
	if (!effectTextures || !effectTextures[name]) {
		fail("TORCS web renderer smoke test found missing effect texture metadata", { name });
	}
	checkPng(effectTextures[name]);
}
const effectSounds = manifest.effects && manifest.effects.sounds;
for (const name of ["skidTyres", "roadRide", "grassRide", "curbRide", "grassSkid", "metalSkid", "axle", "turbo", "backfireLoop", "backfire", "bang", "bottomCrash", "gearChange"]) {
	const entry = effectSounds && effectSounds[name];
	if (!entry || typeof entry.sample !== "string" || !entry.asset) {
		fail("TORCS web renderer smoke test found missing effect sound metadata", { name });
	}
	checkWav(entry.asset);
}
const crashSounds = manifest.effects && manifest.effects.crashes;
if (!Array.isArray(crashSounds) || crashSounds.length !== 6) {
	fail("TORCS web renderer smoke test found missing crash sound set");
}
crashSounds.forEach((entry, index) => {
	if (!entry || entry.sample !== `crash${index + 1}.wav` || !entry.asset) {
		fail("TORCS web renderer smoke test found malformed crash sound metadata", { index });
	}
	checkWav(entry.asset);
});

Promise.all([checkAudioModelBehavior(), checkInputControllerBehavior(), checkTrackAlignment(track.asset), checkMultiCarModelMetadata()])
	.then(([audioModel, inputController, alignment, multiCarModels]) => {
		console.log(JSON.stringify({
			rendererFiles: files.length,
			html: "torcs_web_renderer.html",
			entrypoint: "renderer/main.js",
			audioModel,
			inputController,
			webAssetTracks: Object.keys(manifest.tracks).length,
			webAssetCars: Object.keys(manifest.cars).length,
			alignment,
			multiCarModels,
		}));
	})
	.catch((error) => fail("TORCS web renderer smoke test failed", { error: error.message }));
