import type { GraphicsProfile } from "@core/UserSettings";
import type { RendererDebugFlags, RendererPostEffectCapabilities } from "./rendererState";

export type CompatibilityActivationReason = "explicit" | "platform" | "bootstrap-failure" | null;

export interface RendererPresentationState {
  activeBackend: string;
  compactBackendLabel: string;
  profile: GraphicsProfile;
  compactLabel: string;
  settingsLabel: string;
  compatibilityActive: boolean;
  automaticFallback: boolean;
  fallbackReason: Exclude<CompatibilityActivationReason, "explicit">;
}

export interface RendererPresentationSource {
  getPresentationState(): RendererPresentationState;
  subscribePresentationState(listener: (state: RendererPresentationState) => void): () => void;
}

function getCompactBackendLabel(activeBackend: string): string {
  if (activeBackend === "WebGPU (WebGL2 backend)") return "WebGPU / WebGL2";
  if (activeBackend === "WebGLRenderer") return "WebGL";
  return activeBackend;
}

function getPostCapabilityLabel(capabilities: RendererPostEffectCapabilities): string {
  if (!capabilities.postProcessingEnabled) return "Post effects unavailable";

  const available = [
    ["SSAO", capabilities.ssaoEnabled],
    ["SSR", capabilities.ssrEnabled],
    ["Bloom", capabilities.bloomEnabled],
    ["Vignette", capabilities.vignetteEnabled],
    ["LUT", capabilities.lutEnabled],
  ]
    .filter((entry) => entry[1])
    .map((entry) => entry[0]);

  return available.length > 0 ? `Available post: ${available.join(", ")}` : "Post effects unavailable";
}

export function buildRendererPresentationState(
  flags: Pick<RendererDebugFlags, "activeBackend" | "graphicsProfile">,
  compatibilityActivationReason: CompatibilityActivationReason,
  capabilities: RendererPostEffectCapabilities,
): RendererPresentationState {
  const compatibilityActive = flags.activeBackend === "WebGLRenderer";
  const automaticFallback =
    compatibilityActive &&
    (compatibilityActivationReason === "platform" || compatibilityActivationReason === "bootstrap-failure");
  const compactBackendLabel = getCompactBackendLabel(flags.activeBackend);

  return {
    activeBackend: flags.activeBackend,
    compactBackendLabel,
    profile: flags.graphicsProfile,
    compactLabel: `${compactBackendLabel} · ${flags.graphicsProfile}`,
    settingsLabel: `Renderer: ${flags.activeBackend} · Applied profile: ${flags.graphicsProfile} · ${getPostCapabilityLabel(capabilities)}`,
    compatibilityActive,
    automaticFallback,
    fallbackReason: automaticFallback ? compatibilityActivationReason : null,
  };
}
