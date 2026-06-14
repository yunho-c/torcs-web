# TORCS Web Graphical Remaster Strategy

This document outlines what it would take to move the TORCS web renderer from
legacy visual parity toward a modern racing-game remaster inspired by recent
racing titles and Assetto Corsa with Custom Shaders Patch-style enhancements.

The key point is that this would be a renderer and content-pipeline project,
not a small post-processing pass. Modern racing visuals come from a stack of
material classification, lighting, shadows, environment response, weather,
post-processing, asset quality, and tuning.

## Current Baseline

The current web renderer is intentionally conservative. It is now backed by the
three.js WebGPU build, but it still preserves the direct legacy-style render
path:

- `WebGPURenderer` renders the scene directly.
- There is no `RenderPipeline` post-processing stack yet.
- Lighting is one ambient light plus one directional sun light.
- Track metadata supplies background, fog, ambient, diffuse, and light-position
  values.
- Converted GLTF materials are reduced toward `MeshLambertMaterial` to preserve
  TORCS' simple diffuse look.
- Car shadows are planar/fake shadows rather than light-generated shadow maps.
- Smoke, fire, lights, skid marks, and background are sprite/basic-material
  effects rather than physically lit scene elements.

This is a good baseline for TORCS parity. A remaster should preserve this path
instead of replacing it outright.

## Remaster Pillars

### Material System

The first major requirement is material classification. Modern-looking racing
renderers depend heavily on knowing what each surface is, not just which diffuse
texture it uses.

The asset pipeline should classify or override materials into groups such as:

- asphalt, concrete, curb, grass, dirt, gravel, sand, barrier, glass, metal,
  rubber, car paint, lights, tree cards, signs, and buildings
- road-like surfaces that can become wet or reflective
- alpha-card surfaces that need special handling for trees, fences, smoke, and
  trackside details

The renderer can then apply a modern material profile with roughness, metalness,
specular/clearcoat, normal-map, emissive, and wetness controls. The first
version should infer classes from material names, texture names, object names,
and track surface metadata, then allow hand-authored overrides later.

### Lighting And Shadows

The current ambient-plus-sun setup should evolve into a more tunable lighting
model:

- keep track-derived sun direction and color as the starting point
- add real sun shadow maps for cars and important nearby track geometry
- introduce environment/sky lighting so surfaces respond to the sky backdrop
- add exposure, tone mapping, and color grading controls
- keep fake planar car shadows as an optional fallback or supplement
- promote headlights and brake lights from pure sprites to light contributors
  only after the main daylight path is stable

This should be tuned against screenshots. Too much physically based lighting on
old assets can make them look harsh or artificially shiny.

### Render Pipeline And Post Effects

Post-processing should be added after the material and lighting foundations are
in place. When added, it should use three.js' current `RenderPipeline` direction
rather than the deprecated `PostProcessing` wrapper.

Good early candidates:

- subtle ambient occlusion for contact depth
- bloom for sun, headlights, brake lights, and emissive surfaces
- exposure and color grading
- improved fog/sky composition
- anti-aliasing aimed at tree/fence/road-line shimmer

Deferred or risky candidates:

- screen-space reflections
- temporal anti-aliasing
- screen-space global illumination
- heavy motion blur

Those effects are more likely to artifact with fast racing cameras, billboard
sprites, alpha-card trees, HUD overlays, and low-poly legacy geometry.

### Wet Road And Weather

Wet-road rendering is the highest-impact modern feature, but it should be
surface driven rather than a global shiny filter.

A practical first version should:

- classify road and curb materials
- add a global or per-track wetness value
- darken wet asphalt
- reduce roughness on wet road surfaces
- add subtle sky/environment reflection on wet road
- adjust skid, smoke, dirt, and spray behavior based on surface wetness

Full rain, puddles, drying lines, droplets, wipers, dynamic accumulation, and
track evolution should be separate later phases.

### Asset Quality

Modern effects cannot fully compensate for old content. TORCS assets are
low-poly and mostly diffuse-texture driven. A convincing remaster will
eventually need asset improvements:

- higher-resolution road, terrain, curb, wall, and car textures
- generated or authored normal maps and roughness maps
- improved vegetation or tree-card replacements
- cleaner car paint, glass, light, rubber, and metal material metadata
- per-track material overrides for problem surfaces

Without these, advanced lighting can make the scene look like old assets with a
new shine rather than a modern racing game.

## Effort Ladder

| Level | Expected result | Rough effort |
| --- | --- | ---: |
| Visual polish pass | Sharper textures, better tone/color/fog, improved basic shadows | 1-2 weeks |
| Lightweight remaster | Material classes, PBR-ish profile, sun shadows, AO, bloom, wet-road prototype | 3-6 weeks |
| CSP-inspired renderer | Material overrides, weather/wetness, reflections, post stack, better lights | 2-4 months |
| Modern racing-game look | Reworked assets, advanced weather, tuned tracks/cars, authoring workflow | 6+ months |

The early levels are feasible within the current architecture. The later levels
require new content authoring and persistent visual QA, not only renderer code.

## Recommended Implementation Strategy

1. Preserve the current legacy parity path as the default baseline.
2. Add a separate `modern` render profile toggle for remaster work.
3. Extend the asset manifest with material classifications and optional material
   overrides.
4. Build a modern material adapter that can use PBR-ish materials while leaving
   the legacy Lambert conversion intact.
5. Add sun shadows and tone/exposure/color controls before advanced
   screen-space effects.
6. Add subtle ambient occlusion and bloom through a future RenderPipeline
   milestone.
7. Add wet-road behavior as a surface/material feature.
8. Defer SSR, TAA, SSGI, and heavy weather until the simpler modern profile is
   stable and screenshot comparisons are reliable.

This keeps the project from mixing too many risks at once. It also lets the web
renderer keep a known-good TORCS-style mode while the remaster profile evolves.

## Acceptance Criteria

A remaster phase should be accepted only when it improves browser screenshots
and motion without breaking the legacy baseline. Useful checks include:

- native TORCS parity mode still renders with the current legacy look
- modern mode improves road readability, car grounding, and material response
- sky, fog, tone, and exposure remain stable across camera modes
- alpha-card trees, fences, smoke, fire, lights, skids, and shadows do not show
  obvious sorting or temporal artifacts
- wet-road behavior affects road-like surfaces without making grass, trees, or
  buildings look globally glossy
- forced WebGL fallback through `?renderer=webgl` still has an acceptable
  degradation path

