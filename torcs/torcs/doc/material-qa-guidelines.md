# TORCS Web Material-Class QA Guidelines

These guidelines are for human and AI testers reviewing converted TORCS cars
and tracks before deeper graphical remaster and screen-space work. The goal is
to find surfaces whose inferred material class is wrong, record enough evidence
to fix them, and keep the legacy render profile unaffected.

## Purpose

The web asset converter assigns material classes from AC3D object names and
texture names. Those classes are embedded in GLB material extras as
`torcsMaterialClass`, summarized in `web-assets/manifest.json`, and used by the
renderer's modern profile for PBR-like material presets, wetness, and material
debug colors.

Material QA should answer:

- Are road, grass, curb, building, barrier, fence, tree, terrain, and car
  materials classified correctly?
- Do wetness and modern material presets affect only appropriate surfaces?
- Are unclassified materials acceptable, or should they receive a class?
- What exact source object or texture needs an override?

This is intentionally visual and evidence-driven. Do not guess from a screenshot
alone if the manifest or GLB metadata can identify the source material.

## Setup

1. Build or reuse a current wasm renderer build.

   ```sh
   just build
   just serve
   ```

   If `just build` is blocked by local Emscripten/Python configuration, use an
   already configured build directory and run:

   ```sh
   cmake --build torcs/torcs/build-wasm --target torcs_web_renderer_browser
   ```

2. Open the renderer:

   ```text
   http://127.0.0.1:8002/torcs_web_renderer.html
   ```

3. Open `Settings` from the Gear row.

4. Set:

   - Render: `Modern`
   - Material classes: enabled
   - Skybox: optional, but keep it consistent during a pass
   - ACES tone mapping: optional, but keep it consistent during a pass
   - Wetness: `0.00` for classification QA; use `1.00` only for wetness QA

5. Choose one track/car pair and start the session. Inspect with several camera
   modes, including chase, overhead, road fixed, and TV director. Use the FPS
   debug camera when close inspection is needed.

## Debug Color Reference

The debug colors come from `MATERIAL_DEBUG_COLORS` in
`src/web/renderer/assets.js`. The exact hue is less important than consistency,
but use this class list when recording findings:

| Area | Expected classes |
| --- | --- |
| Road driving surface | `road`, sometimes `concrete` for concrete pavement |
| Painted curbs and rumble strips | `curb` |
| Grass runoff and green terrain | `grass` or `terrain` |
| Sand, dirt, gravel runoff | `sand` or `terrain` when no better class exists |
| Walls, guardrails, Armco, blocks | `barrier`, `concrete`, or `tireWall` |
| Chain link and transparent fencing | `fence` |
| Trackside buildings, bridges, stands | `building` |
| Signs and banners | `sign` |
| Trees and flat vegetation cards | `treeFoliage` |
| Car painted body panels | `body` |
| Car windows and windshields | `glass` or `mirrorGlass` |
| Headlights and tail lamps | `headlamp` or `taillamp` |
| Tires, rims, brakes | `wheelTire`, `wheelRim`, `wheelBrake` |
| Exhaust, dark trim, cockpit, driver | `exhaust`, `blackTrim`, `interior`, `driver` |

`unclassified` is not automatically a bug. Small one-off props can remain
legacy-like if they look correct and do not need remaster behavior. It is a bug
when an unclassified surface should participate in material-specific behavior,
such as wet road response, glass transparency, emissive lights, or vegetation
alpha handling.

## What To Inspect

### Tracks

Inspect each converted track in both normal modern view and material-debug view.
For every track, check:

- Main road surface: should be consistently `road` across straights, turns,
  pit lane if visually road-like, and alternate road patches.
- Curbs: should be `curb`, not `road`, `barrier`, or `building`.
- Grass and terrain: should not be `road`, especially near road edges and
  runoff areas.
- Sand/dirt/gravel: should not become wet/glossy with wetness enabled.
- Barriers and fences: should not be classified as road or grass.
- Buildings, bridges, pits, stands, and signs: should not be classified as road
  or curb.
- Tree cards: should be `treeFoliage` and retain alpha-cutout behavior.
- Track shadow/skid overlays: should remain overlays, not ordinary road or
  terrain material findings.

For wetness QA, set Wetness to `1.00` after classification QA:

- Road and curb may darken and become more reflective.
- Grass, trees, buildings, barriers, fences, signs, and sand should not become
  globally glossy.
- If a surface changes with wetness but should not, it is probably classified as
  `road` or `curb` incorrectly.
- If road-like pavement does not change with wetness, it is probably
  unclassified or misclassified.

### Cars

Inspect every converted car in modern material-debug view. Use chase, side,
front, rear, and cockpit/bonnet cameras where useful. Check:

- Painted exterior panels should be `body`.
- Windshield, side windows, and transparent covers should be `glass`.
- Mirrors should be `mirrorGlass` when separable.
- Headlights should be `headlamp`; rear/brake lenses should be `taillamp`.
- Black rubber trim, splitters, vents, and carbon-like details should be
  `blackTrim` unless they are clearly painted body.
- Tires should be `wheelTire`, rims `wheelRim`, brakes `wheelBrake`.
- Exhaust pipes should be `exhaust`.
- Cockpit surfaces should be `interior`; driver geometry should be `driver`.

Car misclassification usually shows up as wrong reflectance in modern mode:
paint too matte, glass opaque, tires shiny, lamps not emissive, or cockpit
surfaces treated like exterior paint.

## Evidence To Record

Every finding should include enough information for an implementer to add a
converter rule or material override without re-discovering the issue.

Use this format:

```md
### <track-or-car-id>: <short issue title>

- Asset: `<manifest path or UI label>`
- Renderer URL/settings: `profile=modern`, material debug on, wetness `<value>`
- Camera/view: `<camera mode or FPS debug position>`
- Expected class: `<class>`
- Actual class/color: `<class if known, or debug color>`
- Visible issue: `<what looks wrong>`
- Source texture: `<texture name if known>`
- Source object names: `<object names if known>`
- Evidence: `<screenshot path, manifest excerpt, GLB material excerpt>`
- Suggested fix: `<classifier rule or override>`
```

Prefer source texture and object names over vague descriptions like "left wall"
or "green patch". The converter records these in material metadata:

- GLB material extras: `torcsSourceTexture`, `torcsObjectNames`,
  `torcsMaterialClass`
- Manifest material records: `materials[].class`, `materials[].texture`,
  `materials[].objectNames`

## Finding Source Metadata

The easiest source of truth is the generated manifest:

```sh
python3 -m json.tool torcs/torcs/build-wasm/web-assets/manifest.json > /tmp/torcs-web-manifest.json
rg -n '"materialClasses"|"materials"|"texture"|"objectNames"' /tmp/torcs-web-manifest.json
```

For a specific track or car, search by asset id:

```sh
rg -n 'e-track-1|kc-2000gt|materialClasses|objectNames' /tmp/torcs-web-manifest.json
```

When the manifest is not enough, inspect the GLB JSON chunk. Use any GLB
inspector that shows material `extras`, or add a small local script that reads
the JSON chunk and prints materials. The important fields are:

```json
{
  "extras": {
    "torcsSourceTexture": "example.rgb",
    "torcsObjectNames": ["object-name"],
    "torcsMaterialClass": "road"
  }
}
```

## Override Guidance

The current classifier lives in `tools/web-assets/convert_torcs_assets.py`:

- `classify_track_object(name, texture)`
- `classify_car_object(name, texture)`
- `classify_wheel_object(name, texture)`

For broad, repeatable errors, prefer improving the classifier. Examples:

- all textures matching a known road naming pattern should become `road`
- all tire-wall textures should become `tireWall`
- a common headlamp object-name prefix should become `headlamp`

For one-off or asset-specific errors, record an override request instead of
adding an overly broad pattern. A good override request identifies:

- asset path, such as `data/tracks/.../...xml` or `data/cars/models/.../...xml`
- source AC/ACC object name
- source texture name
- current class
- desired class
- reason the rule should be asset-specific

Do not add a broad classifier pattern from one screenshot. Check at least two
assets, or prove from source names that the pattern is unambiguous.

## Acceptance Criteria For A QA Pass

A track or car is ready for remaster tuning when:

- No road/curb/grass/building/car-body class errors are visible in material
  debug mode.
- Wetness affects road-like and curb surfaces only.
- Alpha-card trees/fences still cut out correctly in modern mode.
- Important car materials have plausible classes: paint, glass, lamps, trim,
  tires, rims, brakes, interior.
- Remaining unclassified materials are documented as acceptable or filed as
  override requests.
- Findings include source texture and object names whenever possible.

## Common Mistakes

- Treating color mismatch as material-class mismatch. First verify the debug
  class; color/tone tuning is a separate issue.
- Testing only the default chase camera. Some wrong classes are obvious only
  from overhead, side, road, or FPS debug views.
- Enabling wetness during first-pass classification. Wetness is a second pass.
- Filing "looks wrong" without source texture or object names.
- Using a broad converter pattern for an asset-specific naming accident.
- Forgetting that legacy profile must remain a baseline and should not be
  changed to fix modern material classification.
