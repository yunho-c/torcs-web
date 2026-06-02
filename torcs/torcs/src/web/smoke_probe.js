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
			runtime.remainingLaps !== 0 ||
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
