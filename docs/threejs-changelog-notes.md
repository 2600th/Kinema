# Three.js Changelog Notes For Kinema

Last reviewed: 2026-06-14

Kinema is currently pinned to `three` and `@types/three` `~0.183.0`. These notes summarize the Three.js migration-guide and current-doc points that matter most for this repo's WebGPU-first renderer, WebGL compatibility fallback, level editor, loaders, materials, and browser tests.

Sources consulted:

- Three.js migration guide: <https://github.com/mrdoob/three.js/wiki/Migration-Guide>
- Three.js releases: <https://github.com/mrdoob/three.js/releases>
- Context7 MCP, library `/mrdoob/three.js`, queried for current WebGPURenderer, TSL, RenderPipeline, loader, and TransformControls guidance.

Treat these notes as repo guidance, not a substitute for reading the exact migration section for the target version before upgrading.

## Upgrade Rule

Three.js recommends upgrading old projects in increments of about 10 releases because deprecation warnings are kept for about 10 releases. For this repo, use smaller increments when possible because the renderer path depends on newer WebGPU, TSL, and addon APIs that have been moving quickly.

For any Three.js bump:

- Upgrade `three` and `@types/three` together.
- Review the migration sections from the current pinned release to the target release.
- Run both renderer paths: default WebGPU-first path and `/?forceWebGL=1`.
- Also run `/?forceWebGPUWebGL=1` when touching renderer bootstrap or TSL code.
- Re-check visual output for materials, sky, PMREM/environment lighting, shadows, transparent VFX, and postprocessing.
- Run at least `npx.cmd --no-install tsc`, `npm.cmd run typecheck:tests`, `npm.cmd run test`, `npm.cmd run build`, and the relevant Playwright specs.

## Repo Hotspots

These files are the first places to inspect after a Three.js update:

- `src/renderer/rendererBootstrap.ts`: `WebGPURenderer` construction, `await renderer.init()`, fallback WebGL renderer, shadow map type.
- `src/renderer/RendererManager.ts`: WebGPU fallback handoff, `RenderPipeline`, TSL runtime imports, PMREM/environment handling, output color transform.
- `src/renderer/rendererPipelineBuilder.ts`: TSL node graph and `RenderPipeline` setup.
- `src/level/AssetLoader.ts`: `GLTFLoader`, `DRACOLoader`, `KTX2Loader.detectSupport(renderer)`, compressed texture support.
- `src/level/GrassEffect.ts`, `src/level/VfxShowcase.ts`, `src/level/ProceduralBuilder.ts`: TSL and `three/webgpu` node materials.
- `src/editor/TransformGizmo.ts`: `TransformControls` helper attachment.
- `src/character/animation/CharacterModel.ts` and VFX/material code: transparent materials and `premultipliedAlpha`.

## Release Notes To Remember

### r184 to r185

- `WebGPURenderer` changed premultiplied-alpha behavior. If blending or HTML-background compositing changes, prefer an opaque `Scene.background` or opaque `renderer.setClearColor()` unless the page truly needs transparent canvas blending.
- `Object3D.updateWorldMatrix()` now honors `Object3D.matrixWorldNeedsUpdate`. If code sets `matrixAutoUpdate = false` and mutates matrices directly, set `matrixWorldNeedsUpdate = true`.
- `DRACOLoader.setDecoderConfig()` is deprecated. Keep decoder setup simple and prefer path/worker-limit configuration unless upstream requires otherwise.
- Several TSL names continue to move. Check all `three/tsl` imports during any bump.

### r183 to r184

- `FileLoader.load()` and `ImageBitmapLoader.load()` no longer return a value. Use callbacks or `loadAsync()`; do not rely on a returned request or image handle.
- Background and environment map rotation changed to align with object rotation. Re-check `scene.background`, `scene.environment`, PMREM, and any custom environment node work.
- `FBXLoader` automatically converts +Z-up models to +Y-up. Remove manual correction only after checking affected assets.

### r182 to r183

- `PostProcessing` was renamed to `RenderPipeline`. This repo already uses `RenderPipeline`; avoid reintroducing old naming in new code.
- `Clock` is deprecated in favor of `Timer`. Kinema mostly owns its own timing, but avoid new `THREE.Clock` usage.
- WebGPU shadows changed. If upgrading across this boundary, revisit shadow bias values and inspect acne/peter-panning in both renderer paths.
- `WebGLCubeRenderTarget` cannot be used with `WebGPURenderer`; use `CubeRenderTarget`.
- `RoomEnvironment` PMREM and `Sky`/`SkyMesh` output changed visually. Re-check environment lighting and sky-like procedural materials.

### r181 to r182

- `PCFSoftShadowMap` with `WebGLRenderer` is deprecated; `PCFShadowMap` is now the soft path. Kinema uses `PCFShadowMap`, which matches this direction.
- `WebGPURenderer` `colorBufferType` was renamed to `outputBufferType`. Use current names in renderer settings and tests.

### r180 to r181

- PBR lighting and PMREM reflections changed. Rough materials may appear brighter and reflections can shift. After an upgrade, review screenshots for `materials`, `vfx`, `vehicles`, and any imported GLB assets.
- `WebGPURenderer` async rendering helpers were deprecated/removed in favor of initializing the renderer before synchronous use. Kinema should keep explicit `await renderer.init()` in bootstrap paths and call KTX2 support detection only after the renderer is initialized.
- `KTX2Loader.detectSupportAsync()` is deprecated. Context7 current docs show `.detectSupport(renderer)` and state it must be called before loading textures.
- TSL and node postprocessing resolution APIs changed to `resolutionScale` naming in several places. Check `rendererPipelineBuilder` if any pass APIs move again.

### r179 to r180

- `RGBELoader` was renamed to `HDRLoader`. Kinema already imports `HDRLoader`; new code should not use `RGBELoader`.
- Several WebGPU postprocessing nodes and resolution properties changed. Prefer current examples when editing depth of field, blur, reflector, or anamorphic-style effects.
- WebGL shader defines for reverse/log depth buffer were renamed. Search custom shader code if enabling those features.

### r178 to r179

- `Timer` moved into core. If Kinema eventually replaces custom timing with Three's timer, import/use the current core API.
- `reverseDepthBuffer` became `reversedDepthBuffer`.
- TSL `label()` became `setName()`.

### r177 to r178

- `MultiplyBlending` and `SubtractiveBlending` require `Material.premultipliedAlpha = true`. Kinema has additive/transparent VFX and manually sets `premultipliedAlpha` in several places, so inspect blending when changing material modes.

### r176 to r177

- Color-management helpers were renamed to `workingToColorSpace()` and `colorSpaceToWorking()`.
- The JSON Object Scene format version changed. Be careful if editor exports/imports ever move toward Three's object JSON format instead of Kinema's own level JSON.

### r175 to r176

- `CapsuleGeometry` `length` was renamed to `height`.
- `GLTFLoader` no longer detects WebP/AVIF support internally. Keep asset-format assumptions explicit.

### r174 to r175

- `Controls.connect()` requires a DOM element. Addon control lifecycle code should always pass the renderer canvas or intended DOM target.

### r173 to r174

- `Timer` no longer automatically uses the Page Visibility API. If adopting `Timer`, call `timer.connect(document)` only if that behavior is desired.
- `RenderTarget.clone()` now performs a full structural clone without sharing texture resources. Re-check disposal assumptions if cloning render targets.

### r172 to r173

- Several TSL functions and objects were renamed: `varying()` to `toVarying()`, `vertexStage()` to `toVertexStage()`, `TextureNode.uv()` to `TextureNode.sample()`, fog helpers, and material AO names. Search every `three/tsl` import when upgrading.
- `PostProcessingUtils` became `RendererUtils`.

### r170 to r171

- WebGPU and TSL imports were split. Use:
  - `three/webgpu` for `WebGPURenderer`, node materials, `RenderPipeline`, WebGPU-specific exports.
  - `three/tsl` for TSL functions and nodes.
- This matches Kinema's current pattern. Do not collapse these imports back into plain `three`.

### r169 to r170

- `Material.type` became static and cannot be modified by app code. Avoid using material type mutation to force uniforms, cache keys, or shader rebuilds.
- TSL modules moved between core/addons. Again, audit imports on upgrade.
- Mipmaps are generated whenever `Texture.generateMipmaps` is true, regardless of filter settings. Check texture memory/load costs for compressed and generated textures.

### r168 to r169

- `TransformControls` now derives from `Controls`; add its visual representation via `controls.getHelper()`, not by adding `controls` directly to the scene. Kinema's `TransformGizmo` already does this.
- Some exporter and generator APIs became async. Use `parseAsync()`/`loadAsync()` when current docs call for it.

## Current API Guidance From Context7

Context7 current Three.js docs reinforced these implementation rules:

- `WebGPURenderer` should be initialized with `await renderer.init()` before feature-dependent setup.
- `KTX2Loader.detectSupport(renderer)` accepts `WebGPURenderer | WebGLRenderer`, must be called before texture loads, and should run after the renderer is initialized.
- WebGPU examples use `three/webgpu` and `three/tsl` import paths explicitly.
- WebGPU postprocessing examples construct a `RenderPipeline`, assign `outputNode`, and deliberately set `outputColorTransform` depending on whether tone mapping/color conversion happens inside the graph.
- `TransformControls` examples attach scene-visible helpers with `controls.getHelper()`.

## Kinema-Specific Practices

- Keep the constructor-created `WebGLRenderer` fallback alive until WebGPU bootstrap fully succeeds. WebGPU and the WebGPU-backed WebGL2 path can fail late during `init()` or TSL setup.
- Do not use TSL node materials on the plain WebGL compatibility path unless a sanitizer/fallback exists.
- Keep `AssetLoader.initRendererSupport(renderer)` wired after renderer setup so KTX2 detection sees the active renderer.
- Prefer `loadAsync()` for loader code that composes with cancellation or stale-generation guards.
- Dispose resources explicitly on unload: geometries, materials, textures, render targets, node pipelines, and late-arriving async GLB/model objects.
- Screenshot-test visual stations after Three.js bumps. PBR, PMREM, sky, transparent blending, shadows, and postprocessing have all shifted in recent releases.

## Upgrade Checklist

1. Read every migration section from the current repo version to the target version.
2. Search the repo for renamed APIs before changing code:
   - `three/webgpu`, `three/tsl`, `RenderPipeline`, `PostProcessing`
   - `KTX2Loader`, `DRACOLoader`, `HDRLoader`, `FileLoader`, `ImageBitmapLoader`
   - `TransformControls`, `Clock`, `Timer`
   - `PCFSoftShadowMap`, `PCFShadowMap`
   - `premultipliedAlpha`, `transparent`, `outputColorTransform`
3. Update imports and typings together.
4. Verify default, `?forceWebGL=1`, and `?forceWebGPUWebGL=1` paths.
5. Compare representative screenshots for stations: `materials`, `vfx`, `vehicles`, `navigation`, and one imported-asset scene.
6. Run the standard verification set and record any visual deltas in the PR notes.
