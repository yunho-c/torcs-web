# TORCS Web Screen-Space Effects Assessment

This note evaluates how suitable screen-space and post-processing style effects
are for the TORCS browser renderer after the move to three.js WebGPU-era usage.

## Overall Verdict

Screen-space effects are moderately applicable to this project, but they should
be added selectively. The web renderer's near-term goal is still TORCS visual
parity: low-poly AC3D-derived geometry, legacy-style materials, texture-driven
detail, simple lighting, fog, sky/background, sprites, and camera behavior.

The best candidates are effects that directly improve current parity gaps,
especially distant road texture clarity and track-surface material behavior.
Broad modern post effects should wait until screenshot capture and comparison
are closely aligned enough to judge whether they improve or hurt the TORCS look.

| Effect | Suitability | Rationale |
| --- | ---: | --- |
| Anisotropic filtering / distant texture sharpness | 9/10 | Directly addresses blurry road textures at distance, is cheap, and fits the existing asset pipeline. This should remain a high-priority baseline improvement. |
| Wet-road reflectivity | 7/10 when surface-driven, 4/10 when global | A good racing-sim feature if tied to track surface/material metadata. A global reflective pass would likely look artificial and drift away from TORCS parity. |
| Ambient occlusion | 6/10 | Can add contact depth around cars, barriers, props, and tree cards. It should be optional and subtle because TORCS' original look is more texture/lighting/fog driven than AO driven. |
| Temporal anti-aliasing | 5/10 | Could reduce shimmer on alpha cards, fences, road lines, and distant geometry, but it risks ghosting with fast cameras, sprites, HUD overlays, and fixed-step simulation playback. |
| Screen-space reflections | 3/10 | Fragile in racing views because reflections depend only on visible pixels, fail at screen edges, and interact poorly with low-poly scenery and alpha cards. Prefer simpler targeted reflection techniques first. |
| Bounced-light approximations / SSGI | 2/10 | Expensive, unstable, and not important for matching legacy TORCS visuals. The current Lambert/simple-material path does not justify this yet. |

## Current Constraints

- The renderer currently uses a direct `WebGPURenderer` render path, not a
  `RenderPipeline` post-processing path.
- The asset loader intentionally converts GLTF materials toward legacy
  `MeshLambertMaterial`-style shading instead of physically based rendering.
- Visual parity work is still more important than modernization: camera
  matching, sky/background, fog, lighting balance, texture sampling, and
  material conversion should stay ahead of screen-space polish.
- The scene contains many alpha-tested or transparent elements, including tree
  cards, smoke, fire, lights, skids, and shadows. These can produce artifacts in
  temporal or screen-space passes.
- HUD and controls are DOM overlays, so post effects should apply only to the
  3D canvas and should not assume a fully composited game framebuffer.

## Recommended Order

1. Keep improving texture sampling and distant sharpness first. This is the
   highest-value effect-like improvement and is already aligned with the asset
   manager's texture configuration.
2. Add wet-road support only as a surface/material feature. Prefer explicit
   track metadata or known road material names over a whole-screen reflective
   look.
3. Prototype lightweight ambient occlusion only after baseline screenshot
   comparisons show that contact depth is a real gap.
4. Defer temporal anti-aliasing until motion artifacts can be evaluated in the
   browser with representative tracks, cars, sprites, and camera modes.
5. Avoid screen-space reflections and SSGI unless the project goal changes from
   TORCS parity to a deliberately modernized renderer.

## RenderPipeline Guidance

If post-processing is added later, it should use the current three.js
`RenderPipeline` direction rather than the deprecated `PostProcessing` wrapper.
That should be treated as a separate milestone from the backend migration,
because it changes the visual pipeline and screenshot comparison baseline.

Good first RenderPipeline candidates would be narrow, measurable effects such
as custom fog/background composition or a subtle ambient-occlusion experiment.
SSR, SSGI, and TAA should not be first candidates.

## Acceptance Guidance

Screen-space work should be accepted only when it improves side-by-side browser
and native TORCS comparisons without introducing obvious artifacts in motion.
Useful checks include:

- distant road texture readability
- alpha-card tree and fence shimmer
- car contact depth and shadow grounding
- smoke, fire, skid, light, and shadow transparency behavior
- chase, onboard, trackside, and TV camera motion
- forced WebGL fallback behavior through `?renderer=webgl`

