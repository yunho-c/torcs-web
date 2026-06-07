export class InputController {
	constructor(elements, onChange) {
		this.elements = elements;
		this.onChange = onChange;
		this.keys = new Set();
		this.gamepadGearButtons = new Set();
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
		this.setValue(input, Math.max(min, Math.min(max, value)).toFixed(3));
	}

	changeGear(delta) {
		const input = this.elements.gear;
		const min = Number(input.min);
		const max = Number(input.max);
		this.setValue(input, Math.max(min, Math.min(max, Number(input.value) + delta)));
		this.onChange(this.getControls());
	}

	syncKeys() {
		const left = this.keys.has("ArrowLeft") || this.keys.has("KeyA");
		const right = this.keys.has("ArrowRight") || this.keys.has("KeyD");
		const throttle = this.keys.has("ArrowUp") || this.keys.has("KeyW");
		const brake = this.keys.has("ArrowDown") || this.keys.has("KeyS") || this.keys.has("Space");
		this.setValue(this.elements.steer, left === right ? 0 : (left ? -1 : 1));
		this.setValue(this.elements.accel, throttle ? 1 : 0);
		this.setValue(this.elements.brake, brake ? 1 : 0);
		this.onChange(this.getControls());
	}

	getGamepad() {
		if (!navigator.getGamepads) {
			return null;
		}
		return Array.from(navigator.getGamepads()).find((gamepad) => gamepad && gamepad.connected) || null;
	}

	updateGamepad() {
		const gamepad = this.getGamepad();
		if (!gamepad) {
			return false;
		}
		const axis = (index) => Math.abs(gamepad.axes[index] || 0) > 0.08 ? gamepad.axes[index] : 0;
		const button = (index) => gamepad.buttons[index] ? gamepad.buttons[index].value : 0;
		const pressed = (index) => button(index) > 0.5;

		this.setRangeValue(this.elements.steer, axis(0));
		this.setRangeValue(this.elements.accel, button(7));
		this.setRangeValue(this.elements.brake, button(6));

		for (const [index, delta] of [[5, 1], [4, -1]]) {
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
		this.syncKeys();
	}

	bind() {
		for (const input of [this.elements.steer, this.elements.accel, this.elements.brake, this.elements.clutch, this.elements.gear]) {
			input.addEventListener("input", () => this.onChange(this.getControls()));
		}
		window.addEventListener("keydown", (event) => this.handleKey(event, true));
		window.addEventListener("keyup", (event) => this.handleKey(event, false));
	}
}
