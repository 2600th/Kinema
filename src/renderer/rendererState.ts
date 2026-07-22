import type { AntiAliasingMode, GraphicsProfile, ShadowQualityTier, UserSettings } from "@core/UserSettings";
import type { RendererPipelineDescriptor } from "./pipelineProfile";
import type { ShowcaseArtDirectionId } from "./showcaseArtDirection";

export type PostEffectSettings = Pick<
  UserSettings,
  "postProcessingEnabled" | "ssaoEnabled" | "ssrEnabled" | "bloomEnabled" | "vignetteEnabled" | "lutEnabled"
>;

export type RendererPostEffectCapabilities = Readonly<{
  [Key in keyof PostEffectSettings]: boolean;
}>;

const POST_EFFECT_SETTING_KEYS = [
  "postProcessingEnabled",
  "ssaoEnabled",
  "ssrEnabled",
  "bloomEnabled",
  "vignetteEnabled",
  "lutEnabled",
] as const satisfies ReadonlyArray<keyof PostEffectSettings>;

export function pickPostEffectSettings(settings: Readonly<PostEffectSettings>): PostEffectSettings {
  return {
    postProcessingEnabled: settings.postProcessingEnabled,
    ssaoEnabled: settings.ssaoEnabled,
    ssrEnabled: settings.ssrEnabled,
    bloomEnabled: settings.bloomEnabled,
    vignetteEnabled: settings.vignetteEnabled,
    lutEnabled: settings.lutEnabled,
  };
}

export function applyPostEffectSettingsBatch(
  current: Readonly<PostEffectSettings>,
  next: Readonly<PostEffectSettings>,
  requestStructuralMutation: () => void,
): PostEffectSettings {
  const requested = pickPostEffectSettings(next);
  if (POST_EFFECT_SETTING_KEYS.some((key) => current[key] !== requested[key])) {
    requestStructuralMutation();
  }
  return requested;
}

export function getRendererPostEffectCapabilities(
  supportsPostPipeline: boolean,
  compatibilityPostEnabled = false,
): RendererPostEffectCapabilities {
  if (!supportsPostPipeline && compatibilityPostEnabled) {
    return {
      postProcessingEnabled: true,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: true,
      lutEnabled: true,
    };
  }
  return {
    postProcessingEnabled: supportsPostPipeline,
    ssaoEnabled: supportsPostPipeline,
    ssrEnabled: supportsPostPipeline,
    bloomEnabled: supportsPostPipeline,
    vignetteEnabled: supportsPostPipeline,
    lutEnabled: supportsPostPipeline,
  };
}

export function getEffectivePostEffectSettings(
  requested: Readonly<PostEffectSettings>,
  profile: GraphicsProfile,
  capabilities: RendererPostEffectCapabilities,
  rendererMode: "advanced" | "compatibility" = "advanced",
): PostEffectSettings {
  const postRequested = capabilities.postProcessingEnabled && requested.postProcessingEnabled;
  const compatibilityLutEnabled = rendererMode !== "compatibility" || profile !== "performance";
  const compatibilityVignetteEnabled = rendererMode !== "compatibility" || profile === "cinematic";
  const vignetteEnabled =
    postRequested && capabilities.vignetteEnabled && requested.vignetteEnabled && compatibilityVignetteEnabled;
  const lutEnabled = postRequested && capabilities.lutEnabled && requested.lutEnabled && compatibilityLutEnabled;
  const postProcessingEnabled = postRequested && (rendererMode !== "compatibility" || vignetteEnabled || lutEnabled);
  return {
    postProcessingEnabled,
    ssaoEnabled: postRequested && capabilities.ssaoEnabled && requested.ssaoEnabled && profile !== "performance",
    ssrEnabled: postRequested && capabilities.ssrEnabled && requested.ssrEnabled && profile === "cinematic",
    bloomEnabled: postRequested && capabilities.bloomEnabled && requested.bloomEnabled && profile !== "performance",
    vignetteEnabled,
    lutEnabled,
  };
}

export interface RendererProfileDefaults {
  gtaoEnabled: boolean;
  ssrEnabled: boolean;
  bloomEnabled: boolean;
  bloomStrength: number;
  casEnabled: boolean;
  casStrength: number;
  vignetteEnabled: boolean;
  vignetteDarkness: number;
  lutEnabled: boolean;
  lutStrength: number;
  antiAliasingMode: AntiAliasingMode;
  ssrOpacity: number;
  ssrResolutionScale: number;
}

export interface RendererDebugFlags {
  activeBackend: string;
  compatibilityPostActive: boolean;
  postProcessingEnabled: boolean;
  shadowsEnabled: boolean;
  shadowQuality: ShadowQualityTier;
  shadowQualityResolvedProfile: GraphicsProfile;
  exposure: number;
  graphicsProfile: GraphicsProfile;
  envRotationDegrees: number;
  showcaseArtDirection: ShowcaseArtDirectionId;
  aaMode: AntiAliasingMode;
  aoOnly: boolean;
  ssaoEnabled: boolean;
  aoDenoiseActive: boolean;
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
}

export interface BuildRendererDebugFlagsArgs {
  isWebGPUPipeline: boolean;
  compatibilityPostActive: boolean;
  backendInfo?: { isWebGPUBackend?: boolean };
  postEffectCapabilities: RendererPostEffectCapabilities;
  postProcessingEnabled: boolean;
  shadowsEnabled: boolean;
  shadowQuality: ShadowQualityTier;
  shadowQualityResolvedProfile: GraphicsProfile;
  exposure: number;
  graphicsProfile: GraphicsProfile;
  envRotationDegrees: number;
  showcaseArtDirection: ShowcaseArtDirectionId;
  descriptor: RendererPipelineDescriptor;
  aoDenoisePassActive: boolean;
  aoOnlyView: boolean;
  ssrOpacity: number;
  ssrResolutionScale: number;
  bloomStrength: number;
  casStrength: number;
  vignetteEnabled: boolean;
  vignetteDarkness: number;
  lutEnabled: boolean;
  lutStrength: number;
  lutName: string;
  lutReady: boolean;
  envName: string;
}

export function getGraphicsProfileDefaults(profile: GraphicsProfile): RendererProfileDefaults {
  if (profile === "performance") {
    return {
      gtaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      bloomStrength: 0.0,
      casEnabled: false,
      casStrength: 0,
      vignetteEnabled: false,
      vignetteDarkness: 0.42,
      lutEnabled: true,
      lutStrength: 0.28,
      antiAliasingMode: "fxaa",
      ssrOpacity: 0.35,
      ssrResolutionScale: 0.45,
    };
  }

  if (profile === "balanced") {
    return {
      gtaoEnabled: true,
      ssrEnabled: false,
      bloomEnabled: true,
      bloomStrength: 0.1,
      casEnabled: false,
      casStrength: 0.2,
      vignetteEnabled: true,
      vignetteDarkness: 0.38,
      lutEnabled: true,
      lutStrength: 0.38,
      antiAliasingMode: "fxaa",
      ssrOpacity: 0.4,
      ssrResolutionScale: 0.5,
    };
  }

  return {
    gtaoEnabled: true,
    ssrEnabled: true,
    bloomEnabled: true,
    bloomStrength: 0.1,
    casEnabled: true,
    casStrength: 0.3,
    vignetteEnabled: true,
    vignetteDarkness: 0.42,
    lutEnabled: true,
    lutStrength: 0.42,
    antiAliasingMode: "smaa",
    ssrOpacity: 0.5,
    ssrResolutionScale: 1.0,
  };
}

export function buildRendererDebugFlags(args: BuildRendererDebugFlagsArgs): RendererDebugFlags {
  const activeBackend = !args.isWebGPUPipeline
    ? "WebGLRenderer"
    : args.backendInfo?.isWebGPUBackend
      ? "WebGPU"
      : "WebGPU (WebGL2 backend)";

  return {
    activeBackend,
    compatibilityPostActive: args.compatibilityPostActive,
    postProcessingEnabled: args.postProcessingEnabled,
    shadowsEnabled: args.shadowsEnabled,
    shadowQuality: args.shadowQuality,
    shadowQualityResolvedProfile: args.shadowQualityResolvedProfile,
    exposure: args.exposure,
    graphicsProfile: args.graphicsProfile,
    envRotationDegrees: args.envRotationDegrees,
    showcaseArtDirection: args.showcaseArtDirection,
    aaMode: args.descriptor.aaMode,
    aoOnly: args.aoOnlyView,
    ssaoEnabled: args.postEffectCapabilities.ssaoEnabled && args.descriptor.useAo,
    aoDenoiseActive: args.aoDenoisePassActive,
    ssrEnabled: args.postEffectCapabilities.ssrEnabled && args.descriptor.useSSR,
    ssrOpacity: args.ssrOpacity,
    ssrResolutionScale: args.ssrResolutionScale,
    bloomEnabled: args.postEffectCapabilities.bloomEnabled && args.descriptor.useBloom,
    bloomStrength: args.bloomStrength,
    casEnabled: args.descriptor.useCAS,
    casStrength: args.casStrength,
    vignetteEnabled: args.vignetteEnabled,
    vignetteDarkness: args.vignetteDarkness,
    lutEnabled: args.lutEnabled,
    lutStrength: args.lutStrength,
    lutName: args.lutName,
    lutReady: args.lutReady,
    envName: args.envName,
  };
}
