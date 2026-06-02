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
