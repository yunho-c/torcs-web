import { SNAPSHOT } from "./runtime.js";

const KEYBOARD_STEER_SENSITIVITY = 1 / 0.8;
const KEYBOARD_STEER_SPEED_SENSITIVITY = 0.7 / 100;
const DIGITAL_PEDAL_INC_RATE = 0.2;
const GAMEPAD_AXIS_DEAD_ZONE = 0.08;
const GAMEPAD_STEER_SENSITIVITY = 1 / 0.8;
const GAMEPAD_GEAR_BUTTONS = [
	[5, 1],  // R1/RB
	[0, 1],  // Cross/A, matching TORCS default BTN1 upshift
	[4, -1], // L1/LB
	[1, -1], // Circle/B, matching TORCS default BTN2 downshift
];

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
		this.gamepadGearButtons = new Set();
		this.keyboardState = {
			leftSteer: 0,
			rightSteer: 0,
			accel: 0,
			brake: 0,
		};
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

	rampKeyboardSteer(previous, pressed, deltaTime, speed) {
		if (!pressed) {
			return 0;
		}
		const speedFactor = 1 + KEYBOARD_STEER_SPEED_SENSITIVITY * Math.abs(speed) / 10;
		return clamp(previous + KEYBOARD_STEER_SENSITIVITY * deltaTime / speedFactor, 0, 1);
	}

	rampDigitalPedal(previous, pressed, currentTime) {
		const target = pressed ? 1 : 0;
		if (currentTime <= 1 || target <= previous) {
			return target;
		}
		const delta = target - previous;
		if (Math.abs(delta) <= DIGITAL_PEDAL_INC_RATE) {
			return target;
		}
		return previous + DIGITAL_PEDAL_INC_RATE * Math.sign(delta);
	}

	syncKeyboard(deltaTime = 1 / 60, snapshot = null) {
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
		this.keyboardState.accel = this.rampDigitalPedal(this.keyboardState.accel, throttle, currentTime);
		this.keyboardState.brake = this.rampDigitalPedal(this.keyboardState.brake, brake, currentTime);

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
		if (!navigator.getGamepads) {
			return null;
		}
		return Array.from(navigator.getGamepads()).find((gamepad) => gamepad && gamepad.connected) || null;
	}

	updateGamepad(gamepad = this.getGamepad()) {
		if (!gamepad) {
			return false;
		}
		const axis = (index) => this.shapeGamepadAxis(gamepad.axes[index] || 0);
		const button = (index) => gamepad.buttons[index] ? gamepad.buttons[index].value : 0;
		const pressed = (index) => button(index) > 0.5;

		this.setRangeValue(this.elements.steer, axis(0));
		this.setRangeValue(this.elements.accel, button(7));
		this.setRangeValue(this.elements.brake, button(6));

		for (const [index, delta] of GAMEPAD_GEAR_BUTTONS) {
			if (pressed(index)) {
				if (!this.gamepadGearButtons.has(index)) {
					this.changeGear(delta);
				}
				this.gamepadGearButtons.add(index);
			} else {
				this.gamepadGearButtons.delete(index);
			}
		}
		this.onChange(this.getControls());
		return true;
	}

	update(deltaTime = 1 / 60, snapshot = null) {
		const gamepad = this.getGamepad();
		if (gamepad) {
			return this.updateGamepad(gamepad);
		}
		if (this.keys.size > 0) {
			return this.syncKeyboard(deltaTime, snapshot);
		}
		return false;
	}

	handleKey(event, pressed) {
		const controlCodes = new Set([
			"ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
			"KeyA", "KeyD", "KeyW", "KeyS", "Space", "KeyQ", "KeyE",
		]);
		if (!controlCodes.has(event.code)) {
			return;
		}
		event.preventDefault();

		if (pressed) {
			this.keys.add(event.code);
			if (!event.repeat && event.code === "KeyE") {
				this.changeGear(1);
				return;
			}
			if (!event.repeat && event.code === "KeyQ") {
				this.changeGear(-1);
				return;
			}
		} else {
			this.keys.delete(event.code);
		}
		this.syncKeyboard(pressed ? 1 / 60 : 0, this.lastSnapshot);
	}

	bind() {
		for (const input of [this.elements.steer, this.elements.accel, this.elements.brake, this.elements.clutch, this.elements.gear]) {
			input.addEventListener("input", () => this.onChange(this.getControls()));
		}
		window.addEventListener("keydown", (event) => this.handleKey(event, true));
		window.addEventListener("keyup", (event) => this.handleKey(event, false));
	}
}
