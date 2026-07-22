import { describe, expect, it, vi } from "vitest";
import { buildRendererPipelineDescriptor } from "./pipelineProfile";
import {
  applyPostEffectSettingsBatch,
  buildRendererDebugFlags,
  getEffectivePostEffectSettings,
  getGraphicsProfileDefaults,
  getRendererPostEffectCapabilities,
  type PostEffectSettings,
  pickPostEffectSettings,
} from "./rendererState";

const ALL_ENABLED: PostEffectSettings = {
  postProcessingEnabled: true,
  ssaoEnabled: true,
  ssrEnabled: true,
  bloomEnabled: true,
  vignetteEnabled: true,
  lutEnabled: true,
};

describe("renderer post-effect state", () => {
  it("includes the selected showcase art direction in renderer debug flags", () => {
    const descriptor = buildRendererPipelineDescriptor({
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
    const flags = buildRendererDebugFlags({
      isWebGPUPipeline: true,
      compatibilityPostActive: false,
      backendInfo: { isWebGPUBackend: true },
      postEffectCapabilities: getRendererPostEffectCapabilities(true),
      postProcessingEnabled: true,
      shadowsEnabled: true,
      shadowQuality: "auto",
      shadowQualityResolvedProfile: "balanced",
      exposure: 0.85,
      graphicsProfile: "balanced",
      envRotationDegrees: 0,
      showcaseArtDirection: "aurora",
      descriptor,
      aoDenoisePassActive: false,
      aoOnlyView: false,
      ssrOpacity: 0.4,
      ssrResolutionScale: 0.5,
      bloomStrength: 0.1,
      casStrength: 0,
      vignetteEnabled: true,
      vignetteDarkness: 0.38,
      lutEnabled: true,
      lutStrength: 0.38,
      lutName: "Cubicle 99",
      lutReady: true,
      envName: "Sunrise",
    });

    expect(flags.showcaseArtDirection).toBe("aurora");
    expect(flags.aoDenoiseActive).toBe(false);
  });

  it("reports AO denoising only when the applied pipeline has an active denoise pass", () => {
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
    const args = {
      isWebGPUPipeline: true,
      compatibilityPostActive: false,
      backendInfo: { isWebGPUBackend: true },
      postEffectCapabilities: getRendererPostEffectCapabilities(true),
      postProcessingEnabled: true,
      shadowsEnabled: true,
      shadowQuality: "auto" as const,
      shadowQualityResolvedProfile: "cinematic" as const,
      exposure: 0.85,
      graphicsProfile: "cinematic" as const,
      envRotationDegrees: 0,
      showcaseArtDirection: "aurora" as const,
      descriptor,
      aoOnlyView: false,
      ssrOpacity: 0.5,
      ssrResolutionScale: 1,
      bloomStrength: 0.1,
      casStrength: 0.3,
      vignetteEnabled: true,
      vignetteDarkness: 0.42,
      lutEnabled: true,
      lutStrength: 0.42,
      lutName: "Cubicle 99",
      lutReady: true,
      envName: "Sunrise",
    };

    expect(buildRendererDebugFlags({ ...args, aoDenoisePassActive: true }).aoDenoiseActive).toBe(true);
    expect(buildRendererDebugFlags({ ...args, aoDenoisePassActive: false }).aoDenoiseActive).toBe(false);
  });

  it("keeps the established profile defaults", () => {
    expect(getGraphicsProfileDefaults("performance")).toMatchObject({
      gtaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: false,
      lutEnabled: true,
    });
    expect(getGraphicsProfileDefaults("balanced")).toMatchObject({
      gtaoEnabled: true,
      ssrEnabled: false,
      bloomEnabled: true,
      vignetteEnabled: true,
      lutEnabled: true,
    });
    expect(getGraphicsProfileDefaults("cinematic")).toMatchObject({
      gtaoEnabled: true,
      ssrEnabled: true,
      bloomEnabled: true,
      vignetteEnabled: true,
      lutEnabled: true,
    });
  });

  it("extracts the six requested post-effect settings as one typed value", () => {
    expect(pickPostEffectSettings(ALL_ENABLED)).toEqual(ALL_ENABLED);
    expect(pickPostEffectSettings(ALL_ENABLED)).not.toBe(ALL_ENABLED);
  });

  it("requests at most one structural mutation for a six-effect batch", () => {
    const requestStructuralMutation = vi.fn();
    const next = {
      postProcessingEnabled: false,
      ssaoEnabled: false,
      ssrEnabled: true,
      bloomEnabled: false,
      vignetteEnabled: true,
      lutEnabled: false,
    } satisfies PostEffectSettings;

    expect(applyPostEffectSettingsBatch(ALL_ENABLED, next, requestStructuralMutation)).toEqual(next);
    expect(requestStructuralMutation).toHaveBeenCalledTimes(1);

    applyPostEffectSettingsBatch(next, next, requestStructuralMutation);
    expect(requestStructuralMutation).toHaveBeenCalledTimes(1);
  });

  it("preserves subordinate requests while master post is off and restores their effective state", () => {
    const requestedWhileOff = { ...ALL_ENABLED, postProcessingEnabled: false };
    const capabilities = getRendererPostEffectCapabilities(true);

    expect(getEffectivePostEffectSettings(requestedWhileOff, "cinematic", capabilities)).toEqual({
      postProcessingEnabled: false,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: false,
      lutEnabled: false,
    });
    expect(requestedWhileOff).toMatchObject({
      ssaoEnabled: true,
      ssrEnabled: true,
      bloomEnabled: true,
      vignetteEnabled: true,
      lutEnabled: true,
    });

    expect(
      getEffectivePostEffectSettings({ ...requestedWhileOff, postProcessingEnabled: true }, "cinematic", capabilities),
    ).toEqual(ALL_ENABLED);
  });

  it("reports profile and renderer capability gates without rewriting requested intent", () => {
    const requested = { ...ALL_ENABLED };
    expect(getEffectivePostEffectSettings(requested, "performance", getRendererPostEffectCapabilities(true))).toEqual({
      postProcessingEnabled: true,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: true,
      lutEnabled: true,
    });
    expect(getEffectivePostEffectSettings(requested, "cinematic", getRendererPostEffectCapabilities(false))).toEqual({
      postProcessingEnabled: false,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: false,
      lutEnabled: false,
    });
    expect(requested).toEqual(ALL_ENABLED);
  });

  it("advertises only LUT and vignette when the compatibility post feature is enabled", () => {
    expect(getRendererPostEffectCapabilities(false, true)).toEqual({
      postProcessingEnabled: true,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: true,
      lutEnabled: true,
    });
    expect(getRendererPostEffectCapabilities(false, false)).toEqual({
      postProcessingEnabled: false,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: false,
      lutEnabled: false,
    });
  });

  it("applies the compatibility profile floor without changing advanced profile behavior", () => {
    const capabilities = getRendererPostEffectCapabilities(false, true);

    expect(getEffectivePostEffectSettings(ALL_ENABLED, "performance", capabilities, "compatibility")).toEqual({
      postProcessingEnabled: false,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: false,
      lutEnabled: false,
    });
    expect(getEffectivePostEffectSettings(ALL_ENABLED, "balanced", capabilities, "compatibility")).toEqual({
      postProcessingEnabled: true,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: false,
      lutEnabled: true,
    });
    expect(getEffectivePostEffectSettings(ALL_ENABLED, "cinematic", capabilities, "compatibility")).toEqual({
      postProcessingEnabled: true,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: true,
      lutEnabled: true,
    });
    expect(
      getEffectivePostEffectSettings(ALL_ENABLED, "performance", getRendererPostEffectCapabilities(true)),
    ).toMatchObject({
      vignetteEnabled: true,
      lutEnabled: true,
    });
  });
});
