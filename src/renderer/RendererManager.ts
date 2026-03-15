// NOTE: `three` and `three/webgpu` are intentionally separate imports.
// `three` provides core types/classes shared across backends.
// `three/webgpu` provides WebGPU-specific exports (WebGPURenderer, RenderPipeline, PMREMGenerator).
// No Vite alias is needed — these are distinct entry points by design since r182.
import * as THREE from 'three';
import { WebGPURenderer, RenderPipeline, PMREMGenerator } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LUT3dlLoader } from 'three/addons/loaders/LUT3dlLoader.js';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { LUTImageLoader } from 'three/addons/loaders/LUTImageLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { Disposable } from '@core/types';
import type { GraphicsProfile, ShadowQualityTier } from '@core/UserSettings';

const _drawingSize = new THREE.Vector2();
const _envRotation = new THREE.Euler();

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

// TSL nodes: use any for dynamic imports to avoid strict three/tsl type dependency
type TSLPassNode = { setMRT(mrt: unknown): void; getTextureNode(name: string): unknown; getTexture(name: string): THREE.Texture };
type TSLNode = unknown;
type GTAONodeLike = {
  resolutionScale: number;
  useTemporalFiltering: boolean;
  samples?: { value: number };
  radius?: { value: number };
  thickness?: { value: number };
  distanceExponent?: { value: number };
  distanceFallOff?: { value: number };
  scale?: { value: number };
  updateBeforeType?: string;
  dispose?: () => void;
};
type DenoiseNodeLike = {
  updateBeforeType?: string;
  dispose?: () => void;
};

export type AntiAliasingMode = 'smaa' | 'fxaa' | 'none';

const CAMERA_CLIP_NEAR = 0.5;
const CAMERA_CLIP_FAR = 1000;

/**
 * Wraps the renderer, scene, camera, and TSL post-processing chain.
 * Uses WebGPURenderer (WebGPU with WebGL2 fallback) and a TSL post-processing graph.
 */
export class RendererManager implements Disposable {
  public readonly renderer: THREE.WebGLRenderer | WebGPURenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  private postProcessing: RenderPipeline | null = null;
  private buildPipelineFn: ((profile: GraphicsProfile) => TSLNode) | null = null;
  private mainOutputNode: TSLNode | null = null;
  private pipelineRebuildNeeded = false;
  private pipelineDisposables: Array<{ dispose: () => void }> = [];

  // Keep a reference for runtime SSR parameter sync/debugging.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ssrNode: any | null = null;
  private bloomNodes: Array<{ strength: { value: number } }> = [];
  private isWebGPUPipeline = false;

  private antiAliasingMode: AntiAliasingMode = 'smaa';
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
  private graphicsProfile: GraphicsProfile = 'cinematic';
  private environmentTarget: THREE.WebGLRenderTarget<THREE.Texture> | null = null;
  private envName = 'Sunrise';
  private readonly envCache = new Map<string, THREE.WebGLRenderTarget<THREE.Texture>>();
  // Persistent PMREMGenerator — lazily created on first use, reused for all
  // environment loads (avoids re-compiling the equirectangular shader each time).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pmrem: any | null = null;
  private readonly hdrLoader = new HDRLoader();
  private postProcessingEnabled = true;
  private shadowsEnabled = true;
  private shadowQualityTier: ShadowQualityTier = 'auto';
  private toneExposure = 0.85;
  private resolutionScale = 1;
  private envRotationDegrees = 0;
  private aoOnlyView = false;
  private aoOnlyOutputNode: TSLNode | null = null;
  private gtaoPass: GTAONodeLike | null = null;
  private aoDenoisePass: DenoiseNodeLike | null = null;
  private prePassNode: (TSLPassNode & { updateBeforeType?: string; dispose?: () => void }) | null = null;
  private readonly aoFullResOnThisPlatform = (() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent ?? '';
    const platform = (
      navigator as Navigator & {
        userAgentData?: { platform?: string };
      }
    ).userAgentData?.platform ?? navigator.platform ?? '';
    const isMac = /Mac/i.test(platform) || /Macintosh/i.test(ua);
    const isChrome = /Chrome/i.test(ua) && !/Edg|OPR|Brave/i.test(ua);
    return isMac && isChrome;
  })();

  private gtaoEnabled = true;
  private bloomStrength = 0.1;
  private casEnabled = true;
  private casStrength = 0.3;
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
    aoStrength: { value: number };
    casStrength: { value: number };
    casTexelSize: { value: THREE.Vector2 };
  } | null = null;

  private lastRenderStats = {
    drawCalls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
  };

  private _onResize = this.handleResize.bind(this);

  /**
   * Guard shadow update: skip ShadowNode.updateBeforeNode when shadowMap is null
   * or light.castShadow is false (WebGPU).
   *
   * WARNING: This patches the private `_nodes.constructor.prototype.updateBefore`
   * internal of WebGPURenderer. It was written against Three.js r182 and may break
   * on future releases. If this guard is no longer needed or the internal API
   * changes, remove/update this method.
   *
   * Upstream issue: toggling shadows at runtime can trigger a null depthTexture
   * crash inside ShadowNode, causing a black screen or device loss.
   */
  private static readonly SUPPORTED_THREE_REVISIONS = ['182', '183'];
  private static shadowPatchApplied = false;
  private static shadowPatchOriginal: ((ro: unknown) => void) | null = null;
  private static shadowPatchInstanceCount = 0;

  private patchShadowNodeForToggle(wgpuRenderer: WebGPURenderer): void {
    RendererManager.shadowPatchInstanceCount++;

    if (RendererManager.shadowPatchApplied) return;

    if (!RendererManager.SUPPORTED_THREE_REVISIONS.includes(THREE.REVISION)) {
      console.warn(
        `[RendererManager] Shadow toggle patch was written for Three.js r${RendererManager.SUPPORTED_THREE_REVISIONS.join('/')} ` +
        `but running r${THREE.REVISION}. Skipping patch — verify shadow toggling still works.`,
      );
      return;
    }
    try {
      // r182-r183: WebGPURenderer._nodes (NodeManager) internal
      const nodes = (wgpuRenderer as unknown as { _nodes?: { constructor: { prototype: { updateBefore: (ro: unknown) => void } }; getNodeFrameForRender: (ro: unknown) => { updateBeforeNode: (n: unknown) => void } } })._nodes;
      if (!nodes?.constructor?.prototype?.updateBefore) return;

      // Store the original before patching so we can restore it on dispose.
      RendererManager.shadowPatchOriginal = nodes.constructor.prototype.updateBefore;
      const proto = nodes.constructor.prototype;

      proto.updateBefore = function (renderObject: unknown) {
        const ro = renderObject as { getNodeBuilderState: () => { updateBeforeNodes: unknown[] } };
        const nodeBuilder = ro.getNodeBuilderState();
        // Use `this` (the NodeManager instance) rather than capturing a specific renderer,
        // so the patch works regardless of which RendererManager instance triggers it.
        const self = this as unknown as {
          getNodeFrameForRender: (r: unknown) => { updateBeforeNode: (x: unknown) => void };
          renderer?: { shadowMap?: { enabled?: boolean } };
        };
        for (const node of nodeBuilder.updateBeforeNodes) {
          const n = node as {
            isShadowNode?: boolean;
            shadowMap?: { depthTexture?: unknown } | null;
            light?: { castShadow?: boolean };
          };
          if (n.isShadowNode === true) {
            // If shadows are disabled, skip shadow updates entirely.
            // Access the renderer from the NodeManager's own reference (avoids closure capture).
            const shadowMapEnabled = self.renderer?.shadowMap?.enabled;
            if (shadowMapEnabled === false) continue;
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

      RendererManager.shadowPatchApplied = true;
    } catch {
      // _nodes may not exist before first use
    }
  }

  private static unpatchShadowNodeForToggle(wgpuRenderer: WebGPURenderer): void {
    RendererManager.shadowPatchInstanceCount--;
    if (RendererManager.shadowPatchInstanceCount > 0) return;
    if (!RendererManager.shadowPatchApplied || !RendererManager.shadowPatchOriginal) return;
    try {
      const nodes = (wgpuRenderer as unknown as { _nodes?: { constructor: { prototype: { updateBefore: (ro: unknown) => void } } } })._nodes;
      if (nodes?.constructor?.prototype) {
        nodes.constructor.prototype.updateBefore = RendererManager.shadowPatchOriginal;
      }
    } catch {
      // Best-effort restore
    }
    RendererManager.shadowPatchApplied = false;
    RendererManager.shadowPatchOriginal = null;
  }

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8d8c8);
    this.scene.fog = new THREE.Fog(0xe8d8c8, 140, 400);
    this.applyEnvironmentRotation();

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      CAMERA_CLIP_NEAR,
      CAMERA_CLIP_FAR,
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
      const {
        pass,
        mrt,
        output,
        normalView,
        screenUV,
        builtinAOContext,
        vec2,
        vec3,
        vec4,
        convertToTexture,
        metalness,
        roughness,
        renderOutput,
        texture3D,
        uniform,
      } = await import('three/tsl');
      const { ao: gtao } = await import('three/addons/tsl/display/GTAONode.js');
      const { denoise } = await import('three/addons/tsl/display/DenoiseNode.js');
      const { fxaa } = await import('three/addons/tsl/display/FXAANode.js');
      const { smaa } = await import('three/addons/tsl/display/SMAANode.js');
      const { lut3D } = await import('three/addons/tsl/display/Lut3DNode.js');
      // NOTE: hashBlur is intentionally not used; SSRNode already supports roughness-based blur via mips.

      const wgpuRenderer = new WebGPURenderer({
        antialias: false, // MSAA off — post-processing AA handles edges
        alpha: false,
        powerPreference: 'high-performance',
        requiredLimits: {
          // Scene pass uses 2 HalfFloat MRT color attachments.
          maxColorAttachmentBytesPerSample: 32,
        },
      } as any) as WebGPURenderer; // r182-r183: requiredLimits not in public types
      (wgpuRenderer as any).info.autoReset = true; // FIX: Ensure info is reset every frame to avoid stat accumulation
      wgpuRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      wgpuRenderer.setSize(window.innerWidth, window.innerHeight);
      wgpuRenderer.outputColorSpace = THREE.SRGBColorSpace;
      // Keep tone mapping consistent with the WebGL fallback path for a stable "look".
      wgpuRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      wgpuRenderer.toneMappingExposure = this.toneExposure;
      wgpuRenderer.shadowMap.enabled = this.shadowsEnabled;
      wgpuRenderer.shadowMap.type = THREE.PCFShadowMap;

      // DO NOT update this.renderer yet. Wait for successful init and graph build.
      // r182-r183: WebGPURenderer.init() not in public types
      await (wgpuRenderer as unknown as { init(): Promise<void> }).init();

      this.patchShadowNodeForToggle(wgpuRenderer);

      // Lazy-init persistent PMREMGenerator (reused for all env loads).
      this.pmrem = new PMREMGenerator(wgpuRenderer);
      this.pmrem.compileEquirectangularShader();
      const envTarget = this.pmrem.fromScene(new RoomEnvironment(), 0.04);
      this.environmentTarget = envTarget as unknown as THREE.WebGLRenderTarget<THREE.Texture>;
      this.envCache.set('Room Environment', this.environmentTarget);
      this.scene.environment = this.environmentTarget.texture;
      this.scene.background = this.environmentTarget.texture;
      this.scene.environmentIntensity = 0.7;
      this.scene.backgroundIntensity = 1.2;
      this.scene.backgroundBlurriness = 0.5;
      this.applyEnvironmentRotation();

      // Dispose the temporary WebGL fallback renderer before swapping.
      const oldRenderer = this.renderer as THREE.WebGLRenderer;
      oldRenderer.dispose();

      // Successful pipeline setup - NOW swap the renderer and set flag
      (this as { renderer: THREE.WebGLRenderer | WebGPURenderer }).renderer = wgpuRenderer;
      this.isWebGPUPipeline = true;

      // Override device-lost handler to show a user-visible overlay
      // r182-r183: WebGPURenderer._onDeviceLost internal
      const defaultHandler = (wgpuRenderer as any)._onDeviceLost.bind(wgpuRenderer);
      (wgpuRenderer as any).onDeviceLost = (info: { api: string; message: string; reason: string | null }) => {
        defaultHandler(info);
        console.error('[RendererManager] GPU device lost:', info);
        this.showDeviceLostOverlay(info);
      };

      // --- Opaque-only pre-pass for AO inputs ---
      const prePass = pass(this.scene, this.camera) as TSLPassNode & {
        transparent?: boolean;
        updateBeforeType?: string;
        dispose?: () => void;
      };
      prePass.transparent = false;
      prePass.setMRT(
        mrt({
          output: normalView,
        }),
      );
      prePass.getTexture('output').type = THREE.HalfFloatType;
      const prePassNormal = prePass.getTextureNode('output') as TSLNode;
      const prePassDepth = prePass.getTextureNode('depth') as TSLNode;
      this.prePassNode = prePass;

      // --- Scene pass (full scene color + gbuffer-like MRT inputs) ---
      const scenePass = pass(this.scene, this.camera) as TSLPassNode & { contextNode?: unknown; getTextureNode: (name: string) => unknown; getTexture: (name: string) => THREE.Texture };
      scenePass.setMRT(
        mrt({
          output,
          metalrough: vec2(metalness, roughness),
        }),
      );

      const { add, uv, smoothstep, float, mix, length: tslLength, max: tslMax, min: tslMin, vec4: tslVec4 } = await import('three/tsl');
      const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
      const { ssr } = await import('three/addons/tsl/display/SSRNode.js');

      // Keep reflection-driving channels precise to avoid quantization artifacts.
      scenePass.getTexture('metalrough').type = THREE.HalfFloatType;

      const scenePassColor = scenePass.getTextureNode('output');
      const scenePassMetalrough = scenePass.getTextureNode('metalrough');
      const scenePassDepth = scenePass.getTextureNode('depth');

      const metalnessNode = (scenePassMetalrough as TSLNode & { r: TSLNode }).r;
      const roughnessNode = (scenePassMetalrough as TSLNode & { g: TSLNode }).g;

      // START Post-FX Helper Construction

      // Uniforms for dynamic adjustment
      const ssrOpacityUniform = uniform(this.ssrOpacity);
      const vignetteDarknessUniform = uniform(this.vignetteDarkness);
      const lutIntensityUniform = uniform(this.lutStrength);
      const aoStrengthUniform = uniform(this.gtaoEnabled ? 1 : 0);
      const casStrengthUniform = uniform(this.getEffectiveCasStrength());
      const casTexelSizeUniform = uniform(
        new THREE.Vector2(
          1 / Math.max(window.innerWidth, 1),
          1 / Math.max(window.innerHeight, 1),
        ),
      );

      // Placeholder 2x2x2 LUT for initial graph build (real LUT applied after batch load)
      const placeholderLut = new THREE.Data3DTexture(new Uint8Array(4 * 2 * 2 * 2), 2, 2, 2);
      placeholderLut.format = THREE.RGBAFormat;
      placeholderLut.type = THREE.UnsignedByteType;
      placeholderLut.colorSpace = THREE.NoColorSpace;
      placeholderLut.needsUpdate = true;

      const applyDisplayOutput = (colorInput: TSLNode): TSLNode => {
        // Scene output transform (tone mapping + color space conversion).
        return renderOutput(colorInput as never) as TSLNode;
      };

      // Shared Post-FX applicator (Vignette + LUT). Expects display-space input.
      const applyColorGrade = (displayColorInput: TSLNode): TSLNode => {
        // 1. Radial vignette
        const uvCoord = uv();
        const dist = (uvCoord as { sub: (n: number) => { mul: (n: number) => TSLNode } }).sub(0.5).mul(2);
        const vignetteFactor = smoothstep(float(0.5), float(1.15), tslLength(dist as never) as never) as TSLNode;
        const one = float(1);
        const dark = (vignetteDarknessUniform as { mul: (n: TSLNode) => TSLNode }).mul(vignetteFactor as never) as TSLNode;
        const mult = tslMax(float(0), (one as { sub: (n: TSLNode) => TSLNode }).sub(dark as TSLNode) as never) as TSLNode;
        const withVignette = (displayColorInput as { mul: (n: TSLNode) => TSLNode }).mul(mult as TSLNode) as TSLNode;

        // 2. LUT (Native TSL node) — capture node reference for runtime switching
        const lutNode = lut3D(withVignette as never, texture3D(placeholderLut), placeholderLut.image.width, lutIntensityUniform as never);
        this.lutPassNode = lutNode as unknown as {
          lutNode: { value: THREE.Data3DTexture };
          size: { value: number };
          intensityNode: { value: number };
        };
        return lutNode as TSLNode;
      };

      // CAS-style sharpening pass applied after AA in display space.
      const applyCasSharpen = (displayColorInput: TSLNode): TSLNode => {
        const sourceTexture = convertToTexture(displayColorInput as never) as unknown as {
          uvNode?: TSLNode;
          sample: (uvNode: unknown) => TSLNode;
        };
        const sourceUv = (sourceTexture.uvNode ?? uv()) as TSLNode;
        const texel = casTexelSizeUniform as unknown as { x: TSLNode; y: TSLNode };
        const texelX = texel.x;
        const texelY = texel.y;

        const uvLeft = (sourceUv as unknown as { add: (n: unknown) => TSLNode }).add(
          vec2((texelX as unknown as { negate: () => TSLNode }).negate() as never, float(0) as never) as never,
        ) as TSLNode;
        const uvRight = (sourceUv as unknown as { add: (n: unknown) => TSLNode }).add(
          vec2(texelX as never, float(0) as never) as never,
        ) as TSLNode;
        const uvUp = (sourceUv as unknown as { add: (n: unknown) => TSLNode }).add(
          vec2(float(0) as never, (texelY as unknown as { negate: () => TSLNode }).negate() as never) as never,
        ) as TSLNode;
        const uvDown = (sourceUv as unknown as { add: (n: unknown) => TSLNode }).add(
          vec2(float(0) as never, texelY as never) as never,
        ) as TSLNode;

        const center = sourceTexture.sample(sourceUv as never) as unknown as { rgb: TSLNode; a: TSLNode };
        const left = sourceTexture.sample(uvLeft as never) as unknown as { rgb: TSLNode };
        const right = sourceTexture.sample(uvRight as never) as unknown as { rgb: TSLNode };
        const up = sourceTexture.sample(uvUp as never) as unknown as { rgb: TSLNode };
        const down = sourceTexture.sample(uvDown as never) as unknown as { rgb: TSLNode };

        const luminance = (sampled: { rgb: TSLNode }): TSLNode => {
          const rgb = sampled.rgb as unknown as { r: TSLNode; g: TSLNode; b: TSLNode };
          return tslMax(rgb.r as never, rgb.g as never, rgb.b as never) as TSLNode;
        };

        const centerLum = luminance(center);
        const leftLum = luminance(left);
        const rightLum = luminance(right);
        const upLum = luminance(up);
        const downLum = luminance(down);
        const localMax = tslMax(
          centerLum as never,
          leftLum as never,
          rightLum as never,
          upLum as never,
          downLum as never,
        ) as TSLNode;
        const localMin = tslMin(
          centerLum as never,
          leftLum as never,
          rightLum as never,
          upLum as never,
          downLum as never,
        ) as TSLNode;
        const localContrast = (localMax as unknown as { sub: (n: unknown) => TSLNode })
          .sub(localMin as never) as TSLNode;
        const adaptiveAmount = smoothstep(float(0.02), float(0.30), localContrast as never) as TSLNode;
        const sharpenAmount = (casStrengthUniform as unknown as { mul: (n: unknown) => TSLNode })
          .mul(adaptiveAmount as never) as TSLNode;

        const horizontalNeighbors = add(left.rgb as never, right.rgb as never) as TSLNode;
        const verticalNeighbors = add(up.rgb as never, down.rgb as never) as TSLNode;
        const neighborAverage = (add(horizontalNeighbors as never, verticalNeighbors as never) as unknown as {
          mul: (n: unknown) => TSLNode;
        }).mul(float(0.25) as never) as TSLNode;
        const detail = (center.rgb as unknown as { sub: (n: unknown) => TSLNode })
          .sub(neighborAverage as never) as TSLNode;
        const sharpenedRgb = (center.rgb as unknown as { add: (n: unknown) => TSLNode }).add(
          (detail as unknown as { mul: (n: unknown) => TSLNode }).mul(sharpenAmount as never) as never,
        ) as TSLNode;

        return vec4(sharpenedRgb as never, center.a as never) as unknown as TSLNode;
      };

      this.postFXUniforms = {
        ssrOpacity: ssrOpacityUniform as { value: number },
        vignetteDarkness: vignetteDarknessUniform as { value: number },
        lutIntensity: lutIntensityUniform as { value: number },
        aoStrength: aoStrengthUniform as { value: number },
        casStrength: casStrengthUniform as { value: number },
        casTexelSize: casTexelSizeUniform as { value: THREE.Vector2 },
      };

      // --- GTAO (computed from opaque pre-pass depth + normal) ---
      const aoPass = gtao(prePassDepth as never, prePassNormal as never, this.camera) as unknown as GTAONodeLike & {
        getTextureNode: () => { sample: (u: unknown) => unknown };
      };
      this.gtaoPass = aoPass;

      const aoDenoised = denoise(
        aoPass.getTextureNode() as never,
        prePassDepth as never,
        prePassNormal as never,
        this.camera,
      ) as unknown as TSLNode & DenoiseNodeLike & { r: TSLNode };
      this.aoDenoisePass = aoDenoised;
      this.syncGtaoSettings();
      const aoSample = aoDenoised.r;
      const aoLightingSample = (
        (aoPass.getTextureNode() as unknown as { sample: (uvNode: unknown) => { r: TSLNode } })
          .sample(screenUV as never)
      ).r as TSLNode;
      // NOTE: Debug view uses denoised AO for readability, while production lighting samples
      // raw GTAO via builtinAOContext at screenUV. Denoise output can't be sampled in material
      // context, so this intentionally diverges slightly from the final lit AO signal.
      // AO-only debug view (grayscale). Mirrors the example's AO-only output.
      // https://threejs.org/examples/?q=ao#webgpu_postprocessing_ao
      this.aoOnlyOutputNode = vec4(vec3(aoSample as never), float(1) as never) as unknown as TSLNode;
      // Inject AO into scene lighting so transparents rendered later remain unaffected.
      scenePass.contextNode = builtinAOContext(
        mix(
          float(1) as never,
          aoLightingSample as never,
          aoStrengthUniform as never,
        ),
      );

      // Helper to build the graph based on graphics profile.
      const buildPipeline = (profile: GraphicsProfile): TSLNode => {
        this.disposePipelineDisposables();
        this.bloomNodes = [];
        this.ssrNode = null;

        const trackTempNode = <T>(node: T): T => {
          this.registerPipelineDisposable(node);
          return node;
        };

        let currentNode = scenePassColor;

        // Helper: preserve alpha while manipulating RGB.
        const keepAlphaWithRgb = (base: TSLNode, rgb: TSLNode): TSLNode =>
          tslVec4(rgb as never, (base as unknown as { a: TSLNode }).a as never) as TSLNode;

        const currentRgb = (): TSLNode => (currentNode as unknown as { rgb: TSLNode }).rgb;

        // 1) Reflections (SSR) — additive in linear space.
        //    SSRNode internally handles metalness/roughness from MRT input.
        //    With physically correct materials (non-metals at metalness <= 0.05),
        //    the SSR node naturally avoids non-reflective surfaces.
        if (this.isSsrActiveForPipeline() && profile !== 'performance') {
          const ssrNode = trackTempNode(ssr(
            scenePassColor as never,
            scenePassDepth as never,
            // Opaque-only normals avoid transparent sprite/particle normal artifacts in SSR.
            prePassNormal as never,
            metalnessNode as never,
            roughnessNode as never,
            this.camera,
          )) as TSLNode;

          (ssrNode as unknown as { resolutionScale: number }).resolutionScale = this.ssrResolutionScale;
          const u = ssrNode as unknown as {
            maxDistance: { value: number };
            thickness: { value: number };
            quality: { value: number };
          };
          const blurQ = ssrNode as unknown as { blurQuality: { value: number } };
          blurQ.blurQuality.value = profile === 'cinematic' ? 3 : 2;
          u.maxDistance.value = 2.5;
          u.thickness.value = 0.03;
          u.quality.value = profile === 'cinematic' ? 0.7 : 0.5;
          this.ssrNode = ssrNode;

          // Additive SSR blend driven by runtime ssrOpacity uniform
          const nextRgb = add(currentRgb() as never, (ssrNode as unknown as { rgb: { mul: (n: unknown) => TSLNode } }).rgb.mul(ssrOpacityUniform) as never) as TSLNode;
          currentNode = keepAlphaWithRgb(currentNode, nextRgb);
        }

        // 2) Bloom — additive in linear space.
        if (this.bloomEnabled && profile !== 'performance') {
          const bloomNode = trackTempNode(
            bloom(currentNode as never, 0.1, 0.8, 0.05),
          ) as TSLNode & { strength: { value: number } };
          this.bloomNodes.push(bloomNode);
          const bloomRgb = (bloomNode as unknown as { rgb: TSLNode }).rgb;
          const nextRgb = add(currentRgb() as never, bloomRgb as never) as TSLNode;
          currentNode = keepAlphaWithRgb(currentNode, nextRgb);
        }

        // 3) AA + output transform.
        //    r183 ordering rules:
        //    - SMAA runs BEFORE renderOutput() (linear space) — its edge detection
        //      expects linear-space input without sRGB encoding.
        //    - FXAA runs AFTER renderOutput() (sRGB display space) — it is designed
        //      for perceptually-encoded (gamma) pixel values.
        if (this.antiAliasingMode === 'smaa') {
          currentNode = trackTempNode(smaa(currentNode as never)) as TSLNode;
        }

        // 4) Output transform (tone mapping + sRGB conversion)
        currentNode = applyDisplayOutput(currentNode);

        if (this.antiAliasingMode === 'fxaa') {
          currentNode = trackTempNode(fxaa(currentNode as never)) as TSLNode;
        }

        // 5) CAS-style sharpening after AA (only when enabled and strength > 0).
        if (this.casEnabled && this.casStrength > 0) {
          currentNode = applyCasSharpen(currentNode);
        }

        // 6) Final Grading (Vignette + LUT)
        currentNode = applyColorGrade(currentNode);

        return currentNode;
      };

      // Initialize with current profile
      const initialGraph = buildPipeline(this.graphicsProfile);
      this.mainOutputNode = initialGraph;

      const postProcessing = new RenderPipeline(
        wgpuRenderer,
        (this.aoOnlyView && this.aoOnlyOutputNode ? this.aoOnlyOutputNode : this.mainOutputNode) as never,
      );
      // We call renderOutput() manually in applyDisplayOutput() — disable the automatic
      // color transform to prevent double tone mapping + color space conversion.
      // r182-r183: RenderPipeline.outputColorTransform not in public types
      (postProcessing as any).outputColorTransform = false;
      this.postProcessing = postProcessing;

      // Store the builder function so we can rebuild only on structural changes.
      this.buildPipelineFn = buildPipeline;
      this.pipelineRebuildNeeded = false;

      this.applyQualitySettings(); // Will trigger re-build if needed or just update uniforms

      console.log('[RendererManager] WebGPU + TSL pipeline initialized');
    } catch (e) {
      console.warn('[RendererManager] WebGPU/TSL not available, using WebGL only:', e);
      this.isWebGPUPipeline = false;
      // Fallback: constructor already created a WebGLRenderer; we keep it and render via render().
      // When init() succeeds, WebGPURenderer may still use WebGL2 backend internally if WebGPU is unavailable.
      this.postProcessing = null;
      this.buildPipelineFn = null;
      this.mainOutputNode = null;
      this.pipelineRebuildNeeded = false;
      this.disposePipelineDisposables();
      this.gtaoPass = null;
      this.aoDenoisePass = null;
      this.prePassNode = null;
      this.bloomNodes = [];
      this.postFXUniforms = null;
      this.pmrem = new THREE.PMREMGenerator(this.renderer as THREE.WebGLRenderer);
      this.pmrem.compileEquirectangularShader();
      const envTarget = this.pmrem.fromScene(new RoomEnvironment(), 0.04);
      this.environmentTarget = envTarget;
      this.envCache.set('Room Environment', envTarget);
      this.scene.environment = envTarget.texture;
      this.scene.background = envTarget.texture;
      this.scene.environmentIntensity = 0.7;
      this.scene.backgroundIntensity = 1.2;
      this.scene.backgroundBlurriness = 0.5;
      this.applyEnvironmentRotation();
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
    // Both WebGPURenderer (via Renderer base) and WebGLRenderer.capabilities expose this
    return (this.renderer as unknown as { getMaxAnisotropy(): number }).getMaxAnisotropy?.() ?? 1;
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

  private markPipelineDirty(): void {
    this.pipelineRebuildNeeded = true;
  }

  private registerPipelineDisposable(node: unknown): void {
    const disposable = node as { dispose?: () => void };
    if (typeof disposable?.dispose === 'function') {
      this.pipelineDisposables.push({ dispose: disposable.dispose.bind(disposable) });
    }
  }

  private disposePipelineDisposables(): void {
    for (const node of this.pipelineDisposables) {
      try {
        node.dispose();
      } catch {
        // Best-effort cleanup for node-managed render targets.
      }
    }
    this.pipelineDisposables = [];
  }

  setGraphicsProfile(profile: GraphicsProfile): void {
    this.graphicsProfile = profile;
    this.applyGraphicsProfileDefaults(profile);
    this.markPipelineDirty();
    this.applyQualitySettings();
  }

  private applyGraphicsProfileDefaults(profile: GraphicsProfile): void {
    // These defaults define the 3 player-facing profiles in deterministic AA mode.
    // They intentionally do NOT touch persisted settings like resolutionScale.
    if (profile === 'performance') {
      this.gtaoEnabled = false;
      this.ssrEnabled = false;
      this.bloomEnabled = false;
      this.bloomStrength = 0.0;
      this.casEnabled = false;
      this.casStrength = 0;
      this.vignetteEnabled = false;
      this.lutEnabled = true;
      this.lutStrength = 0.28;
      this.antiAliasingMode = 'fxaa';
      // Keep SSR params in a safe baseline if user enables it manually.
      this.ssrOpacity = 0.35;
      this.ssrResolutionScale = 0.45;
      return;
    }

    if (profile === 'balanced') {
      this.gtaoEnabled = true;
      this.ssrEnabled = false;
      this.bloomEnabled = true;
      this.bloomStrength = 0.1;
      this.casEnabled = true;
      this.casStrength = 0.2;
      this.vignetteEnabled = true;
      this.vignetteDarkness = 0.38;
      this.lutEnabled = true;
      this.lutStrength = 0.38;
      this.antiAliasingMode = 'smaa';
      this.ssrOpacity = 0.4;
      this.ssrResolutionScale = 0.75;
      return;
    }

    // cinematic
    this.gtaoEnabled = true;
    this.ssrEnabled = true;
    this.bloomEnabled = true;
    this.bloomStrength = 0.1;
    this.casEnabled = true;
    this.casStrength = 0.3;
    this.vignetteEnabled = true;
    this.vignetteDarkness = 0.42;
    this.lutEnabled = true;
    this.lutStrength = 0.42;
    this.antiAliasingMode = 'smaa';
    this.ssrOpacity = 0.5;
    this.ssrResolutionScale = 1.0;
  }

  private getGtaoResolutionScale(profile: GraphicsProfile): number {
    // Chrome/mac has shown stable AO only at full-resolution in this project.
    if (this.aoFullResOnThisPlatform) return 1.0;
    if (profile === 'performance') return 0.75;
    if (profile === 'balanced') return 1.0;
    return 1.0;
  }

  private getProfileMaxPixelRatio(profile: GraphicsProfile): number {
    if (profile === 'performance') return 1.25;
    if (profile === 'balanced') return 1.75;
    return 2;
  }

  private getEffectiveShadowQualityProfile(): GraphicsProfile {
    return this.shadowQualityTier === 'auto' ? this.graphicsProfile : this.shadowQualityTier;
  }

  private getEffectiveCasStrength(): number {
    if (!this.casEnabled) return 0;
    if (this.antiAliasingMode === 'none') return 0;
    return this.casStrength;
  }

  private syncCasSettings(): void {
    if (!this.postFXUniforms) return;
    this.postFXUniforms.casStrength.value = this.getEffectiveCasStrength();
  }

  private syncCasTexelSize(): void {
    if (!this.postFXUniforms) return;
    this.renderer.getDrawingBufferSize(_drawingSize);
    if (_drawingSize.x <= 0 || _drawingSize.y <= 0) return;
    this.postFXUniforms.casTexelSize.value.set(1 / _drawingSize.x, 1 / _drawingSize.y);
  }

  private applyEnvironmentRotation(): void {
    const radians = THREE.MathUtils.degToRad(this.envRotationDegrees);
    _envRotation.set(0, radians, 0);
    const sceneWithRotation = this.scene as THREE.Scene & {
      environmentRotation?: THREE.Euler;
      backgroundRotation?: THREE.Euler;
    };
    sceneWithRotation.environmentRotation = _envRotation;
    sceneWithRotation.backgroundRotation = _envRotation;
  }

  private isSsrActiveForPipeline(): boolean {
    return this.ssrEnabled;
  }

  private syncGtaoSettings(): void {
    if (this.postFXUniforms) {
      this.postFXUniforms.aoStrength.value = this.gtaoEnabled ? 1 : 0;
    }
    if (!this.gtaoPass) return;
    const isCinematic = this.graphicsProfile === 'cinematic';
    const aoSamples = isCinematic ? 16 : this.graphicsProfile === 'balanced' ? 12 : 8;
    if (this.gtaoPass.samples) {
      this.gtaoPass.samples.value = aoSamples;
    }
    if (this.gtaoPass.radius) {
      this.gtaoPass.radius.value = isCinematic ? 0.65 : this.graphicsProfile === 'balanced' ? 0.5 : 0.4;
    }
    if (this.gtaoPass.thickness) {
      this.gtaoPass.thickness.value = 1.0;
    }
    if (this.gtaoPass.distanceExponent) {
      this.gtaoPass.distanceExponent.value = 1.5;
    }
    if (this.gtaoPass.distanceFallOff) {
      this.gtaoPass.distanceFallOff.value = 0.5;
    }
    if (this.gtaoPass.scale) {
      this.gtaoPass.scale.value = 1.0;
    }
    this.gtaoPass.resolutionScale = this.getGtaoResolutionScale(this.graphicsProfile);
    // Deterministic pipeline: always spatial AO only.
    this.gtaoPass.useTemporalFiltering = false;
    const shouldRenderAoPass = this.gtaoEnabled || this.aoOnlyView;
    if (typeof this.gtaoPass.updateBeforeType !== 'undefined') {
      this.gtaoPass.updateBeforeType = shouldRenderAoPass ? 'frame' : 'none';
    }
    if (this.aoDenoisePass && typeof this.aoDenoisePass.updateBeforeType !== 'undefined') {
      this.aoDenoisePass.updateBeforeType = this.aoOnlyView ? 'frame' : 'none';
    }
    if (this.prePassNode && typeof this.prePassNode.updateBeforeType !== 'undefined') {
      this.prePassNode.updateBeforeType = shouldRenderAoPass ? 'frame' : 'none';
    }
  }

  setPostProcessingEnabled(enabled: boolean): void {
    this.postProcessingEnabled = enabled;
    this.syncGtaoSettings();
  }

  setAoOnlyView(enabled: boolean): void {
    this.aoOnlyView = enabled;
    this.syncGtaoSettings();
    this.refreshOutputNode();
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
    if (this.antiAliasingMode === mode) return;
    this.antiAliasingMode = mode;
    this.markPipelineDirty();
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

  setEnvironmentRotationDegrees(value: number): void {
    if (!Number.isFinite(value)) return;
    this.envRotationDegrees = THREE.MathUtils.clamp(value, -180, 180);
    this.applyEnvironmentRotation();
  }

  setShadowQualityTier(tier: ShadowQualityTier): void {
    this.shadowQualityTier = tier;
  }

  setCasEnabled(enabled: boolean): void {
    if (this.casEnabled === enabled) return;
    this.casEnabled = enabled;
    // CAS node is conditionally added to the pipeline, so toggling requires a rebuild.
    this.markPipelineDirty();
    this.applyQualitySettings();
  }

  setCasStrength(value: number): void {
    if (!Number.isFinite(value)) return;
    const newStrength = THREE.MathUtils.clamp(value, 0, 1);
    // Transitioning to/from zero changes whether the CAS node is in the pipeline.
    const wasZero = this.casStrength === 0;
    const isZero = newStrength === 0;
    this.casStrength = newStrength;
    if (wasZero !== isZero) {
      this.markPipelineDirty();
      this.applyQualitySettings();
    } else {
      this.syncCasSettings();
    }
  }

  async setEnvironment(name: string): Promise<void> {
    if (this.envName === name) return;
    this.envName = name;

    // Check cache first
    const cached = this.envCache.get(name);
    if (cached) {
      this.scene.environment = cached.texture;
      this.scene.background = cached.texture;
      this.applyEnvironmentRotation();
      return;
    }

    // Load HDR
    const preset = ENV_PRESETS.find(p => p.name === name);
    if (!preset?.file || !this.pmrem) return;

    try {
      const url = new URL(`../assets/env/${preset.file}`, import.meta.url).href;
      const hdrTexture = await this.hdrLoader.loadAsync(url);
      const envTarget = this.pmrem.fromEquirectangular(hdrTexture);
      hdrTexture.dispose();

      this.envCache.set(name, envTarget as unknown as THREE.WebGLRenderTarget<THREE.Texture>);

      // Only apply if still the selected env (user might have switched during load)
      if (this.envName === name) {
        this.scene.environment = envTarget.texture;
        this.scene.background = envTarget.texture;
        this.applyEnvironmentRotation();
      }
    } catch (err) {
      console.warn(`[RendererManager] Failed to load environment: ${name}`, err);
    }
  }

  setSsaoEnabled(enabled: boolean): void {
    this.gtaoEnabled = enabled;
    this.syncGtaoSettings();
    if (this.postProcessing) {
      (this.postProcessing as { needsUpdate: boolean }).needsUpdate = true;
    }
  }

  setSsrEnabled(enabled: boolean): void {
    if (this.ssrEnabled === enabled) return;
    this.ssrEnabled = enabled;
    this.markPipelineDirty();
    this.applyQualitySettings();
  }

  setSsrOpacity(value: number): void {
    if (!Number.isFinite(value)) return;
    this.ssrOpacity = THREE.MathUtils.clamp(value, 0, 1);
    if (this.postFXUniforms) this.postFXUniforms.ssrOpacity.value = this.isSsrActiveForPipeline() ? this.ssrOpacity : 0;
  }

  setSsrResolutionScale(value: number): void {
    if (!Number.isFinite(value)) return;
    this.ssrResolutionScale = THREE.MathUtils.clamp(value, 0.25, 1);
    if (this.ssrNode) {
      (this.ssrNode as unknown as { resolutionScale: number }).resolutionScale = this.ssrResolutionScale;
    }
  }

  setBloomEnabled(enabled: boolean): void {
    if (this.bloomEnabled === enabled) return;
    this.bloomEnabled = enabled;
    this.markPipelineDirty();
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

  getRenderStats(): Readonly<{ drawCalls: number; triangles: number; lines: number; points: number }> {
    return this.lastRenderStats;
  }

  /** Returns current flags (effective state). */
  getDebugFlags(): Readonly<{
    activeBackend: string;
    postProcessingEnabled: boolean;
    shadowsEnabled: boolean;
    shadowQuality: ShadowQualityTier;
    shadowQualityResolvedProfile: GraphicsProfile;
    exposure: number;
    graphicsProfile: GraphicsProfile;
    envRotationDegrees: number;
    aaMode: AntiAliasingMode;
    aoOnly: boolean;
    ssaoEnabled: boolean;
    ssrEnabled: boolean;
    ssrOpacity: number;
    ssrResolutionScale: number;
    bloomEnabled: boolean;
    bloomStrength: number;
    casEnabled: boolean;
    casStrength: number;
    vignetteEnabled: boolean;
    vignetteDarkness: number;
    lutEnabled: boolean;
    lutStrength: number;
    lutName: string;
    lutReady: boolean;
    envName: string;
  }> {
    let activeBackend = 'WebGLRenderer';
    if (this.isWebGPUPipeline) {
      const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
      activeBackend = backend?.isWebGPUBackend ? 'WebGPU' : 'WebGPU (WebGL2 backend)';
    }
    return {
      activeBackend,
      postProcessingEnabled: this.postProcessingEnabled,
      shadowsEnabled: this.shadowsEnabled,
      shadowQuality: this.shadowQualityTier,
      shadowQualityResolvedProfile: this.getEffectiveShadowQualityProfile(),
      exposure: this.toneExposure,
      graphicsProfile: this.graphicsProfile,
      envRotationDegrees: this.envRotationDegrees,
      aaMode: this.antiAliasingMode,
      aoOnly: this.aoOnlyView,
      ssaoEnabled: this.gtaoEnabled,
      ssrEnabled: this.isSsrActiveForPipeline(),
      ssrOpacity: this.ssrOpacity,
      ssrResolutionScale: this.ssrResolutionScale,
      bloomEnabled: this.bloomEnabled,
      bloomStrength: this.bloomStrength,
      casEnabled: this.casEnabled,
      casStrength: this.casStrength,
      vignetteEnabled: this.vignetteEnabled,
      vignetteDarkness: this.vignetteDarkness,
      lutEnabled: this.lutEnabled,
      lutStrength: this.lutStrength,
      lutName: this.lutName,
      lutReady: this.lutReady,
      envName: this.envName,
    };
  }

  /**
   * Syncs post-FX uniforms, pixel ratio budget, rebuilds the node graph, and resizes.
   */
  private applyQualitySettings(): void {
    // 1. Sync uniforms (cheap — no graph rebuild)
    if (this.postFXUniforms) {
      this.postFXUniforms.ssrOpacity.value = this.isSsrActiveForPipeline() ? this.ssrOpacity : 0;
      this.postFXUniforms.vignetteDarkness.value = this.vignetteEnabled ? this.vignetteDarkness : 0;
      this.postFXUniforms.lutIntensity.value = this.lutEnabled ? this.lutStrength : 0;
    }
    this.syncGtaoSettings();
    this.syncCasSettings();
    if (this.ssrNode) {
      // Keep SSR resolution scale in sync with runtime controls.
      (this.ssrNode as unknown as { resolutionScale: number }).resolutionScale = this.ssrResolutionScale;
    }

    // 2. Cap pixel ratio by profile to avoid runaway GPU cost
    const maxPR = this.getProfileMaxPixelRatio(this.graphicsProfile);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPR) * this.resolutionScale);
    this.renderer.shadowMap.enabled = this.shadowsEnabled;

    // 3. Rebuild the TSL node graph only when structural settings changed
    if (this.pipelineRebuildNeeded && this.isWebGPUPipeline && this.postProcessing && this.buildPipelineFn) {
      const finalGraph = this.buildPipelineFn(this.graphicsProfile);
      this.mainOutputNode = finalGraph;
      this.refreshOutputNode();

      // Re-apply the cached LUT to the new Lut3DNode (rebuild creates a placeholder)
      this.applyLutFromCache(this.lutName);

      // Re-sync bloom strength to newly created bloom nodes
      for (const node of this.bloomNodes) {
        node.strength.value = this.bloomStrength;
      }
      if (this.ssrNode) {
        (this.ssrNode as unknown as { resolutionScale: number }).resolutionScale = this.ssrResolutionScale;
      }

      this.pipelineRebuildNeeded = false;
    }

    this.handleResize();
  }

  private refreshOutputNode(): void {
    if (!this.postProcessing) return;
    const nextOutput = this.aoOnlyView && this.aoOnlyOutputNode
      ? this.aoOnlyOutputNode
      : this.mainOutputNode;
    if (!nextOutput) return;
    (this.postProcessing as { outputNode: TSLNode }).outputNode = nextOutput;
    this.postProcessing.needsUpdate = true;
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
    const maxPR = this.getProfileMaxPixelRatio(this.graphicsProfile);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, maxPR) * this.resolutionScale,
    );
    this.renderer.setSize(w, h);
    this.syncCasTexelSize();
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

    // Restore the shadow node prototype patch if this was the last instance.
    if (this.isWebGPUPipeline) {
      RendererManager.unpatchShadowNodeForToggle(this.renderer as WebGPURenderer);
    }

    for (const target of this.envCache.values()) {
      target.dispose();
    }
    this.envCache.clear();
    if (this.pmrem) {
      this.pmrem.dispose();
      this.pmrem = null;
    }
    if (this.postProcessing && typeof (this.postProcessing as { dispose?: () => void }).dispose === 'function') {
      (this.postProcessing as { dispose: () => void }).dispose();
    }
    this.disposePipelineDisposables();
    this.postProcessing = null;
    this.buildPipelineFn = null;
    this.mainOutputNode = null;
    this.pipelineRebuildNeeded = false;
    this.bloomNodes = [];
    this.postFXUniforms = null;
    this.lutPassNode = null;
    if (typeof this.prePassNode?.dispose === 'function') {
      this.prePassNode.dispose();
    }
    if (typeof this.aoDenoisePass?.dispose === 'function') {
      this.aoDenoisePass.dispose();
    }
    if (typeof this.gtaoPass?.dispose === 'function') {
      this.gtaoPass.dispose();
    }
    this.prePassNode = null;
    this.aoDenoisePass = null;
    this.gtaoPass = null;
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
