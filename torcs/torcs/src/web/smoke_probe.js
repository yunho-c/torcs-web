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
		const result = {
			rc: module.ccall("torcs_web_probe", "number", [], []),
			rc2: module.ccall("torcs_web_probe", "number", [], []),
			simu: module.ccall("torcs_web_get_module_name", "string", ["string"], ["simu"]),
			track: module.ccall("torcs_web_get_module_name", "string", ["string"], ["track"]),
			fps: module.ccall("torcs_web_get_capture_fps", "number", [], []),
			staticModuleRegistry: module.ccall("torcs_web_check_static_module_registry", "number", [], []),
			trackModule: module.ccall("torcs_web_check_track_module", "number", [], []),
		};

		console.log(JSON.stringify(result));

		if (
			result.rc !== 0 ||
			result.rc2 !== 0 ||
			result.simu !== "simuv2" ||
			result.track !== "track" ||
			result.fps !== 25 ||
			result.staticModuleRegistry !== 0 ||
			result.trackModule !== 0
		) {
			fail("TORCS WASM probe smoke test failed", result);
		}
	})
	.catch((error) => {
		fail("TORCS WASM probe smoke test failed to run", {
			message: error && error.message ? error.message : String(error),
		});
	});
