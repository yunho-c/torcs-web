export const SNAPSHOT = {
	time: 0,
	x: 1,
	y: 2,
	z: 3,
	yaw: 4,
	pitch: 5,
	roll: 6,
	speed: 7,
	fuel: 8,
	dimensionX: 9,
	dimensionY: 10,
	dimensionZ: 11,
	state: 12,
	gear: 13,
	engineRpm: 14,
	engineRedline: 15,
	trackSegmentId: 16,
	trackSegmentType: 17,
	trackToStart: 18,
	trackToRight: 19,
	trackToMiddle: 20,
	trackDistanceFromStart: 21,
	raceState: 22,
	racePosition: 23,
	lapCount: 24,
	remainingLaps: 25,
	lapProgress: 26,
	distanceRaced: 27,
	currentLapTime: 28,
	lastLapTime: 29,
	bestLapTime: 30,
	topSpeed: 31,
	controlSteer: 32,
	controlAccel: 33,
	controlBrake: 34,
	controlClutch: 35,
	posMat0: 36,
	cornerX0: 52,
	cornerY0: 56,
	wheelSpinVelocity0: 60,
	wheelSlipAccel0: 64,
	wheelSlipSide0: 68,
	wheelBrakeTemp0: 72,
	trackLength: 76,
	trackWidth: 77,
	trackSegments: 78,
	trackSamples: 79,
	wheelRelX0: 80,
	wheelRelY0: 84,
	wheelRelZ0: 88,
	wheelRelRoll0: 92,
	wheelSpinAngle0: 96,
	wheelSteerAngle0: 100,
	wheelRadius0: 104,
	wheelWidth0: 108,
	carSteerLock: 112,
	lightCommand: 113,
	collision: 114,
	damage: 115,
	wheelSkidIntensity0: 116,
	wheelSurfaceKind0: 120,
	wheelReaction0: 124,
	engineSmoke: 128,
	exhaustCount: 129,
	exhaustPower: 130,
	exhaustX0: 131,
	exhaustY0: 133,
	exhaustZ0: 135,
	velocityX: 137,
	velocityY: 138,
	velocityZ: 139,
	gearRatio: 140,
	gearChangeEvent: 141,
	collisionEvent: 142,
	wheelRoughnessFrequency0: 143,
	wheelRoughness0: 147,
	wheelOtherSurfaceContribution0: 151,
	wheelOtherSurfaceKind0: 155,
	wheelOtherRoughnessFrequency0: 159,
	wheelOtherRoughness0: 163,
	wheelSurfaceStyle0: 167,
	wheelOtherSurfaceStyle0: 171,
};

const TRACK_SIDE = {
	right: 0,
	center: 1,
	left: 2,
};

export class TorcsRuntime {
	constructor(module) {
		this.module = module;
		this.snapshotSize = this.call("torcs_web_runtime_get_snapshot_size", "number");
		this.snapshotCount = this.snapshotSize / Float64Array.BYTES_PER_ELEMENT;
		this.snapshotPtr = module._malloc(this.snapshotSize);
		this.active = false;
		this.carCount = 0;
	}

	call(name, returnType, argTypes = [], args = []) {
		return this.module.ccall(name, returnType, argTypes, args);
	}

	start(trackPath, carPath, carCount = 1) {
		this.shutdown();
		const rc = this.call(
			"torcs_web_runtime_start_multi_with_files",
			"number",
			["string", "string", "number"],
			[trackPath, carPath, carCount],
		);
		this.active = rc === 0;
		this.carCount = this.active ? this.call("torcs_web_runtime_get_car_count", "number") : 0;
		return this.active;
	}

	shutdown() {
		if (this.active) {
			this.call("torcs_web_runtime_shutdown", null);
			this.active = false;
			this.carCount = 0;
		}
	}

	dispose() {
		this.shutdown();
		if (this.snapshotPtr) {
			this.module._free(this.snapshotPtr);
			this.snapshotPtr = 0;
		}
	}

	setControls({ steer, accel, brake, clutch, gear }) {
		if (!this.active) {
			return false;
		}
		// The web UI is right-positive; TORCS control input is left-positive.
		const torcsSteer = -steer;
		return this.call(
			"torcs_web_runtime_set_controls",
			"number",
			["number", "number", "number", "number", "number"],
			[torcsSteer, accel, brake, clutch, gear],
		) === 0;
	}

	step(deltaTime) {
		if (!this.active) {
			return false;
		}
		return this.call("torcs_web_runtime_step", "number", ["number"], [deltaTime]) === 0;
	}

	readSnapshot() {
		if (!this.active) {
			return null;
		}
		const rc = this.call(
			"torcs_web_runtime_write_snapshot",
			"number",
			["number", "number"],
			[this.snapshotPtr, this.snapshotSize],
		);
		if (rc !== 0) {
			return null;
		}
		const values = this.module.HEAPF64.subarray(
			this.snapshotPtr >> 3,
			(this.snapshotPtr >> 3) + this.snapshotCount,
		);
		return values;
	}

	readCarSnapshot(carIndex) {
		if (!this.active) {
			return null;
		}
		const rc = this.call(
			"torcs_web_runtime_write_car_snapshot",
			"number",
			["number", "number", "number"],
			[carIndex, this.snapshotPtr, this.snapshotSize],
		);
		if (rc !== 0) {
			return null;
		}
		const values = this.module.HEAPF64.subarray(
			this.snapshotPtr >> 3,
			(this.snapshotPtr >> 3) + this.snapshotCount,
		);
		return Float64Array.from(values);
	}

	readSnapshots() {
		const snapshots = [];
		for (let i = 0; i < this.carCount; i += 1) {
			const values = this.readCarSnapshot(i);
			if (values) {
				values.carIndex = i;
				values.driverName = this.getCarName(i);
				snapshots.push(values);
			}
		}
		return snapshots;
	}

	getCarName(carIndex) {
		if (!this.active) {
			return "";
		}
		return this.call("torcs_web_runtime_get_car_name_by_index", "string", ["number"], [carIndex]);
	}

	readPoint(sampleIndex, side) {
		return {
			x: this.call("torcs_web_runtime_get_track_sample_x", "number", ["number", "number"], [sampleIndex, side]),
			y: this.call("torcs_web_runtime_get_track_sample_y", "number", ["number", "number"], [sampleIndex, side]),
		};
	}

	readTrackSamples() {
		if (!this.active) {
			return { center: [], right: [], left: [], bounds: null };
		}

		const count = this.call("torcs_web_runtime_get_track_sample_count", "number");
		const track = {
			center: [],
			right: [],
			left: [],
			bounds: {
				minX: Number.POSITIVE_INFINITY,
				minY: Number.POSITIVE_INFINITY,
				maxX: Number.NEGATIVE_INFINITY,
				maxY: Number.NEGATIVE_INFINITY,
			},
		};
		const extend = (point) => {
			track.bounds.minX = Math.min(track.bounds.minX, point.x);
			track.bounds.minY = Math.min(track.bounds.minY, point.y);
			track.bounds.maxX = Math.max(track.bounds.maxX, point.x);
			track.bounds.maxY = Math.max(track.bounds.maxY, point.y);
		};

		for (let i = 0; i < count; i += 1) {
			const right = this.readPoint(i, TRACK_SIDE.right);
			const center = this.readPoint(i, TRACK_SIDE.center);
			const left = this.readPoint(i, TRACK_SIDE.left);
			track.right.push(right);
			track.center.push(center);
			track.left.push(left);
			extend(right);
			extend(left);
		}

		if (!Number.isFinite(track.bounds.minX)) {
			track.bounds = null;
		}
		return track;
	}
}

export async function createTorcsRuntime() {
	const factory = window.TorcsWebProbe;
	if (!factory) {
		throw new Error("torcs_web_probe.js did not expose TorcsWebProbe");
	}
	const module = await factory({ locateFile: (path) => path });
	return new TorcsRuntime(module);
}
