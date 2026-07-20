import { describe, expect, it } from "vitest";
import { buildRendererPresentationState } from "./rendererPresentation";

const ADVANCED_CAPABILITIES = {
  postProcessingEnabled: true,
  ssaoEnabled: true,
  ssrEnabled: true,
  bloomEnabled: true,
  vignetteEnabled: true,
  lutEnabled: true,
} as const;
const NO_POST_CAPABILITIES = {
  postProcessingEnabled: false,
  ssaoEnabled: false,
  ssrEnabled: false,
  bloomEnabled: false,
  vignetteEnabled: false,
  lutEnabled: false,
} as const;

describe("renderer presentation state", () => {
  it.each([
    ["WebGPU", "WebGPU"],
    ["WebGPU (WebGL2 backend)", "WebGPU / WebGL2"],
    ["WebGLRenderer", "WebGL"],
  ])("formats %s as a compact applied-backend label", (activeBackend, compactBackendLabel) => {
    const state = buildRendererPresentationState(
      { activeBackend, graphicsProfile: "balanced" },
      null,
      ADVANCED_CAPABILITIES,
    );

    expect(state).toMatchObject({
      activeBackend,
      compactBackendLabel,
      compactLabel: `${compactBackendLabel} · balanced`,
      settingsLabel: `Renderer: ${activeBackend} · Applied profile: balanced · Available post: SSAO, SSR, Bloom, Vignette, LUT`,
    });
  });

  it.each([
    "platform",
    "bootstrap-failure",
  ] as const)("marks %s compatibility routing as an automatic fallback", (activationReason) => {
    const state = buildRendererPresentationState(
      { activeBackend: "WebGLRenderer", graphicsProfile: "performance" },
      activationReason,
      NO_POST_CAPABILITIES,
    );

    expect(state.compatibilityActive).toBe(true);
    expect(state.automaticFallback).toBe(true);
    expect(state.fallbackReason).toBe(activationReason);
  });

  it("never describes an explicit compatibility request as an automatic fallback", () => {
    const state = buildRendererPresentationState(
      { activeBackend: "WebGLRenderer", graphicsProfile: "cinematic" },
      "explicit",
      NO_POST_CAPABILITIES,
    );

    expect(state).toMatchObject({
      compatibilityActive: true,
      automaticFallback: false,
      fallbackReason: null,
    });
  });

  it("reports the exact compatibility post effects exposed by the active path", () => {
    const state = buildRendererPresentationState(
      { activeBackend: "WebGLRenderer", graphicsProfile: "balanced" },
      "platform",
      {
        ...NO_POST_CAPABILITIES,
        postProcessingEnabled: true,
        vignetteEnabled: true,
        lutEnabled: true,
      },
    );

    expect(state.settingsLabel).toBe(
      "Renderer: WebGLRenderer · Applied profile: balanced · Available post: Vignette, LUT",
    );
  });

  it("states when the active renderer has no post-effect pipeline", () => {
    const state = buildRendererPresentationState(
      { activeBackend: "WebGLRenderer", graphicsProfile: "balanced" },
      "explicit",
      NO_POST_CAPABILITIES,
    );

    expect(state.settingsLabel).toBe("Renderer: WebGLRenderer · Applied profile: balanced · Post effects unavailable");
  });
});
