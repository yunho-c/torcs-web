import { SNAPSHOT } from "./runtime.js";

function fmt(value, digits = 2) {
	return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

export class Hud {
	constructor(elements) {
		this.elements = elements;
	}

	setState(state) {
		this.elements.state.textContent = state;
	}

	update(values) {
		if (!values) {
			return;
		}
		this.elements.time.textContent = fmt(values[SNAPSHOT.time], 3);
		this.elements.speed.textContent = fmt(values[SNAPSHOT.speed] * 3.6, 1);
		this.elements.gear.textContent = String(values[SNAPSHOT.gear]);
		this.elements.rpm.textContent = fmt(values[SNAPSHOT.engineRpm], 0);
		this.elements.lap.textContent = String(values[SNAPSHOT.lapCount]);
		this.elements.progress.textContent = fmt(values[SNAPSHOT.lapProgress] * 100, 1);
		this.elements.segment.textContent = String(values[SNAPSHOT.trackSegmentId]);
		this.elements.offset.textContent = fmt(values[SNAPSHOT.trackToMiddle], 2);
	}
}
