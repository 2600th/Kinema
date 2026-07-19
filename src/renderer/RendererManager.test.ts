import type { GraphicsProfile } from "@core/UserSettings";
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
  isWebGPUPipeline: boolean;
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
      aoOnlyView: false,
      ssrOpacity: 0.5,
      ssrResolutionScale: 1,
      bloomStrength: 0.1,
      vignetteDarkness: 0.38,
      lutStrength: 0.38,
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
      vignetteEnabled: true,
      lutEnabled: true,
    });
    expect(manager.getRequestedPostEffectSettings()).toMatchObject({
      ssrEnabled: true,
      vignetteEnabled: false,
      lutEnabled: false,
    });
  });
});
