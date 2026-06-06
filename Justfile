torcs_root := "torcs/torcs"
wasm_build_dir := torcs_root + "/build-wasm"
serve_port := "8002"

default:
	@just --list

# Configure the Emscripten/CMake wasm build directory.
configure:
	emcmake cmake -S {{torcs_root}} -B {{wasm_build_dir}} -DCMAKE_BUILD_TYPE=Release

# Build the browser renderer, including copied JS files and generated web assets.
build: configure
	cmake --build {{wasm_build_dir}} --target torcs_web_renderer_browser

# Build and run the wasm probe plus renderer smoke tests.
smoke: configure
	cmake --build {{wasm_build_dir}} --target torcs_web_probe_smoke

# Remove the wasm build directory for a from-scratch rebuild.
clean:
	rm -rf {{wasm_build_dir}}

# Clean, configure, build, and run smoke tests from scratch.
rebuild: clean smoke

# Serve the wasm build output locally.
serve port=serve_port:
	python3 -m http.server {{port}} --directory {{wasm_build_dir}}
