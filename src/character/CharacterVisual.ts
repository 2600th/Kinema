import * as THREE from 'three';
import { AssetLoader } from '@level/AssetLoader';
import type { Disposable } from '@core/types';
import type { StateId } from '@core/types';

type ClipKey =
  | 'idle'
  | 'move'
  | 'jump'
  | 'air'
  | 'crouch'
  | 'interact'
  | 'grab'
  | 'carry';

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pickBestClipKey(state: StateId): ClipKey {
  // Keep this conservative: map known FSM states; fallback to idle.
  switch (state) {
    case 'move':
      return 'move';
    case 'jump':
      return 'jump';
    case 'air':
      return 'air';
    case 'crouch':
      return 'crouch';
    case 'interact':
      return 'interact';
    case 'grab':
      return 'grab';
    case 'carry':
      return 'carry';
    case 'idle':
    default:
      return 'idle';
  }
}

/**
 * Optional animated character visual:
 * - auto-detects a GLB model in `src/assets/models/` at build time
 * - keeps capsule fallback if no model (or no animations) are present
 */
export class CharacterVisual implements Disposable {
  private readonly loader = new AssetLoader();
  private modelRoot: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ClipKey, THREE.AnimationAction>();
  private current: ClipKey | null = null;

  constructor(private parent: THREE.Object3D) {}

  async init(): Promise<void> {
    // Build-time enumeration; if no models exist, this object remains a no-op.
    const modelImports = import.meta.glob('../assets/models/*.glb', { eager: true, import: 'default' }) as Record<
      string,
      string
    >;
    const candidates = Object.entries(modelImports);
    if (candidates.length === 0) return;

    // Prefer filenames that look like "character"/"player", else take first.
    const preferred =
      candidates.find(([path]) => /character|player/i.test(path)) ??
      candidates.find(([path]) => /humanoid|rig/i.test(path)) ??
      candidates[0];
    const url = preferred?.[1];
    if (!url) return;

    try {
      const gltf = await this.loader.load(url);
      const root = gltf.scene.clone(true);
      root.name = 'CharacterModel';
      root.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });

      // Replace/attach model under the player's visual parent.
      this.parent.add(root);
      this.modelRoot = root;
      const capsule = this.parent.getObjectByName('PlayerCapsule');
      if (capsule) capsule.visible = false;

      const clips = gltf.animations ?? [];
      if (clips.length === 0) {
        return;
      }

      this.mixer = new THREE.AnimationMixer(root);
      this.actions = this.buildActionMap(clips, this.mixer);

      // Start idle if present, else first available.
      this.playImmediate(this.actions.get('idle') ? 'idle' : (Array.from(this.actions.keys())[0] ?? null));
    } catch (err) {
      console.warn('[CharacterVisual] Failed to load character model:', err);
    }
  }

  setState(state: StateId): void {
    const next = pickBestClipKey(state);
    if (next === this.current) return;
    if (!this.mixer || this.actions.size === 0) return;

    // Prefer exact mapping; otherwise keep current.
    const nextAction = this.actions.get(next) ?? this.actions.get('idle') ?? null;
    if (!nextAction) return;

    const prevKey = this.current;
    this.current = next;

    if (!prevKey) {
      nextAction.reset().fadeIn(0.12).play();
      return;
    }
    const prevAction = this.actions.get(prevKey);
    if (!prevAction || prevAction === nextAction) {
      nextAction.reset().fadeIn(0.12).play();
      return;
    }

    // Smooth transitions.
    prevAction.fadeOut(0.12);
    nextAction.reset().fadeIn(0.12).play();
  }

  update(dt: number): void {
    if (!this.mixer) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.mixer.update(dt);
  }

  dispose(): void {
    if (this.modelRoot) {
      this.parent.remove(this.modelRoot);
      this.modelRoot.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          const mat = node.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else {
            mat.dispose();
          }
        }
      });
    }
    this.modelRoot = null;
    const capsule = this.parent.getObjectByName('PlayerCapsule');
    if (capsule) capsule.visible = true;
    this.mixer = null;
    this.actions.clear();
    this.current = null;
  }

  private playImmediate(key: ClipKey | null): void {
    if (!key) return;
    const action = this.actions.get(key);
    if (!action) return;
    this.current = key;
    action.reset().play();
  }

  private buildActionMap(clips: THREE.AnimationClip[], mixer: THREE.AnimationMixer): Map<ClipKey, THREE.AnimationAction> {
    const map = new Map<ClipKey, THREE.AnimationAction>();
    const byName = new Map<string, THREE.AnimationClip>();
    for (const clip of clips) {
      byName.set(normalize(clip.name), clip);
    }

    const pickByPatterns = (patterns: RegExp[]): THREE.AnimationClip | null => {
      for (const clip of clips) {
        const n = normalize(clip.name);
        if (patterns.some((p) => p.test(n))) return clip;
      }
      return null;
    };

    const mapping: Array<[ClipKey, RegExp[]]> = [
      ['idle', [/\bidle\b/, /\bstand\b/]],
      ['move', [/\bwalk\b/, /\brun\b/, /\bmove\b/, /\blocomotion\b/]],
      ['jump', [/\bjump\b/, /\btake off\b/, /\btakeoff\b/]],
      ['air', [/\bfall\b/, /\bin air\b/, /\bair\b/]],
      ['crouch', [/\bcrouch\b/, /\bduck\b/]],
      ['interact', [/\binteract\b/, /\buse\b/, /\baction\b/]],
      ['grab', [/\bgrab\b/, /\bpull\b/]],
      ['carry', [/\bcarry\b/, /\bhold\b/]],
    ];

    for (const [key, patterns] of mapping) {
      const clip = pickByPatterns(patterns);
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.clampWhenFinished = true;
      action.loop = THREE.LoopRepeat;
      map.set(key, action);
    }

    // Ensure we at least have something if clips exist.
    if (map.size === 0 && clips.length > 0) {
      const action = mixer.clipAction(clips[0]);
      action.enabled = true;
      action.loop = THREE.LoopRepeat;
      map.set('idle', action);
    }

    return map;
  }
}

