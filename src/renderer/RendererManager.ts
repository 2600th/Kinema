import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LUT3dlLoader } from 'three/addons/loaders/LUT3dlLoader.js';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { LUTImageLoader } from 'three/addons/loaders/LUTImageLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { Disposable } from '@core/types';
import type { GraphicsQuality } from '@core/UserSettings';

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

/** SSGI quality preset: sliceCount, stepCount (with temporal filtering). */
export type SSGIPreset = 'low' | 'medium' | 'high';

/**
 * Wraps the renderer, scene, camera, and TSL post-processing chain.
 * Uses WebGPURenderer (WebGPU with WebGL2 fallback) and PostProcessing with SSGI + TRAA.
 */
export class RendererManager implements Disposable {
  public readonly renderer: THREE.WebGLRenderer | WebGPURenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  private postProcessing: PostProcessing | null = null;

  // TSL Nodes
  private ssgiNode: InstanceType<typeof import('three/addons/tsl/display/SSGINode.js').default> | null = null;


  private bloomNodes: Array<{ strength: { value: number } }> = [];
  private isWebGPUPipeline = false;

  private antiAliasingMode: AntiAliasingMode = 'taa';
  private ssrEnabled = false;
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
  private graphicsQuality: GraphicsQuality = 'high';
  private environmentTarget: THREE.WebGLRenderTarget<THREE.Texture> | null = null;
  private envName = 'Royal Esplanade';
  private readonly envCache = new Map<string, THREE.WebGLRenderTarget<THREE.Texture>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createPmremGenerator: (() => any) | null = null;
  private readonly hdrLoader = new HDRLoader();
  private postProcessingEnabled = true;
  private shadowsEnabled = true;
  private toneExposure = 0.75;
  private resolutionScale = 1;

  private ssgiEnabled = true;
  private ssgiPreset: SSGIPreset = 'medium';
  private ssgiRadius = 10;
  private ssgiGiIntensity = 20;
  private gtaoEnabled = true;

  private traaEnabled = true;
  private bloomStrength = 0.02;
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
          const n = node as { isShadowNode?: boolean; shadowMap?: unknown; light?: { castShadow?: boolean } };
          if (n.isShadowNode === true && (n.shadowMap == null || !n.light?.castShadow)) continue;
          self.getNodeFrameForRender(renderObject).updateBeforeNode(node);
        }
      };
    } catch {
      // _nodes may not exist before first use
    }
  }

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa9b9ee);
    this.scene.fog = new THREE.Fog(0xa9b9ee, 85, 260);

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
    this.renderer.setClearColor(0xa9b9ee, 1);

    void this.batchLoadLuts();
    this.setGraphicsQuality('high');
  }

  /**
   * Must be called before first render. Tries to switch to WebGPU+TSL pipeline.
   * On failure (e.g. three/webgpu not available or init throws), the existing WebGL
   * renderer is kept and render() uses it. WebGPURenderer itself may use a WebGL2
   * backend when WebGPU is unavailable (browser-dependent).
   */
  async init(): Promise<void> {
    document.body.style.margin = '0';
    document.body.style.background = '#a9b9ee';
    document.body.style.backgroundAttachment = 'fixed';

    try {
      const { WebGPURenderer, PostProcessing } = await import('three/webgpu');
      const { pass, mrt, output, diffuseColor, normalView, velocity, directionToColor, renderOutput, texture3D, uniform } = await import('three/tsl');
      const { ssgi } = await import('three/addons/tsl/display/SSGINode.js');
      const { ao: gtao } = await import('three/addons/tsl/display/GTAONode.js');
      const { traa } = await import('three/addons/tsl/display/TRAANode.js');
      const { fxaa } = await import('three/addons/tsl/display/FXAANode.js');
      const { lut3D } = await import('three/addons/tsl/display/Lut3DNode.js');
      const { hashBlur } = await import('three/addons/tsl/display/hashBlur.js');

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
      wgpuRenderer.toneMapping = THREE.AgXToneMapping;
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
      this.scene.environmentIntensity = 0.55;
      this.scene.backgroundIntensity = 1.0;
      this.scene.backgroundBlurriness = 0.5;
      pmremGenerator.dispose();
      this.createPmremGenerator = () => new PMREMGeneratorClass(this.renderer as any);

      // Successful pipeline setup - NOW swap the renderer and set flag
      (this as { renderer: THREE.WebGLRenderer | WebGPURenderer }).renderer = wgpuRenderer;
      this.isWebGPUPipeline = true;

      const scenePass = pass(this.scene, this.camera) as TSLPassNode;
      const { vec2, metalness, roughness } = await import('three/tsl');
      scenePass.setMRT(
        mrt({
          output,
          diffuseColor,
          normal: directionToColor(normalView),
          velocity,
          metalrough: vec2(metalness, roughness),
        }),
      );

      const { add, mix, uv, smoothstep, float, length: tslLength, max: tslMax, sample, colorToDirection, vec4: tslVec4 } = await import('three/tsl');
      const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
      const { ssr } = await import('three/addons/tsl/display/SSRNode.js');

      // Bandwidth optimization: 8-bit precision for targets that don't need float.
      // Reduces MRT total from 40 bytes (5×RGBA16F) to 28 bytes (2×RGBA16F + 3×RGBA8).
      scenePass.getTexture('diffuseColor').type = THREE.UnsignedByteType;
      scenePass.getTexture('normal').type = THREE.UnsignedByteType;
      scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;

      const scenePassColor = scenePass.getTextureNode('output');
      const scenePassDiffuse = scenePass.getTextureNode('diffuseColor');
      const scenePassDepth = scenePass.getTextureNode('depth');
      const scenePassNormal = scenePass.getTextureNode('normal');
      const scenePassVelocity = scenePass.getTextureNode('velocity');
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

      // Decoded normal sampler shared across tiers
      const sceneNormalDecoded = sample((uvNode: unknown) =>
        colorToDirection((scenePassNormal as { sample: (u: unknown) => unknown }).sample(uvNode) as never),
      ) as TSLNode;

      // Helper to build the graph based on quality
      const buildPipeline = (quality: GraphicsQuality): TSLNode => {
        this.bloomNodes = []; // Clear to prevent accumulation leak
        let currentNode = scenePassColor;

        // 1. Lighting / Reflections / GI
        if (quality === 'high') {
          // HIGH: SSGI handles GI + reflections + AO in a single unified pass.
          // SSGI returns vec4(gi_rgb, ao_factor).
          const giNode = ssgi(scenePassColor as never, scenePassDepth as never, sceneNormalDecoded as never, this.camera);
          this.ssgiNode = giNode as unknown as InstanceType<typeof import('three/addons/tsl/display/SSGINode.js').default>;

          if (this.ssgiEnabled) {
            const gi = (giNode as TSLNode & { rgb: TSLNode }).rgb;
            const ao = (giNode as TSLNode & { a: TSLNode }).a;
            const sceneRgb = (scenePassColor as TSLNode & { rgb: TSLNode }).rgb;
            const diffuseRgb = (scenePassDiffuse as TSLNode & { rgb: TSLNode }).rgb;
            const sceneAlpha = (scenePassColor as TSLNode & { a: TSLNode }).a;

            // Composite: direct_light * ao + diffuse * gi
            currentNode = tslVec4(
              add(
                (sceneRgb as { mul: (n: TSLNode) => TSLNode }).mul(ao) as never,
                (diffuseRgb as { mul: (n: TSLNode) => TSLNode }).mul(gi) as never,
              ) as never,
              sceneAlpha as never,
            ) as TSLNode;
          }

        } else if (quality === 'medium') {
          // MEDIUM: SSR + GTAO (separate passes, traditional console-era pipeline)
          this.ssgiNode = null;

          // SSR
          if (this.ssrEnabled) {
            const ssrResult = ssr(
              scenePassColor as never,
              scenePassDepth as never,
              sceneNormalDecoded as never,
              metalnessNode as never,
              roughnessNode as never,
              this.camera
            ) as TSLNode;

            const blurredSSR = hashBlur(ssrResult as never, roughnessNode as never, {
              repeats: 4,
              premultipliedAlpha: true
            } as any) as TSLNode;

            currentNode = mix(currentNode as never, blurredSSR as never, ssrOpacityUniform as never) as TSLNode;
          }

          // GTAO
          if (this.gtaoEnabled) {
            const aoResult = gtao(scenePassDepth as never, sceneNormalDecoded as never, this.camera);
            // GTAO uses RedFormat — extract .r channel to avoid red tint
            currentNode = (currentNode as { mul: (n: TSLNode) => TSLNode }).mul((aoResult as unknown as { r: TSLNode }).r);
          }

        } else {
          // LOW: GTAO only — minimal fragment shader overhead
          this.ssgiNode = null;

          if (this.gtaoEnabled) {
            const aoResult = gtao(scenePassDepth as never, sceneNormalDecoded as never, this.camera);
            currentNode = (currentNode as { mul: (n: TSLNode) => TSLNode }).mul((aoResult as unknown as { r: TSLNode }).r);
          }
        }

        // 2. Bloom (Medium/High only)
        if (this.bloomEnabled && quality !== 'low') {
          const bloomNode = bloom(currentNode as never, this.bloomStrength, 0.4, 0.2) as TSLNode & { strength: { value: number } };
          this.bloomNodes.push(bloomNode);
          currentNode = add(currentNode as never, bloomNode as never) as TSLNode;
        }

        // 3. Anti-aliasing
        if (quality === 'high') {
          // TRAA is mandatory in HIGH tier — it is the temporal denoiser for SSGI's
          // low sample count. Without it, SSGI output is pure noise.
          currentNode = traa(currentNode as never, scenePassDepth as never, scenePassVelocity as never, this.camera) as TSLNode;
        } else if (quality === 'medium') {
          if (this.antiAliasingMode === 'taa' && this.traaEnabled) {
            currentNode = traa(currentNode as never, scenePassDepth as never, scenePassVelocity as never, this.camera) as TSLNode;
          } else if (this.antiAliasingMode === 'fxaa' || this.antiAliasingMode === 'smaa') {
            currentNode = fxaa(currentNode as never) as TSLNode;
          }
        } else if (quality === 'low') {
          if (this.antiAliasingMode !== 'none') {
            currentNode = fxaa(currentNode as never) as TSLNode;
          }
        }

        // 4. Final Grading (Vignette + LUT + Tone Mapping)
        currentNode = applyFinalGrade(currentNode);

        return currentNode;
      };

      // Initialize with current quality
      const initialGraph = buildPipeline(this.graphicsQuality);

      const postProcessing = new PostProcessing(wgpuRenderer, initialGraph as never);
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
      this.ssgiNode = null;
      this.bloomNodes = [];
      this.postFXUniforms = null;
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer as THREE.WebGLRenderer);
      this.environmentTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
      this.envCache.set('Room Environment', this.environmentTarget);
      this.scene.environment = this.environmentTarget.texture;
      this.scene.background = this.environmentTarget.texture;
      this.scene.environmentIntensity = 0.55;
      this.scene.backgroundIntensity = 1.0;
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

  setGraphicsQuality(quality: GraphicsQuality): void {
    this.graphicsQuality = quality;
    this.applyQualitySettings();
  }

  setPostProcessingEnabled(enabled: boolean): void {
    this.postProcessingEnabled = enabled;
  }

  setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    // Keep renderer.shadowMap.enabled always true to avoid WebGPU ShadowNode seeing null depthTexture when toggling back on.
    // Toggling lights' castShadow (via LevelManager) controls whether shadows are actually cast.
    this.renderer.shadowMap.enabled = true;
    if (enabled && this.postProcessing) {
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

  setSsrOpacity(value: number): void {
    if (!Number.isFinite(value)) return;
    this.ssrOpacity = THREE.MathUtils.clamp(value, 0, 1);
    if (this.postFXUniforms) this.postFXUniforms.ssrOpacity.value = this.ssrEnabled ? this.ssrOpacity : 0;
  }

  setSsrResolutionScale(value: number): void {
    if (!Number.isFinite(value)) return;
    this.ssrResolutionScale = THREE.MathUtils.clamp(value, 0.25, 1);
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
    this.applyQualitySettings();
  }

  setBloomStrength(value: number): void {
    if (!Number.isFinite(value)) return;
    this.bloomStrength = THREE.MathUtils.clamp(value, 0, 1.5);
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

  setSsgiEnabled(enabled: boolean): void {
    this.ssgiEnabled = enabled;
    this.applyQualitySettings();
  }

  setSsgiPreset(preset: SSGIPreset): void {
    this.ssgiPreset = preset;
    this.applySSGIPreset(preset);
  }

  setSsgiRadius(value: number): void {
    if (!Number.isFinite(value)) return;
    this.ssgiRadius = THREE.MathUtils.clamp(value, 1, 25);
    this.updateSSGIControls();
  }

  setSsgiGiIntensity(value: number): void {
    if (!Number.isFinite(value)) return;
    this.ssgiGiIntensity = THREE.MathUtils.clamp(value, 0, 100);
    this.updateSSGIControls();
  }

  setTraaEnabled(enabled: boolean): void {
    this.traaEnabled = enabled;
    this.applyQualitySettings();
  }

  private applySSGIPreset(preset: SSGIPreset): void {
    if (!this.ssgiNode) return;
    const u = this.ssgiNode as { sliceCount: { value: number }; stepCount: { value: number } };
    if (preset === 'low') {
      u.sliceCount.value = 1;
      u.stepCount.value = 12;
    } else if (preset === 'medium') {
      u.sliceCount.value = 2;
      u.stepCount.value = 8;
    } else {
      u.sliceCount.value = 3;
      u.stepCount.value = 16;
    }
  }

  private updateSSGIControls(): void {
    if (!this.ssgiNode) return;
    const u = this.ssgiNode as {
      radius: { value: number };
      giIntensity: { value: number };
    };
    u.radius.value = this.ssgiRadius;
    u.giIntensity.value = this.ssgiGiIntensity;
  }

  getRenderStats(): Readonly<{ drawCalls: number; triangles: number; lines: number; points: number }> {
    return this.lastRenderStats;
  }

  /** Returns current flags; SSGI/TRAA reflect *effective* state (after quality budget) so UI stays in sync. */
  getDebugFlags(): Readonly<{
    postProcessingEnabled: boolean;
    shadowsEnabled: boolean;
    exposure: number;
    graphicsQuality: GraphicsQuality;
    aaMode: AntiAliasingMode;
    ssaoEnabled: boolean;
    ssrEnabled: boolean;
    ssrOpacity: number;
    ssrResolutionScale: number;
    bloomEnabled: boolean;
    bloomStrength: number;
    vignetteEnabled: boolean;
    vignetteDarkness: number;
    lutEnabled: boolean;
    lutStrength: number;
    lutName: string;
    lutReady: boolean;
    ssgiEnabled: boolean;
    ssgiPreset: SSGIPreset;
    ssgiRadius: number;
    ssgiGiIntensity: number;
    traaEnabled: boolean;
    envName: string;
  }> {
    const ssgiBudget = this.graphicsQuality === 'high' && this.ssgiEnabled;
    const effectiveSsgi = !!(this.postProcessingEnabled && this.isWebGPUPipeline && ssgiBudget);
    // In HIGH tier, TRAA is mandatory (denoiser for SSGI). In MEDIUM, it's user-toggleable.
    const effectiveTraa = !!(
      this.postProcessingEnabled &&
      this.isWebGPUPipeline &&
      (this.graphicsQuality === 'high' || (this.graphicsQuality === 'medium' && this.traaEnabled))
    );
    return {
      postProcessingEnabled: this.postProcessingEnabled,
      shadowsEnabled: this.shadowsEnabled,
      exposure: this.toneExposure,
      graphicsQuality: this.graphicsQuality,
      aaMode: this.antiAliasingMode,
      ssaoEnabled: this.gtaoEnabled,
      ssrEnabled: this.ssrEnabled,
      ssrOpacity: this.ssrOpacity,
      ssrResolutionScale: this.ssrResolutionScale,
      bloomEnabled: this.bloomEnabled,
      bloomStrength: this.bloomStrength,
      vignetteEnabled: this.vignetteEnabled,
      vignetteDarkness: this.vignetteDarkness,
      lutEnabled: this.lutEnabled,
      lutStrength: this.lutStrength,
      lutName: this.lutName,
      lutReady: this.lutReady,
      ssgiEnabled: effectiveSsgi,
      ssgiPreset: this.ssgiPreset,
      ssgiRadius: this.ssgiRadius,
      ssgiGiIntensity: this.ssgiGiIntensity,
      traaEnabled: effectiveTraa,
      envName: this.envName,
    };
  }

  /**
   * Syncs quality state: post-FX uniforms, pixel ratio, SSGI preset,
   * rebuilds the TSL node graph for the current tier, and runs handleResize().
   */
  private applyQualitySettings(): void {
    // 1. Sync uniforms (cheap — no graph rebuild)
    if (this.postFXUniforms) {
      this.postFXUniforms.ssrOpacity.value = this.ssrEnabled ? this.ssrOpacity : 0;
      this.postFXUniforms.vignetteDarkness.value = this.vignetteEnabled ? this.vignetteDarkness : 0;
      this.postFXUniforms.lutIntensity.value = this.lutEnabled ? this.lutStrength : 0;
    }

    // 2. Cap pixel ratio by quality to avoid runaway GPU cost
    const maxPR = this.graphicsQuality === 'low' ? 1 : this.graphicsQuality === 'medium' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPR) * this.resolutionScale);
    this.renderer.shadowMap.enabled = true;

    // 3. Sync SSGI preset/controls if node exists
    if (this.ssgiNode) {
      this.applySSGIPreset(this.graphicsQuality === 'high' ? this.ssgiPreset : 'low');
      this.updateSSGIControls();
    }

    // 4. Rebuild the TSL node graph for the current tier
    if (this.isWebGPUPipeline && this.postProcessing && (this as any)._buildPipeline) {
      const newGraph = (this as any)._buildPipeline(this.graphicsQuality);
      (this.postProcessing as { outputNode: TSLNode }).outputNode = newGraph;
      this.postProcessing.needsUpdate = true;

      // Re-apply the cached LUT to the new Lut3DNode (rebuild creates a placeholder)
      this.applyLutFromCache(this.lutName);
    }

    this.handleResize();
  }

  getGraphicsQuality(): GraphicsQuality {
    return this.graphicsQuality;
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
    this.renderer.setSize(w, h);
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
    this.ssgiNode = null;
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
