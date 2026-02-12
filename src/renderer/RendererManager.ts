import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LUT3dlLoader } from 'three/addons/loaders/LUT3dlLoader.js';
import type { Disposable } from '@core/types';
import type { GraphicsQuality } from '@core/UserSettings';

// WebGPU + TSL pipeline (dynamic import to allow fallback and avoid top-level side effects)
type WebGPURenderer = import('three/webgpu').WebGPURenderer;
type PostProcessing = import('three/webgpu').PostProcessing;
// TSL nodes: use any for dynamic imports to avoid strict three/tsl type dependency
type TSLPassNode = { setMRT(mrt: unknown): void; getTextureNode(name: string): unknown };
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
  private scenePass: TSLPassNode | null = null;
  private ssgiNode: InstanceType<typeof import('three/addons/tsl/display/SSGINode.js').default> | null = null;
  private outputNodeTraaWithSSGI: TSLNode | null = null;
  private outputNodeTraaNoSSGI: TSLNode | null = null;
  private outputNodeSSGIOnly: TSLNode | null = null;
  private outputNodeSceneOnly: TSLNode | null = null;
  private outputNodeSceneBloom: TSLNode | null = null;
  private outputNodeSSGIBloom: TSLNode | null = null;
  private outputNodeTraaSceneBloom: TSLNode | null = null;
  private outputNodeTraaSSGIBloom: TSLNode | null = null;
  private bloomNodes: Array<{ strength: { value: number } }> = [];
  private isWebGPUPipeline = false;

  private antiAliasingMode: AntiAliasingMode = 'taa';
  private ssrEnabled = false;
  private ssrResolutionScale = 0.5;
  private bloomEnabled = true;
  private vignetteEnabled = true;
  private lutEnabled = true;
  private lutStrength = 0.42;
  private lutReady = false;
  private readonly lutLoader = new LUT3dlLoader();
  private graphicsQuality: GraphicsQuality = 'high';
  private environmentTarget: THREE.WebGLRenderTarget<THREE.Texture> | null = null;
  private postProcessingEnabled = true;
  private shadowsEnabled = true;
  private toneExposure = 0.58;

  private ssgiEnabled = true;
  private ssgiPreset: SSGIPreset = 'medium';
  private ssgiRadius = 5;
  private ssgiGiIntensity = 2;
  private traaEnabled = true;
  private bloomStrength = 0.02;
  private vignetteDarkness = 0.42;
  private ssrOpacity = 0.5;
  private lutTexture: THREE.Data3DTexture | null = null;
  private postFXUniforms: {
    ssrOpacity: { value: number };
    vignetteDarkness: { value: number };
    lutIntensity: { value: number };
  } | null = null;

  /** Set in WebGPU init for SMAA/FXAA when applying AA mode. */
  private _aaHelpers: {
    smaa: (node: TSLNode) => TSLNode;
    fxaa: (node: TSLNode) => TSLNode;
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
    (this.renderer as THREE.WebGLRenderer).info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0xa9b9ee, 1);

    void this.loadDefaultLut();
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
      const { pass, mrt, output, diffuseColor, normalView, velocity, directionToColor } = await import('three/tsl');
      const { ssgi } = await import('three/addons/tsl/display/SSGINode.js');
      const { traa } = await import('three/addons/tsl/display/TRAANode.js');

      const wgpuRenderer = new WebGPURenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      }) as WebGPURenderer;
      wgpuRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      wgpuRenderer.setSize(window.innerWidth, window.innerHeight);
      wgpuRenderer.outputColorSpace = THREE.SRGBColorSpace;
      wgpuRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      wgpuRenderer.toneMappingExposure = this.toneExposure;
      wgpuRenderer.shadowMap.enabled = this.shadowsEnabled;
      wgpuRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

      await (wgpuRenderer as unknown as { init(): Promise<void> }).init();

      this.patchShadowNodeForToggle(wgpuRenderer);

      const pmremGenerator = new (await import('three/webgpu')).PMREMGenerator(wgpuRenderer);
      const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
      this.environmentTarget = envTarget as unknown as THREE.WebGLRenderTarget<THREE.Texture>;
      this.scene.environment = this.environmentTarget.texture;
      this.scene.environmentIntensity = 0.55;
      pmremGenerator.dispose();

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

      const { add, mix, uv, smoothstep, float, uniform, length: tslLength, max: tslMax, convertToTexture, sample, colorToDirection } = await import('three/tsl');
      const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
      const { ssr } = await import('three/addons/tsl/display/SSRNode.js');
      const scenePassColor = scenePass.getTextureNode('output');
      const scenePassDepth = scenePass.getTextureNode('depth');
      const scenePassNormal = scenePass.getTextureNode('normal');
      const scenePassVelocity = scenePass.getTextureNode('velocity');
      const scenePassMetalrough = scenePass.getTextureNode('metalrough');
      const metalnessNode = (scenePassMetalrough as TSLNode & { r: TSLNode }).r;
      const roughnessNode = (scenePassMetalrough as TSLNode & { g: TSLNode }).g;
      // Decode MRT normals (directionToColor-encoded) to view-space vec3 for SSR/SSGI (official three.js pattern)
      const sceneNormalDecoded = sample((uvNode: unknown) =>
        colorToDirection((scenePassNormal as { sample: (u: unknown) => unknown }).sample(uvNode) as never),
      ) as TSLNode;
      const giNode = ssgi(scenePassColor as never, scenePassDepth as never, sceneNormalDecoded as never, this.camera);
      const compositeWithSSGI = add(scenePassColor as never, giNode as never) as TSLNode;
      this.outputNodeSceneOnly = scenePassColor as TSLNode;
      this.outputNodeSSGIOnly = compositeWithSSGI;
      const traaSceneOnly = traa(scenePassColor as never, scenePassDepth as never, scenePassVelocity as never, this.camera) as TSLNode;
      const traaWithSSGI = traa(compositeWithSSGI as never, scenePassDepth as never, scenePassVelocity as never, this.camera) as TSLNode;

      const bloomSceneInput = bloom(scenePassColor as never, this.bloomStrength, 0.4, 0.2) as TSLNode & { strength: { value: number } };
      const bloomSSGINode = bloom(compositeWithSSGI as never, this.bloomStrength, 0.4, 0.2) as TSLNode & { strength: { value: number } };
      this.bloomNodes = [bloomSceneInput, bloomSSGINode];
      const bloomSceneOnly = add(scenePassColor as never, bloomSceneInput as never) as TSLNode;
      const bloomSSGIOnly = add(compositeWithSSGI as never, bloomSSGINode as never) as TSLNode;
      this.outputNodeSceneBloom = bloomSceneOnly;
      this.outputNodeSSGIBloom = bloomSSGIOnly;
      const traaSceneBloom = traa(bloomSceneOnly as never, scenePassDepth as never, scenePassVelocity as never, this.camera) as TSLNode;
      const traaSSGIBloom = traa(bloomSSGIOnly as never, scenePassDepth as never, scenePassVelocity as never, this.camera) as TSLNode;

      const ssrOpacityUniform = uniform(this.ssrOpacity);
      const vignetteDarknessUniform = uniform(this.vignetteDarkness);
      const lutIntensityUniform = uniform(this.lutStrength);
      this.lutTexture = new (await import('three')).Data3DTexture(new Uint8Array(4 * 2 * 2 * 2), 2, 2, 2);
      this.lutTexture.format = (await import('three')).RGBAFormat;
      this.lutTexture.type = (await import('three')).UnsignedByteType;
      this.lutTexture.needsUpdate = true;
      const applyPostFX = (colorInput: TSLNode): TSLNode => {
        const ssrResult = ssr(
          colorInput as never,
          scenePassDepth as never,
          sceneNormalDecoded as never,
          metalnessNode as never,
          roughnessNode as never,
          this.camera,
        );
        const withSSR = mix(colorInput as never, ssrResult as never, ssrOpacityUniform as never) as TSLNode;
        // Radial vignette: no darkening in center, smooth falloff toward edges (dist 0 at center, ~1.4 at corners)
        const uvCoord = uv();
        const dist = (uvCoord as { sub: (n: number) => { mul: (n: number) => TSLNode } }).sub(0.5).mul(2);
        const vignetteFactor = smoothstep(float(0.5), float(1.15), tslLength(dist as never) as never) as TSLNode;
        const one = float(1);
        const dark = (vignetteDarknessUniform as { mul: (n: TSLNode) => TSLNode }).mul(vignetteFactor as never) as TSLNode;
        const mult = tslMax(float(0), (one as { sub: (n: TSLNode) => TSLNode }).sub(dark as TSLNode) as never) as TSLNode;
        const withVignette = (withSSR as { mul: (n: TSLNode) => TSLNode }).mul(mult as TSLNode) as TSLNode;
        // LUT strength: 3D LUT disabled (WebGPU binding); simple brightness/contrast grade so slider has effect
        const contrast = float(1.2);
        const graded = (withVignette as { mul: (n: TSLNode) => TSLNode }).mul(contrast as TSLNode) as TSLNode;
        const withLUT = mix(withVignette as never, graded as never, lutIntensityUniform as never) as TSLNode;
        return withLUT;
      };
      this.postFXUniforms = {
        ssrOpacity: ssrOpacityUniform as { value: number },
        vignetteDarkness: vignetteDarknessUniform as { value: number },
        lutIntensity: lutIntensityUniform as { value: number },
      };
      // PostFX (SSR, vignette, LUT) must receive sampleable texture nodes. TRAA returns a pass node; convertToTexture gets its output texture.
      const postFXScene = applyPostFX(this.outputNodeSceneOnly!);
      const postFXSceneBloom = applyPostFX(this.outputNodeSceneBloom!);
      const postFXSSGI = applyPostFX(this.outputNodeSSGIOnly!);
      const postFXSSGIBloom = applyPostFX(this.outputNodeSSGIBloom!);
      this.outputNodeSceneOnly = postFXScene;
      this.outputNodeSSGIOnly = postFXSSGI;
      this.outputNodeSceneBloom = postFXSceneBloom;
      this.outputNodeSSGIBloom = postFXSSGIBloom;
      this.outputNodeTraaNoSSGI = applyPostFX(convertToTexture(traaSceneOnly as never) as TSLNode);
      this.outputNodeTraaWithSSGI = applyPostFX(convertToTexture(traaWithSSGI as never) as TSLNode);
      this.outputNodeTraaSceneBloom = applyPostFX(convertToTexture(traaSceneBloom as never) as TSLNode);
      this.outputNodeTraaSSGIBloom = applyPostFX(convertToTexture(traaSSGIBloom as never) as TSLNode);

      const { smaa } = await import('three/addons/tsl/display/SMAANode.js');
      const { fxaa } = await import('three/addons/tsl/display/FXAANode.js');
      this._aaHelpers = {
        smaa: smaa as (node: TSLNode) => TSLNode,
        fxaa: fxaa as (node: TSLNode) => TSLNode,
      };

      const postProcessing = new PostProcessing(wgpuRenderer, this.outputNodeTraaWithSSGI as never);
      this.postProcessing = postProcessing;
      this.scenePass = scenePass;
      this.ssgiNode = giNode as unknown as InstanceType<typeof import('three/addons/tsl/display/SSGINode.js').default>;

      this.applySSGIPreset(this.ssgiPreset);
      this.updateSSGIControls();
      this.applyQualitySettings();

      console.log('[RendererManager] WebGPU + TSL pipeline initialized');
    } catch (e) {
      console.warn('[RendererManager] WebGPU/TSL not available, using WebGL only:', e);
      this.isWebGPUPipeline = false;
      // Fallback: constructor already created a WebGLRenderer; we keep it and render via render().
      // When init() succeeds, WebGPURenderer may still use WebGL2 backend internally if WebGPU is unavailable.
      this.postProcessing = null;
      this.scenePass = null;
      this.ssgiNode = null;
      this.outputNodeSceneBloom = null;
      this.outputNodeSSGIBloom = null;
      this.outputNodeTraaSceneBloom = null;
      this.outputNodeTraaSSGIBloom = null;
      this.bloomNodes = [];
      this.postFXUniforms = null;
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer as THREE.WebGLRenderer);
      this.environmentTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
      this.scene.environment = this.environmentTarget.texture;
      this.scene.environmentIntensity = 0.55;
      pmremGenerator.dispose();
    }

    const renderer = this.renderer as THREE.WebGLRenderer;
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.zIndex = '0';
    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', this._onResize);
    this.handleResize();
    console.log('[RendererManager] Initialized');
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get maxAnisotropy(): number {
    return this.renderer.getMaxAnisotropy?.() ?? (this.renderer as THREE.WebGLRenderer).capabilities.getMaxAnisotropy();
  }

  /** Render one frame. */
  render(): void {
    if (this.renderer.info?.reset) this.renderer.info.reset();
    if (this.postProcessingEnabled && this.isWebGPUPipeline && this.postProcessing) {
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    const info = this.renderer.info ?? (this.renderer as THREE.WebGLRenderer).info;
    if (info?.render) {
      this.lastRenderStats.drawCalls = info.render.calls ?? 0;
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
    this.applyQualitySettings();
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
    this.applyQualitySettings();
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

  setSsaoEnabled(enabled: boolean): void {
    this.ssgiEnabled = enabled;
    this.applyQualitySettings();
  }

  setSsaoRadius(value: number): void {
    if (!Number.isFinite(value)) return;
    this.ssgiRadius = THREE.MathUtils.clamp(value, 2, 24);
    this.updateSSGIControls();
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
    this.applyQualitySettings();
  }

  setVignetteEnabled(enabled: boolean): void {
    this.vignetteEnabled = enabled;
    this.applyQualitySettings();
  }

  setVignetteDarkness(value: number): void {
    if (!Number.isFinite(value)) return;
    this.vignetteDarkness = THREE.MathUtils.clamp(value, 0, 0.8);
    if (this.postFXUniforms) this.postFXUniforms.vignetteDarkness.value = this.vignetteDarkness;
    this.applyQualitySettings();
  }

  setLutEnabled(enabled: boolean): void {
    this.lutEnabled = enabled;
    this.applyQualitySettings();
  }

  setLutStrength(value: number): void {
    if (!Number.isFinite(value)) return;
    this.lutStrength = THREE.MathUtils.clamp(value, 0, 1);
    if (this.postFXUniforms) this.postFXUniforms.lutIntensity.value = this.lutEnabled ? this.lutStrength : 0;
    this.applyQualitySettings();
  }

  setSsgiEnabled(enabled: boolean): void {
    this.ssgiEnabled = enabled;
    this.applyQualitySettings();
  }

  setSsgiPreset(preset: SSGIPreset): void {
    this.ssgiPreset = preset;
    this.applySSGIPreset(preset);
    this.applyQualitySettings();
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
    ssaoRadius: number;
    ssrEnabled: boolean;
    ssrOpacity: number;
    ssrResolutionScale: number;
    bloomEnabled: boolean;
    bloomStrength: number;
    vignetteEnabled: boolean;
    vignetteDarkness: number;
    lutEnabled: boolean;
    lutStrength: number;
    lutReady: boolean;
    ssgiEnabled: boolean;
    ssgiPreset: SSGIPreset;
    ssgiRadius: number;
    ssgiGiIntensity: number;
    traaEnabled: boolean;
  }> {
    const bloomStrength = this.bloomStrength;
    const vignetteDarkness = this.vignetteDarkness;
    const ssgiBudget = this.graphicsQuality === 'low' ? false : this.ssgiEnabled;
    const traaBudget = this.graphicsQuality === 'low' ? false : this.traaEnabled;
    const effectiveSsgi = !!(
      this.postProcessingEnabled &&
      this.isWebGPUPipeline &&
      ssgiBudget
    );
    const effectiveTraa = !!(
      this.postProcessingEnabled &&
      this.isWebGPUPipeline &&
      traaBudget
    );
    return {
      postProcessingEnabled: this.postProcessingEnabled,
      shadowsEnabled: this.shadowsEnabled,
      exposure: this.toneExposure,
      graphicsQuality: this.graphicsQuality,
      aaMode: this.antiAliasingMode,
      ssaoEnabled: this.ssgiEnabled,
      ssaoRadius: this.ssgiRadius,
      ssrEnabled: this.ssrEnabled,
      ssrOpacity: this.ssrOpacity,
      ssrResolutionScale: this.ssrResolutionScale,
      bloomEnabled: this.bloomEnabled,
      bloomStrength,
      vignetteEnabled: this.vignetteEnabled,
      vignetteDarkness,
      lutEnabled: this.lutEnabled,
      lutStrength: this.lutStrength,
      lutReady: this.lutReady,
      ssgiEnabled: effectiveSsgi,
      ssgiPreset: this.ssgiPreset,
      ssgiRadius: this.ssgiRadius,
      ssgiGiIntensity: this.ssgiGiIntensity,
      traaEnabled: effectiveTraa,
    };
  }

  /**
   * Syncs quality state: post-FX uniforms, pixel ratio, shadows, SSGI/TRAA,
   * selects the active output node (scene/bloom/SSGI/TRAA combination), sets
   * postProcessing.needsUpdate, and runs handleResize().
   */
  private applyQualitySettings(): void {
    if (this.postFXUniforms) {
      this.postFXUniforms.ssrOpacity.value = this.ssrEnabled ? this.ssrOpacity : 0;
      this.postFXUniforms.vignetteDarkness.value = this.vignetteEnabled ? this.vignetteDarkness : 0;
      this.postFXUniforms.lutIntensity.value = this.lutEnabled ? this.lutStrength : 0;
    }
    // Guardrails: cap pixel ratio by quality to avoid runaway GPU cost
    const maxPR = this.graphicsQuality === 'low' ? 1 : this.graphicsQuality === 'medium' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPR));

    this.renderer.shadowMap.enabled = true;

    let ssgiBudget = this.ssgiEnabled;
    let traaBudget = this.traaEnabled;
    let effectivePreset = this.ssgiPreset;

    if (this.graphicsQuality === 'low') {
      ssgiBudget = false;
      traaBudget = false;
      effectivePreset = 'low';
    } else {
      effectivePreset = this.ssgiPreset;
    }

    if (this.ssgiNode) {
      this.applySSGIPreset(effectivePreset);
      this.updateSSGIControls();
    }
    if (this.postProcessing && this.scenePass && this.outputNodeTraaWithSSGI) {
      const useSSGI = ssgiBudget && this.ssgiEnabled && this.postProcessingEnabled;
      const useTRAA =
        this.antiAliasingMode === 'taa' &&
        traaBudget &&
        this.traaEnabled &&
        this.postProcessingEnabled;
      const useBloom = this.bloomEnabled && this.postProcessingEnabled;
      let out: TSLNode;
      if (useBloom) {
        if (useTRAA && useSSGI) out = this.outputNodeTraaSSGIBloom!;
        else if (useTRAA && !useSSGI) out = this.outputNodeTraaSceneBloom!;
        else if (!useTRAA && useSSGI) out = this.outputNodeSSGIBloom!;
        else out = this.outputNodeSceneBloom!;
      } else {
        if (useTRAA && useSSGI) out = this.outputNodeTraaWithSSGI;
        else if (useTRAA && !useSSGI) out = this.outputNodeTraaNoSSGI!;
        else if (!useTRAA && useSSGI) out = this.outputNodeSSGIOnly!;
        else out = this.outputNodeSceneOnly!;
      }
      if (this._aaHelpers) {
        if (this.antiAliasingMode === 'smaa') {
          out = this._aaHelpers.smaa(out);
        } else if (this.antiAliasingMode === 'fxaa') {
          out = this._aaHelpers.fxaa(out);
        }
      }
      (this.postProcessing as { outputNode: TSLNode }).outputNode = out;
      this.postProcessing.needsUpdate = true;
    }

    this.handleResize();
  }

  getGraphicsQuality(): GraphicsQuality {
    return this.graphicsQuality;
  }

  private async loadDefaultLut(): Promise<void> {
    try {
      const source = new URL('../assets/postfx/lut_v2.3dl', import.meta.url).href;
      const parsed = (await this.lutLoader.loadAsync(source)) as { texture3D?: THREE.Data3DTexture };
      if (!parsed.texture3D) return;
      this.lutTexture = parsed.texture3D;
      parsed.texture3D.needsUpdate = true;
      this.lutReady = true;
      this.applyQualitySettings();
    } catch (err) {
      console.warn('[RendererManager] Failed to load LUT asset:', err);
      this.lutReady = false;
    }
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
    this.environmentTarget?.dispose();
    if (this.postProcessing && typeof (this.postProcessing as { dispose?: () => void }).dispose === 'function') {
      (this.postProcessing as { dispose: () => void }).dispose();
    }
    this.postProcessing = null;
    this.scenePass = null;
    this.ssgiNode = null;
    this.outputNodeTraaWithSSGI = null;
    this.outputNodeTraaNoSSGI = null;
    this.outputNodeSSGIOnly = null;
    this.outputNodeSceneOnly = null;
    this.outputNodeSceneBloom = null;
    this.outputNodeSSGIBloom = null;
    this.outputNodeTraaSceneBloom = null;
    this.outputNodeTraaSSGIBloom = null;
    this.bloomNodes = [];
    this.postFXUniforms = null;
    this.lutTexture?.dispose();
    this.lutTexture = null;
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
