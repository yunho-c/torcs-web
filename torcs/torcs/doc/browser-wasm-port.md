# TORCS Browser and WebAssembly Port Plan

This document describes a staged strategy for moving TORCS 1.3.9-test1 into a
browser runtime with WebAssembly while preserving the current simulator logic.

## Current Port Blockers

The native application is not a direct browser compile:

- The entrypoint in `src/linux/main.cpp` initializes GLUT through
  `GfScrInit()`, calls `TorcsEntry()`, then enters `glutMainLoop()`.
- `configure.in` requires desktop OpenGL, GLU, GLUT, GLX, X11, PLIB, OpenAL,
  Vorbis, libpng, zlib, and `dlopen`.
- Runtime modules are discovered and loaded through `GfModLoad()` and the OS
  callback table in `src/libs/tgf/module.cpp`; Linux implements this with
  `dlopen()` and `dlsym()` in `src/linux/linuxspec.cpp`.
- Presentation code depends on PLIB SSG, GLUT, OpenGL immediate-mode-era calls,
  OpenAL, and the legacy `tgfclient` GUI.
- Several tools also create GLUT windows or load modules dynamically, so they
  are useful validation targets but should not define the first browser runtime.

The useful browser-port split is therefore:

- Preserve `txml`, `tgf`, the XML parameter model, track loading, `simuv2`, race
  state structs, and selected robot drivers.
- Replace dynamic module discovery with a linked registry for WASM builds.
- Replace GLUT, PLIB SSG, OpenAL, and the legacy GUI with browser-native shell,
  WebGL/WebGPU-facing presentation, and Web Audio.
- Keep deterministic fixed-step simulation as the core runtime contract.

## Staged Architecture

### Stage 1: WASM core foothold

Compile a small TORCS slice to WebAssembly and run it in a browser or Node-like
Emscripten shell. The initial scaffold in this repository builds:

- `torcs_txml`: the XML parser sources from `src/libs/txml`.
- `torcs_tgf`: parameter, directory, module facade, logging, profiler, and hash
  support from `src/libs/tgf`.
- `torcs_robottools`: the `rttrack.cpp` geometry helpers needed by the track
  loader interface.
- `torcs_track`: the real track loader module sources from `src/modules/track`.
- `torcs_solid`: the bundled SOLID 2.0 collision library used by `simuv2`.
- `torcs_plibsg`: PLIB SG math helpers needed by `simuv2` transforms.
- `torcs_simuv2`: the real simulation module sources from
  `src/modules/simu/simuv2`.
- `torcs_web_probe`: a tiny executable in `src/web` that preloads
  `raceengine.xml`, E-Track 1, and the shared track surface/object entity files,
  then verifies `GfParmReadFile()`, `GfParmGetStr()`, and `GfParmGetNum()` in
  Emscripten's virtual filesystem.

Build command:

```bash
cd torcs/torcs
EMSDK_PYTHON=/opt/homebrew/bin/python3 emcmake cmake -S . -B build-wasm -G Ninja
EMSDK_PYTHON=/opt/homebrew/bin/python3 EM_CACHE="$PWD/build-wasm/emcache" cmake --build build-wasm --target torcs_web_probe
EMSDK_PYTHON=/opt/homebrew/bin/python3 EM_CACHE="$PWD/build-wasm/emcache" cmake --build build-wasm --target torcs_web_probe_smoke
```

The generated target is `build-wasm/torcs_web_probe.js` with a companion
`.wasm` and `.data` file. It uses Emscripten `MODULARIZE` and `EXPORT_NAME`, so
JavaScript can instantiate it as `TorcsWebProbe(...)` and call exported probe
functions via `ccall`/`cwrap`. The `torcs_web_probe_smoke` target runs
`src/web/smoke_probe.js` from the generated output directory and copies
`src/web/torcs_web_probe.html` beside the generated JS/WASM/data files. Serve
`build-wasm/` over HTTP and open `torcs_web_probe.html` to drive the runtime in
a browser.

The smoke test now also verifies the browser static module provider by resolving
a linked probe module through `GfModInfo()` and `GfModLoad()` instead of native
`dlopen()`. It also registers the real `track(tModInfo*)` entry point and
verifies that its `tTrackItf` function table initializes inside WASM. The same
smoke path now uses that interface to build
`/torcs/data/tracks/e-track-1/e-track-1.xml` headlessly and assert the parsed
name, version, segment count, length, and width. It also registers
`simuv2(tModInfo*)` and verifies that its simulator function table initializes
after linking SOLID and the PLIB SG math helper. A
zero-car headless initialization check then calls `simuv2` init/shutdown against
the loaded track, exercising the simulator and collision setup path. The smoke
path also preloads the `kc-2000gt` car XML, configures one car on E-Track 1,
runs one fixed `RCM_MAX_DT_SIMU` update, and validates the resulting car state.
The probe also exposes a small persistent runtime API so browser JavaScript can
start the one-car headless session, set controls, step simulation time, read
time/position/yaw/speed/fuel/drivetrain snapshots, sample the loaded track's
center/right/left boundaries for browser rendering, and shut the session down
without using raw TORCS pointers. Drivetrain telemetry currently includes active
gear, engine revs, engine redline, and per-wheel spin/slip scalars. The browser
harness now draws E-Track 1 from these sampled TORCS track coordinates instead
of a placeholder map, mirrors keyboard driving input into the same control path
as the sliders, and shows the live drivetrain fields. Use the same
working-directory rule, or configure
`locateFile` in browser code, because the generated JavaScript loads the
`.wasm` and `.data` files relative to the current runtime location.

On this macOS/Homebrew setup, `EMSDK_PYTHON` avoids the system Python 3.9
interpreter and `EM_CACHE` avoids writes to the read-only Homebrew Emscripten
cache.

### Stage 2: static module registry

Add a WASM-specific module provider that fills `tModList` entries from linked
symbols instead of filesystem shared libraries. The initial provider lives in
`src/web/torcs_web_platform.cpp`; callers install an explicit
`tTorcsWebModule` table with `TorcsWebInitPlatform()`, which fills the existing
`GfOs` module callbacks. This preserves the public `GfModInfo()` and
`GfModLoad()` APIs while replacing the browser-hostile platform implementation.

The registry now exposes:

- `track(tModInfo*)` from `src/modules/track`.
- `simuv2(tModInfo*)` from `src/modules/simu/simuv2`.

The next production entries should expose:

- One simple AI driver module, then the human driver once browser input exists.

This keeps the existing race-engine module interface while removing the
browser-hostile dependency on `dlopen()`.

### Stage 3: headless race step

Compile enough of `raceengineclient`, `track`, `robottools`, `simuv2`, SOLID,
and car/track data to run a scripted race without graphics. The current scaffold
can load E-Track 1, configure one `kc-2000gt`, and execute one headless `simuv2`
update through exported start/control/step/snapshot functions. The next
browser-facing API should expose:

- configurable race/track/car selection
- multi-car loading and driver selection
- broader snapshots of `tSituation`, car transforms, wheel state, lap state, and
  race events

The browser shell should not receive raw TORCS pointers.

### Stage 4: browser presentation

Build a browser renderer around stable simulation snapshots. This can be done
with WebGL/WebGPU code, Three.js, or another rendering layer; it should not
depend on PLIB SSG. Convert TORCS AC/ACC geometry and images into browser-ready
assets offline or during a loading stage.

### Stage 5: full playable browser runtime

Add menu flow, input mapping, audio, asset loading, persistence, replays,
telemetry, and packaging. At this point the original TORCS desktop build should
still work, while the browser runtime owns its own shell.

## Why This Path

A full one-step browser compile would combine unrelated risks: old desktop
graphics APIs, dynamic plugin loading, audio, UI, asset conversion, filesystem
layout, and physics correctness. The staged route proves the lowest-level TORCS
data path first, then moves to static modules and deterministic simulation
before any presentation work.

The first scaffold intentionally does not compile PLIB, OpenAL, GLUT, or
desktop OpenGL code. Those are replacement targets for the browser port, not
dependencies to preserve.
