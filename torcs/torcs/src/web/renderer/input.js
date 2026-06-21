import { SNAPSHOT } from "./runtime.js";

const KEYBOARD_STEER_SENSITIVITY = 1 / 0.8;
const KEYBOARD_STEER_SPEED_SENSITIVITY = 0.7 / 100;
const DIGITAL_PEDAL_INC_RATE = 0.2;
const GAMEPAD_AXIS_DEAD_ZONE = 0.08;
const GAMEPAD_STEER_SENSITIVITY = 1 / 0.8;
const GAMEPAD_TRIGGER_DEAD_ZONE = 0.02;
const GAMEPAD_BRAKE_BUTTON = 6;
const GAMEPAD_ACCEL_BUTTON = 7;
const GAMEPAD_BRAKE_AXIS_CANDIDATES = [7, 4];
const GAMEPAD_ACCEL_AXIS_CANDIDATES = [6, 5];
const GAMEPAD_LOOK_X_AXIS = 2;
const GAMEPAD_LOOK_Y_AXIS = 3;
const GAMEPAD_LOOK_BUTTON = 11;
const GAMEPAD_LOOK_DPAD_BUTTONS = new Map([
	[12, "front"],
	[14, "left"],
	[15, "right"],
]);
const GAMEPAD_GEAR_BUTTONS = [
	[5, 1],  // R1/RB
	[0, 1],  // Cross/A, matching TORCS default BTN1 upshift
	[4, -1], // L1/LB
	[1, -1], // Circle/B, matching TORCS default BTN2 downshift
];
const CAMERA_LOOKAROUND_KEYS = new Map([
	["BracketLeft", "left"],
	["BracketRight", "right"],
	["Backslash", "front"],
]);
const CAMERA_SHIFT_LOOKAROUND_KEYS = new Map([
	["BracketLeft", "backLeft"],
	["BracketRight", "backRight"],
]);

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function snapshotValue(snapshot, index, fallback = 0) {
	const value = snapshot ? snapshot[index] : fallback;
	return Number.isFinite(value) ? value : fallback;
}

export class InputController {
	constructor(elements, onChange) {
		this.elements = elements;
		this.onChange = onChange;
		this.keys = new Set();
		this.lookaroundKeys = [];
		this.gamepadLook = {
			x: 0,
			y: 0,
			front: false,
			preset: "",
		};
		this.gamepadLookButtonHeld = false;
		this.gamepadLookDpadButtons = [];
		this.gamepadGearButtons = new Set();
		this.gamepadTriggerAxisModes = new Map();
		this.keyboardState = {
			leftSteer: 0,
			rightSteer: 0,
			accel: 0,
			brake: 0,
		};
		this.gamepadActive = false;
		this.lastSnapshot = null;
		this.bind();
	}

	getControls() {
		return {
			steer: Number(this.elements.steer.value),
			accel: Number(this.elements.accel.value),
			brake: Number(this.elements.brake.value),
			clutch: Number(this.elements.clutch.value),
			gear: Number(this.elements.gear.value),
		};
	}

	getCameraLookaround() {
		this.updateGamepadLook(this.getGamepad());
		const keyboardLookaround = this.lookaroundKeys[this.lookaroundKeys.length - 1];
		if (keyboardLookaround) {
			return keyboardLookaround;
		}
		if (this.gamepadLook.preset || this.gamepadLook.front || this.gamepadLook.x !== 0 || this.gamepadLook.y !== 0) {
			return {
				type: "gamepad",
				x: this.gamepadLook.x,
				y: this.gamepadLook.y,
				front: this.gamepadLook.front,
				preset: this.gamepadLook.preset,
			};
		}
		return "";
	}

	setValue(input, value) {
		input.value = String(value);
	}

	setRangeValue(input, value) {
		const min = Number(input.min);
		const max = Number(input.max);
		this.setValue(input, clamp(value, min, max).toFixed(3));
	}

	changeGear(delta) {
		const input = this.elements.gear;
		const min = Number(input.min);
		const max = Number(input.max);
		this.setValue(input, Math.max(min, Math.min(max, Number(input.value) + delta)));
		this.onChange(this.getControls());
	}

	shapeGamepadAxis(value) {
		const magnitude = Math.abs(value);
		if (magnitude <= GAMEPAD_AXIS_DEAD_ZONE) {
			return 0;
		}
		const normalized = (magnitude - GAMEPAD_AXIS_DEAD_ZONE) / (1 - GAMEPAD_AXIS_DEAD_ZONE);
		return Math.sign(value) * Math.pow(normalized, GAMEPAD_STEER_SENSITIVITY);
	}

	shapeGamepadLookAxis(value) {
		const magnitude = Math.abs(value);
		if (magnitude <= GAMEPAD_AXIS_DEAD_ZONE) {
			return 0;
		}
		return Math.sign(value) * ((magnitude - GAMEPAD_AXIS_DEAD_ZONE) / (1 - GAMEPAD_AXIS_DEAD_ZONE));
	}

	shapeGamepadTriggerAxis(value, modeKey) {
		if (!Number.isFinite(value)) {
			return 0;
		}
		const clamped = clamp(value, -1, 1);
		if (clamped < -0.5) {
			this.gamepadTriggerAxisModes.set(modeKey, "signed");
		}
		const triggerValue = this.gamepadTriggerAxisModes.get(modeKey) === "signed" ?
			(clamped + 1) / 2 :
			clamped;
		return triggerValue > GAMEPAD_TRIGGER_DEAD_ZONE ? clamp(triggerValue, 0, 1) : 0;
	}

	getGamepadButtonValue(buttons, buttonIndex) {
		const button = buttons[buttonIndex];
		const buttonValue = button && Number.isFinite(button.value) ? button.value : 0;
		return clamp(buttonValue, 0, 1);
	}

	getGamepadTriggerAxis(gamepad, axisCandidates, modeKey) {
		const axes = gamepad.axes || [];
		let axisValue = 0;
		for (const index of axisCandidates) {
			if (index < axes.length) {
				axisValue = Math.max(axisValue, this.shapeGamepadTriggerAxis(axes[index], `${modeKey}:${index}`));
			}
		}
		return axisValue;
	}

	getGamepadPedals(gamepad) {
		const buttons = gamepad.buttons || [];
		const brakeButton = this.getGamepadButtonValue(buttons, GAMEPAD_BRAKE_BUTTON);
		const accelButton = this.getGamepadButtonValue(buttons, GAMEPAD_ACCEL_BUTTON);
		let brakeAxis = this.getGamepadTriggerAxis(gamepad, GAMEPAD_BRAKE_AXIS_CANDIDATES, "brake");
		let accelAxis = this.getGamepadTriggerAxis(gamepad, GAMEPAD_ACCEL_AXIS_CANDIDATES, "accel");

		if (brakeButton > GAMEPAD_TRIGGER_DEAD_ZONE && accelButton <= GAMEPAD_TRIGGER_DEAD_ZONE) {
			accelAxis = 0;
		}
		if (accelButton > GAMEPAD_TRIGGER_DEAD_ZONE && brakeButton <= GAMEPAD_TRIGGER_DEAD_ZONE) {
			brakeAxis = 0;
		}
		return {
			brake: brakeAxis > 0 ? brakeAxis : brakeButton,
			accel: accelAxis > 0 ? accelAxis : accelButton,
		};
	}

	rampKeyboardSteer(previous, pressed, deltaTime, speed) {
		if (!pressed) {
			return 0;
		}
		const speedFactor = 1 + KEYBOARD_STEER_SPEED_SENSITIVITY * Math.abs(speed) / 10;
		return clamp(previous + KEYBOARD_STEER_SENSITIVITY * deltaTime / speedFactor, 0, 1);
	}

	rampDigitalPedal(previous, pressed, currentTime, allowIncrease = true) {
		const target = pressed ? 1 : 0;
		if (!allowIncrease && target > previous) {
			return previous;
		}
		if (currentTime <= 1 || target <= previous) {
			return target;
		}
		const delta = target - previous;
		if (Math.abs(delta) <= DIGITAL_PEDAL_INC_RATE) {
			return target;
		}
		return previous + DIGITAL_PEDAL_INC_RATE * Math.sign(delta);
	}

	syncKeyboard(deltaTime = 1 / 60, snapshot = null, options = {}) {
		if (snapshot) {
			this.lastSnapshot = snapshot;
		}
		const left = this.keys.has("ArrowLeft") || this.keys.has("KeyA");
		const right = this.keys.has("ArrowRight") || this.keys.has("KeyD");
		const throttle = this.keys.has("ArrowUp") || this.keys.has("KeyW");
		const brake = this.keys.has("ArrowDown") || this.keys.has("KeyS") || this.keys.has("Space");
		const speed = snapshotValue(snapshot, SNAPSHOT.speed);
		const currentTime = snapshotValue(snapshot, SNAPSHOT.time);

		this.keyboardState.leftSteer = this.rampKeyboardSteer(this.keyboardState.leftSteer, left, deltaTime, speed);
		this.keyboardState.rightSteer = this.rampKeyboardSteer(this.keyboardState.rightSteer, right, deltaTime, speed);
		const allowPedalIncrease = options.allowPedalIncrease !== false;
		this.keyboardState.accel = this.rampDigitalPedal(this.keyboardState.accel, throttle, currentTime, allowPedalIncrease);
		this.keyboardState.brake = this.rampDigitalPedal(this.keyboardState.brake, brake, currentTime, allowPedalIncrease);

		this.setRangeValue(this.elements.steer, this.keyboardState.rightSteer - this.keyboardState.leftSteer);
		this.setRangeValue(this.elements.accel, this.keyboardState.accel);
		this.setRangeValue(this.elements.brake, this.keyboardState.brake);
		this.onChange(this.getControls());
		return true;
	}

	syncKeys(deltaTime = 1 / 60, snapshot = null) {
		return this.syncKeyboard(deltaTime, snapshot);
	}

	getGamepad() {
		if (typeof navigator === "undefined" || !navigator.getGamepads) {
			return null;
		}
		return Array.from(navigator.getGamepads()).find((gamepad) => gamepad && gamepad.connected) || null;
	}

	hasGamepadInput(gamepad) {
		if (!gamepad) {
			return false;
		}
		const button = (index) => gamepad.buttons && gamepad.buttons[index] ? gamepad.buttons[index].value : 0;
		const { brake, accel } = this.getGamepadPedals(gamepad);
		return Math.abs((gamepad.axes || [])[0] || 0) > GAMEPAD_AXIS_DEAD_ZONE ||
			brake > GAMEPAD_TRIGGER_DEAD_ZONE ||
			accel > GAMEPAD_TRIGGER_DEAD_ZONE ||
			GAMEPAD_GEAR_BUTTONS.some(([index]) => button(index) > 0.5);
	}

	resetGamepadControls() {
		this.setRangeValue(this.elements.steer, 0);
		this.setRangeValue(this.elements.accel, 0);
		this.setRangeValue(this.elements.brake, 0);
		this.gamepadTriggerAxisModes.clear();
		this.gamepadGearButtons.clear();
		this.gamepadLookDpadButtons = [];
		this.onChange(this.getControls());
	}

	updateGamepadLook(gamepad = this.getGamepad()) {
		const previous = { ...this.gamepadLook };
		if (!gamepad) {
			this.gamepadLook.x = 0;
			this.gamepadLook.y = 0;
			this.gamepadLook.front = false;
			this.gamepadLook.preset = "";
			this.gamepadLookButtonHeld = false;
			this.gamepadLookDpadButtons = [];
			return previous.x !== 0 || previous.y !== 0 || previous.front || Boolean(previous.preset);
		}
		const axes = gamepad.axes || [];
		const buttons = gamepad.buttons || [];
		const pressed = Boolean(buttons[GAMEPAD_LOOK_BUTTON] && buttons[GAMEPAD_LOOK_BUTTON].value > 0.5);
		this.gamepadLook.x = this.shapeGamepadLookAxis(axes[GAMEPAD_LOOK_X_AXIS] || 0);
		this.gamepadLook.y = this.shapeGamepadLookAxis(axes[GAMEPAD_LOOK_Y_AXIS] || 0);
		if (pressed && !this.gamepadLookButtonHeld) {
			this.gamepadLook.front = !this.gamepadLook.front;
		}
		this.gamepadLookButtonHeld = pressed;
		for (const [index] of GAMEPAD_LOOK_DPAD_BUTTONS) {
			const dpadPressed = Boolean(buttons[index] && buttons[index].value > 0.5);
			const alreadyHeld = this.gamepadLookDpadButtons.includes(index);
			if (dpadPressed && !alreadyHeld) {
				this.gamepadLookDpadButtons.push(index);
			} else if (!dpadPressed && alreadyHeld) {
				this.gamepadLookDpadButtons = this.gamepadLookDpadButtons.filter((heldIndex) => heldIndex !== index);
			}
		}
		const lastDpadButton = this.gamepadLookDpadButtons[this.gamepadLookDpadButtons.length - 1];
		this.gamepadLook.preset = GAMEPAD_LOOK_DPAD_BUTTONS.get(lastDpadButton) || "";
		return previous.x !== this.gamepadLook.x ||
			previous.y !== this.gamepadLook.y ||
			previous.front !== this.gamepadLook.front ||
			previous.preset !== this.gamepadLook.preset;
	}

	updateGamepad(gamepad = this.getGamepad()) {
		if (!gamepad) {
			return false;
		}
		const axis = (index) => this.shapeGamepadAxis(gamepad.axes[index] || 0);
		const button = (index) => gamepad.buttons[index] ? gamepad.buttons[index].value : 0;
		const pressed = (index) => button(index) > 0.5;
		const { accel, brake } = this.getGamepadPedals(gamepad);

		this.setRangeValue(this.elements.steer, axis(0));
		this.setRangeValue(this.elements.accel, accel);
		this.setRangeValue(this.elements.brake, brake);

		for (const [index, delta] of GAMEPAD_GEAR_BUTTONS) {
			if (pressed(index)) {
				this.gamepadGearButtons.add(index);
			} else if (this.gamepadGearButtons.has(index)) {
				this.gamepadGearButtons.delete(index);
				this.changeGear(delta);
			} else {
				this.gamepadGearButtons.delete(index);
			}
		}
		this.onChange(this.getControls());
		return true;
	}

	update(deltaTime = 1 / 60, snapshot = null) {
		if (snapshot) {
			this.lastSnapshot = snapshot;
		}
		const gamepad = this.getGamepad();
		const gamepadLookChanged = this.updateGamepadLook(gamepad);
		const gamepadHasInput = this.hasGamepadInput(gamepad);
		if (!gamepad && this.gamepadActive) {
			this.resetGamepadControls();
			this.gamepadActive = false;
			if (this.keys.size === 0) {
				return true;
			}
		}
		if (gamepad && (gamepadHasInput || this.gamepadActive)) {
			this.updateGamepad(gamepad);
			this.gamepadActive = gamepadHasInput;
			if (gamepadHasInput || this.keys.size === 0) {
				return true;
			}
		}
		if (this.keys.size > 0) {
			return this.syncKeyboard(deltaTime, snapshot);
		}
		return gamepadLookChanged;
	}

	handleKey(event, pressed) {
		if (CAMERA_LOOKAROUND_KEYS.has(event.code)) {
			event.preventDefault();
			const lookaround = event.shiftKey && CAMERA_SHIFT_LOOKAROUND_KEYS.has(event.code)
				? CAMERA_SHIFT_LOOKAROUND_KEYS.get(event.code)
				: CAMERA_LOOKAROUND_KEYS.get(event.code);
			const mappedLookarounds = new Set([
				CAMERA_LOOKAROUND_KEYS.get(event.code),
				CAMERA_SHIFT_LOOKAROUND_KEYS.get(event.code),
			].filter(Boolean));
			this.lookaroundKeys = this.lookaroundKeys.filter((heldLookaround) => !mappedLookarounds.has(heldLookaround));
			if (pressed) {
				this.lookaroundKeys.push(lookaround);
			}
			return;
		}
		const controlCodes = new Set([
			"ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
			"KeyA", "KeyD", "KeyW", "KeyS", "Space", "KeyQ", "KeyE",
		]);
		if (!controlCodes.has(event.code)) {
			return;
		}
		event.preventDefault();

		const wasHeld = this.keys.has(event.code);
		if (pressed) {
			this.keys.add(event.code);
		} else {
			this.keys.delete(event.code);
			if (wasHeld && event.code === "KeyE") {
				this.changeGear(1);
			}
			if (wasHeld && event.code === "KeyQ") {
				this.changeGear(-1);
			}
		}
		if (!pressed) {
			this.syncKeyboard(0, this.lastSnapshot, { allowPedalIncrease: false });
		}
	}

	bind() {
		for (const input of [this.elements.steer, this.elements.accel, this.elements.brake, this.elements.clutch, this.elements.gear]) {
			input.addEventListener("input", () => this.onChange(this.getControls()));
		}
		window.addEventListener("keydown", (event) => this.handleKey(event, true));
		window.addEventListener("keyup", (event) => this.handleKey(event, false));
	}
}
