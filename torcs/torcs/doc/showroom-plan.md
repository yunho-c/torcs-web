# TORCS Web Showroom Background Plan

## Goal

Raise the TORCS Web showroom background quality toward the VW Virtual Studio
standard while keeping the implementation owned by TORCS-Web. The target is a
full-screen car selection experience where the car feels grounded in a designed
studio scene, not placed over a flat page gradient.

## VW Findings

VW Virtual Studio treats backgrounds as content, not decoration. The public app
loads a shell, then per-car JSON such as `cars/golf-gti-my26.json`. That JSON
selects a scene and exposes a background grouping named `BG Colors`.

The rendering bundle uses a 3DCommerce/VisCircle stack with environment assets,
HDR/VHDR cubemaps, tone mapping, screen-space effects, KTX2/Basis/Draco loading,
and content-driven scene states. The local VW manifest snapshot in this repo
shows named `BACKGROUND` assets such as Studio HDR, Light Studio, Evening Road,
Parking Lot Brunswick, Volkswagen Arena, Mondello Beach, and Estadio Puebla.

The important pattern is that VW pairs:

- image-based lighting for reflections,
- visible cubemap or skydome background,
- authored ground/road/floor geometry,
- shadow catcher and wheelhouse shadow materials,
- scene states that swap environment and skydome together.

The TORCS-Web implementation should copy that architecture pattern, not VW's
production assets.

## Current TORCS State

The showroom already loads `web/hdri/120_hdrmaps_com_free_2K.exr` and assigns it
to `scene.environment`, so car paint and glass can receive image-based lighting.
The first showroom pass moved this into the renderer, but still read as a
separate wall/floor setup. The live VW exterior view reads more like a seamless
colored product cyclorama: a controlled gradient sweep, hidden floor transition,
rear glow, and broad soft contact shadow.

That means TORCS has decent reflection input but not a convincing visible
studio. The main gap is environment presentation: seamless backdrop, floor
transition, tonal palette, and contact grounding.

## Implementation Strategy

Stage 1 should be procedural and dependency-free:

- keep the existing EXR for lighting and reflections,
- add a showroom background preset system with a default `studio-dark` preset,
- render an in-scene cyclorama mesh that curves from floor into backdrop,
- use procedural canvas textures for sweep gradients, rear glow, floor depth,
  grain, and contact shadow,
- keep post-processing out of the first pass,
- keep the main driving renderer unchanged.

Stage 2 can add licensed background assets:

- curated HDRI/skydome packs with attribution,
- per-preset environment intensity and tone exposure,
- optional track-paddock or garage presets.

Stage 3 can add content selection:

- per-car or per-category showroom presets,
- user-facing background selector,
- screenshot/export-friendly preset metadata.

## Acceptance Criteria

- The showroom no longer depends on the HTML gradient as its primary background.
- Cars sit on a seamless studio sweep with stronger contact grounding.
- The existing EXR remains bound as the reflection environment.
- No VW production URLs or licensed VW assets are committed into runtime code.
- Smoke tests guard the background preset, studio geometry, EXR lighting, and
  no-postprocessing constraint.
