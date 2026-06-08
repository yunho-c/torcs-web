#!/usr/bin/env node

const path = require("node:path");

const modulePath = path.resolve(process.argv[2] || "torcs_web_probe.js");
const createModule = require(modulePath);

function fail(message, details) {
	console.error(message);
	if (details) {
		console.error(JSON.stringify(details));
	}
	process.exit(1);
}

const SNAPSHOT = {
	time: 0,
	x: 1,
	y: 2,
	z: 3,
	yaw: 4,
	speed: 7,
	fuel: 8,
	dimensionX: 9,
	dimensionY: 10,
	dimensionZ: 11,
	gear: 13,
	engineRpm: 14,
	trackSegmentId: 16,
	trackSegmentType: 17,
	trackToRight: 19,
	trackToMiddle: 20,
	trackDistanceFromStart: 21,
	raceState: 22,
	racePosition: 23,
	lapProgress: 26,
	distanceRaced: 27,
	currentLapTime: 28,
	topSpeed: 31,
	controlSteer: 32,
	controlAccel: 33,
	posMat0: 36,
	cornerX0: 52,
	cornerY0: 56,
	wheelSpinVelocity0: 60,
	wheelSlipAccel0: 64,
	wheelSlipSide0: 68,
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

function readSnapshot(module) {
	const version = module.ccall("torcs_web_runtime_get_snapshot_version", "number", [], []);
	const size = module.ccall("torcs_web_runtime_get_snapshot_size", "number", [], []);
	const ptr = module._malloc(size);
	try {
		const write = module.ccall("torcs_web_runtime_write_snapshot", "number", ["number", "number"], [ptr, size]);
		const values = Array.from(module.HEAPF64.subarray(ptr >> 3, (ptr + size) >> 3));
		return { version, size, write, values };
	} finally {
		module._free(ptr);
	}
}

function readCarSnapshot(module, carIndex) {
	const size = module.ccall("torcs_web_runtime_get_snapshot_size", "number", [], []);
	const ptr = module._malloc(size);
	try {
		const write = module.ccall(
			"torcs_web_runtime_write_car_snapshot",
			"number",
			["number", "number", "number"],
			[carIndex, ptr, size],
		);
		const values = Array.from(module.HEAPF64.subarray(ptr >> 3, (ptr + size) >> 3));
		return { write, values };
	} finally {
		module._free(ptr);
	}
}

createModule()
	.then((module) => {
		const runtime = {
			start: module.ccall("torcs_web_runtime_start", "number", [], []),
		};
		runtime.setControls = module.ccall(
			"torcs_web_runtime_set_controls",
			"number",
			["number", "number", "number", "number", "number"],
			[0.1, 0.0, 0.0, 1.0, 0],
		);
		runtime.step = module.ccall("torcs_web_runtime_step", "number", ["number"], [1 / 60]);
		runtime.time = module.ccall("torcs_web_runtime_get_time", "number", [], []);
		runtime.trackName = module.ccall("torcs_web_runtime_get_track_name", "string", [], []);
		runtime.carName = module.ccall("torcs_web_runtime_get_car_name", "string", [], []);
		runtime.x = module.ccall("torcs_web_runtime_get_car_x", "number", [], []);
		runtime.y = module.ccall("torcs_web_runtime_get_car_y", "number", [], []);
		runtime.z = module.ccall("torcs_web_runtime_get_car_z", "number", [], []);
		runtime.yaw = module.ccall("torcs_web_runtime_get_car_yaw", "number", [], []);
		runtime.speed = module.ccall("torcs_web_runtime_get_car_speed", "number", [], []);
		runtime.fuel = module.ccall("torcs_web_runtime_get_car_fuel", "number", [], []);
		runtime.dimensionX = module.ccall("torcs_web_runtime_get_car_dimension_x", "number", [], []);
		runtime.dimensionY = module.ccall("torcs_web_runtime_get_car_dimension_y", "number", [], []);
		runtime.dimensionZ = module.ccall("torcs_web_runtime_get_car_dimension_z", "number", [], []);
		runtime.corner0X = module.ccall("torcs_web_runtime_get_car_corner_x", "number", ["number"], [0]);
		runtime.corner0Y = module.ccall("torcs_web_runtime_get_car_corner_y", "number", ["number"], [0]);
		runtime.corner1X = module.ccall("torcs_web_runtime_get_car_corner_x", "number", ["number"], [1]);
		runtime.corner1Y = module.ccall("torcs_web_runtime_get_car_corner_y", "number", ["number"], [1]);
		runtime.trackSegmentId = module.ccall("torcs_web_runtime_get_car_track_segment_id", "number", [], []);
		runtime.trackSegmentType = module.ccall("torcs_web_runtime_get_car_track_segment_type", "number", [], []);
		runtime.trackToStart = module.ccall("torcs_web_runtime_get_car_track_to_start", "number", [], []);
		runtime.trackToRight = module.ccall("torcs_web_runtime_get_car_track_to_right", "number", [], []);
		runtime.trackToMiddle = module.ccall("torcs_web_runtime_get_car_track_to_middle", "number", [], []);
		runtime.trackDistanceFromStart = module.ccall(
			"torcs_web_runtime_get_car_track_distance_from_start",
			"number",
			[],
			[],
		);
		runtime.raceState = module.ccall("torcs_web_runtime_get_race_state", "number", [], []);
		runtime.racePosition = module.ccall("torcs_web_runtime_get_race_position", "number", [], []);
		runtime.lapCount = module.ccall("torcs_web_runtime_get_lap_count", "number", [], []);
		runtime.remainingLaps = module.ccall("torcs_web_runtime_get_remaining_laps", "number", [], []);
		runtime.lapProgress = module.ccall("torcs_web_runtime_get_lap_progress", "number", [], []);
		runtime.distanceRaced = module.ccall("torcs_web_runtime_get_distance_raced", "number", [], []);
		runtime.currentLapTime = module.ccall("torcs_web_runtime_get_current_lap_time", "number", [], []);
		runtime.lastLapTime = module.ccall("torcs_web_runtime_get_last_lap_time", "number", [], []);
		runtime.bestLapTime = module.ccall("torcs_web_runtime_get_best_lap_time", "number", [], []);
		runtime.topSpeed = module.ccall("torcs_web_runtime_get_top_speed", "number", [], []);
		runtime.engineRpm = module.ccall("torcs_web_runtime_get_engine_rpm", "number", [], []);
		runtime.engineRedline = module.ccall("torcs_web_runtime_get_engine_redline", "number", [], []);
		runtime.gear = module.ccall("torcs_web_runtime_get_gear", "number", [], []);
		runtime.wheelSpinVelocity = module.ccall(
			"torcs_web_runtime_get_wheel_spin_velocity",
			"number",
			["number"],
			[0],
		);
		runtime.wheelSlipAccel = module.ccall(
			"torcs_web_runtime_get_wheel_slip_accel",
			"number",
			["number"],
			[0],
		);
		runtime.wheelSlipSide = module.ccall(
			"torcs_web_runtime_get_wheel_slip_side",
			"number",
			["number"],
			[0],
		);
		runtime.trackLength = module.ccall("torcs_web_runtime_get_track_length", "number", [], []);
		runtime.trackWidth = module.ccall("torcs_web_runtime_get_track_width", "number", [], []);
		runtime.trackSegments = module.ccall("torcs_web_runtime_get_track_segment_count", "number", [], []);
		runtime.trackSamples = module.ccall("torcs_web_runtime_get_track_sample_count", "number", [], []);
		runtime.trackCenterX = module.ccall(
			"torcs_web_runtime_get_track_sample_x",
			"number",
			["number", "number"],
			[0, 1],
		);
		runtime.trackCenterY = module.ccall(
			"torcs_web_runtime_get_track_sample_y",
			"number",
			["number", "number"],
			[0, 1],
		);
		runtime.trackRightX = module.ccall(
			"torcs_web_runtime_get_track_sample_x",
			"number",
			["number", "number"],
			[0, 0],
		);
		runtime.trackRightY = module.ccall(
			"torcs_web_runtime_get_track_sample_y",
			"number",
			["number", "number"],
			[0, 0],
		);
		runtime.trackLeftX = module.ccall(
			"torcs_web_runtime_get_track_sample_x",
			"number",
			["number", "number"],
			[0, 2],
		);
		runtime.trackLeftY = module.ccall(
			"torcs_web_runtime_get_track_sample_y",
			"number",
			["number", "number"],
			[0, 2],
		);
		runtime.snapshot = readSnapshot(module);
		module.ccall("torcs_web_runtime_shutdown", null, [], []);

		const drive = {
			start: module.ccall("torcs_web_runtime_start", "number", [], []),
		};
		drive.setControls = module.ccall(
			"torcs_web_runtime_set_controls",
			"number",
			["number", "number", "number", "number", "number"],
			[0.0, 1.0, 0.0, 0.0, 1],
		);
		drive.startX = module.ccall("torcs_web_runtime_get_car_x", "number", [], []);
		drive.startY = module.ccall("torcs_web_runtime_get_car_y", "number", [], []);
		for (let i = 0; i < 600; i += 1) {
			drive.step = module.ccall("torcs_web_runtime_step", "number", ["number"], [1 / 60]);
		}
		drive.time = module.ccall("torcs_web_runtime_get_time", "number", [], []);
		drive.x = module.ccall("torcs_web_runtime_get_car_x", "number", [], []);
		drive.y = module.ccall("torcs_web_runtime_get_car_y", "number", [], []);
		drive.speed = module.ccall("torcs_web_runtime_get_car_speed", "number", [], []);
		drive.gear = module.ccall("torcs_web_runtime_get_gear", "number", [], []);
		drive.engineRpm = module.ccall("torcs_web_runtime_get_engine_rpm", "number", [], []);
		drive.trackDistanceFromStart = module.ccall(
			"torcs_web_runtime_get_car_track_distance_from_start",
			"number",
			[],
			[],
		);
		drive.lapProgress = module.ccall("torcs_web_runtime_get_lap_progress", "number", [], []);
		drive.distanceRaced = module.ccall("torcs_web_runtime_get_distance_raced", "number", [], []);
		drive.currentLapTime = module.ccall("torcs_web_runtime_get_current_lap_time", "number", [], []);
		drive.topSpeed = module.ccall("torcs_web_runtime_get_top_speed", "number", [], []);
		module.ccall("torcs_web_runtime_shutdown", null, [], []);

		const selected = {
			start: module.ccall(
				"torcs_web_runtime_start_with_files",
				"number",
				["string", "string"],
				[
					"/torcs/data/tracks/g-track-1/g-track-1.xml",
					"/torcs/data/cars/models/kc-a110/kc-a110.xml",
				],
			),
		};
		selected.step = module.ccall("torcs_web_runtime_step", "number", ["number"], [1 / 60]);
		selected.trackName = module.ccall("torcs_web_runtime_get_track_name", "string", [], []);
		selected.carName = module.ccall("torcs_web_runtime_get_car_name", "string", [], []);
		selected.trackLength = module.ccall("torcs_web_runtime_get_track_length", "number", [], []);
		selected.trackSamples = module.ccall("torcs_web_runtime_get_track_sample_count", "number", [], []);
		selected.dimensionX = module.ccall("torcs_web_runtime_get_car_dimension_x", "number", [], []);
		selected.dimensionY = module.ccall("torcs_web_runtime_get_car_dimension_y", "number", [], []);
		selected.lapProgress = module.ccall("torcs_web_runtime_get_lap_progress", "number", [], []);
			selected.time = module.ccall("torcs_web_runtime_get_time", "number", [], []);
			module.ccall("torcs_web_runtime_shutdown", null, [], []);

			const expanded = {
				start: module.ccall(
					"torcs_web_runtime_start_with_files",
					"number",
					["string", "string"],
					[
						"/torcs/data/tracks/a-speedway/a-speedway.xml",
						"/torcs/data/cars/models/155-DTM/155-DTM.xml",
					],
				),
			};
			expanded.step = module.ccall("torcs_web_runtime_step", "number", ["number"], [1 / 60]);
			expanded.trackName = module.ccall("torcs_web_runtime_get_track_name", "string", [], []);
			expanded.carName = module.ccall("torcs_web_runtime_get_car_name", "string", [], []);
			expanded.trackLength = module.ccall("torcs_web_runtime_get_track_length", "number", [], []);
			expanded.trackSamples = module.ccall("torcs_web_runtime_get_track_sample_count", "number", [], []);
			expanded.dimensionX = module.ccall("torcs_web_runtime_get_car_dimension_x", "number", [], []);
			expanded.dimensionY = module.ccall("torcs_web_runtime_get_car_dimension_y", "number", [], []);
			expanded.time = module.ccall("torcs_web_runtime_get_time", "number", [], []);
			module.ccall("torcs_web_runtime_shutdown", null, [], []);

			const multi = {
				start: module.ccall(
					"torcs_web_runtime_start_multi_with_files",
				"number",
				["string", "string", "number"],
				[
					"/torcs/data/tracks/e-track-1/e-track-1.xml",
					"/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml",
					3,
				],
			),
		};
		multi.count = module.ccall("torcs_web_runtime_get_car_count", "number", [], []);
		multi.maxCars = module.ccall("torcs_web_runtime_get_max_cars", "number", [], []);
		multi.names = [];
		for (let i = 0; i < multi.count; i += 1) {
			multi.names.push(module.ccall("torcs_web_runtime_get_car_name_by_index", "string", ["number"], [i]));
		}
		multi.initialPositions = [];
		for (let i = 0; i < multi.count; i += 1) {
			const carSnapshot = readCarSnapshot(module, i);
			multi.initialPositions.push(carSnapshot.values[SNAPSHOT.racePosition]);
		}
		multi.step = module.ccall("torcs_web_runtime_step", "number", ["number"], [1 / 30]);
		multi.snapshots = [];
		for (let i = 0; i < multi.count; i += 1) {
			const carSnapshot = readCarSnapshot(module, i);
			multi.snapshots.push({
				write: carSnapshot.write,
				x: carSnapshot.values[SNAPSHOT.x],
				y: carSnapshot.values[SNAPSHOT.y],
				speed: carSnapshot.values[SNAPSHOT.speed],
				position: carSnapshot.values[SNAPSHOT.racePosition],
				accel: carSnapshot.values[SNAPSHOT.controlAccel],
				gear: carSnapshot.values[SNAPSHOT.gear],
				trackDistanceFromStart: carSnapshot.values[SNAPSHOT.trackDistanceFromStart],
			});
		}
		for (let i = 0; i < 600; i += 1) {
			multi.longStep = module.ccall("torcs_web_runtime_step", "number", ["number"], [1 / 60]);
		}
		multi.longRun = [];
		for (let i = 1; i < multi.count; i += 1) {
			const carSnapshot = readCarSnapshot(module, i);
			multi.longRun.push({
				write: carSnapshot.write,
				x: carSnapshot.values[SNAPSHOT.x],
				y: carSnapshot.values[SNAPSHOT.y],
				speed: carSnapshot.values[SNAPSHOT.speed],
				toRight: carSnapshot.values[SNAPSHOT.trackToRight],
				toMiddle: carSnapshot.values[SNAPSHOT.trackToMiddle],
				steer: carSnapshot.values[SNAPSHOT.controlSteer],
				trackWidth: carSnapshot.values[SNAPSHOT.trackWidth],
				trackDistanceFromStart: carSnapshot.values[SNAPSHOT.trackDistanceFromStart],
			});
		}
		module.ccall("torcs_web_runtime_shutdown", null, [], []);

		const result = {
			rc: module.ccall("torcs_web_probe", "number", [], []),
			rc2: module.ccall("torcs_web_probe", "number", [], []),
			simu: module.ccall("torcs_web_get_module_name", "string", ["string"], ["simu"]),
			track: module.ccall("torcs_web_get_module_name", "string", ["string"], ["track"]),
			fps: module.ccall("torcs_web_get_capture_fps", "number", [], []),
			staticModuleRegistry: module.ccall("torcs_web_check_static_module_registry", "number", [], []),
			trackModule: module.ccall("torcs_web_check_track_module", "number", [], []),
			trackBuild: module.ccall("torcs_web_check_track_build", "number", [], []),
			simuv2Module: module.ccall("torcs_web_check_simuv2_module", "number", [], []),
			headlessSimInit: module.ccall("torcs_web_check_headless_sim_init", "number", [], []),
			headlessSimUpdate: module.ccall("torcs_web_check_headless_sim_update", "number", [], []),
				runtime,
				drive,
				selected,
				expanded,
				multi,
			};

		console.log(JSON.stringify(result));

		if (
			result.rc !== 0 ||
			result.rc2 !== 0 ||
			result.simu !== "simuv2" ||
			result.track !== "track" ||
			result.fps !== 25 ||
			result.staticModuleRegistry !== 0 ||
			result.trackModule !== 0 ||
			result.trackBuild !== 0 ||
			result.simuv2Module !== 0 ||
			result.headlessSimInit !== 0 ||
			result.headlessSimUpdate !== 0 ||
			runtime.start !== 0 ||
			runtime.setControls !== 0 ||
			runtime.step !== 0 ||
			runtime.trackName !== "E-Track 1" ||
			runtime.carName !== "kc-2000gt" ||
			runtime.time <= 0 ||
			runtime.fuel <= 0 ||
			runtime.dimensionX <= 0 ||
			runtime.dimensionY <= 0 ||
			runtime.dimensionZ <= 0 ||
			!Number.isFinite(runtime.corner0X) ||
			!Number.isFinite(runtime.corner0Y) ||
			!Number.isFinite(runtime.corner1X) ||
			!Number.isFinite(runtime.corner1Y) ||
			Math.hypot(runtime.corner0X - runtime.corner1X, runtime.corner0Y - runtime.corner1Y) <= 0.1 ||
			runtime.trackSegmentId < 0 ||
			![1, 2, 3].includes(runtime.trackSegmentType) ||
			!Number.isFinite(runtime.trackToStart) ||
			!Number.isFinite(runtime.trackToRight) ||
			!Number.isFinite(runtime.trackToMiddle) ||
			runtime.trackDistanceFromStart <= 0 ||
			runtime.trackDistanceFromStart >= runtime.trackLength ||
			runtime.raceState !== 1 ||
			runtime.racePosition !== 1 ||
			runtime.lapCount !== 0 ||
			runtime.remainingLaps < 0 ||
			runtime.lapProgress <= 0 ||
			runtime.lapProgress >= 1 ||
			runtime.distanceRaced < 0 ||
			runtime.currentLapTime <= 0 ||
			runtime.lastLapTime !== 0 ||
			runtime.bestLapTime !== 0 ||
			runtime.topSpeed < runtime.speed ||
			runtime.engineRpm <= 0 ||
			runtime.engineRedline <= 0 ||
			runtime.gear !== 0 ||
			!Number.isFinite(runtime.wheelSpinVelocity) ||
			!Number.isFinite(runtime.wheelSlipAccel) ||
			!Number.isFinite(runtime.wheelSlipSide) ||
			runtime.trackLength <= 0 ||
			runtime.trackWidth <= 0 ||
			runtime.trackSegments <= 0 ||
			runtime.trackSamples !== runtime.trackSegments * 12 ||
			runtime.snapshot.version !== 6 ||
			runtime.snapshot.size !== 175 * 8 ||
			runtime.snapshot.write !== 0 ||
			runtime.snapshot.values.length !== 175 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.time] - runtime.time) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.x] - runtime.x) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.y] - runtime.y) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.z] - runtime.z) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.yaw] - runtime.yaw) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.speed] - runtime.speed) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.fuel] - runtime.fuel) > 0.000001 ||
			runtime.snapshot.values[SNAPSHOT.dimensionX] !== runtime.dimensionX ||
			runtime.snapshot.values[SNAPSHOT.dimensionY] !== runtime.dimensionY ||
			runtime.snapshot.values[SNAPSHOT.dimensionZ] !== runtime.dimensionZ ||
			runtime.snapshot.values[SNAPSHOT.gear] !== runtime.gear ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.engineRpm] - runtime.engineRpm) > 0.000001 ||
			runtime.snapshot.values[SNAPSHOT.trackSegmentId] !== runtime.trackSegmentId ||
			runtime.snapshot.values[SNAPSHOT.trackSegmentType] !== runtime.trackSegmentType ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.trackDistanceFromStart] - runtime.trackDistanceFromStart) > 0.000001 ||
			runtime.snapshot.values[SNAPSHOT.raceState] !== runtime.raceState ||
			runtime.snapshot.values[SNAPSHOT.racePosition] !== runtime.racePosition ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.lapProgress] - runtime.lapProgress) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.distanceRaced] - runtime.distanceRaced) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.currentLapTime] - runtime.currentLapTime) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.topSpeed] - runtime.topSpeed) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.controlSteer] - 0.1) > 0.000001 ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.posMat0]) ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.cornerX0] - runtime.corner0X) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.cornerY0] - runtime.corner0Y) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.wheelSpinVelocity0] - runtime.wheelSpinVelocity) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.wheelSlipAccel0] - runtime.wheelSlipAccel) > 0.000001 ||
			Math.abs(runtime.snapshot.values[SNAPSHOT.wheelSlipSide0] - runtime.wheelSlipSide) > 0.000001 ||
			runtime.snapshot.values[SNAPSHOT.trackLength] !== runtime.trackLength ||
			runtime.snapshot.values[SNAPSHOT.trackWidth] !== runtime.trackWidth ||
			runtime.snapshot.values[SNAPSHOT.trackSegments] !== runtime.trackSegments ||
			runtime.snapshot.values[SNAPSHOT.trackSamples] !== runtime.trackSamples ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelRelX0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelRelY0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelRelZ0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelRelRoll0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelSpinAngle0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelSteerAngle0]) ||
			runtime.snapshot.values[SNAPSHOT.wheelRadius0] <= 0 ||
			runtime.snapshot.values[SNAPSHOT.wheelWidth0] <= 0 ||
			runtime.snapshot.values[SNAPSHOT.carSteerLock] <= 0 ||
			(runtime.snapshot.values[SNAPSHOT.lightCommand] & 0x00000003) !== 0x00000003 ||
			runtime.snapshot.values[SNAPSHOT.collision] < 0 ||
			runtime.snapshot.values[SNAPSHOT.damage] < 0 ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelSkidIntensity0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelSurfaceKind0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelReaction0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.engineSmoke]) ||
			runtime.snapshot.values[SNAPSHOT.exhaustCount] < 0 ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.exhaustPower]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.exhaustX0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.exhaustY0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.exhaustZ0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.velocityX]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.velocityY]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.velocityZ]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.gearRatio]) ||
			runtime.snapshot.values[SNAPSHOT.gearChangeEvent] < 0 ||
			runtime.snapshot.values[SNAPSHOT.collisionEvent] < 0 ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelRoughnessFrequency0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelRoughness0]) ||
			runtime.snapshot.values[SNAPSHOT.wheelOtherSurfaceContribution0] < 0 ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelOtherSurfaceKind0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelOtherRoughnessFrequency0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelOtherRoughness0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelSurfaceStyle0]) ||
			!Number.isFinite(runtime.snapshot.values[SNAPSHOT.wheelOtherSurfaceStyle0]) ||
			!Number.isFinite(runtime.trackCenterX) ||
			!Number.isFinite(runtime.trackCenterY) ||
			!Number.isFinite(runtime.trackRightX) ||
			!Number.isFinite(runtime.trackRightY) ||
			!Number.isFinite(runtime.trackLeftX) ||
			!Number.isFinite(runtime.trackLeftY) ||
			Math.hypot(runtime.trackRightX - runtime.trackLeftX, runtime.trackRightY - runtime.trackLeftY) <= 1 ||
			!Number.isFinite(runtime.x) ||
			!Number.isFinite(runtime.y) ||
			!Number.isFinite(runtime.z) ||
			!Number.isFinite(runtime.yaw) ||
			!Number.isFinite(runtime.speed) ||
			drive.start !== 0 ||
			drive.setControls !== 0 ||
			drive.step !== 0 ||
			drive.time < 9.9 ||
			drive.speed <= 2 ||
			drive.gear !== 1 ||
			drive.engineRpm <= runtime.engineRpm ||
			drive.trackDistanceFromStart <= runtime.trackDistanceFromStart ||
			drive.lapProgress <= runtime.lapProgress ||
			drive.distanceRaced <= runtime.distanceRaced ||
			drive.currentLapTime < 9.9 ||
			drive.topSpeed < drive.speed ||
			selected.start !== 0 ||
			selected.step !== 0 ||
			selected.trackName !== "CG Speedway number 1" ||
			selected.carName !== "kc-a110" ||
			selected.trackLength <= 0 ||
			selected.trackLength === runtime.trackLength ||
			selected.trackSamples <= 0 ||
			selected.dimensionX <= 0 ||
			selected.dimensionY <= 0 ||
				selected.lapProgress <= 0 ||
				selected.lapProgress >= 1 ||
				selected.time <= 0 ||
				expanded.start !== 0 ||
				expanded.step !== 0 ||
				expanded.trackName !== "A-Speedway" ||
				expanded.carName !== "155-DTM" ||
				expanded.trackLength <= 0 ||
				expanded.trackSamples <= 0 ||
				expanded.dimensionX <= 0 ||
				expanded.dimensionY <= 0 ||
				expanded.time <= 0 ||
				multi.start !== 0 ||
				multi.count !== 3 ||
				multi.maxCars < 3 ||
				multi.step !== 0 ||
				multi.names[0] !== "webprobe" ||
				multi.names[1] !== "webai1" ||
				new Set(multi.initialPositions).size !== multi.count ||
				multi.initialPositions.some((position) => position < 1 || position > multi.count) ||
				multi.snapshots.length !== 3 ||
				multi.snapshots.some((car) => car.write !== 0 || !Number.isFinite(car.x) || !Number.isFinite(car.y)) ||
				new Set(multi.snapshots.map((car) => `${car.x.toFixed(3)},${car.y.toFixed(3)}`)).size !== 3 ||
				new Set(multi.snapshots.map((car) => car.position)).size !== multi.count ||
				multi.snapshots.slice(1).some((car) => car.accel <= 0 || car.gear < 1) ||
				multi.snapshots.some((car) => car.trackDistanceFromStart <= 0) ||
				multi.longStep !== 0 ||
				multi.longRun.length !== multi.count - 1 ||
				multi.longRun.some((car) =>
					car.write !== 0 ||
					!Number.isFinite(car.x) ||
					!Number.isFinite(car.y) ||
					car.speed <= 3 ||
					car.toRight <= 0 ||
					car.toRight >= car.trackWidth ||
					Math.abs(car.toMiddle) >= car.trackWidth * 0.45 ||
					Math.abs(car.steer) >= 0.74 ||
					car.trackDistanceFromStart <= 0) ||
				Math.hypot(drive.x - drive.startX, drive.y - drive.startY) <= 5
			) {
			fail("TORCS WASM probe smoke test failed", result);
		}
	})
	.catch((error) => {
		fail("TORCS WASM probe smoke test failed to run", {
			message: error && error.message ? error.message : String(error),
		});
	});
