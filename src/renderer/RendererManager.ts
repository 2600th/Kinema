import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LUT3dlLoader } from 'three/addons/loaders/LUT3dlLoader.js';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { LUTImageLoader } from 'three/addons/loaders/LUTImageLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { Disposable } from '@core/types';
import type { GraphicsProfile } from '@core/UserSettings';

/** LUT preset definitions: name -> { file, format } */
const LUT_PRESETS: ReadonlyArray<{ name: string; file: string; format: 'cube' | '3dl' | 'image' }> = [
  { name: 'Bourbon 64',          file: 'Bourbon 64.CUBE',          format: 'cube' },
  { name: 'Chemical 168',        file: 'Chemical 168.CUBE',        format: 'cube' },
  { name: 'Clayton 33',          file: 'Clayton 33.CUBE',          format: 'cube' },
  { name: 'Cubicle 99',          file: 'Cubicle 99.CUBE',          format: 'cube' },
  { name: 'Remy 24',             file: 'Remy 24.CUBE',             format: 'cube' },
  { name: 'Presetpro-Cinematic', file: 'Presetpro-Cinematic.3dl',  format: '3dl' },
  { name: 'NeutralLUT',          file: 'NeutralLUT.png',           format: 'image' },
  { name: 'B&WLUT',              file: 'B&WLUT.png',               format: 'image' },
  { name: 'NightLUT',            file: 'NightLUT.png',             format: 'image' },
  { name: 'lut',                 file: 'lut.3dl',                  format: '3dl' },
  { name: 'lut_v2',              file: 'lut_v2.3dl',               format: '3dl' },
];
export const LUT_NAMES: readonly string[] = LUT_PRESETS.map(p => p.name);

/** Environment preset definitions: null file = procedural RoomEnvironment */
const ENV_PRESETS: ReadonlyArray<{ name: string; file: string | null }> = [
  { name: 'Room Environment', file: null },
  { name: 'Sunrise',          file: 'blouberg_sunrise_2_1k.hdr' },
  { name: 'Partly Cloudy',    file: 'kloofendal_48d_partly_cloudy_1k.hdr' },
  { name: 'Venice Sunset',    file: 'venice_sunset_1k.hdr' },
  { name: 'Royal Esplanade',  file: 'royal_esplanade_1k.hdr' },
  { name: 'Studio',           file: 'studio_small_09_1k.hdr' },
  { name: 'Night',            file: 'moonless_golf_1k.hdr' },
];
export const ENV_NAMES: readonly string[] = ENV_PRESETS.map(p => p.name);

// WebGPU + TSL pipeline (dynamic import to allow fallback and avoid top-level side effects)
type WebGPURenderer = import('three/webgpu').WebGPURenderer;
type PostProcessing = import('three/webgpu').PostProcessing;
// TSL nodes: use any for dynamic imports to avoid strict three/tsl type dependency
type TSLPassNode = { setMRT(mrt: unknown): void; getTextureNode(name: string): unknown; getTexture(name: string): THREE.Texture };
type TSLNode = unknown;

export type AntiAliasingMode = 'smaa' | 'fxaa' | 'taa' | 'none';

/**
 * Wraps the renderer, scene, camera, and TSL post-processing chain.
 * Uses WebGPURenderer (WebGPU with WebGL2 fallback) and a TSL post-processing graph.
 */
export class RendererManager implements Disposable {
  public readonly renderer: THREE.WebGLRenderer | WebGPURenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  private postProcessing: PostProcessing | null = null;

  // SSRNode exists only in medium tier, but we keep a reference for parameter sync/debugging.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ssrNode: any | null = null;


  private bloomNodes: Array<{ strength: { value: number } }> = [];
  private isWebGPUPipeline = false;

  private antiAliasingMode: AntiAliasingMode = 'taa';
  private ssrEnabled = false;
  private ssgiEnabled = false;
  private ssrResolutionScale = 0.5;
  private bloomEnabled = true;
  private vignetteEnabled = true;
  private lutEnabled = true;
  private lutStrength = 0.42;
  private lutName = 'Cubicle 99';
  private lutReady = false;
  private readonly lut3dlLoader = new LUT3dlLoader();
  private readonly lutCubeLoader = new LUTCubeLoader();
  private readonly lutImageLoader = new LUTImageLoader();
  private readonly lutCache = new Map<string, THREE.Data3DTexture>();
  private graphicsProfile: GraphicsProfile = 'cinematic';
  private environmentTarget: THREE.WebGLRenderTarget<THREE.Texture> | null = null;
  private envName = 'Royal Esplanade';
  private readonly envCache = new Map<string, THREE.WebGLRenderTarget<THREE.Texture>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createPmremGenerator: (() => any) | null = null;
  private readonly hdrLoader = new HDRLoader();
  private postProcessingEnabled = true;
  private shadowsEnabled = true;
  private toneExposure = 0.9;
  private resolutionScale = 1;
  private aoOnlyView = false;
  private aoOnlyOutputNode: TSLNode | null = null;

  private gtaoEnabled = true;

  private traaEnabled = true;
  private bloomStrength = 0.1;
  private vignetteDarkness = 0.42;
  private ssrOpacity = 0.5;
  private lutPassNode: {
    lutNode: { value: THREE.Data3DTexture };
    size: { value: number };
    intensityNode: { value: number };
  } | null = null;
  private postFXUniforms: {
    ssrOpacity: { value: number };
    vignetteDarkness: { value: number };
    lutIntensity: { value: number };
  } | null = null;

  private lastRenderStats = {
    drawCalls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
  };

  private _onResize = this.handleResize.bind(this);

  /** Guard shadow update: skip ShadowNode.updateBeforeNode when shadowMap is null or light.castShadow is false (WebGPU). */
  private patchShadowNodeForToggle(wgpuRenderer: WebGPURenderer): void {
    try {
      const nodes = (wgpuRenderer as unknown as { _nodes?: { constructor: { prototype: { updateBefore: (ro: unknown) => void } }; getNodeFrameForRender: (ro: unknown) => { updateBeforeNode: (n: unknown) => void } } })._nodes;
      if (!nodes?.constructor?.prototype?.updateBefore) return;
      nodes.constructor.prototype.updateBefore = function (renderObject: unknown) {
        const ro = renderObject as { getNodeBuilderState: () => { updateBeforeNodes: unknown[] } };
        const nodeBuilder = ro.getNodeBuilderState();
        const self = this as unknown as { getNodeFrameForRender: (r: unknown) => { updateBeforeNode: (x: unknown) => void } };
        for (const node of nodeBuilder.updateBeforeNodes) {
          const n = node as {
            isShadowNode?: boolean;
            shadowMap?: { depthTexture?: unknown } | null;
            light?: { castShadow?: boolean };
          };
          if (n.isShadowNode === true) {
            // If shadows are disabled, skip shadow updates entirely.
            if (wgpuRenderer.shadowMap?.enabled === false) continue;
            // If the light isn't casting shadows, skip.
            if (!n.light?.castShadow) continue;
            // If the shadow resources aren't ready yet, skip this frame (prevents null depthTexture crash).
            if (!n.shadowMap || !n.shadowMap.depthTexture) continue;
          }
          try {
            self.getNodeFrameForRender(renderObject).updateBeforeNode(node);
          } catch (e) {
            // Some renderer builds can temporarily have a null shadowMap/depthTexture while shadows are being
            // re-enabled. Skipping the shadow update for this frame prevents a fatal render crash (black screen).
            if (n.isShadowNode === true) continue;
            throw e;
          }
        }
      };
    } catch {
      // _nodes may not exist before first use
    }
  }

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xd8dce8);
    this.scene.fog = new THREE.Fog(0xd8dce8, 140, 400);

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 5, 10);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.toneExposure;
    (this.renderer as THREE.WebGLRenderer).info.autoReset = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0xd8dce8, 1);

    void this.batchLoadLuts();
    this.setGraphicsProfile('cinematic');
  }

  /**
   * Must be called before first render. Tries to switch to WebGPU+TSL pipeline.
   * On failure (e.g. three/webgpu not available or init throws), the existing WebGL
   * renderer is kept and render() uses it. WebGPURenderer itself may use a WebGL2
   * backend when WebGPU is unavailable (browser-dependent).
   */
  async init(): Promise<void> {
    document.body.style.margin = '0';
    document.body.style.background = '#d8dce8';
    document.body.style.backgroundAttachment = 'fixed';

    try {
      const { WebGPURenderer, PostProcessing } = await import('three/webgpu');
      const {
        sample,
        pass,
        mrt,
        output,
        diffuseColor,
        normalView,
        velocity,
        vec2,
        vec3,
        vec4,
        metalness,
        roughness,
        screenUV,
        builtinAOContext,
        directionToColor,
        colorToDirection,
        renderOutput,
        texture3D,
        uniform,
      } = await import('three/tsl');
      const { ao: gtao } = await import('three/addons/tsl/display/GTAONode.js');
      const { traa } = await import('three/addons/tsl/display/TRAANode.js');
      const { fxaa } = await import('three/addons/tsl/display/FXAANode.js');
      const { smaa } = await import('three/addons/tsl/display/SMAANode.js');
      const { lut3D } = await import('three/addons/tsl/display/Lut3DNode.js');
      const { ssgi } = await import('three/addons/tsl/display/SSGINode.js');
      // NOTE: hashBlur is intentionally not used; SSRNode already supports roughness-based blur via mips.

      const wgpuRenderer = new WebGPURenderer({
        antialias: false, // MSAA off — TRAA/FXAA in the post-processing pipeline handles AA
        alpha: false,
        powerPreference: 'high-performance',
        requiredLimits: {
          // MRT with 5 color attachments exceeds the 32-byte default even with RGBA8Unorm
          // on some targets (GPU alignment can pad each attachment to 8 bytes).
          maxColorAttachmentBytesPerSample: 64,
        },
      } as any) as WebGPURenderer;
      (wgpuRenderer as any).info.autoReset = true; // FIX: Ensure info is reset every frame to avoid stat accumulation
      wgpuRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      wgpuRenderer.setSize(window.innerWidth, window.innerHeight);
      wgpuRenderer.outputColorSpace = THREE.SRGBColorSpace;
      // Keep tone mapping consistent with the WebGL fallback path for a stable "look".
      wgpuRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      wgpuRenderer.toneMappingExposure = this.toneExposure;
      wgpuRenderer.shadowMap.enabled = this.shadowsEnabled;
      wgpuRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

      // DO NOT update this.renderer yet. Wait for successful init and graph build.
      await (wgpuRenderer as unknown as { init(): Promise<void> }).init();

      this.patchShadowNodeForToggle(wgpuRenderer);

      const { PMREMGenerator: PMREMGeneratorClass } = await import('three/webgpu');
      const pmremGenerator = new PMREMGeneratorClass(wgpuRenderer);
      const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
      this.environmentTarget = envTarget as unknown as THREE.WebGLRenderTarget<THREE.Texture>;
      this.envCache.set('Room Environment', this.environmentTarget);
      this.scene.environment = this.environmentTarget.texture;
      this.scene.background = this.environmentTarget.texture;
      this.scene.environmentIntensity = 0.7;
      this.scene.backgroundIntensity = 1.2;
      this.scene.backgroundBlurriness = 0.5;
      pmremGenerator.dispose();
      this.createPmremGenerator = () => new PMREMGeneratorClass(this.renderer as any);

      // Successful pipeline setup - NOW swap the renderer and set flag
      (this as { renderer: THREE.WebGLRenderer | WebGPURenderer }).renderer = wgpuRenderer;
      this.isWebGPUPipeline = true;

      // Override device-lost handler to show a user-visible overlay
      const defaultHandler = (wgpuRenderer as any)._onDeviceLost.bind(wgpuRenderer);
      (wgpuRenderer as any).onDeviceLost = (info: { api: string; message: string; reason: string | null }) => {
        defaultHandler(info);
        console.error('[RendererManager] GPU device lost:', info);
        this.showDeviceLostOverlay(info);
      };

      // --- Pre-pass (opaque-only): normals + velocity + depth for AO/TRAA/SSR ---
      // WHY: AO computed from a transparent-inclusive depth buffer will "project" occlusion onto sprites/UI.
      // three.js reference: webgpu_postprocessing_ao example uses a prePass with transparent=false.
      const prePass = pass(this.scene, this.camera) as unknown as TSLPassNode & { transparent?: boolean; getLinearDepthNode?: () => unknown; getTextureNode: (name?: string) => unknown; getTexture: (name?: string) => THREE.Texture };
      prePass.transparent = false;
      prePass.setMRT(
        mrt({
          output: directionToColor(normalView),
          velocity,
        }),
      );

      const prePassNormalDecoded = sample((uvNode: unknown) =>
        colorToDirection((prePass.getTextureNode('output') as { sample: (u: unknown) => unknown }).sample(uvNode) as never),
      ) as TSLNode;
      const prePassDepth = prePass.getTextureNode('depth');
      const prePassVelocity = prePass.getTextureNode('velocity');

      // Bandwidth optimization: 8-bit normals
      prePass.getTexture('output').type = THREE.UnsignedByteType;

      // --- Scene pass (full scene color; includes transparent sprites/UI) ---
      const scenePass = pass(this.scene, this.camera) as TSLPassNode & { contextNode?: unknown; getTextureNode: (name: string) => unknown; getTexture: (name: string) => THREE.Texture };
      scenePass.setMRT(
        mrt({
          output,
          diffuseColor,
          metalrough: vec2(metalness, roughness),
        }),
      );

      const { add, uv, smoothstep, float, length: tslLength, max: tslMax, vec4: tslVec4 } = await import('three/tsl');
      const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
      const { ssr } = await import('three/addons/tsl/display/SSRNode.js');

      // Bandwidth optimization: 8-bit precision for targets that don't need float.
      // Reduces MRT total from 40 bytes (5×RGBA16F) to 28 bytes (2×RGBA16F + 3×RGBA8).
      scenePass.getTexture('diffuseColor').type = THREE.UnsignedByteType;
      scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;

      const scenePassColor = scenePass.getTextureNode('output');
      const scenePassDiffuse = scenePass.getTextureNode('diffuseColor');
      const scenePassMetalrough = scenePass.getTextureNode('metalrough');

      const metalnessNode = (scenePassMetalrough as TSLNode & { r: TSLNode }).r;
      const roughnessNode = (scenePassMetalrough as TSLNode & { g: TSLNode }).g;

      // START Post-FX Helper Construction

      // Uniforms for dynamic adjustment
      const ssrOpacityUniform = uniform(this.ssrOpacity);
      const vignetteDarknessUniform = uniform(this.vignetteDarkness);
      const lutIntensityUniform = uniform(this.lutStrength);

      // Placeholder 2x2x2 LUT for initial graph build (real LUT applied after batch load)
      const placeholderLut = new THREE.Data3DTexture(new Uint8Array(4 * 2 * 2 * 2), 2, 2, 2);
      placeholderLut.format = THREE.RGBAFormat;
      placeholderLut.type = THREE.UnsignedByteType;
      placeholderLut.needsUpdate = true;

      // Shared Post-FX applicator (Vignette + LUT + Tone Mapping)
      const applyFinalGrade = (colorInput: TSLNode): TSLNode => {
        // 1. Scene Output (includes Tone Mapping and Color Space conversion)
        const sceneOutput = renderOutput(colorInput as never);

        // 2. Radial vignette
        const uvCoord = uv();
        const dist = (uvCoord as { sub: (n: number) => { mul: (n: number) => TSLNode } }).sub(0.5).mul(2);
        const vignetteFactor = smoothstep(float(0.5), float(1.15), tslLength(dist as never) as never) as TSLNode;
        const one = float(1);
        const dark = (vignetteDarknessUniform as { mul: (n: TSLNode) => TSLNode }).mul(vignetteFactor as never) as TSLNode;
        const mult = tslMax(float(0), (one as { sub: (n: TSLNode) => TSLNode }).sub(dark as TSLNode) as never) as TSLNode;
        const withVignette = (sceneOutput as { mul: (n: TSLNode) => TSLNode }).mul(mult as TSLNode) as TSLNode;

        // 3. LUT (Native TSL node) — capture node reference for runtime switching
        const lutNode = lut3D(withVignette as never, texture3D(placeholderLut), placeholderLut.image.width, lutIntensityUniform as never);
        this.lutPassNode = lutNode as unknown as {
          lutNode: { value: THREE.Data3DTexture };
          size: { value: number };
          intensityNode: { value: number };
        };
        return lutNode as TSLNode;
      };

      this.postFXUniforms = {
        ssrOpacity: ssrOpacityUniform as { value: number },
        vignetteDarkness: vignetteDarknessUniform as { value: number },
        lutIntensity: lutIntensityUniform as { value: number },
      };

      // --- GTAO (computed from opaque pre-pass) + injected via AO context ---
      const aoPass = gtao(prePassDepth as never, prePassNormalDecoded as never, this.camera) as unknown as {
        resolutionScale: number;
        useTemporalFiltering: boolean;
        getTextureNode: () => { sample: (u: unknown) => unknown };
      };
      aoPass.resolutionScale = this.graphicsProfile === 'performance' ? 0.5 : 0.5;
      aoPass.useTemporalFiltering = true;

      const aoSample = (aoPass.getTextureNode() as { sample: (u: unknown) => unknown }).sample(screenUV);
      // AO-only debug view (grayscale). Mirrors the example's AO-only output.
      // https://threejs.org/examples/?q=ao#webgpu_postprocessing_ao
      this.aoOnlyOutputNode = vec4(vec3((aoSample as unknown as { r: unknown }).r as never), float(1) as never) as unknown as TSLNode;
      // Attach AO to the scene shading pipeline (three.js official pattern).
      // When disabled, provide a neutral AO factor of 1.
      scenePass.contextNode = builtinAOContext(
        this.gtaoEnabled ? ((aoSample as unknown as { r: unknown }).r as never) : (float(1) as never),
      );

      // Helper to build the graph based on graphics profile.
      const buildPipeline = (profile: GraphicsProfile): TSLNode => {
        this.bloomNodes = []; // Clear to prevent accumulation leak
        this.ssrNode = null;

        // Re-apply AO context so toggle changes take effect on rebuild
        scenePass.contextNode = builtinAOContext(
          this.gtaoEnabled ? ((aoSample as unknown as { r: unknown }).r as never) : (float(1) as never),
        );

        let currentNode = scenePassColor;

        // Helper: preserve alpha while manipulating RGB.
        const keepAlphaWithRgb = (base: TSLNode, rgb: TSLNode): TSLNode =>
          tslVec4(rgb as never, (base as unknown as { a: TSLNode }).a as never) as TSLNode;

        const currentRgb = (): TSLNode => (currentNode as unknown as { rgb: TSLNode }).rgb;

        // 0) SSGI — cinematic only, before SSR
        //    Matches official Three.js webgpu_postprocessing_ssgi example compositing:
        //    composite = sceneColor * AO_ssgi + diffuseColor * GI
        //    Our sceneColor already has GTAO baked in via builtinAOContext, so we
        //    apply SSGI's own AO on top and add the diffuse GI contribution.
        if (this.ssgiEnabled && profile === 'cinematic') {
          const ssgiNode = ssgi(scenePassColor as never, prePassDepth as never, prePassNormalDecoded as never, this.camera) as unknown as {
            sliceCount: { value: number };
            stepCount: { value: number };
            giIntensity: { value: number };
            radius: { value: number };
            thickness: { value: number };
            useTemporalFiltering: boolean;
            rgb: TSLNode;
            a: TSLNode;
          };
          ssgiNode.sliceCount.value = 2;
          ssgiNode.stepCount.value = 8;
          ssgiNode.giIntensity.value = 15;
          ssgiNode.radius.value = 12;
          ssgiNode.thickness.value = 0.5;
          ssgiNode.useTemporalFiltering = true;

          // Official compositing: vec4(sceneColor.rgb * ao + diffuse.rgb * gi, sceneColor.a)
          const gi = ssgiNode.rgb;
          const ao = ssgiNode.a;
          const compositeRgb = add(
            (currentRgb() as unknown as { mul: (n: TSLNode) => TSLNode }).mul(ao) as never,
            (scenePassDiffuse as unknown as { rgb: { mul: (n: TSLNode) => TSLNode } }).rgb.mul(gi) as never,
          ) as TSLNode;
          currentNode = keepAlphaWithRgb(currentNode, compositeRgb);
        }

        // 1) Reflections (SSR) — Lumen reference parameters.
        //    SSRNode internally handles metalness/roughness from MRT input.
        //    With physically correct materials (non-metals at metalness <= 0.05),
        //    the SSR node naturally avoids non-reflective surfaces.
        if (this.ssrEnabled && profile !== 'performance') {
          const ssrNode = ssr(
            scenePassColor as never,
            prePassDepth as never,
            prePassNormalDecoded as never,
            metalnessNode as never,
            roughnessNode as never,
            this.camera,
          ) as TSLNode;

          (ssrNode as unknown as { resolutionScale: number }).resolutionScale = 0.7;
          const u = ssrNode as unknown as {
            maxDistance: { value: number };
            thickness: { value: number };
            quality: { value: number };
          };
          const blurQ = ssrNode as unknown as { blurQuality: { value: number } };
          blurQ.blurQuality.value = 4;
          u.maxDistance.value = 2.5;
          u.thickness.value = 0.03;
          u.quality.value = profile === 'cinematic' ? 0.7 : 0.5;
          this.ssrNode = ssrNode;

          // Additive SSR blend driven by runtime ssrOpacity uniform
          const nextRgb = add(currentRgb() as never, (ssrNode as unknown as { rgb: { mul: (n: unknown) => TSLNode } }).rgb.mul(ssrOpacityUniform) as never) as TSLNode;
          currentNode = keepAlphaWithRgb(currentNode, nextRgb);
        }

        // 2) Bloom — full scene color at low threshold (Lumen reference)
        if (this.bloomEnabled && profile !== 'performance') {
          const bloomNode = bloom(scenePassColor as never, 0.1, 0.8, 0.05) as TSLNode & { strength: { value: number } };
          this.bloomNodes.push(bloomNode);
          const bloomRgb = (bloomNode as unknown as { rgb: TSLNode }).rgb;
          const nextRgb = add(currentRgb() as never, bloomRgb as never) as TSLNode;
          currentNode = keepAlphaWithRgb(currentNode, nextRgb);
        }

        // 3) Anti-aliasing
        switch (this.antiAliasingMode) {
          case 'none':
            break;
          case 'smaa':
            // Official usage pattern: `smaa( node )` (see webgpu_postprocessing_ssr).
            currentNode = smaa(currentNode as never) as TSLNode;
            break;
          case 'fxaa':
            currentNode = fxaa(currentNode as never) as TSLNode;
            break;
          case 'taa':
          default:
            // In this project, "taa" maps to TRAA when enabled (temporal reprojection AA).
            // If disabled, fall back to FXAA so the mode still has an effect.
            currentNode = this.traaEnabled
              ? (traa(currentNode as never, prePassDepth as never, prePassVelocity as never, this.camera) as TSLNode)
              : (fxaa(currentNode as never) as TSLNode);
            break;
        }

        // 4) Final Grading (Vignette + LUT + Tone Mapping)
        currentNode = applyFinalGrade(currentNode);

        return currentNode;
      };

      // Initialize with current profile
      const initialGraph = buildPipeline(this.graphicsProfile);

      const postProcessing = new PostProcessing(
        wgpuRenderer,
        (this.aoOnlyView && this.aoOnlyOutputNode ? this.aoOnlyOutputNode : initialGraph) as never,
      );
      // We call renderOutput() manually in applyFinalGrade() — disable the automatic
      // color transform to prevent double tone mapping + color space conversion.
      (postProcessing as any).outputColorTransform = false;
      this.postProcessing = postProcessing;

      // Store the builder function so we can call it later
      (this as any)._buildPipeline = buildPipeline;

      this.applyQualitySettings(); // Will trigger re-build if needed or just update uniforms

      console.log('[RendererManager] WebGPU + TSL pipeline initialized');
    } catch (e) {
      console.warn('[RendererManager] WebGPU/TSL not available, using WebGL only:', e);
      this.isWebGPUPipeline = false;
      // Fallback: constructor already created a WebGLRenderer; we keep it and render via render().
      // When init() succeeds, WebGPURenderer may still use WebGL2 backend internally if WebGPU is unavailable.
      this.postProcessing = null;
      this.bloomNodes = [];
      this.postFXUniforms = null;
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer as THREE.WebGLRenderer);
      this.environmentTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
      this.envCache.set('Room Environment', this.environmentTarget);
      this.scene.environment = this.environmentTarget.texture;
      this.scene.background = this.environmentTarget.texture;
      this.scene.environmentIntensity = 0.7;
      this.scene.backgroundIntensity = 1.2;
      this.scene.backgroundBlurriness = 0.5;
      pmremGenerator.dispose();
      this.createPmremGenerator = () => new THREE.PMREMGenerator(this.renderer as THREE.WebGLRenderer);
    }

    const renderer = this.renderer as THREE.WebGLRenderer;
    if (renderer.domElement.parentElement !== document.body) {
      renderer.domElement.style.position = 'fixed';
      renderer.domElement.style.inset = '0';
      renderer.domElement.style.zIndex = '0';
      document.body.appendChild(renderer.domElement);
    }
    window.addEventListener('resize', this._onResize);
    this.handleResize();
    console.log('[RendererManager] Initialized');

    // Load the default HDR environment if it's not the procedural Room Environment
    if (this.envName !== 'Room Environment') {
      const defaultEnv = this.envName;
      this.envName = ''; // Reset to bypass setEnvironment guard
      void this.setEnvironment(defaultEnv);
    }
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get maxAnisotropy(): number {
    return this.renderer.getMaxAnisotropy?.() ?? (this.renderer as THREE.WebGLRenderer).capabilities.getMaxAnisotropy();
  }

  /** Render one frame. */
  render(): void {
    if (this.postProcessingEnabled && this.isWebGPUPipeline && this.postProcessing) {
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    const info = this.renderer.info ?? (this.renderer as THREE.WebGLRenderer).info;
    if (info?.render) {
      // WebGPU Info uses `drawCalls` (per-frame), WebGL uses `calls` (also per-frame with autoReset).
      this.lastRenderStats.drawCalls = (info.render as { drawCalls?: number }).drawCalls ?? info.render.calls ?? 0;
      this.lastRenderStats.triangles = info.render.triangles ?? 0;
      this.lastRenderStats.lines = info.render.lines ?? 0;
      this.lastRenderStats.points = info.render.points ?? 0;
    }
  }

  setGraphicsProfile(profile: GraphicsProfile): void {
    this.graphicsProfile = profile;
    this.applyGraphicsProfileDefaults(profile);
    this.applyQualitySettings();
  }

  private applyGraphicsProfileDefaults(profile: GraphicsProfile): void {
    // These defaults define the 3 player-facing profiles.
    // They intentionally do NOT touch persisted settings like resolutionScale or aaMode.
    if (profile === 'performance') {
      this.gtaoEnabled = false;
      this.ssrEnabled = false;
      this.ssgiEnabled = false;
      this.traaEnabled = false;
      this.bloomEnabled = false;
      this.bloomStrength = 0.0;
      this.vignetteEnabled = false;
      this.lutEnabled = true;
      this.lutStrength = 0.28;
      // Keep SSR params in a safe baseline if user enables it manually.
      this.ssrOpacity = 0.35;
      this.ssrResolutionScale = 0.45;
      return;
    }

    if (profile === 'balanced') {
      this.gtaoEnabled = true;
      this.ssrEnabled = false;
      this.ssgiEnabled = false;
      this.traaEnabled = true;
      this.bloomEnabled = true;
      this.bloomStrength = 0.1;
      this.vignetteEnabled = true;
      this.vignetteDarkness = 0.38;
      this.lutEnabled = true;
      this.lutStrength = 0.38;
      this.ssrOpacity = 0.4;
      this.ssrResolutionScale = 0.75;
      return;
    }

    // cinematic
    this.gtaoEnabled = true;
    this.ssrEnabled = true;
    this.ssgiEnabled = false;
    this.traaEnabled = true;
    this.bloomEnabled = true;
    this.bloomStrength = 0.1;
    this.vignetteEnabled = true;
    this.vignetteDarkness = 0.42;
    this.lutEnabled = true;
    this.lutStrength = 0.42;
    this.ssrOpacity = 0.5;
    this.ssrResolutionScale = 1.0;
  }

  setPostProcessingEnabled(enabled: boolean): void {
    this.postProcessingEnabled = enabled;
  }

  setAoOnlyView(enabled: boolean): void {
    this.aoOnlyView = enabled;
    // Fast path: if WebGPU post-processing exists, just swap the output node.
    // (applyQualitySettings will also re-apply this on rebuild.)
    if (this.isWebGPUPipeline && this.postProcessing && this.aoOnlyOutputNode) {
      if (enabled) {
        (this.postProcessing as { outputNode: TSLNode }).outputNode = this.aoOnlyOutputNode;
      } else if ((this as any)._buildPipeline) {
        (this.postProcessing as { outputNode: TSLNode }).outputNode = (this as any)._buildPipeline(this.graphicsProfile);
        // Toggling AO-only off rebuilds the graph; re-apply the cached LUT to the new Lut3DNode.
        this.applyLutFromCache(this.lutName);
      }
      this.postProcessing.needsUpdate = true;
    }
  }

  setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    // Use renderer.shadowMap.enabled as the global shadow toggle.
    // LevelManager keeps light.castShadow stable to avoid WebGPU "destroyed texture" hazards.
    this.renderer.shadowMap.enabled = enabled;
    if (this.postProcessing) {
      (this.postProcessing as { needsUpdate: boolean }).needsUpdate = true;
      const sm = this.renderer.shadowMap as { needsUpdate?: boolean };
      if (typeof sm.needsUpdate !== 'undefined') sm.needsUpdate = true;
    }
  }

  setExposure(value: number): void {
    if (!Number.isFinite(value)) return;
    this.toneExposure = THREE.MathUtils.clamp(value, 0.35, 1.85);
    this.renderer.toneMappingExposure = this.toneExposure;
  }

  setAntiAliasingMode(mode: AntiAliasingMode): void {
    this.antiAliasingMode = mode;
    this.applyQualitySettings();
  }

  setResolutionScale(value: number): void {
    if (!Number.isFinite(value)) return;
    this.resolutionScale = THREE.MathUtils.clamp(value, 0.5, 1);
    this.applyQualitySettings();
  }

  setBackgroundIntensity(value: number): void {
    if (!Number.isFinite(value)) return;
    this.scene.backgroundIntensity = THREE.MathUtils.clamp(value, 0, 2);
  }

  setBackgroundBlurriness(value: number): void {
    if (!Number.isFinite(value)) return;
    this.scene.backgroundBlurriness = THREE.MathUtils.clamp(value, 0, 1);
  }

  async setEnvironment(name: string): Promise<void> {
    if (this.envName === name) return;
    this.envName = name;

    // Check cache first
    const cached = this.envCache.get(name);
    if (cached) {
      this.scene.environment = cached.texture;
      this.scene.background = cached.texture;
      return;
    }

    // Load HDR
    const preset = ENV_PRESETS.find(p => p.name === name);
    if (!preset?.file || !this.createPmremGenerator) return;

    try {
      const url = new URL(`../assets/env/${preset.file}`, import.meta.url).href;
      const hdrTexture = await this.hdrLoader.loadAsync(url);
      const pmrem = this.createPmremGenerator();
      const envTarget = pmrem.fromEquirectangular(hdrTexture);
      pmrem.dispose();
      hdrTexture.dispose();

      this.envCache.set(name, envTarget as unknown as THREE.WebGLRenderTarget<THREE.Texture>);

      // Only apply if still the selected env (user might have switched during load)
      if (this.envName === name) {
        this.scene.environment = envTarget.texture;
        this.scene.background = envTarget.texture;
      }
    } catch (err) {
      console.warn(`[RendererManager] Failed to load environment: ${name}`, err);
    }
  }

  setSsaoEnabled(enabled: boolean): void {
    this.gtaoEnabled = enabled;
    this.applyQualitySettings();
  }

  setSsrEnabled(enabled: boolean): void {
    this.ssrEnabled = enabled;
    this.applyQualitySettings();
  }

  setSsgiEnabled(enabled: boolean): void {
    this.ssgiEnabled = enabled;
    this.applyQualitySettings();
  }

  setSsrOpacity(value: number): void {
    if (!Number.isFinite(value)) return;
    this.ssrOpacity = THREE.MathUtils.clamp(value, 0, 1);
    if (this.postFXUniforms) this.postFXUniforms.ssrOpacity.value = this.ssrEnabled ? this.ssrOpacity : 0;
  }

  setSsrResolutionScale(value: number): void {
    if (!Number.isFinite(value)) return;
    this.ssrResolutionScale = THREE.MathUtils.clamp(value, 0.25, 1);
    this.applyQualitySettings();
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
    this.applyQualitySettings();
  }

  setBloomStrength(value: number): void {
    if (!Number.isFinite(value)) return;
    this.bloomStrength = THREE.MathUtils.clamp(value, 0, 1.0);
    for (const node of this.bloomNodes) {
      node.strength.value = this.bloomStrength;
    }
  }

  setVignetteEnabled(enabled: boolean): void {
    this.vignetteEnabled = enabled;
    if (this.postFXUniforms) {
      this.postFXUniforms.vignetteDarkness.value = enabled ? this.vignetteDarkness : 0;
    }
  }

  setVignetteDarkness(value: number): void {
    if (!Number.isFinite(value)) return;
    this.vignetteDarkness = THREE.MathUtils.clamp(value, 0, 0.8);
    if (this.postFXUniforms) this.postFXUniforms.vignetteDarkness.value = this.vignetteEnabled ? this.vignetteDarkness : 0;
  }

  setLutEnabled(enabled: boolean): void {
    this.lutEnabled = enabled;
    if (this.postFXUniforms) {
      this.postFXUniforms.lutIntensity.value = enabled ? this.lutStrength : 0;
    }
  }

  setLutStrength(value: number): void {
    if (!Number.isFinite(value)) return;
    this.lutStrength = THREE.MathUtils.clamp(value, 0, 1);
    if (this.postFXUniforms) this.postFXUniforms.lutIntensity.value = this.lutEnabled ? this.lutStrength : 0;
  }

  setLutName(name: string): void {
    if (this.lutName === name) return;
    this.lutName = name;

    const cached = this.lutCache.get(name);
    if (cached && this.lutPassNode) {
      this.lutPassNode.lutNode.value = cached;
      this.lutPassNode.size.value = cached.image.width;
      if (this.postProcessing) {
        (this.postProcessing as { needsUpdate: boolean }).needsUpdate = true;
      }
    } else if (!cached) {
      // LUT not yet loaded — attempt async load then apply
      void this.loadSingleLut(name);
    }
  }

  /** Load a single LUT by name (fallback for presets not yet cached). */
  private async loadSingleLut(name: string): Promise<void> {
    const preset = LUT_PRESETS.find(p => p.name === name);
    if (!preset) {
      console.warn(`[RendererManager] Unknown LUT: ${name}`);
      return;
    }
    try {
      const url = new URL(`../assets/postfx/${preset.file}`, import.meta.url).href;
      const result = await this.loadLutByFormat(url, preset.format);
      if (result) {
        result.needsUpdate = true;
        this.lutCache.set(name, result);
        this.applyLutFromCache(name);
      }
    } catch (err) {
      console.warn(`[RendererManager] Failed to load LUT: ${name}`, err);
    }
  }

  /** Dispatch to the correct loader by format. */
  private async loadLutByFormat(url: string, format: 'cube' | '3dl' | 'image'): Promise<THREE.Data3DTexture | null> {
    let parsed: { texture3D?: THREE.Data3DTexture };
    if (format === 'cube') {
      parsed = await this.lutCubeLoader.loadAsync(url) as { texture3D?: THREE.Data3DTexture };
    } else if (format === 'image') {
      parsed = await this.lutImageLoader.loadAsync(url) as { texture3D?: THREE.Data3DTexture };
    } else {
      parsed = await this.lut3dlLoader.loadAsync(url) as { texture3D?: THREE.Data3DTexture };
    }
    return parsed.texture3D ?? null;
  }

  /** Apply a cached LUT to the live Lut3DNode (no pipeline rebuild). */
  private applyLutFromCache(name: string): void {
    const tex = this.lutCache.get(name);
    if (!tex) return;
    this.lutReady = true;
    if (this.lutPassNode) {
      this.lutPassNode.lutNode.value = tex;
      this.lutPassNode.size.value = tex.image.width;
      if (this.postProcessing) {
        (this.postProcessing as { needsUpdate: boolean }).needsUpdate = true;
      }
    }
  }

  setTraaEnabled(enabled: boolean): void {
    this.traaEnabled = enabled;
    this.applyQualitySettings();
  }

  getRenderStats(): Readonly<{ drawCalls: number; triangles: number; lines: number; points: number }> {
    return this.lastRenderStats;
  }

  /** Returns current flags (effective state). */
  getDebugFlags(): Readonly<{
    postProcessingEnabled: boolean;
    shadowsEnabled: boolean;
    exposure: number;
    graphicsProfile: GraphicsProfile;
    aaMode: AntiAliasingMode;
    aoOnly: boolean;
    ssaoEnabled: boolean;
    ssrEnabled: boolean;
    ssrOpacity: number;
    ssrResolutionScale: number;
    ssgiEnabled: boolean;
    bloomEnabled: boolean;
    bloomStrength: number;
    vignetteEnabled: boolean;
    vignetteDarkness: number;
    lutEnabled: boolean;
    lutStrength: number;
    lutName: string;
    lutReady: boolean;
    traaEnabled: boolean;
    envName: string;
  }> {
    const effectiveTraa = !!(this.postProcessingEnabled && this.isWebGPUPipeline && this.traaEnabled);
    return {
      postProcessingEnabled: this.postProcessingEnabled,
      shadowsEnabled: this.shadowsEnabled,
      exposure: this.toneExposure,
      graphicsProfile: this.graphicsProfile,
      aaMode: this.antiAliasingMode,
      aoOnly: this.aoOnlyView,
      ssaoEnabled: this.gtaoEnabled,
      ssrEnabled: this.ssrEnabled,
      ssrOpacity: this.ssrOpacity,
      ssrResolutionScale: this.ssrResolutionScale,
      ssgiEnabled: this.ssgiEnabled,
      bloomEnabled: this.bloomEnabled,
      bloomStrength: this.bloomStrength,
      vignetteEnabled: this.vignetteEnabled,
      vignetteDarkness: this.vignetteDarkness,
      lutEnabled: this.lutEnabled,
      lutStrength: this.lutStrength,
      lutName: this.lutName,
      lutReady: this.lutReady,
      traaEnabled: effectiveTraa,
      envName: this.envName,
    };
  }

  /**
   * Syncs post-FX uniforms, pixel ratio budget, rebuilds the node graph, and resizes.
   */
  private applyQualitySettings(): void {
    // 1. Sync uniforms (cheap — no graph rebuild)
    if (this.postFXUniforms) {
      this.postFXUniforms.ssrOpacity.value = this.ssrEnabled ? this.ssrOpacity : 0;
      this.postFXUniforms.vignetteDarkness.value = this.vignetteEnabled ? this.vignetteDarkness : 0;
      this.postFXUniforms.lutIntensity.value = this.lutEnabled ? this.lutStrength : 0;
    }
    if (this.ssrNode) {
      // Keep SSR resolution scale in sync with runtime controls.
      (this.ssrNode as unknown as { resolutionScale: number }).resolutionScale = this.ssrResolutionScale;
    }

    // 2. Cap pixel ratio by profile to avoid runaway GPU cost
    const maxPR = this.graphicsProfile === 'performance' ? 1 : this.graphicsProfile === 'balanced' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPR) * this.resolutionScale);
    this.renderer.shadowMap.enabled = this.shadowsEnabled;

    // 3. Rebuild the TSL node graph for the current profile
    if (this.isWebGPUPipeline && this.postProcessing && (this as any)._buildPipeline) {
      const finalGraph = (this as any)._buildPipeline(this.graphicsProfile) as TSLNode;
      const outputNode = this.aoOnlyView && this.aoOnlyOutputNode ? this.aoOnlyOutputNode : finalGraph;
      (this.postProcessing as { outputNode: TSLNode }).outputNode = outputNode;
      this.postProcessing.needsUpdate = true;

      // Re-apply the cached LUT to the new Lut3DNode (rebuild creates a placeholder)
      this.applyLutFromCache(this.lutName);

      // Re-sync bloom strength to newly created bloom nodes
      for (const node of this.bloomNodes) {
        node.strength.value = this.bloomStrength;
      }
    }

    this.handleResize();
  }

  getGraphicsProfile(): GraphicsProfile {
    return this.graphicsProfile;
  }

  /** Batch-load all LUT presets at startup. */
  private async batchLoadLuts(): Promise<void> {
    const loadPromises = LUT_PRESETS.map(async (preset) => {
      try {
        const url = new URL(`../assets/postfx/${preset.file}`, import.meta.url).href;
        const tex = await this.loadLutByFormat(url, preset.format);
        if (tex) {
          tex.needsUpdate = true;
          this.lutCache.set(preset.name, tex);
        }
      } catch (err) {
        console.warn(`[RendererManager] Failed to load LUT: ${preset.name}`, err);
      }
    });

    await Promise.all(loadPromises);
    this.lutReady = this.lutCache.size > 0;
    // Apply the default LUT once all are loaded
    this.applyLutFromCache(this.lutName);
    console.log(`[RendererManager] Loaded ${this.lutCache.size}/${LUT_PRESETS.length} LUTs`);
  }

  /** Set the animation loop callback. */
  setAnimationLoop(callback: ((time: DOMHighResTimeStamp) => void) | null): void {
    const r = this.renderer as THREE.WebGLRenderer & { setAnimationLoop?(cb: ((t: number) => void) | null): void };
    if (r.setAnimationLoop) r.setAnimationLoop(callback);
  }

  private handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Recalculate pixel ratio with profile-based cap (must be BEFORE setSize)
    const maxPR = this.graphicsProfile === 'performance' ? 1
      : this.graphicsProfile === 'balanced' ? 1.5 : 2;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, maxPR) * this.resolutionScale,
    );
    this.renderer.setSize(w, h);
  }

  /** Show a full-screen overlay when the GPU device is lost. */
  private showDeviceLostOverlay(info: { api: string; message: string; reason: string | null }): void {
    if (document.getElementById('device-lost-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'device-lost-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '99999',
      background: 'rgba(0,0,0,0.85)', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontFamily: 'system-ui, sans-serif', textAlign: 'center',
    } as CSSStyleDeclaration);

    const h1 = document.createElement('h1');
    h1.textContent = 'GPU Device Lost';
    h1.style.margin = '0 0 12px';

    const desc = document.createElement('p');
    desc.textContent = 'The GPU connection was lost. This can happen when the driver crashes or the system resumes from sleep.';
    Object.assign(desc.style, { maxWidth: '420px', lineHeight: '1.5', opacity: '0.8' });

    const detail = document.createElement('p');
    detail.textContent = `${info.api}: ${info.message || 'unknown'}`;
    Object.assign(detail.style, {
      fontSize: '12px', opacity: '0.5', fontFamily: 'monospace', margin: '8px 0 24px',
    });

    const btn = document.createElement('button');
    btn.textContent = 'Reload Page';
    Object.assign(btn.style, {
      padding: '10px 28px', fontSize: '16px', cursor: 'pointer',
      border: 'none', borderRadius: '6px', background: '#4488ff', color: '#fff',
    });
    btn.addEventListener('click', () => window.location.reload());

    overlay.append(h1, desc, detail, btn);
    document.body.appendChild(overlay);
  }

  dispose(): void {
    window.removeEventListener('resize', this._onResize);
    this.setAnimationLoop(null);
    for (const target of this.envCache.values()) {
      target.dispose();
    }
    this.envCache.clear();
    this.createPmremGenerator = null;
    if (this.postProcessing && typeof (this.postProcessing as { dispose?: () => void }).dispose === 'function') {
      (this.postProcessing as { dispose: () => void }).dispose();
    }
    this.postProcessing = null;
    this.bloomNodes = [];
    this.postFXUniforms = null;
    this.lutPassNode = null;
    for (const tex of this.lutCache.values()) {
      tex.dispose();
    }
    this.lutCache.clear();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
