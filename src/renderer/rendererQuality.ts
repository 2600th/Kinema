import * as THREE from 'three';
import type { GraphicsProfile } from '@core/UserSettings';
import type { RendererPipelineDescriptor } from './pipelineProfile';
import type { RendererPostFxUniforms } from './rendererPipelineBuilder';
import type { DenoiseNodeLike, GTAONodeLike, TSLPassNode } from './rendererRuntime';

const _drawingSize = new THREE.Vector2();

export type RendererAntiAliasingMode = 'smaa' | 'fxaa' | 'none';

export interface DrawingBufferRendererLike {
  getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2;
}

export interface SyncGtaoSettingsArgs {
  postFXUniforms: RendererPostFxUniforms | null;
  gtaoPass: GTAONodeLike | null;
  aoDenoisePass: DenoiseNodeLike | null;
  prePassNode: (TSLPassNode & { updateBeforeType?: string; dispose?: () => void }) | null;
  descriptor: RendererPipelineDescriptor;
  aoOnlyView: boolean;
  graphicsProfile: GraphicsProfile;
}

export interface SyncRuntimePostFxArgs extends SyncGtaoSettingsArgs {
  renderer: DrawingBufferRendererLike;
  ssrNode: unknown | null;
  ssrOpacity: number;
  ssrResolutionScale: number;
  vignetteEnabled: boolean;
  vignetteDarkness: number;
  lutEnabled: boolean;
  lutStrength: number;
  casEnabled: boolean;
  antiAliasingMode: RendererAntiAliasingMode;
  casStrength: number;
}

export function getEffectiveCasStrength(
  casEnabled: boolean,
  antiAliasingMode: RendererAntiAliasingMode,
  casStrength: number,
): number {
  if (!casEnabled) return 0;
  if (antiAliasingMode === 'none') return 0;
  return casStrength;
}

export function syncCasTexelSize(
  renderer: DrawingBufferRendererLike,
  postFXUniforms: RendererPostFxUniforms | null,
): void {
  if (!postFXUniforms) return;
  renderer.getDrawingBufferSize(_drawingSize);
  if (_drawingSize.x <= 0 || _drawingSize.y <= 0) return;
  postFXUniforms.casTexelSize.value.set(1 / _drawingSize.x, 1 / _drawingSize.y);
}

export function syncGtaoSettings(args: SyncGtaoSettingsArgs): void {
  const {
    postFXUniforms,
    gtaoPass,
    aoDenoisePass,
    prePassNode,
    descriptor,
    aoOnlyView,
    graphicsProfile,
  } = args;

  if (postFXUniforms) {
    postFXUniforms.aoStrength.value = descriptor.useAo && !aoOnlyView ? 1 : 0;
  }
  if (!gtaoPass) return;

  const isCinematic = graphicsProfile === 'cinematic';
  if (gtaoPass.samples) {
    gtaoPass.samples.value = descriptor.aoSamples;
  }
  if (gtaoPass.radius) {
    gtaoPass.radius.value = isCinematic ? 0.65 : graphicsProfile === 'balanced' ? 0.5 : 0.4;
  }
  if (gtaoPass.thickness) {
    gtaoPass.thickness.value = 1.0;
  }
  if (gtaoPass.distanceExponent) {
    gtaoPass.distanceExponent.value = 1.5;
  }
  if (gtaoPass.distanceFallOff) {
    gtaoPass.distanceFallOff.value = 0.5;
  }
  if (gtaoPass.scale) {
    gtaoPass.scale.value = 1.0;
  }
  gtaoPass.resolutionScale = descriptor.aoResolutionScale;
  gtaoPass.useTemporalFiltering = false;

  if (typeof gtaoPass.updateBeforeType !== 'undefined') {
    gtaoPass.updateBeforeType = descriptor.useAo ? 'frame' : 'none';
  }
  if (aoDenoisePass && typeof aoDenoisePass.updateBeforeType !== 'undefined') {
    aoDenoisePass.updateBeforeType = descriptor.useAoDenoise ? 'frame' : 'none';
  }
  if (prePassNode && typeof prePassNode.updateBeforeType !== 'undefined') {
    prePassNode.updateBeforeType = descriptor.usePrePassNormals ? 'frame' : 'none';
  }
}

export function syncRuntimePostFxState(args: SyncRuntimePostFxArgs): void {
  const {
    renderer,
    postFXUniforms,
    ssrNode,
    ssrOpacity,
    ssrResolutionScale,
    vignetteEnabled,
    vignetteDarkness,
    lutEnabled,
    lutStrength,
    casEnabled,
    antiAliasingMode,
    casStrength,
    descriptor,
    aoOnlyView,
    gtaoPass,
    aoDenoisePass,
    prePassNode,
    graphicsProfile,
  } = args;

  if (postFXUniforms) {
    postFXUniforms.ssrOpacity.value = descriptor.useSSR ? ssrOpacity : 0;
    postFXUniforms.vignetteDarkness.value = vignetteEnabled ? vignetteDarkness : 0;
    postFXUniforms.lutIntensity.value = lutEnabled ? lutStrength : 0;
    postFXUniforms.casStrength.value = getEffectiveCasStrength(casEnabled, antiAliasingMode, casStrength);
  }

  syncGtaoSettings({
    postFXUniforms,
    gtaoPass,
    aoDenoisePass,
    prePassNode,
    descriptor,
    aoOnlyView,
    graphicsProfile,
  });

  if (ssrNode) {
    (ssrNode as { resolutionScale: number }).resolutionScale = ssrResolutionScale;
  }

  syncCasTexelSize(renderer, postFXUniforms);
}
