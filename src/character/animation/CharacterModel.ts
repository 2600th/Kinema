import * as THREE from 'three';
import type { AssetLoader } from '@level/AssetLoader';
import type { Disposable } from '@core/types';
import type { AnimationProfile } from './AnimationProfile';

export class CharacterModel implements Disposable {
  readonly root: THREE.Object3D;
  readonly clips: Map<string, THREE.AnimationClip>;

  private constructor(root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>) {
    this.root = root;
    this.clips = clips;
  }

  static async load(
    profile: AnimationProfile,
    parent: THREE.Object3D,
    loader: AssetLoader,
  ): Promise<CharacterModel> {
    // 1. Load model GLB
    const modelGltf = await loader.load(profile.modelUrl);
    const root = modelGltf.scene as THREE.Group;
    root.name = 'CharacterModel';

    // 2. Enable shadows
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });

    // 3. Scale model to match capsule height
    const box = new THREE.Box3().setFromObject(root);
    const modelHeight = box.max.y - box.min.y;
    if (modelHeight > 0) {
      const capsuleHeight = 1.3; // 2 * (0.35 + 0.3)
      const scale = capsuleHeight / modelHeight;
      root.scale.setScalar(scale);
    }

    // 4. Offset model so feet align with capsule bottom
    const scaledBox = new THREE.Box3().setFromObject(root);
    const capsuleBottom = -0.65; // -(halfHeight + radius)
    root.position.y = capsuleBottom - scaledBox.min.y;

    // 5. Attach to parent, hide capsule
    parent.add(root);
    const capsule = parent.getObjectByName('PlayerCapsule');
    if (capsule) capsule.visible = false;

    // 6. Collect clips from all animation URLs (clone to avoid cache mutation)
    const clips = new Map<string, THREE.AnimationClip>();
    for (const clip of modelGltf.animations ?? []) {
      if (!clips.has(clip.name)) {
        clips.set(clip.name, clip.clone());
      }
    }
    for (const url of profile.animationUrls) {
      if (url === profile.modelUrl) continue;
      try {
        const animGltf = await loader.load(url);
        for (const clip of animGltf.animations ?? []) {
          if (!clips.has(clip.name)) {
            clips.set(clip.name, clip.clone());
          }
        }
      } catch (err) {
        console.warn(`[CharacterModel] Failed to load animation GLB: ${url}`, err);
      }
    }

    // 7. Strip root motion (X/Z) from all clips
    const rootBoneName = CharacterModel.findRootBoneName(root);
    for (const clip of clips.values()) {
      CharacterModel.stripRootMotion(clip, rootBoneName);
    }

    if (import.meta.env.DEV) {
      const boneNames: string[] = [];
      root.traverse((n) => { if ((n as THREE.Bone).isBone) boneNames.push(n.name); });
      const trackBoneNames = new Set<string>();
      for (const clip of clips.values()) {
        for (const track of clip.tracks) {
          trackBoneNames.add(track.name.split('.')[0]);
        }
      }
      const missing = [...trackBoneNames].filter(n => !boneNames.includes(n));
      if (missing.length > 0) {
        console.warn('[CharacterModel] Track targets NOT found in skeleton:', missing);
      } else {
        console.debug(`[CharacterModel] All ${trackBoneNames.size} track targets found in skeleton. ${clips.size} clips loaded.`);
      }
    }

    return new CharacterModel(root, clips);
  }

  /** Tint all materials by blending toward the given color. */
  tint(color: THREE.Color): void {
    this.root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of materials) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.color.lerp(color, 0.6);
            mat.emissive.copy(color);
            mat.emissiveIntensity = 0.08;
          }
        }
      }
    });
  }

  dispose(): void {
    // Capture parent before removal so we can restore capsule visibility
    const parent = this.root.parent;
    if (parent) {
      parent.remove(this.root);
      const capsule = parent.getObjectByName('PlayerCapsule');
      if (capsule) capsule.visible = true;
    }
    this.root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.map?.dispose();
            mat.normalMap?.dispose();
            mat.roughnessMap?.dispose();
            mat.metalnessMap?.dispose();
            mat.aoMap?.dispose();
            mat.emissiveMap?.dispose();
            mat.alphaMap?.dispose();
            mat.envMap?.dispose();
          }
          mat.dispose();
        }
      }
    });
  }

  private static findRootBoneName(root: THREE.Object3D): string {
    let boneName = '';
    root.traverse((node) => {
      if (!boneName && (node as THREE.Bone).isBone) {
        boneName = node.name;
      }
    });
    return boneName || 'root';
  }

  private static stripRootMotion(clip: THREE.AnimationClip, rootBoneName: string): void {
    for (const track of clip.tracks) {
      if (track.name === rootBoneName + '.position') {
        const values = track.values;
        for (let i = 0; i < values.length; i += 3) {
          values[i] = 0;     // X
          values[i + 2] = 0; // Z
        }
      }
    }
  }
}
