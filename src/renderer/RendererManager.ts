// NOTE: `three` and `three/webgpu` are intentionally separate imports.
// `three` provides core types/classes shared across backends.
// `three/webgpu` provides WebGPU-specific exports (WebGPURenderer, RenderPipeline, PMREMGenerator).
// No Vite alias is needed — these are distinct entry points by design since r182.

import { resolveViewportMetrics } from "@core/mobilePlatform";
import type { Disposable } from "@core/types";
import type { GraphicsProfile, ShadowQualityTier } from "@core/UserSettings";
import * as THREE from "three";
import { PMREMGenerator, type RenderPipeline, WebGPURenderer } from "three/webgpu";
import {
  buildRendererPipelineDescriptor,
  getRendererMaxPixelRatio,
  type RendererPipelineDescriptor,
} from "./pipelineProfile";
import { RendererAssetLibrary } from "./rendererAssets";
import {
  attachRendererCanvas,
  createFallbackRenderer,
  createWebGpuRenderer,
  showDeviceLostOverlay,
} from "./rendererBootstrap";
import { clampFiniteNumber, resolveCasStrengthMutation } from "./rendererMutations";
import {
  buildRendererPipeline,
  type RendererLutPassNode,
  type RendererPostFxUniforms,
} from "./rendererPipelineBuilder";
import { ENV_PRESETS } from "./rendererPresets";
import { getEffectiveCasStrength, syncCasTexelSize, syncGtaoSettings, syncRuntimePostFxState } from "./rendererQuality";
import {
  type DenoiseNodeLike,
  type GTAONodeLike,
  loadTslRuntime,
  type TSLPassNode,
  type TSLRuntime,
} from "./rendererRuntime";
import {
  applyEnvironmentRotation,
  applyEnvironmentTarget,
  applyLutTexture,
  applyShadowToggle,
} from "./rendererSceneState";
import { buildRendererDebugFlags, getGraphicsProfileDefaults, type RendererDebugFlags } from "./rendererState";

/**
 * Renderer notes for the r183 WebGPU path.
 *
 * - `RenderPipeline.outputColorTransform` stays disabled because this renderer
 *   calls `renderOutput()` manually in the TSL graph.
 * - `info.autoReset` is enabled explicitly so per-frame stats stay stable.
 * - `WebGPURenderer.init()` is used during bootstrap even when local typings lag.
 * - `onDeviceLost` is wired so the user gets a visible recovery overlay.
 */

export { ENV_NAMES, LUT_NAMES } from "./rendererPresets";

export type AntiAliasingMode = "smaa" | "fxaa" | "none";

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
  private pipelineRebuildNeeded = false;
  private pipelineDisposables: Array<{ dispose: () => void }> = [];
  private tslRuntime: TSLRuntime | null = null;
  private currentPipelineDescriptor: RendererPipelineDescriptor | null = null;

  // Keep a reference for runtime SSR parameter sync/debugging.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ssrNode: any | null = null;
  private bloomNodes: Array<{ strength: { value: number } }> = [];
  private isWebGPUPipeline = false;
  private readonly forceWebGL: boolean;

  private antiAliasingMode: AntiAliasingMode = "fxaa";
  private ssrEnabled = false;
  private ssrResolutionScale = 0.5;
  private bloomEnabled = true;
  private vignetteEnabled = true;
  private lutEnabled = true;
  private lutStrength = 0.42;
  private lutName = "Cubicle 99";
  private lutReady = false;
  private readonly assetLibrary = new RendererAssetLibrary();
  private graphicsProfile: GraphicsProfile = "cinematic";
  private envName = "Sunrise";
  private postProcessingEnabled = true;
  private shadowsEnabled = true;
  private shadowQualityTier: ShadowQualityTier = "auto";
  private toneExposure = 0.85;
  private resolutionScale = 1;
  private envRotationDegrees = 0;
  private aoOnlyView = false;
  private gtaoPass: GTAONodeLike | null = null;
  private aoDenoisePass: DenoiseNodeLike | null = null;
  private prePassNode: (TSLPassNode & { updateBeforeType?: string; dispose?: () => void }) | null = null;

  private gtaoEnabled = true;
  private bloomStrength = 0.1;
  private casEnabled = true;
  private casStrength = 0.3;
  private vignetteDarkness = 0.42;
  private ssrOpacity = 0.5;
  private lutPassNode: RendererLutPassNode | null = null;
  private postFXUniforms: RendererPostFxUniforms | null = null;

  private lastRenderStats = {
    drawCalls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
  };

  private _onResize = this.handleResize.bind(this);
  private _onOrientationChange = this.handleOrientationChange.bind(this);
  private _onViewportMetricsChanged = this.queueResize.bind(this);
  private resizeFrame: number | null = null;
  private orientationSettleTimer: number | null = null;
  private readonly preferCompatibilityRenderer: boolean;

  constructor(
    options: {
      forceWebGL?: boolean;
      preferCompatibilityRenderer?: boolean;
    } = {},
  ) {
    this.forceWebGL = options.forceWebGL ?? false;
    this.preferCompatibilityRenderer = options.preferCompatibilityRenderer ?? false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8d8c8);
    this.scene.fog = new THREE.Fog(0xe8d8c8, 140, 400);
    applyEnvironmentRotation(this.scene, this.envRotationDegrees);

    const initialViewport = resolveViewportMetrics(window);
    this.camera = new THREE.PerspectiveCamera(
      65,
      initialViewport.width / initialViewport.height,
      CAMERA_CLIP_NEAR,
      CAMERA_CLIP_FAR,
    );
    this.camera.position.set(0, 5, 10);
    this.camera.lookAt(0, 0, 0);

    this.renderer = createFallbackRenderer(this.toneExposure);

    void this.loadSingleLut(this.lutName);
    this.setGraphicsProfile("balanced");
  }

  /**
   * Must be called before first render. Tries to switch to WebGPU+TSL pipeline.
   * On failure (e.g. three/webgpu not available or init throws), the existing WebGL
   * renderer is kept and render() uses it. WebGPURenderer itself may use a WebGL2
   * backend when WebGPU is unavailable (browser-dependent).
   */
  async init(): Promise<void> {
    document.body.style.margin = "0";
    document.body.style.background = "#d8dce8";
    document.body.style.backgroundAttachment = "fixed";

    if (this.preferCompatibilityRenderer) {
      console.log("[RendererManager] Compatibility renderer enabled; using WebGL renderer on this device");
      this.isWebGPUPipeline = false;
      this.tslRuntime = null;
      this.currentPipelineDescriptor = null;
      this.resetPipelineResources();
      this.pipelineRebuildNeeded = false;
      this.initializeFallbackEnvironment();
    } else {
      try {
        this.tslRuntime = await loadTslRuntime();

        const bootstrapRenderer = await createWebGpuRenderer({
          forceWebGL: this.forceWebGL,
          profile: this.graphicsProfile,
          shadowsEnabled: this.shadowsEnabled,
          exposure: this.toneExposure,
          onDeviceLost: (info) => {
            console.error("[RendererManager] GPU device lost:", info);
            showDeviceLostOverlay(info);
          },
        });

        const pmrem = new PMREMGenerator(bootstrapRenderer);
        pmrem.compileEquirectangularShader();
        this.assetLibrary.setPmremGenerator(pmrem);
        const bootstrapEnvTarget = this.assetLibrary.getOrCreateRoomEnvironment();
        if (!bootstrapEnvTarget) {
          throw new Error("Failed to build room environment during WebGPU bootstrap");
        }
        applyEnvironmentTarget(this.scene, bootstrapEnvTarget, this.envRotationDegrees);
        this.scene.environmentIntensity = 0.68;
        this.scene.backgroundIntensity = 1.0;
        this.scene.backgroundBlurriness = 0.15;

        const fallbackRenderer = this.renderer as THREE.WebGLRenderer;
        fallbackRenderer.dispose();

        (this as { renderer: THREE.WebGLRenderer | WebGPURenderer }).renderer = bootstrapRenderer;
        this.isWebGPUPipeline = true;

        this.pipelineRebuildNeeded = true;
        this.applyQualitySettings();
        console.log("[RendererManager] WebGPU + TSL pipeline initialized");
      } catch (e) {
        console.warn("[RendererManager] WebGPU/TSL not available, using WebGL only:", e);
        this.isWebGPUPipeline = false;
        this.tslRuntime = null;
        this.currentPipelineDescriptor = null;
        // Fallback: constructor already created a WebGLRenderer; we keep it and render via render().
        // When init() succeeds, WebGPURenderer may still use WebGL2 backend internally if WebGPU is unavailable.
        this.resetPipelineResources();
        this.pipelineRebuildNeeded = false;
        this.initializeFallbackEnvironment();
      }
    }

    attachRendererCanvas(this.renderer);
    window.addEventListener("resize", this._onResize);
    window.addEventListener("orientationchange", this._onOrientationChange);
    window.visualViewport?.addEventListener("resize", this._onViewportMetricsChanged);
    window.visualViewport?.addEventListener("scroll", this._onViewportMetricsChanged);
    this.handleResize();
    console.log("[RendererManager] Initialized");

    // Load the default HDR environment if it's not the procedural Room Environment
    if (this.envName !== "Room Environment") {
      const defaultEnv = this.envName;
      this.envName = ""; // Reset to bypass setEnvironment guard
      void this.setEnvironment(defaultEnv);
    }
  }

  private initializeFallbackEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer as THREE.WebGLRenderer);
    pmrem.compileEquirectangularShader();
    this.assetLibrary.setPmremGenerator(pmrem);
    const envTarget = this.assetLibrary.getOrCreateRoomEnvironment();
    if (!envTarget) {
      throw new Error("Failed to build room environment during fallback bootstrap");
    }
    applyEnvironmentTarget(this.scene, envTarget, this.envRotationDegrees);
    this.scene.environmentIntensity = 0.68;
    this.scene.backgroundIntensity = 1.0;
    this.scene.backgroundBlurriness = 0.15;
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
    if (typeof disposable?.dispose === "function") {
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

  private getPipelineDescriptor(): RendererPipelineDescriptor {
    const descriptor = buildRendererPipelineDescriptor({
      profile: this.graphicsProfile,
      aaMode: this.antiAliasingMode,
      postProcessingEnabled: this.postProcessingEnabled,
      aoEnabled: this.gtaoEnabled,
      aoOnlyView: this.aoOnlyView,
      bloomEnabled: this.bloomEnabled,
      ssrEnabled: this.ssrEnabled,
      casEnabled: this.casEnabled,
      casStrength: this.casStrength,
      vignetteEnabled: this.vignetteEnabled,
      lutEnabled: this.lutEnabled,
    });
    this.currentPipelineDescriptor = descriptor;
    return descriptor;
  }

  private resetPipelineResources(): void {
    if (this.postProcessing && typeof (this.postProcessing as { dispose?: () => void }).dispose === "function") {
      (this.postProcessing as { dispose: () => void }).dispose();
    }
    this.postProcessing = null;
    this.disposePipelineDisposables();
    if (typeof this.prePassNode?.dispose === "function") this.prePassNode.dispose();
    if (typeof this.aoDenoisePass?.dispose === "function") this.aoDenoisePass.dispose();
    if (typeof this.gtaoPass?.dispose === "function") this.gtaoPass.dispose();
    this.prePassNode = null;
    this.aoDenoisePass = null;
    this.gtaoPass = null;
    this.bloomNodes = [];
    this.ssrNode = null;
    this.postFXUniforms = null;
    this.lutPassNode = null;
  }

  private rebuildPostProcessingPipeline(): void {
    if (!this.isWebGPUPipeline || !this.tslRuntime || !(this.renderer instanceof WebGPURenderer)) {
      this.currentPipelineDescriptor = this.getPipelineDescriptor();
      this.resetPipelineResources();
      return;
    }

    const descriptor = this.getPipelineDescriptor();
    this.resetPipelineResources();

    if (!descriptor.useRenderPipeline) {
      return;
    }

    const result = buildRendererPipeline({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      runtime: this.tslRuntime,
      descriptor,
      aoOnlyView: this.aoOnlyView,
      vignetteEnabled: this.vignetteEnabled,
      vignetteDarkness: this.vignetteDarkness,
      lutEnabled: this.lutEnabled,
      lutStrength: this.lutStrength,
      ssrOpacity: this.ssrOpacity,
      ssrResolutionScale: this.ssrResolutionScale,
      casStrength: this.casStrength,
      registerDisposable: (node) => this.registerPipelineDisposable(node),
    });

    this.postProcessing = result.postProcessing;
    this.postFXUniforms = result.postFXUniforms;
    this.prePassNode = result.prePassNode;
    this.aoDenoisePass = result.aoDenoisePass;
    this.gtaoPass = result.gtaoPass;
    this.bloomNodes = result.bloomNodes;
    this.ssrNode = result.ssrNode;
    this.lutPassNode = result.lutPassNode;
    syncGtaoSettings({
      postFXUniforms: this.postFXUniforms,
      gtaoPass: this.gtaoPass,
      aoDenoisePass: this.aoDenoisePass,
      prePassNode: this.prePassNode,
      descriptor,
      aoOnlyView: this.aoOnlyView,
      graphicsProfile: this.graphicsProfile,
    });
    for (const node of this.bloomNodes) {
      node.strength.value = this.bloomStrength;
    }
    if (this.ssrNode) {
      (this.ssrNode as { resolutionScale: number }).resolutionScale = this.ssrResolutionScale;
    }
    this.applyLutFromCache(this.lutName);
  }

  setGraphicsProfile(profile: GraphicsProfile): void {
    this.graphicsProfile = profile;
    const defaults = getGraphicsProfileDefaults(profile);
    this.gtaoEnabled = defaults.gtaoEnabled;
    this.ssrEnabled = defaults.ssrEnabled;
    this.bloomEnabled = defaults.bloomEnabled;
    this.bloomStrength = defaults.bloomStrength;
    this.casEnabled = defaults.casEnabled;
    this.casStrength = defaults.casStrength;
    this.vignetteEnabled = defaults.vignetteEnabled;
    this.vignetteDarkness = defaults.vignetteDarkness;
    this.lutEnabled = defaults.lutEnabled;
    this.lutStrength = defaults.lutStrength;
    this.antiAliasingMode = defaults.antiAliasingMode;
    this.ssrOpacity = defaults.ssrOpacity;
    this.ssrResolutionScale = defaults.ssrResolutionScale;
    this.markPipelineDirty();
    this.applyQualitySettings();
  }

  private getProfileMaxPixelRatio(profile: GraphicsProfile): number {
    return getRendererMaxPixelRatio(profile);
  }

  private getEffectiveShadowQualityProfile(): GraphicsProfile {
    return this.shadowQualityTier === "auto" ? this.graphicsProfile : this.shadowQualityTier;
  }

  private isSsrActiveForPipeline(): boolean {
    return this.currentPipelineDescriptor?.useSSR ?? false;
  }

  private applyStructuralToggleChange(
    currentValue: boolean,
    nextValue: boolean,
    assign: (value: boolean) => void,
  ): void {
    if (currentValue === nextValue) return;
    assign(nextValue);
    this.markPipelineDirty();
    this.applyQualitySettings();
  }

  private applyStructuralChange(changed: boolean, apply: () => void): void {
    if (!changed) return;
    apply();
    this.markPipelineDirty();
    this.applyQualitySettings();
  }

  setPostProcessingEnabled(enabled: boolean): void {
    this.applyStructuralToggleChange(this.postProcessingEnabled, enabled, (value) => {
      this.postProcessingEnabled = value;
    });
  }

  setAoOnlyView(enabled: boolean): void {
    this.applyStructuralToggleChange(this.aoOnlyView, enabled, (value) => {
      this.aoOnlyView = value;
    });
  }

  setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    // Use renderer.shadowMap.enabled as the global shadow toggle.
    // LevelManager keeps light.castShadow stable to avoid WebGPU "destroyed texture" hazards.
    applyShadowToggle(this.renderer, this.postProcessing, enabled);
  }

  setExposure(value: number): void {
    const nextValue = clampFiniteNumber(value, 0.35, 1.85);
    if (nextValue === null) return;
    this.toneExposure = nextValue;
    this.renderer.toneMappingExposure = this.toneExposure;
  }

  setAntiAliasingMode(mode: AntiAliasingMode): void {
    this.applyStructuralChange(this.antiAliasingMode !== mode, () => {
      this.antiAliasingMode = mode;
    });
  }

  setResolutionScale(value: number): void {
    const nextValue = clampFiniteNumber(value, 0.5, 1);
    if (nextValue === null) return;
    this.resolutionScale = nextValue;
    this.applyQualitySettings();
  }

  setBackgroundIntensity(value: number): void {
    const nextValue = clampFiniteNumber(value, 0, 2);
    if (nextValue === null) return;
    this.scene.backgroundIntensity = nextValue;
  }

  setBackgroundBlurriness(value: number): void {
    const nextValue = clampFiniteNumber(value, 0, 1);
    if (nextValue === null) return;
    this.scene.backgroundBlurriness = nextValue;
  }

  setEnvironmentRotationDegrees(value: number): void {
    const nextValue = clampFiniteNumber(value, -180, 180);
    if (nextValue === null) return;
    this.envRotationDegrees = nextValue;
    applyEnvironmentRotation(this.scene, this.envRotationDegrees);
  }

  setShadowQualityTier(tier: ShadowQualityTier): void {
    this.shadowQualityTier = tier;
  }

  setCasEnabled(enabled: boolean): void {
    this.applyStructuralToggleChange(this.casEnabled, enabled, (value) => {
      this.casEnabled = value;
    });
  }

  setCasStrength(value: number): void {
    const nextValue = clampFiniteNumber(value, 0, 1);
    if (nextValue === null) return;
    const mutation = resolveCasStrengthMutation(this.casStrength, nextValue);
    this.casStrength = mutation.nextValue;
    if (mutation.requiresRebuild) {
      this.markPipelineDirty();
      this.applyQualitySettings();
    } else {
      if (this.postFXUniforms) {
        this.postFXUniforms.casStrength.value = getEffectiveCasStrength(
          this.casEnabled,
          this.antiAliasingMode,
          this.casStrength,
        );
      }
    }
  }

  async setEnvironment(name: string): Promise<void> {
    if (this.envName === name) return;
    this.envName = name;

    const envTarget = await this.assetLibrary.ensureEnvironment(name);
    if (!envTarget) {
      const preset = ENV_PRESETS.find((entry) => entry.name === name);
      if (preset?.file) {
        console.warn(`[RendererManager] Failed to apply environment: ${name}`);
      }
      return;
    }

    // Only apply if still selected (user may have switched during the async load).
    if (this.envName !== name) return;
    applyEnvironmentTarget(this.scene, envTarget, this.envRotationDegrees);
  }

  setSsaoEnabled(enabled: boolean): void {
    this.applyStructuralToggleChange(this.gtaoEnabled, enabled, (value) => {
      this.gtaoEnabled = value;
    });
  }

  setSsrEnabled(enabled: boolean): void {
    this.applyStructuralToggleChange(this.ssrEnabled, enabled, (value) => {
      this.ssrEnabled = value;
    });
  }

  setSsrOpacity(value: number): void {
    const nextValue = clampFiniteNumber(value, 0, 1);
    if (nextValue === null) return;
    this.ssrOpacity = nextValue;
    if (this.postFXUniforms) this.postFXUniforms.ssrOpacity.value = this.isSsrActiveForPipeline() ? this.ssrOpacity : 0;
  }

  setSsrResolutionScale(value: number): void {
    const nextValue = clampFiniteNumber(value, 0.25, 1);
    if (nextValue === null) return;
    this.ssrResolutionScale = nextValue;
    if (this.ssrNode) {
      (this.ssrNode as unknown as { resolutionScale: number }).resolutionScale = this.ssrResolutionScale;
    }
  }

  setBloomEnabled(enabled: boolean): void {
    this.applyStructuralToggleChange(this.bloomEnabled, enabled, (value) => {
      this.bloomEnabled = value;
    });
  }

  setBloomStrength(value: number): void {
    const nextValue = clampFiniteNumber(value, 0, 1.0);
    if (nextValue === null) return;
    this.bloomStrength = nextValue;
    for (const node of this.bloomNodes) {
      node.strength.value = this.bloomStrength;
    }
  }

  setVignetteEnabled(enabled: boolean): void {
    this.applyStructuralToggleChange(this.vignetteEnabled, enabled, (value) => {
      this.vignetteEnabled = value;
    });
  }

  setVignetteDarkness(value: number): void {
    const nextValue = clampFiniteNumber(value, 0, 0.8);
    if (nextValue === null) return;
    this.vignetteDarkness = nextValue;
    if (this.postFXUniforms)
      this.postFXUniforms.vignetteDarkness.value = this.vignetteEnabled ? this.vignetteDarkness : 0;
  }

  setLutEnabled(enabled: boolean): void {
    this.applyStructuralToggleChange(this.lutEnabled, enabled, (value) => {
      this.lutEnabled = value;
    });
  }

  setLutStrength(value: number): void {
    const nextValue = clampFiniteNumber(value, 0, 1);
    if (nextValue === null) return;
    this.lutStrength = nextValue;
    if (this.postFXUniforms) this.postFXUniforms.lutIntensity.value = this.lutEnabled ? this.lutStrength : 0;
  }

  setLutName(name: string): void {
    if (this.lutName === name) return;
    this.lutName = name;

    const cached = this.assetLibrary.getCachedLut(name);
    if (cached && this.lutPassNode) {
      applyLutTexture(this.lutPassNode, this.postProcessing, cached);
    } else if (!cached) {
      // LUT not yet loaded — attempt async load then apply
      void this.loadSingleLut(name);
    }
  }

  /** Load a single LUT by name (fallback for presets not yet cached). */
  private async loadSingleLut(name: string): Promise<void> {
    const texture = await this.assetLibrary.ensureLut(name);
    if (texture && this.lutName === name) {
      this.applyLutFromCache(name);
    }
  }

  /** Apply a cached LUT to the live Lut3DNode (no pipeline rebuild). */
  private applyLutFromCache(name: string): void {
    const tex = this.assetLibrary.getCachedLut(name);
    if (!tex) return;
    this.lutReady = true;
    applyLutTexture(this.lutPassNode, this.postProcessing, tex);
  }

  getRenderStats(): Readonly<{ drawCalls: number; triangles: number; lines: number; points: number }> {
    return this.lastRenderStats;
  }

  /** Returns current flags (effective state). */
  getDebugFlags(): Readonly<RendererDebugFlags> {
    const descriptor = this.currentPipelineDescriptor ?? this.getPipelineDescriptor();
    const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    return buildRendererDebugFlags({
      isWebGPUPipeline: this.isWebGPUPipeline,
      backendInfo: backend,
      postProcessingEnabled: this.postProcessingEnabled,
      shadowsEnabled: this.shadowsEnabled,
      shadowQuality: this.shadowQualityTier,
      shadowQualityResolvedProfile: this.getEffectiveShadowQualityProfile(),
      exposure: this.toneExposure,
      graphicsProfile: this.graphicsProfile,
      envRotationDegrees: this.envRotationDegrees,
      descriptor,
      aoOnlyView: this.aoOnlyView,
      ssrOpacity: this.ssrOpacity,
      ssrResolutionScale: this.ssrResolutionScale,
      bloomStrength: this.bloomStrength,
      casStrength: this.casStrength,
      vignetteEnabled: this.vignetteEnabled,
      vignetteDarkness: this.vignetteDarkness,
      lutEnabled: this.lutEnabled,
      lutStrength: this.lutStrength,
      lutName: this.lutName,
      lutReady: this.lutReady,
      envName: this.envName,
    });
  }

  /**
   * Syncs post-FX uniforms, pixel ratio budget, rebuilds the node graph, and resizes.
   */
  private applyQualitySettings(): void {
    const descriptor = this.getPipelineDescriptor();
    // 1. Sync uniforms (cheap — no graph rebuild)
    syncRuntimePostFxState({
      renderer: this.renderer,
      postFXUniforms: this.postFXUniforms,
      ssrNode: this.ssrNode,
      ssrOpacity: this.ssrOpacity,
      ssrResolutionScale: this.ssrResolutionScale,
      vignetteEnabled: this.vignetteEnabled,
      vignetteDarkness: this.vignetteDarkness,
      lutEnabled: this.lutEnabled,
      lutStrength: this.lutStrength,
      casEnabled: this.casEnabled,
      antiAliasingMode: this.antiAliasingMode,
      casStrength: this.casStrength,
      descriptor,
      aoOnlyView: this.aoOnlyView,
      gtaoPass: this.gtaoPass,
      aoDenoisePass: this.aoDenoisePass,
      prePassNode: this.prePassNode,
      graphicsProfile: this.graphicsProfile,
    });

    // 2. Cap pixel ratio by profile to avoid runaway GPU cost
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, descriptor.maxPixelRatio) * this.resolutionScale);
    this.renderer.shadowMap.enabled = this.shadowsEnabled;

    // 3. Rebuild the TSL node graph only when structural settings changed
    if (this.pipelineRebuildNeeded && this.isWebGPUPipeline) {
      this.rebuildPostProcessingPipeline();
      this.pipelineRebuildNeeded = false;
    }

    this.handleResize();
  }

  getGraphicsProfile(): GraphicsProfile {
    return this.graphicsProfile;
  }

  supportsAdvancedGpuEffects(): boolean {
    return this.isWebGPUPipeline;
  }

  /** Set the animation loop callback. */
  setAnimationLoop(callback: ((time: DOMHighResTimeStamp) => void) | null): void {
    const r = this.renderer as THREE.WebGLRenderer & { setAnimationLoop?(cb: ((t: number) => void) | null): void };
    if (r.setAnimationLoop) r.setAnimationLoop(callback);
  }

  private queueResize(): void {
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame);
    }
    this.resizeFrame = window.requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.handleResize();
    });
  }

  private handleOrientationChange(): void {
    this.queueResize();
    if (this.orientationSettleTimer !== null) {
      window.clearTimeout(this.orientationSettleTimer);
    }
    this.orientationSettleTimer = window.setTimeout(() => {
      this.orientationSettleTimer = null;
      this.handleResize();
    }, 250);
  }

  private syncViewportCss(width: number, height: number): void {
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--app-width", `${width}px`);
    rootStyle.setProperty("--app-height", `${height}px`);
  }

  private handleResize(): void {
    const { width, height } = resolveViewportMetrics(window);
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.syncViewportCss(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Recalculate pixel ratio with profile-based cap (must be BEFORE setSize)
    const maxPR = this.getProfileMaxPixelRatio(this.graphicsProfile);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPR) * this.resolutionScale);
    this.renderer.setSize(w, h);
    syncCasTexelSize(this.renderer, this.postFXUniforms);
  }

  dispose(): void {
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("orientationchange", this._onOrientationChange);
    window.visualViewport?.removeEventListener("resize", this._onViewportMetricsChanged);
    window.visualViewport?.removeEventListener("scroll", this._onViewportMetricsChanged);
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = null;
    }
    if (this.orientationSettleTimer !== null) {
      window.clearTimeout(this.orientationSettleTimer);
      this.orientationSettleTimer = null;
    }
    this.setAnimationLoop(null);
    this.resetPipelineResources();
    this.pipelineRebuildNeeded = false;
    this.currentPipelineDescriptor = null;
    this.tslRuntime = null;
    this.assetLibrary.dispose();

    // Clean up custom device-lost handler to avoid dangling closure references.
    if (this.isWebGPUPipeline && typeof (this.renderer as any).onDeviceLost !== "undefined") {
      (this.renderer as any).onDeviceLost = null;
    }

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
