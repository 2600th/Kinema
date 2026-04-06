import * as THREE from 'three';
import type { RenderPipeline } from 'three/webgpu';
import type { EnvironmentTargetLike } from './rendererAssets';
import type { RendererLutPassNode } from './rendererPipelineBuilder';

const _envRotation = new THREE.Euler();

export interface ShadowToggleRendererLike {
  shadowMap: {
    enabled: boolean;
    needsUpdate?: boolean;
  };
}

export function applyEnvironmentRotation(scene: THREE.Scene, envRotationDegrees: number): void {
  const radians = THREE.MathUtils.degToRad(envRotationDegrees);
  _envRotation.set(0, radians, 0);
  const sceneWithRotation = scene as THREE.Scene & {
    environmentRotation?: THREE.Euler;
    backgroundRotation?: THREE.Euler;
  };
  sceneWithRotation.environmentRotation = _envRotation;
  sceneWithRotation.backgroundRotation = _envRotation;
}

export function applyEnvironmentTarget(
  scene: THREE.Scene,
  envTarget: EnvironmentTargetLike,
  envRotationDegrees: number,
): void {
  scene.environment = envTarget.texture;
  scene.background = envTarget.texture;
  applyEnvironmentRotation(scene, envRotationDegrees);
}

export function applyShadowToggle(
  renderer: ShadowToggleRendererLike,
  postProcessing: RenderPipeline | null,
  enabled: boolean,
): void {
  renderer.shadowMap.enabled = enabled;
  if (!postProcessing) return;
  (postProcessing as { needsUpdate: boolean }).needsUpdate = true;
  if (typeof renderer.shadowMap.needsUpdate !== 'undefined') {
    renderer.shadowMap.needsUpdate = true;
  }
}

export function applyLutTexture(
  lutPassNode: RendererLutPassNode | null,
  postProcessing: RenderPipeline | null,
  texture: THREE.Data3DTexture,
): void {
  if (!lutPassNode) return;
  lutPassNode.lutNode.value = texture;
  lutPassNode.size.value = texture.image.width;
  if (postProcessing) {
    (postProcessing as { needsUpdate: boolean }).needsUpdate = true;
  }
}
