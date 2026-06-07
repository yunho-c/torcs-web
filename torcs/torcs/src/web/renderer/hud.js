import { SNAPSHOT } from "./runtime.js";

function fmt(value, digits = 2) {
	return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

function fmtTime(value) {
	if (!Number.isFinite(value) || value <= 0) {
		return "--:--.---";
	}
	const minutes = Math.floor(value / 60);
	const seconds = value - minutes * 60;
	return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function makeBounds(points) {
	const bounds = {
		minX: Number.POSITIVE_INFINITY,
		minY: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		maxY: Number.NEGATIVE_INFINITY,
	};
	for (const point of points) {
		bounds.minX = Math.min(bounds.minX, point.x);
		bounds.minY = Math.min(bounds.minY, point.y);
		bounds.maxX = Math.max(bounds.maxX, point.x);
		bounds.maxY = Math.max(bounds.maxY, point.y);
	}
	return Number.isFinite(bounds.minX) ? bounds : null;
}

export class Hud {
	constructor(elements) {
		this.elements = elements;
		this.track = null;
		this.mapContext = elements.map ? elements.map.getContext("2d") : null;
	}

	setState(state) {
		this.elements.state.textContent = state;
	}

	setTrack(track) {
		const points = track ? track.right.concat(track.left) : [];
		this.track = points.length ? {
			...track,
			bounds: track.bounds || makeBounds(points),
		} : null;
		this.drawMap(null);
	}

	update(values) {
		if (!values) {
			return;
		}
		this.elements.time.textContent = fmt(values[SNAPSHOT.time], 3);
		this.elements.speed.textContent = fmt(values[SNAPSHOT.speed] * 3.6, 1);
		this.elements.gear.textContent = String(values[SNAPSHOT.gear]);
		this.elements.rpm.textContent = fmt(values[SNAPSHOT.engineRpm], 0);
		this.elements.position.textContent = String(values[SNAPSHOT.racePosition]);
		this.elements.fuel.textContent = fmt(values[SNAPSHOT.fuel], 1);
		this.elements.lap.textContent = `${values[SNAPSHOT.lapCount]} / ${values[SNAPSHOT.remainingLaps]}`;
		this.elements.currentLap.textContent = fmtTime(values[SNAPSHOT.currentLapTime]);
		this.elements.lastLap.textContent = fmtTime(values[SNAPSHOT.lastLapTime]);
		this.elements.bestLap.textContent = fmtTime(values[SNAPSHOT.bestLapTime]);
		this.elements.topSpeed.textContent = fmt(values[SNAPSHOT.topSpeed] * 3.6, 1);
		this.elements.progress.textContent = fmt(values[SNAPSHOT.lapProgress] * 100, 1);
		this.elements.segment.textContent = String(values[SNAPSHOT.trackSegmentId]);
		this.elements.offset.textContent = fmt(values[SNAPSHOT.trackToMiddle], 2);
		this.drawMap(values);
	}

	resizeMap() {
		if (!this.elements.map || !this.mapContext) {
			return false;
		}
		const rect = this.elements.map.getBoundingClientRect();
		const scale = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(rect.width * scale));
		const height = Math.max(1, Math.round(rect.height * scale));
		if (this.elements.map.width === width && this.elements.map.height === height) {
			return false;
		}
		this.elements.map.width = width;
		this.elements.map.height = height;
		return true;
	}

	drawMap(values) {
		if (!this.mapContext || !this.elements.map) {
			return;
		}
		this.resizeMap();
		const canvas = this.elements.map;
		const ctx = this.mapContext;
		const width = canvas.width;
		const height = canvas.height;
		ctx.clearRect(0, 0, width, height);
		ctx.fillStyle = "rgba(15, 18, 16, 0.76)";
		ctx.fillRect(0, 0, width, height);
		if (!this.track || !this.track.bounds) {
			return;
		}

		const bounds = this.track.bounds;
		const padding = Math.max(12, Math.min(width, height) * 0.08);
		const spanX = Math.max(1, bounds.maxX - bounds.minX);
		const spanY = Math.max(1, bounds.maxY - bounds.minY);
		const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
		const mapWidth = spanX * scale;
		const mapHeight = spanY * scale;
		const originX = (width - mapWidth) * 0.5;
		const originY = (height - mapHeight) * 0.5;
		const project = (x, y) => ({
			x: originX + (x - bounds.minX) * scale,
			y: height - (originY + (y - bounds.minY) * scale),
		});

		const drawPolyline = (points, color, lineWidth) => {
			if (!points.length) {
				return;
			}
			ctx.beginPath();
			points.forEach((point, index) => {
				const p = project(point.x, point.y);
				if (index === 0) {
					ctx.moveTo(p.x, p.y);
				} else {
					ctx.lineTo(p.x, p.y);
				}
			});
			ctx.closePath();
			ctx.strokeStyle = color;
			ctx.lineWidth = lineWidth;
			ctx.stroke();
		};

		ctx.beginPath();
		this.track.left.forEach((point, index) => {
			const p = project(point.x, point.y);
			if (index === 0) {
				ctx.moveTo(p.x, p.y);
			} else {
				ctx.lineTo(p.x, p.y);
			}
		});
		for (let i = this.track.right.length - 1; i >= 0; i -= 1) {
			const point = this.track.right[i];
			const p = project(point.x, point.y);
			ctx.lineTo(p.x, p.y);
		}
		ctx.closePath();
		ctx.fillStyle = "rgba(47, 53, 46, 0.96)";
		ctx.fill();
		drawPolyline(this.track.left, "rgba(241, 237, 224, 0.7)", 2);
		drawPolyline(this.track.right, "rgba(241, 237, 224, 0.7)", 2);
		drawPolyline(this.track.center, "rgba(212, 173, 95, 0.55)", 1);

		if (values) {
			const car = project(values[SNAPSHOT.x], values[SNAPSHOT.y]);
			const radius = Math.max(4, Math.min(width, height) * 0.035);
			ctx.beginPath();
			ctx.arc(car.x, car.y, radius, 0, Math.PI * 2);
			ctx.fillStyle = "#c9483d";
			ctx.fill();
			ctx.lineWidth = 2;
			ctx.strokeStyle = "#f1ede0";
			ctx.stroke();
		}
	}
}
