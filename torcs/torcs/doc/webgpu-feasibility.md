# TORCS WebGPU Three.js Feasibility

This document evaluates whether the browser renderer should migrate from the
current WebGL-oriented three.js path to WebGPU-era three.js usage.

## Feasibility Verdict

The migration is feasible, but it should be staged. The first milestone should
move the renderer backend to `WebGPURenderer` while preserving the current
direct scene render path. RenderPipeline and TSL-based effects should be a
follow-up after the backend boots reliably and visual parity is understood.

The current renderer is structurally friendly to this migration:

- `TorcsScene` owns renderer creation.
- `main.js` has one render call path through `scene.render(camera)`.
- `AssetManager` only needs renderer access for anisotropy capability.
- Current visual effects are built from standard three.js meshes, sprites,
  textures, and materials, not custom WebGL shader programs.
- The project does not currently use deprecated `PostProcessing` or
  `EffectComposer`.

The migration is not a one-line replacement because current three.js WebGPU
usage changes imports, renderer initialization, and potentially some renderer
capability assumptions.

## Current Renderer State

The current browser renderer uses a CDN import map pinned to `three@0.165.0`:

```html
"three": "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js",
"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/"
```

`src/web/renderer/scene.js` constructs a WebGL renderer directly:

```js
this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
```

The render loop is still direct:

```js
this.renderer.render(this.scene, camera);
```

There is no bundler, package lock, or local npm dependency for three.js. The
browser build copies static JavaScript files and relies on the HTML import map.

## Relevant Three.js Direction

Current three.js documentation describes `WebGPURenderer` as the newer
alternative to `WebGLRenderer`. It is imported from the WebGPU build:

```js
import * as THREE from "three/webgpu";
```

The recommended import map shape includes:

```json
{
  "imports": {
    "three": "../build/three.webgpu.js",
    "three/webgpu": "../build/three.webgpu.js",
    "three/tsl": "../build/three.tsl.js",
    "three/addons/": "./jsm/"
  }
}
```

The docs also state that `WebGPURenderer` uses WebGPU when available and falls
back to a WebGL 2 backend when WebGPU is unavailable. Three.js examples call
`await renderer.init()` before rendering, so the TORCS renderer startup should
be made async.

For postprocessing, current docs say `PostProcessing` is deprecated since r183
and has been renamed to `RenderPipeline`. The TORCS web renderer does not use
either today. Future WebGPU-era effects should use `RenderPipeline`, not the
deprecated compatibility wrapper.

Reference pages:

- `manual/en/webgpurenderer.html`
- `docs/pages/WebGPURenderer.html`
- `docs/pages/PostProcessing.html.md`

## Migration Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| three.js version jump | `0.165.0` to r183+ may alter material, color, loader, or renderer behavior. | Upgrade in one scoped step and verify visuals before adding pipeline effects. |
| Async renderer initialization | `main.js` currently constructs `TorcsScene` synchronously. | Add `TorcsScene.create(canvas)` and only construct `AssetManager` after the renderer is initialized. |
| Capability API differences | `renderer.capabilities.getMaxAnisotropy()` may not exist on every WebGPU/WebGL backend path. | Guard the anisotropy helper and fall back to `1`. |
| Visual parity drift | Lighting, fog, sprites, alpha, and texture sampling may differ after the backend switch. | Preserve direct rendering first; compare screenshots before changing effects. |
| Browser coverage | WebGPU is not universal across all browser/device combinations. | Use `WebGPURenderer` fallback and keep an explicit debug `forceWebGL` path. |
| Smoke coverage | Current renderer smoke tests are mostly file/static checks. | Add a browser-level canvas nonblank check for the renderer page. |

## Recommended Implementation Plan

### 1. Upgrade import map and module imports

- Pin the renderer HTML import map to a current r183+ three.js release.
- Add import map entries for `three/webgpu` and `three/tsl`.
- Map `three` and `three/webgpu` to the WebGPU build.
- Keep `three/addons/` pinned to the same release.
- Change renderer modules that import core three.js APIs from `"three"` to
  `"three/webgpu"` where they need the WebGPU build symbols.
- Keep addon imports such as `GLTFLoader` on `three/addons/...`.

### 2. Add async renderer creation

- Replace direct `new TorcsScene(canvas)` startup with an async scene factory,
  for example:

```js
const scene = await TorcsScene.create(elements.canvas);
```

- Inside the factory, create:

```js
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
await renderer.init();
```

- Preserve existing pixel ratio, clear color, output color space, resize, fog,
  lighting, and render behavior.
- Move `AssetManager("./web-assets/", scene.renderer)` after the async scene
  creation so texture configuration sees the initialized renderer.

### 3. Keep direct rendering for the first milestone

- Keep `scene.render(camera)` calling `renderer.render(scene, camera)`.
- Do not introduce `RenderPipeline` in the first backend migration.
- Keep current `MeshLambertMaterial`, `MeshBasicMaterial`, `SpriteMaterial`,
  `Fog`, background dome, skid marks, smoke/fire sprites, and light sprites.
- Add a debug renderer option, such as `?renderer=webgl`, that constructs
  `WebGPURenderer({ canvas, antialias: true, forceWebGL: true })` for fallback
  validation.

### 4. Harden renderer-dependent asset code

- Change `AssetManager.getMaxAnisotropy()` to tolerate missing capability APIs:

```js
const caps = this.renderer && this.renderer.capabilities;
return caps && typeof caps.getMaxAnisotropy === "function"
  ? caps.getMaxAnisotropy()
  : 1;
```

- Keep texture color space, mipmap, min/mag filter, and alpha-test behavior
  unchanged.

### 5. Update smoke and browser validation

- Update `smoke_renderer_files.js` to assert:
  - the HTML import map includes `three/webgpu` and `three/tsl`
  - `scene.js` imports from `three/webgpu`
  - `WebGPURenderer` is used instead of `WebGLRenderer`
  - renderer initialization is awaited
  - the anisotropy fallback exists
- Keep `just smoke` as the fast regression gate.
- Add a browser smoke test when practical:
  - serve `build-wasm`
  - open `torcs_web_renderer.html`
  - start a session
  - wait for one rendered frame
  - assert the canvas is nonblank
  - fail on console errors
- Manually inspect both default and `?renderer=webgl` modes before accepting the
  migration.

## RenderPipeline Follow-Up

After the WebGPU backend migration is stable, consider moving selected effects
to `RenderPipeline` and TSL. The first candidate is custom distance fog or
background composition, because three.js provides WebGPU examples for custom fog
using a render pipeline.

Do not use the deprecated `PostProcessing` wrapper. If postprocessing is added,
use `RenderPipeline` directly.

This should be a separate milestone because it changes the visual pipeline, not
just the renderer backend.

## Acceptance Criteria

The backend migration is complete when:

- The renderer imports three.js through the WebGPU build.
- `TorcsScene` initializes a `WebGPURenderer` asynchronously.
- The browser page still loads the WASM runtime, track, car, skybox, lights,
  smoke/fire, skid marks, HUD, audio controls, and selectable cars/tracks.
- The fallback WebGL 2 backend can be forced for debugging.
- `just smoke` passes.
- Manual browser inspection shows no blank canvas, fatal console errors, or
  obvious rendering regressions versus the current WebGL path.

RenderPipeline work is explicitly not required for this first acceptance gate.
