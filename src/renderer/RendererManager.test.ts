import type { GraphicsProfile } from "@core/UserSettings";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GpuResourceMutationQueue, type GpuResourceMutationScheduler } from "./gpuResourceMutationQueue";
import { buildRendererPipelineDescriptor, type RendererPipelineDescriptor } from "./pipelineProfile";
import { RendererManager } from "./RendererManager";
import type { PostEffectSettings } from "./rendererState";

interface RendererManagerHarness {
  graphicsProfile: GraphicsProfile;
  antiAliasingMode: "smaa" | "fxaa" | "none";
  casEnabled: boolean;
  casStrength: number;
  postProcessingEnabled: boolean;
  gtaoEnabled: boolean;
  ssrEnabled: boolean;
  bloomEnabled: boolean;
  vignetteEnabled: boolean;
  lutEnabled: boolean;
  pipelineRebuildNeeded: boolean;
  scheduleGpuResourceMutation: GpuResourceMutationScheduler;
  applyQualitySettings: () => void;
  currentPipelineDescriptor: RendererPipelineDescriptor | null;
  appliedGraphicsProfile: GraphicsProfile;
  appliedPostEffectSettings: PostEffectSettings;
  appliedQualityDebugState: AppliedQualityDebugState;
  isWebGPUPipeline: boolean;
  compatibilityPostEnabled: boolean;
  compatibilityPostAvailable: boolean;
  compatibilityInitialSettingsPending: boolean;
  compatibilityPostStack: { render(): void; setState(): void; dispose(): void } | null;
  renderer: { backend?: { isWebGPUBackend?: boolean } };
  shadowsEnabled: boolean;
  shadowQualityTier: "auto" | GraphicsProfile;
  toneExposure: number;
  envRotationDegrees: number;
  aoOnlyView: boolean;
  ssrOpacity: number;
  ssrResolutionScale: number;
  bloomStrength: number;
  vignetteDarkness: number;
  lutStrength: number;
  lutName: string;
  lutReady: boolean;
  envName: string;
  postFXUniforms: {
    ssrOpacity: { value: number };
    casStrength: { value: number };
    vignetteDarkness: { value: number };
    lutIntensity: { value: number };
  } | null;
  bloomNodes: Array<{ strength: { value: number } }>;
  ssrNode: { resolutionScale: number } | null;
}

interface AppliedQualityDebugState {
  aoOnlyView: boolean;
  ssrOpacity: number;
  ssrResolutionScale: number;
  bloomStrength: number;
  casStrength: number;
  vignetteDarkness: number;
  lutStrength: number;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createManagerHarness(fields: Partial<RendererManagerHarness>): RendererManager {
  return Object.assign(Object.create(RendererManager.prototype) as RendererManager, fields);
}

const BALANCED_POST_EFFECTS: PostEffectSettings = {
  postProcessingEnabled: true,
  ssaoEnabled: true,
  ssrEnabled: false,
  bloomEnabled: true,
  vignetteEnabled: true,
  lutEnabled: true,
};

describe("RendererManager quality mutation boundaries", () => {
  it("warms the full advanced pipeline through one hidden exact-path frame", async () => {
    const order: string[] = [];
    const compileScene = vi.fn(async () => {
      order.push("scene");
    });
    const compilePipeline = vi.fn();
    const manager = createManagerHarness({
      isWebGPUPipeline: true,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      renderer: { compileAsync: compileScene },
      postProcessingEnabled: true,
      postProcessing: { compileAsync: compilePipeline },
      gpuResourceMutations: null,
    } as never);
    const render = vi.spyOn(manager, "render").mockImplementation(() => {
      order.push("render");
    });

    await manager.warmSceneForReveal();

    expect(order).toEqual(["render"]);
    expect(compileScene).not.toHaveBeenCalled();
    expect(compilePipeline).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledOnce();
  });

  it("restores frustum culling and fails open when shader compilation rejects", async () => {
    const failure = new Error("compile failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scene = new THREE.Scene();
    const visible = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const alreadyUnculled = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    alreadyUnculled.frustumCulled = false;
    scene.add(visible, alreadyUnculled);
    const manager = createManagerHarness({
      isWebGPUPipeline: true,
      scene,
      camera: new THREE.PerspectiveCamera(),
      renderer: {},
      postProcessingEnabled: false,
      postProcessing: null,
      gpuResourceMutations: null,
    } as never);

    vi.spyOn(manager, "render").mockImplementation(() => {
      throw failure;
    });

    await expect(manager.warmSceneForReveal()).resolves.toEqual(expect.any(Number));

    expect(visible.frustumCulled).toBe(true);
    expect(alreadyUnculled.frustumCulled).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[RendererManager] Shader warmup failed; continuing without precompilation:",
      failure,
    );
    warn.mockRestore();
  });

  it("warms compatibility through one requested sanitize and hidden frame", async () => {
    const manager = createManagerHarness({
      isWebGPUPipeline: false,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      renderer: {},
      postProcessing: null,
      gpuResourceMutations: null,
    } as never);
    const requestSanitize = vi.spyOn(manager, "requestCompatibilitySanitize");
    const render = vi.spyOn(manager, "render").mockImplementation(() => {});

    await manager.warmSceneForReveal();

    expect(requestSanitize).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
  });

  it("does not periodically rescan an unchanged compatibility scene", () => {
    const scene = new THREE.Scene();
    const traverse = vi.spyOn(scene, "traverse");
    const manager = createManagerHarness({
      renderingSuspendedForGpuMutation: false,
      shaderWarmupInProgress: false,
      hasRenderedFrame: false,
      isWebGPUPipeline: false,
      scene,
      camera: new THREE.PerspectiveCamera(),
      lastCompatibilitySceneChildCount: -1,
      compatibilitySanitizeRequested: false,
      compatibilityPostStack: null,
      postProcessingEnabled: false,
      postProcessing: null,
      renderer: {
        render: vi.fn(),
        info: { render: { calls: 0, triangles: 0, lines: 0, points: 0 } },
      },
      lastRenderStats: { drawCalls: 0, triangles: 0, lines: 0, points: 0 },
    } as never);

    for (let frame = 0; frame < 121; frame++) manager.render();
    expect(traverse).toHaveBeenCalledTimes(1);

    manager.requestCompatibilitySanitize();
    manager.render();
    expect(traverse).toHaveBeenCalledTimes(2);
  });

  it("exposes only the enabled compatibility post capabilities on the WebGL path", () => {
    const manager = createManagerHarness({
      isWebGPUPipeline: false,
      compatibilityPostEnabled: true,
      compatibilityPostAvailable: true,
    });

    expect(manager.getPostEffectCapabilities()).toEqual({
      postProcessingEnabled: true,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: true,
      lutEnabled: true,
    });
  });

  it("stops advertising compatibility post effects after the stack becomes unavailable", () => {
    const manager = createManagerHarness({
      isWebGPUPipeline: false,
      compatibilityPostEnabled: true,
      compatibilityPostAvailable: false,
    });

    expect(manager.getPostEffectCapabilities()).toEqual({
      postProcessingEnabled: false,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: false,
      lutEnabled: false,
    });
  });

  it("defers compatibility post allocation until persisted initial settings are finalized", () => {
    const applyQualitySettings = vi.fn();
    const manager = createManagerHarness({
      graphicsProfile: "balanced",
      compatibilityInitialSettingsPending: true,
      scheduleGpuResourceMutation: (_key, mutation) => mutation(),
      applyQualitySettings,
    });

    manager.setGraphicsProfile("performance");
    expect(applyQualitySettings).not.toHaveBeenCalled();

    manager.finalizeInitialSettings();
    expect(applyQualitySettings).toHaveBeenCalledOnce();
  });

  it("fails closed to direct WebGL rendering when the compatibility composer throws", () => {
    const failure = new Error("post render failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const directRender = vi.fn();
    const stack = {
      render: vi.fn(() => {
        throw failure;
      }),
      setState: vi.fn(),
      dispose: vi.fn(),
    };
    const manager = createManagerHarness({
      renderingSuspendedForGpuMutation: false,
      hasRenderedFrame: false,
      isWebGPUPipeline: false,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      lastCompatibilitySceneChildCount: 0,
      compatibilitySanitizeRequested: false,
      compatibilityPostEnabled: true,
      compatibilityPostAvailable: true,
      compatibilityPostStack: stack,
      renderer: {
        render: directRender,
        info: { render: { calls: 3, triangles: 7, lines: 0, points: 0 } },
      },
      lastRenderStats: { drawCalls: 0, triangles: 0, lines: 0, points: 0 },
      presentationListeners: new Set(),
      notifyPresentationState: vi.fn(),
      graphicsProfile: "balanced",
      postProcessingEnabled: true,
      gtaoEnabled: true,
      ssrEnabled: false,
      bloomEnabled: true,
      vignetteEnabled: true,
      lutEnabled: true,
      appliedPostEffectSettings: BALANCED_POST_EFFECTS,
    } as never);

    expect(() => manager.render()).not.toThrow();
    expect(stack.dispose).toHaveBeenCalledOnce();
    expect(directRender).toHaveBeenCalledOnce();
    expect(manager.getPostEffectCapabilities().postProcessingEnabled).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[RendererManager] Compatibility post render failed; continuing with direct WebGL rendering:",
      failure,
    );
    warn.mockRestore();
  });

  it("coalesces profile, AA, CAS, and post changes behind one keyed GPU boundary", async () => {
    const barrier = deferred();
    const applyQualitySettings = vi.fn();
    const queue = new GpuResourceMutationQueue(
      () => barrier.promise,
      () => {},
    );
    const manager = createManagerHarness({
      graphicsProfile: "balanced",
      antiAliasingMode: "fxaa",
      casEnabled: false,
      casStrength: 0,
      ...BALANCED_POST_EFFECTS,
      pipelineRebuildNeeded: false,
      scheduleGpuResourceMutation: (key, mutation) => queue.enqueue(key, mutation),
      applyQualitySettings,
    });

    manager.setGraphicsProfile("cinematic");
    manager.setAntiAliasingMode("none");
    manager.setCasEnabled(false);
    manager.setCasStrength(0);
    manager.applyPostEffectSettings({ ...BALANCED_POST_EFFECTS, postProcessingEnabled: false });

    const callsBeforeBoundary = applyQualitySettings.mock.calls.length;
    barrier.resolve();
    await queue.whenIdle();

    expect(callsBeforeBoundary).toBe(0);
    expect(applyQualitySettings).toHaveBeenCalledTimes(1);
  });

  it("reports the last applied effective flags while a requested mutation is pending", () => {
    const appliedDescriptor = buildRendererPipelineDescriptor({
      profile: "balanced",
      aaMode: "fxaa",
      postProcessingEnabled: true,
      aoEnabled: true,
      aoOnlyView: false,
      bloomEnabled: true,
      ssrEnabled: false,
      casEnabled: false,
      casStrength: 0,
      vignetteEnabled: true,
      lutEnabled: true,
    });
    const manager = createManagerHarness({
      currentPipelineDescriptor: appliedDescriptor,
      appliedGraphicsProfile: "balanced",
      appliedPostEffectSettings: BALANCED_POST_EFFECTS,
      appliedQualityDebugState: {
        aoOnlyView: false,
        ssrOpacity: 0.4,
        ssrResolutionScale: 0.5,
        bloomStrength: 0.1,
        casStrength: 0,
        vignetteDarkness: 0.38,
        lutStrength: 0.38,
      },
      graphicsProfile: "cinematic",
      antiAliasingMode: "smaa",
      casEnabled: true,
      casStrength: 0.3,
      postProcessingEnabled: true,
      gtaoEnabled: true,
      ssrEnabled: true,
      bloomEnabled: true,
      vignetteEnabled: false,
      lutEnabled: false,
      isWebGPUPipeline: true,
      renderer: { backend: { isWebGPUBackend: true } },
      shadowsEnabled: true,
      shadowQualityTier: "auto",
      toneExposure: 0.85,
      envRotationDegrees: 0,
      aoOnlyView: true,
      ssrOpacity: 0.91,
      ssrResolutionScale: 0.88,
      bloomStrength: 0.77,
      vignetteDarkness: 0.55,
      lutStrength: 0.44,
      lutName: "Cubicle 99",
      lutReady: true,
      envName: "Sunrise",
    });

    expect(manager.getDebugFlags()).toMatchObject({
      graphicsProfile: "balanced",
      aaMode: "fxaa",
      postProcessingEnabled: true,
      ssaoEnabled: true,
      ssrEnabled: false,
      bloomEnabled: true,
      casEnabled: false,
      casStrength: 0,
      vignetteEnabled: true,
      vignetteDarkness: 0.38,
      lutEnabled: true,
      lutStrength: 0.38,
      aoOnly: false,
      ssrOpacity: 0.4,
      ssrResolutionScale: 0.5,
      bloomStrength: 0.1,
    });
    expect(manager.getRequestedPostEffectSettings()).toMatchObject({
      ssrEnabled: true,
      vignetteEnabled: false,
      lutEnabled: false,
    });
  });

  it("reports immediate live-uniform numeric changes without waiting for a structural boundary", () => {
    const descriptor = buildRendererPipelineDescriptor({
      profile: "cinematic",
      aaMode: "smaa",
      postProcessingEnabled: true,
      aoEnabled: true,
      aoOnlyView: false,
      bloomEnabled: true,
      ssrEnabled: true,
      casEnabled: true,
      casStrength: 0.3,
      vignetteEnabled: true,
      lutEnabled: true,
    });
    const postFXUniforms = {
      ssrOpacity: { value: 0.5 },
      casStrength: { value: 0.3 },
      vignetteDarkness: { value: 0.42 },
      lutIntensity: { value: 0.42 },
    };
    const bloomNode = { strength: { value: 0.1 } };
    const ssrNode = { resolutionScale: 1 };
    const manager = createManagerHarness({
      currentPipelineDescriptor: descriptor,
      appliedGraphicsProfile: "cinematic",
      appliedPostEffectSettings: { ...BALANCED_POST_EFFECTS, ssrEnabled: true },
      appliedQualityDebugState: {
        aoOnlyView: false,
        ssrOpacity: 0.5,
        ssrResolutionScale: 1,
        bloomStrength: 0.1,
        casStrength: 0.3,
        vignetteDarkness: 0.42,
        lutStrength: 0.42,
      },
      graphicsProfile: "cinematic",
      antiAliasingMode: "smaa",
      casEnabled: true,
      casStrength: 0.3,
      postProcessingEnabled: true,
      gtaoEnabled: true,
      ssrEnabled: true,
      bloomEnabled: true,
      vignetteEnabled: true,
      lutEnabled: true,
      isWebGPUPipeline: true,
      renderer: { backend: { isWebGPUBackend: true } },
      shadowsEnabled: true,
      shadowQualityTier: "auto",
      toneExposure: 0.85,
      envRotationDegrees: 0,
      aoOnlyView: false,
      ssrOpacity: 0.5,
      ssrResolutionScale: 1,
      bloomStrength: 0.1,
      vignetteDarkness: 0.42,
      lutStrength: 0.42,
      lutName: "Cubicle 99",
      lutReady: true,
      envName: "Sunrise",
      postFXUniforms,
      bloomNodes: [bloomNode],
      ssrNode,
    });

    manager.setSsrOpacity(0.6);
    manager.setSsrResolutionScale(0.75);
    manager.setBloomStrength(0.6);
    manager.setCasStrength(0.4);
    manager.setVignetteDarkness(0.5);
    manager.setLutStrength(0.7);

    expect(manager.getDebugFlags()).toMatchObject({
      ssrOpacity: 0.6,
      ssrResolutionScale: 0.75,
      bloomStrength: 0.6,
      casStrength: 0.4,
      vignetteDarkness: 0.5,
      lutStrength: 0.7,
    });
    expect(postFXUniforms).toMatchObject({
      ssrOpacity: { value: 0.6 },
      casStrength: { value: 0.4 },
      vignetteDarkness: { value: 0.5 },
      lutIntensity: { value: 0.7 },
    });
    expect(bloomNode.strength.value).toBe(0.6);
    expect(ssrNode.resolutionScale).toBe(0.75);
  });

  it("reports live compatibility grade changes without TSL uniforms", () => {
    const setState = vi.fn();
    const manager = createManagerHarness({
      appliedPostEffectSettings: { ...BALANCED_POST_EFFECTS, ssaoEnabled: false, bloomEnabled: false },
      appliedQualityDebugState: {
        aoOnlyView: false,
        ssrOpacity: 0,
        ssrResolutionScale: 0,
        bloomStrength: 0,
        casStrength: 0,
        vignetteDarkness: 0.42,
        lutStrength: 0.42,
      },
      postFXUniforms: null,
      compatibilityPostStack: { render: vi.fn(), setState, dispose: vi.fn() },
      vignetteDarkness: 0.42,
      lutStrength: 0.42,
      assetLibrary: { getCachedLut: vi.fn(() => null) },
      lutName: "Cubicle 99",
    } as never);

    manager.setVignetteDarkness(0.5);
    manager.setLutStrength(0.7);

    expect((manager as unknown as RendererManagerHarness).appliedQualityDebugState).toMatchObject({
      vignetteDarkness: 0.5,
      lutStrength: 0.7,
    });
    expect(setState).toHaveBeenCalledTimes(2);
  });
});
