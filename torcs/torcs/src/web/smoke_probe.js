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
			!Number.isFinite(runtime.x) ||
			!Number.isFinite(runtime.y) ||
			!Number.isFinite(runtime.z) ||
			!Number.isFinite(runtime.yaw) ||
			!Number.isFinite(runtime.speed)
		) {
			fail("TORCS WASM probe smoke test failed", result);
		}
	})
	.catch((error) => {
		fail("TORCS WASM probe smoke test failed to run", {
			message: error && error.message ? error.message : String(error),
		});
	});
