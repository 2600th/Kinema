import { describe, expect, it, vi } from "vitest";
import {
  applyPostEffectSettingsBatch,
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
    expect(
      getEffectivePostEffectSettings(requested, "performance", getRendererPostEffectCapabilities(true)),
    ).toEqual({
      postProcessingEnabled: true,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: true,
      lutEnabled: true,
    });
    expect(
      getEffectivePostEffectSettings(requested, "cinematic", getRendererPostEffectCapabilities(false)),
    ).toEqual({
      postProcessingEnabled: false,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: false,
      lutEnabled: false,
    });
    expect(requested).toEqual(ALL_ENABLED);
  });
});
