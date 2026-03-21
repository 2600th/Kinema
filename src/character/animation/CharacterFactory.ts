import * as THREE from 'three';
import type { AssetLoader } from '@level/AssetLoader';
import type { AnimationProfile } from './AnimationProfile';
import { CharacterModel } from './CharacterModel';
import { AnimationController } from './AnimationController';

export interface CharacterCreateOptions {
  tint?: THREE.Color;
}

export async function createAnimatedCharacter(
  profile: AnimationProfile,
  parent: THREE.Object3D,
  loader: AssetLoader,
  options?: CharacterCreateOptions,
): Promise<{ model: CharacterModel; animator: AnimationController }> {
  const model = await CharacterModel.load(profile, parent, loader);
  if (options?.tint) model.tint(options.tint);
  const animator = new AnimationController(model, profile);
  return { model, animator };
}
