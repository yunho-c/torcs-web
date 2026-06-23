# Speed Dreams Asset Import for TORCS-Web

This document summarizes the current state of Speed Dreams asset support in
TORCS-Web and outlines what is needed to make converted Speed Dreams cars and
tracks function as runtime simulation inputs, not only as visual assets.

## Summary

Speed Dreams asset import is feasible, but the current implementation is mostly
a visual conversion path. Converted Speed Dreams tracks and cars can appear in
the browser asset manifest and dropdowns, but non-TORCS entries currently fall
back to the default TORCS runtime data for simulation.

The recommended target is staged:

1. Make Speed Dreams tracks usable by the WASM runtime.
2. Make Speed Dreams cars usable by the WASM runtime.
3. Add tests that prove selected Speed Dreams runtime XMLs actually drive the
   simulation.
4. Treat Speed Dreams AI/robot parity as a later, separate problem.

## Current State

The browser asset converter supports multiple asset sources through
`--extra-source` in `tools/web-assets/convert_torcs_assets.py`. Generated visual
assets are written under `web-assets/`, and entries are namespaced in
`manifest.json`, for example:

- `torcs:data/tracks/e-track-1/e-track-1.xml`
- `speed-dreams:data/tracks/circuit/jarama/jarama.xml`
- `speed-dreams-nordschleife:nordschleife.xml`
- `speed-dreams-sc-boxer-96:sc-boxer-96.xml`

The renderer dropdowns are manifest-driven. In
`src/web/renderer/main.js`, `populateAssetSelects()` reads
`web-assets/manifest.json` through `AssetManager` and builds track/car options
from `manifest.tracks` and `manifest.cars`.

This means the dropdown values are currently visual asset identifiers. They are
not guaranteed to be paths that exist in the Emscripten virtual filesystem.

The current runtime startup path still expects TORCS-style XML paths:

- `src/web/renderer/runtime.js` calls
  `torcs_web_runtime_start_multi_with_files(trackPath, carPath, carCount)`.
- `src/web/torcs_web_probe.cpp` defaults to
  `/torcs/data/tracks/e-track-1/e-track-1.xml` and
  `/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml`.
- `src/web/renderer/main.js` maps non-TORCS visual selections back to those
  defaults before starting the runtime.

So a Speed Dreams selection can currently render a converted visual GLB while
the physics/runtime still uses the TORCS golden pair underneath.

## Current WASM Packaging Gap

`CMakeLists.txt` preloads TORCS runtime XML data into the browser filesystem,
including:

- TORCS track XMLs under `/torcs/data/tracks/...`
- TORCS car XMLs under `/torcs/data/cars/models/...`
- TORCS car category XMLs under `/torcs/data/cars/categories/...`
- shared TORCS `objects.xml` and `surfaces.xml`
- Inferno2 driver XMLs

Speed Dreams runtime XMLs are not currently staged or preloaded into the WASM
filesystem. The converted GLB and texture assets live under `web-assets/`, but
the native TORCS track/car loaders do not read simulation data from
`web-assets/manifest.json`.

Functional Speed Dreams runtime support needs a packaging bridge from converted
visual manifest entries to actual `/torcs/data/...` files available inside the
Emscripten filesystem.

## Track Import Feasibility

Track import looks relatively approachable.

The inspected Speed Dreams tracks still use TORCS-like track XML structure.
Jarama and Nordschleife include familiar sections such as:

- `Header`
- `Graphic`
- `Main Track`
- `Surfaces`
- `Objects`
- `Cameras`

They also include Speed Dreams-specific or optional sections such as
`Track Lights`, `Local Info`, `Starting Grid`, and `Sectors`. The TORCS track
loader should mostly ignore unknown or unused sections, as long as the core
track definition and referenced entities can be resolved.

The main track-side risks are:

- XML external entity resolution for shared `surfaces.xml` and `objects.xml`.
- Standalone Speed Dreams repositories that do not naturally live under a
  `data/tracks/<category>/<name>/...` tree.
- Large tracks, especially Nordschleife, stressing runtime load time, memory,
  and sampling assumptions.
- Runtime track samples and converted visual meshes having different origins or
  bounds unless explicitly aligned.

Jarama should be the first runtime-track target because it already lives inside
the Speed Dreams data tree as `data/tracks/circuit/jarama/jarama.xml`.
Nordschleife should come after the runtime packaging path can synthesize a
stable TORCS-style path for standalone asset repositories.

## Car Import Feasibility

Car import is feasible but more involved than track import.

Speed Dreams cars such as Cavallo 360 and Boxer 96 still contain many TORCS-like
sections:

- `Car`
- `Graphic Objects`
- `Engine`
- `Clutch`
- `Gearbox`
- `Drivetrain`
- wheel, axle, suspension, and brake sections

They also include Speed Dreams extensions such as additional feature flags,
turbo parameters, driver/bonnet sections, and richer sound metadata. The TORCS
simulation should ignore many unknown parameters, but the merged setup still
needs to pass TORCS parameter validation.

The main car-side incompatibility is category layout.

TORCS car categories are nested, for example:

```text
data/cars/categories/Historic/Historic.xml
```

Speed Dreams categories are commonly flat, for example:

```text
data/cars/categories/Supercars.xml
```

`src/web/torcs_web_probe.cpp` currently builds category paths using the TORCS
nested layout when merging a car setup. A Speed Dreams car with category
`Supercars` will therefore need either:

- a staged alias at `/torcs/data/cars/categories/Supercars/Supercars.xml`, or
- broader category lookup logic in `loadMergedCarSetup()`.

The first target should be a selected player car on a known TORCS track. AI
opponents can continue to use existing TORCS cars until Speed Dreams robot
support and per-track setups are treated separately.

## Implementation Plan

### 1. Add Runtime Metadata to the Web Asset Manifest

Extend the converter so each track/car entry can optionally declare runtime
metadata:

```json
{
	"runtimePath": "/torcs/data/tracks/circuit/jarama/jarama.xml",
	"runtimeSupported": true
}
```

The visual manifest key should remain namespaced and stable. The runtime path
should point to the normalized path that will exist inside the Emscripten
filesystem.

For assets that are visual-only, omit `runtimePath` or set
`runtimeSupported: false`.

### 2. Stage Speed Dreams Runtime XMLs

Add a build step that stages Speed Dreams runtime files into a normalized
TORCS-compatible directory tree before Emscripten preloading.

For data-root Speed Dreams assets, preserve their source layout:

```text
/torcs/data/tracks/circuit/jarama/jarama.xml
/torcs/data/cars/models/sc-cavallo-360/sc-cavallo-360.xml
/torcs/data/cars/categories/Supercars.xml
```

For standalone repositories, synthesize a stable layout:

```text
/torcs/data/tracks/road/nordschleife/nordschleife.xml
/torcs/data/cars/models/sc-boxer-96/sc-boxer-96.xml
```

Also stage any XML files required for entity resolution, especially shared
track `surfaces.xml` and `objects.xml`.

### 3. Preload the Staged Runtime Files

Extend `CMakeLists.txt` so the staged Speed Dreams runtime XML files are added
to the Emscripten `--preload-file` list.

This should be kept separate from `web-assets/`: GLBs, textures, and audio are
browser-renderer assets, while XML files under `/torcs/data/...` are native
runtime inputs for the TORCS track, car, and simulation modules.

### 4. Resolve Runtime Paths in the Renderer

Update `src/web/renderer/main.js` so selected visual manifest entries can map
to runtime paths when available.

Current behavior:

- TORCS manifest key -> TORCS runtime path
- non-TORCS manifest key -> default E-Track 1 / kc-2000gt runtime fallback

Target behavior:

- manifest entry with `runtimePath` -> pass that runtime path to
  `runtime.start()`
- manifest entry without runtime support -> keep the current default fallback
  and warn clearly

This preserves visual-only conversion while enabling functional imports one
asset at a time.

### 5. Fix or Alias Car Category Lookup

Either stage Speed Dreams categories into TORCS's nested layout or update
`loadMergedCarSetup()` to try both layouts:

```text
/torcs/data/cars/categories/<category>/<category>.xml
/torcs/data/cars/categories/<category>.xml
```

The alias approach is less invasive. The broader lookup approach is more
explicit and may be useful if future external sources use other category
layouts.

### 6. Add Runtime Smoke Tests

Add tests that prove selected Speed Dreams assets are used by the simulator,
not only by the renderer.

Useful first tests:

- Start Jarama with `kc-2000gt` and assert runtime track samples load.
- Start Nordschleife with `kc-2000gt` and assert runtime track samples load.
- Start E-Track 1 with Boxer 96 and assert the selected car model is used.
- Start Jarama with Boxer 96 once the individual track and car tests pass.

The tests should verify observable runtime state such as:

- non-empty track samples
- track bounds differing from E-Track 1 for Speed Dreams tracks
- car dimensions and mass are finite and plausible
- selected car model name matches the requested Speed Dreams car
- runtime startup does not silently fall back to defaults

## Suggested Milestones

| Milestone | Scope | Expected difficulty |
| --- | --- | --- |
| Visual-only Speed Dreams assets | Already mostly implemented. | Done / low |
| Jarama runtime track | Package SD track XML and pass real runtime path. | Medium |
| Nordschleife runtime track | Add standalone repo path normalization and large-track validation. | Medium |
| Boxer 96 runtime car | Package car XML and solve category lookup. | Medium-high |
| Cavallo 360 runtime car | Same pipeline as Boxer 96 once category support works. | Medium |
| Mixed SD track + SD car | Validate startup and runtime state together. | Medium-high |
| SD AI/robot parity | Use real robot modules and SD setups. | High |

## Out of Scope for the First Runtime Import

The first functional import pass should not try to solve everything at once.
These items should remain follow-ups:

- Speed Dreams robot driver modules.
- AI behavior parity on Speed Dreams tracks.
- Speed Dreams-specific graphics effects beyond converted GLB/material support.
- Full Speed Dreams race configuration support.
- Writable driver setup or learning data.
- Packaging every Speed Dreams asset repository.

The practical first success criterion is simple: selecting a supported Speed
Dreams track or car should make the WASM runtime load that XML data, and tests
should fail if the runtime silently falls back to E-Track 1 or `kc-2000gt`.

