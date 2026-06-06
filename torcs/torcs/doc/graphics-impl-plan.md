# TORCS Browser Graphics Implementation Plan

This document lays out an implementation strategy for giving the TORCS browser
runtime a renderer that closely mimics the original desktop graphics style while
keeping the simulator core in WebAssembly.

The important distinction is this: the goal is **visual and behavioral
equivalence**, not a literal port of PLIB SSG, GLUT, or fixed-function OpenGL.
The browser renderer should preserve the look and timing contracts that matter
to players, while replacing the old presentation stack with browser-native
rendering and asset loading.

## Strategic Decision

Use a new browser renderer, with **Three.js over WebGL as the first target**.
Keep WebGPU as a later optimization path, not a prerequisite.

The retained TORCS core should stay on the path already established in
`doc/browser-wasm-port.md`:

- `txml`, `tgf`, `GfParm*`, and the XML parameter model remain in WASM.
- `track` and `simuv2` remain linked through the static module registry in
  `src/web/torcs_web_platform.cpp`.
- The browser shell talks to WASM through stable snapshot APIs, not raw TORCS
  pointers.
- PLIB SSG, GLUT, OpenAL, and desktop OpenGL are reference implementations for
  behavior and appearance, not dependencies for the web build.

The current `torcs_web_probe` is already the right kind of foothold: it can load
tracks and cars, configure a one-car `simuv2` session, step fixed simulation
time, expose car telemetry, and sample track boundaries. The graphics effort
should evolve that probe into a renderer-facing runtime bridge.

## Non-Goals

- Do not compile `src/modules/graphic/ssggraph` into the browser build.
- Do not emulate the OpenGL fixed-function pipeline as the main architecture.
- Do not expose `tCarElt*`, `tTrack*`, or other native pointers to JavaScript.
- Do not use the existing `tgfclient` menu system as the browser UI.
- Do not wait for the full race engine before rendering a first credible scene.

These constraints keep the project from mixing unrelated risks: renderer
replacement, asset conversion, UI replacement, dynamic module replacement, audio,
and full race orchestration.

## What Must Be Mimicked

The original style is not mostly about shader complexity. It comes from low-poly
AC3D geometry, visible texture tiling, simple lighting, fog, camera placement,
and a set of race-specific effects. The web renderer should reproduce those
before adding modern polish.

| Legacy responsibility | Native reference | Web implementation target |
| --- | --- | --- |
| Graphics module API | `src/interfaces/graphic.h`, `src/modules/graphic/ssggraph/ssggraph.cpp` | Browser renderer service, not a native `tGraphicItf` plugin. |
| Scene graph anchors | `grscene.cpp` (`LandAnchor`, `CarsAnchor`, `ShadowAnchor`, `SkidAnchor`, `SmokeAnchor`, `CarlightAnchor`, `SunAnchor`) | Three.js scene groups with the same conceptual ordering. |
| Track model loading | `grscene.cpp`, `TRK_ATT_3DDESC` | Convert track `.ac`/`.acc` to GLB and load through Three.js. |
| Car model loading and LOD | `grcar.cpp`, `SECT_GROBJECTS`, `LST_RANGES` | Convert car LOD meshes to GLB, preserve thresholds and object names. |
| Wheels | `grcar.cpp::initWheel`, wheel `.acc` options | Prefer converted wheel meshes; provide generated wheel fallback. |
| Cameras and FOV | `grcam.cpp`, `grscreen.cpp` | Implement TORCS-style chase/onboard/TV cameras in JS. |
| Lighting, fog, sky/background | `grscene.cpp::grInitScene`, `initBackground()` | Three.js directional/ambient light, linear fog, background dome or image. |
| Shadows | `grshadow.*`, `grDrawShadow()` | Start with planar/blob shadows, then improve if needed. |
| Skid marks | `grskidmarks.cpp` | Dynamic strip geometry on the track surface. |
| Smoke, fire, lights | `grsmoke.cpp`, `grcarlight.cpp` | Billboard sprites and additive/alpha materials. |
| Track map and HUD | `grtrackmap.cpp`, `grboard.*`, `tgfclient` widgets | Browser DOM/canvas overlay, driven by snapshots. |

## Recommended Repository Shape

Keep browser graphics assets and runtime code distinct from the legacy code:

```text
torcs/torcs/
  src/
    web/
      torcs_web_platform.cpp
      torcs_web_probe.cpp
      torcs_web_runtime.cpp          # eventual bridge split from probe
      torcs_web_runtime.h
      torcs_web_renderer.html        # first 3D harness
      renderer/
        main.js
        runtime.js
        scene.js
        cameras.js
        effects.js
        hud.js
  tools/
    web-assets/
      convert_ac_to_gltf.py          # or JS/Node equivalent
      convert_rgb_textures.py
      build_manifest.py
      validate_assets.py
  web-assets/
    manifest.json
    tracks/
    cars/
    textures/
```

The existing C++ source should remain buildable for native TORCS. Browser
renderer code should be ordinary web code that consumes WASM output, not a
mutation of `ssggraph`.

## Asset Pipeline

### Source Formats

The renderer needs to consume the same content concepts as native TORCS:

- Track XML says which visual model to load through `Graphic/3d description`.
- Track visual models are `.ac` or `.acc`, often generated by `trackgen` and
  optionally merged or processed by `accc`.
- Car XML points to car body LODs, wheel textures, optional wheel 3D models,
  driver visibility, lights, exhaust positions, and LOD thresholds.
- Textures are commonly `.rgb`, with some `.png` already present.

The browser should not parse every legacy format at runtime. Convert assets
offline or during a build step.

### Conversion Targets

Use these web-native targets:

- `.ac`/`.acc` -> `.glb`
- `.rgb` -> `.png` or `.webp`
- metadata from XML -> JSON manifest
- texture path search rules -> resolved manifest paths

The manifest should preserve:

- original source path
- converted asset path
- texture bindings
- material names and alpha/cutout flags
- LOD thresholds
- wheel mesh variants
- object names that native code expects, such as `DRIVER`
- track category/internal name
- visual scale and axis transform used during conversion

### AC3D Axis Mapping

The web asset converter must explicitly handle the TORCS/AC3D axis mapping.
The track manual documents that visual model alignment is a contract: physics
and visuals must remain in the same coordinate frame. This should be tested
early with E-Track 1 by comparing sampled WASM track boundaries against the
converted GLB road mesh.

Recommended converter rule:

- Store GLB meshes in a consistent Three.js coordinate frame.
- Keep a single documented transform between TORCS coordinates and renderer
  coordinates.
- Apply that transform once at the snapshot-adapter boundary, not throughout the
  renderer.

### Material Fidelity Rules

Start with simple materials, but preserve the old renderer's intent:

- diffuse texture color is primary
- alpha-test/cutout for trees, fences, smoke, fire, lights, and transparent cards
- linear fog matching track background color where possible
- no physically based reinterpretation in the first pass
- disable aggressive tone mapping until screenshots match
- preserve nearest/bilinear/mipmap behavior enough to avoid obvious texture
  differences

The first target is not "modern realism"; it is "this still looks like TORCS."

## WASM Snapshot API

The renderer needs a richer API than the current probe, but the current pattern
is correct: small exported accessors, copied values, no raw pointers.

### Runtime Lifecycle

Keep these operations explicit:

- start session with track and car paths
- shut down session
- set controls
- step fixed simulation time
- query immutable asset metadata for the loaded track/car
- query per-frame simulation snapshots

The current `torcs_web_runtime_start_with_files`,
`torcs_web_runtime_set_controls`, and `torcs_web_runtime_step` functions are the
right shape. The next step is to batch values into snapshot buffers rather than
calling many scalar accessors every frame.

### Snapshot Data

Expose these data groups:

| Data group | Fields |
| --- | --- |
| Car transform | full `posMat`, position, yaw/pitch/roll, speed, state flags. |
| Car dimensions | dimensions, body corners, driver type, car name, current LOD hint. |
| Wheels | per-wheel relative transform, spin angle, spin velocity, brake temp, slip side, slip accel, contact segment/surface. |
| Controls | steer, accel, brake, clutch, gear, lights, pit command state. |
| Race progress | lap count, distance raced, distance from start line, position, lap times, race state. |
| Effects | collision events, skid intensity, smoke intensity, exhaust fire, head/brake/rear light states. |
| Track | length, width, segment count, sampled center/right/left boundaries, pit data, surface ids. |
| Camera hints | current car, recommended chase target, track cameras if available. |

Move toward one binary or struct-like snapshot export:

```text
torcs_web_runtime_get_snapshot_version()
torcs_web_runtime_get_snapshot_size()
torcs_web_runtime_write_snapshot(ptr, size)
torcs_web_runtime_get_track_mesh_metadata(...)
torcs_web_runtime_get_car_visual_metadata(...)
```

JavaScript can then read a typed array once per frame. Scalar accessors can
remain for debugging and tests.

### Multi-Car Support

Do not wait for full race-manager parity to support multi-car rendering. Add a
small explicit web runtime mode with:

- `n` cars
- selected car XML per car
- controls for one human car
- a simple AI or scripted control source for other cars
- snapshots as arrays

That gives the renderer enough to prove cameras, sorting, HUD, and effects
without importing all menu/race flow at once.

## Renderer Architecture

### Core Modules

The browser renderer should be built as independent web modules:

| Module | Responsibility |
| --- | --- |
| `runtime.js` | Instantiate WASM, call lifecycle functions, own snapshot buffers. |
| `assets.js` | Load manifest, GLB files, textures, and material overrides. |
| `scene.js` | Build scene groups: land, pits, cars, shadows, skids, smoke, lights. |
| `car-view.js` | Create/update car meshes, wheels, LOD, driver visibility. |
| `track-view.js` | Load track GLB and debug sampled track boundaries. |
| `cameras.js` | TORCS-like chase, onboard, trackside, TV, and map cameras. |
| `effects.js` | Skid marks, smoke/fire, lights, shadows, collision feedback. |
| `hud.js` | Browser overlay for speed, RPM, gears, lap, map, standings. |
| `input.js` | Keyboard/gamepad mappings to `torcs_web_runtime_set_controls`. |

### Scene Grouping

Mirror the old conceptual scene ordering, but not the implementation:

```text
Scene
  Background
  Land
  Pits
  SkidMarks
  Shadows
  Cars
  CarLights
  Smoke
  SunAndLensFlare
  HUDOverlay
```

This makes it easy to compare against `grscene.cpp` while staying idiomatic in
Three.js.

### Camera Strategy

Port camera behavior before polishing assets. TORCS feel depends heavily on
camera placement and FOV.

Start with:

- chase camera behind selected car
- hood/onboard camera using car transform
- fixed trackside camera chosen from nearest track camera or generated positions
- top-down/debug camera for asset alignment

Use the same FOV defaults, near/far ranges, and fog ranges where practical.

### Effects Strategy

Effects should be renderer-native and snapshot-driven:

- **Shadows:** planar projected quads under cars, height-adjusted using track
  height samples. Native `grDrawShadow()` does this conceptually by transforming
  a shadow mesh and clamping vertices to track height.
- **Skid marks:** dynamic triangle strips following wheel contact points, faded
  over time or capped in a ring buffer.
- **Smoke/fire:** sprite billboards using converted `smoke.rgb`, `fire0.rgb`,
  and `fire1.rgb`.
- **Car lights:** additive billboards or small emissive quads using converted
  front/rear/brake light textures.
- **Fog/background:** linear fog and background color/image from track graphics
  metadata.

## Implementation Phases

### Phase 0: Renderer Harness

Goal: a Three.js page loads next to `torcs_web_probe.js` and renders a static
debug scene.

Tasks:

- Add `src/web/torcs_web_renderer.html`.
- Add JS modules under `src/web/renderer/`.
- Instantiate the existing WASM module.
- Start the current one-car session.
- Draw sampled track boundaries as Three.js lines.
- Draw the simulated car as a simple oriented box using current position, yaw,
  dimensions, and body corners.

Success criteria:

- Browser page shows E-Track 1 scale and car position correctly.
- Keyboard controls move the same simulated car as the current 2D probe.
- No asset conversion is required yet.

### Phase 1: Asset Converter Prototype

Goal: render real E-Track 1 and `kc-2000gt` geometry.

Tasks:

- Build or adopt an AC3D parser/converter.
- Convert E-Track 1 `.ac`/`.acc` to GLB.
- Convert `kc-2000gt` LODs and textures.
- Convert required `.rgb` textures to PNG/WebP.
- Emit a manifest mapping TORCS XML paths to converted assets.
- Add a validation tool that checks all manifest references exist.

Success criteria:

- Three.js loads converted E-Track 1 and `kc-2000gt`.
- Converted track mesh aligns with sampled track boundaries.
- Texture coverage is close enough to identify the original track and car.

### Phase 2: Car Transform and Wheels

Goal: the real car model moves like the simulated TORCS car.

Tasks:

- Expose full car transform matrix or equivalent yaw/pitch/roll snapshot.
- Update car body transform each frame.
- Load car LOD meshes.
- Implement wheel transforms and spin.
- Add generated wheel fallback for missing wheel models.
- Implement brake temperature color feedback.

Success criteria:

- Car body, wheels, and track position match native physics state.
- Wheel spin and steering are visibly driven by `simuv2`.
- LOD switching is deterministic and visually acceptable.

### Phase 3: TORCS-Like Camera and Lighting

Goal: make the scene feel like TORCS rather than a generic model viewer.

Tasks:

- Implement chase and onboard cameras.
- Add fixed/debug top camera for alignment.
- Reproduce track lighting values from XML where present.
- Add linear fog using track background color.
- Add background image/dome support.
- Reproduce native skybox/backdrop rendering for clouds, mountains, and horizon
  imagery rather than relying on a flat clear color or barely visible dome.
- Fix the hazy ground-surface look by auditing material parameters, especially
  specular response, shininess/roughness, and color-space handling at glancing
  camera angles.
- Improve distant road and ground texture clarity with appropriate mipmap,
  anisotropic filtering, and texture sampling settings.
- Tune FOV and near/far ranges against native screenshots.

Success criteria:

- A side-by-side screenshot comparison has similar scale, camera angle, fog,
  light direction, and color balance.

### Phase 4: Effects Layer

Goal: add the visible racing effects that define the old renderer.

Tasks:

- Add planar car shadows.
- Add skid-mark strips.
- Add smoke and exhaust fire sprites.
- Add head/rear/brake light sprites.
- Add simple collision feedback when collision data is exposed.

Success criteria:

- Hard braking, wheel slip, and light state are visible.
- Effects follow car and track coordinates without drifting.

### Phase 5: HUD, Map, and Input

Goal: replace enough `tgfclient`/`grboard` behavior for a playable browser
prototype.

Tasks:

- Build DOM/canvas HUD for speed, RPM, gear, lap, lap time, position, and fuel.
- Build a track map using sampled track boundaries and car positions.
- Add keyboard and gamepad controls.
- Preserve current `torcs_web_probe` sliders as debug controls if useful.
- Add pause/run/step controls.

Success criteria:

- A user can drive one car in the browser with useful instruments and map.

### Phase 6: Multi-Car and Driver Rendering

Goal: prove renderer scalability and race readability.

Tasks:

- Extend runtime startup to multiple cars.
- Add one AI/scripted driver path.
- Snapshot arrays for car transforms, wheels, effects, and race progress.
- Render multiple car models with distinct skins if available.
- Add standings HUD and current-car selection.

Success criteria:

- Multiple cars render and update smoothly.
- Camera selection and HUD still work.

### Phase 7: Packaging and Regression Tests

Goal: make the graphics path reproducible.

Tasks:

- Add CMake targets for copying renderer files and converted assets.
- Add asset conversion checks to a repeatable script.
- Add Node/browser smoke tests for renderer metadata.
- Add screenshot tests for E-Track 1 + `kc-2000gt`.
- Add budget checks for asset size and frame time.

Success criteria:

- One command builds WASM, prepares web assets, and runs smoke checks.
- Visual regressions are caught by screenshots or deterministic metadata tests.

## Validation Strategy

Use E-Track 1 and `kc-2000gt` as the first golden pair because they are already
wired into the current web probe.

Validation should include:

- native TORCS screenshot from a fixed camera and fixed car state
- browser screenshot from the same camera and car state
- track boundary overlay against converted track mesh
- car footprint/corners overlay against rendered car body
- transform checks for position, yaw, wheel pose, and track segment
- texture-reference manifest checks
- frame-time logging with one car, then multiple cars

For every visual feature, keep a debug overlay toggle. Debug overlays are the
fastest way to catch coordinate and scale mistakes.

## Main Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| AC3D conversion loses material or hierarchy details. | Start with a small parser/manifest validator and preserve object names, materials, textures, and LOD metadata. |
| Coordinate systems drift between TORCS and Three.js. | Centralize the transform once in `runtime.js` or `scene.js`; validate with track boundaries and car corners. |
| `.rgb` texture conversion changes alpha or color. | Build texture conversion tests and preserve alpha/cutout metadata in the manifest. |
| Browser renderer starts depending on native pointers. | Keep snapshot buffers and path-based metadata only. |
| Asset payload becomes too large. | Convert only selected tracks/cars first, then add compression, lazy loading, and per-event manifests. |
| Three.js abstractions hide too much for exact TORCS effects. | Use custom `BufferGeometry` and shader/material hooks for skid marks, billboards, and old-style fog if needed. |
| Full race engine integration blocks rendering progress. | Keep a small explicit web runtime mode for one-car and multi-car prototypes before full menu/race flow. |

## Recommended First Milestone

The first milestone should be intentionally narrow:

> Drive `kc-2000gt` on E-Track 1 in a Three.js scene, with converted track/car
> geometry, TORCS-derived car transform, chase camera, simple fog/light, and a
> debug overlay showing sampled track boundaries and car footprint.

This milestone proves the key claim: the original TORCS look can be closely
mimicked in a browser renderer while the actual simulation remains the TORCS
core running in WASM.

Once that is working, effects and HUD become incremental renderer work rather
than architecture risks.
