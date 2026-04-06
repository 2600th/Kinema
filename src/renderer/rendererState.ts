import type { AntiAliasingMode, GraphicsProfile, ShadowQualityTier } from '@core/UserSettings';
import type { RendererPipelineDescriptor } from './pipelineProfile';

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
}

export interface BuildRendererDebugFlagsArgs {
  isWebGPUPipeline: boolean;
  backendInfo?: { isWebGPUBackend?: boolean };
  postProcessingEnabled: boolean;
  shadowsEnabled: boolean;
  shadowQuality: ShadowQualityTier;
  shadowQualityResolvedProfile: GraphicsProfile;
  exposure: number;
  graphicsProfile: GraphicsProfile;
  envRotationDegrees: number;
  descriptor: RendererPipelineDescriptor;
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
  if (profile === 'performance') {
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
      antiAliasingMode: 'fxaa',
      ssrOpacity: 0.35,
      ssrResolutionScale: 0.45,
    };
  }

  if (profile === 'balanced') {
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
      antiAliasingMode: 'fxaa',
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
    antiAliasingMode: 'smaa',
    ssrOpacity: 0.5,
    ssrResolutionScale: 1.0,
  };
}

export function buildRendererDebugFlags(args: BuildRendererDebugFlagsArgs): RendererDebugFlags {
  const activeBackend = !args.isWebGPUPipeline
    ? 'WebGLRenderer'
    : args.backendInfo?.isWebGPUBackend
      ? 'WebGPU'
      : 'WebGPU (WebGL2 backend)';

  return {
    activeBackend,
    postProcessingEnabled: args.postProcessingEnabled,
    shadowsEnabled: args.shadowsEnabled,
    shadowQuality: args.shadowQuality,
    shadowQualityResolvedProfile: args.shadowQualityResolvedProfile,
    exposure: args.exposure,
    graphicsProfile: args.graphicsProfile,
    envRotationDegrees: args.envRotationDegrees,
    aaMode: args.descriptor.aaMode,
    aoOnly: args.aoOnlyView,
    ssaoEnabled: args.descriptor.useAo,
    ssrEnabled: args.descriptor.useSSR,
    ssrOpacity: args.ssrOpacity,
    ssrResolutionScale: args.ssrResolutionScale,
    bloomEnabled: args.descriptor.useBloom,
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
