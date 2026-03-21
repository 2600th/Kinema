import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import type { EditorTool, EditorToolContext } from './EditorTool';
import type { EditorObject } from '../EditorObject';
import type { LevelManager } from '@level/LevelManager';

type PlacementPhase = 'idle' | 'position';

let glbNameCounter = 0;

/**
 * GLB import + placement tool: loads a GLB file, shows a transparent
 * preview that follows the pointer, and finalises placement on click.
 */
export class GLBPlacementTool implements EditorTool {
  readonly id = 'glb-placement';

  private glbPreview: THREE.Object3D | null = null;
  private pendingGLBAsset: string | null = null;
  private placementPhase: PlacementPhase = 'idle';
  private placementPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private readonly levelManager: LevelManager;
  private readonly onFinished: () => void;

  constructor(opts: { levelManager: LevelManager; onFinished: () => void }) {
    this.levelManager = opts.levelManager;
    this.onFinished = opts.onFinished;
  }

  /* ---- Lifecycle ---- */

  deactivate(ctx: EditorToolContext): void {
    this.cancelPlacement(ctx);
  }

  /* ---- Public helpers called by EditorManager ---- */

  isPlacing(): boolean {
    return this.placementPhase === 'position';
  }

  /** Open a file picker and start placement of the selected GLB. */
  openFilePicker(ctx: EditorToolContext): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void this.importFile(ctx, file);
    });
    input.click();
  }

  /** Import a GLB file (from file picker or drag-and-drop). */
  async importFile(ctx: EditorToolContext, file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const gltf = await this.levelManager.getAssetLoader().load(objectUrl);
      const assetPath = `/assets/models/${file.name}`;

      // Register the loaded GLTF under the canonical asset path so it survives
      // play-test restore (spawnSerializedObject calls load(assetPath)).
      this.levelManager.getAssetLoader().put(assetPath, gltf);

      // Use SkeletonUtils.clone to preserve SkinnedMesh skeleton bindings
      const clone = skeletonClone(gltf.scene);
      // Store animation clips on the cloned scene for later use
      if (gltf.animations?.length) {
        clone.userData.animations = gltf.animations;
      }
      this.startPlacement(ctx, clone, assetPath);
    } catch (err) {
      console.error('[Editor] Failed to import GLB:', err);
    } finally {
      // Revoke the blob URL (the GLTF data is now cached under assetPath via put())
      // Don't call evict() — that would dispose the shared scene/materials.
      URL.revokeObjectURL(objectUrl);
    }
    console.warn(
      `[Editor] Imported "${file.name}" for this session. ` +
        `Copy the file to public/assets/models/ for it to persist across reloads.`,
    );
  }

  /* ---- Tool interface ---- */

  onPointerDown(ctx: EditorToolContext, e: MouseEvent): boolean {
    if (e.button !== 0) return false;
    if (this.placementPhase === 'position' && this.glbPreview) {
      this.confirmPlacement(ctx);
      return true;
    }
    return false;
  }

  update(ctx: EditorToolContext, _dt: number): void {
    this.updatePreview(ctx);
  }

  onKeyDown(ctx: EditorToolContext, e: KeyboardEvent): boolean {
    if (e.code === 'Escape') {
      this.cancelPlacement(ctx);
      this.onFinished();
      return true;
    }
    return false;
  }

  /* ---- Internals ---- */

  private startPlacement(ctx: EditorToolContext, scene: THREE.Object3D, assetPath: string): void {
    this.cancelPlacement(ctx);
    this.pendingGLBAsset = assetPath;
    this.glbPreview = scene;
    // Make preview transparent
    this.glbPreview.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = (child.material as THREE.Material).clone();
        (mat as THREE.MeshStandardMaterial).transparent = true;
        (mat as THREE.MeshStandardMaterial).opacity = 0.4;
        (mat as THREE.MeshStandardMaterial).depthWrite = false;
        child.material = mat;
      }
    });
    ctx.scene.add(this.glbPreview);
    this.placementPhase = 'position';
  }

  private updatePreview(ctx: EditorToolContext): void {
    if (this.placementPhase !== 'position' || !this.glbPreview) return;
    ctx.raycaster.setFromCamera(ctx.mouse, ctx.camera);
    const point = new THREE.Vector3();
    ctx.raycaster.ray.intersectPlane(this.placementPlane, point);
    if (ctx.snapGrid.enabled) {
      const snap = ctx.snapGrid.positionSnap;
      point.x = Math.round(point.x / snap) * snap;
      point.y = Math.round(point.y / snap) * snap;
      point.z = Math.round(point.z / snap) * snap;
    }
    this.glbPreview.position.copy(point);
  }

  private confirmPlacement(ctx: EditorToolContext): void {
    if (!this.glbPreview || !this.pendingGLBAsset) return;
    const position = this.glbPreview.position.clone();
    const assetPath = this.pendingGLBAsset;

    // Remove the transparent preview
    ctx.scene.remove(this.glbPreview);

    // Create final opaque clone (SkeletonUtils preserves skinned mesh bindings)
    const finalObj = skeletonClone(this.glbPreview);
    finalObj.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = (child.material as THREE.Material).clone();
        (mat as THREE.MeshStandardMaterial).transparent = false;
        (mat as THREE.MeshStandardMaterial).opacity = 1;
        (mat as THREE.MeshStandardMaterial).depthWrite = true;
        child.material = mat;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    finalObj.position.copy(position);

    const editorObj: EditorObject = {
      id: finalObj.uuid,
      name: `GLB_${++glbNameCounter}`,
      mesh: finalObj,
      source: { type: 'glb', asset: assetPath },
      transform: {
        position: [position.x, position.y, position.z],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      parentId: null,
      children: [],
      visible: true,
      locked: false,
      physicsType: 'static',
    };

    finalObj.userData.editorSource = editorObj.source;

    // Create static physics body with approximate bounding box
    const box = new THREE.Box3().setFromObject(finalObj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
    const body = ctx.physicsWorld.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      Math.max(size.x / 2, 0.01),
      Math.max(size.y / 2, 0.01),
      Math.max(size.z / 2, 0.01),
    );
    const collider = ctx.physicsWorld.world.createCollider(colliderDesc, body);
    editorObj.body = body;
    editorObj.collider = collider;

    ctx.history.push({
      execute: () => {
        ctx.addEditorObject(editorObj, ctx.scene);
        ctx.syncHierarchy();
        ctx.eventBus.emit('editor:objectAdded', { id: editorObj.id });
      },
      undo: () => {
        ctx.removeEditorObject(editorObj.id);
        ctx.syncHierarchy();
        ctx.eventBus.emit('editor:objectRemoved', { id: editorObj.id });
      },
    });

    ctx.setSelection(editorObj);
    this.glbPreview = null;
    this.pendingGLBAsset = null;
    this.placementPhase = 'idle';
    this.onFinished();
  }

  cancelPlacement(ctx: EditorToolContext): void {
    if (this.glbPreview) {
      ctx.scene.remove(this.glbPreview);
      this.glbPreview.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          const mat = child.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else if (mat) {
            (mat as THREE.Material).dispose();
          }
        }
      });
    }
    this.glbPreview = null;
    this.pendingGLBAsset = null;
    this.placementPhase = 'idle';
  }
}
