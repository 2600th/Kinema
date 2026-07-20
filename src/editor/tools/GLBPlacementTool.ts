import RAPIER from "@dimforge/rapier3d-compat";
import type { LevelManager } from "@level/LevelManager";
import * as THREE from "three";
import { createOwnedCreationCommand } from "../EditorCommands";
import type { EditorObject } from "../EditorObject";
import type { EditorTool, EditorToolContext } from "./EditorTool";

type PlacementPhase = "idle" | "position";

let glbNameCounter = 0;

/**
 * GLB import + placement tool: loads a GLB file, shows a transparent
 * preview that follows the pointer, and finalises placement on click.
 */
export class GLBPlacementTool implements EditorTool {
  readonly id = "glb-placement";

  private glbPreview: THREE.Object3D | null = null;
  private pendingGLBAsset: string | null = null;
  private placementPhase: PlacementPhase = "idle";
  private placementPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private importGeneration = 0;

  private readonly levelManager: LevelManager;
  private readonly onFinished: () => void;
  private readonly onImported: (assetPath: string) => void;
  private readonly onError: (message: string) => void;
  private readonly getLifecycleGeneration: () => number;

  constructor(opts: {
    levelManager: LevelManager;
    onFinished: () => void;
    onImported: (assetPath: string) => void;
    onError?: (message: string) => void;
    getLifecycleGeneration?: () => number;
  }) {
    this.levelManager = opts.levelManager;
    this.onFinished = opts.onFinished;
    this.onImported = opts.onImported;
    this.onError = opts.onError ?? (() => {});
    this.getLifecycleGeneration = opts.getLifecycleGeneration ?? (() => 0);
  }

  /* ---- Lifecycle ---- */

  deactivate(ctx: EditorToolContext): void {
    this.cancelPendingImport(ctx);
  }

  /* ---- Public helpers called by EditorManager ---- */

  isPlacing(): boolean {
    return this.placementPhase === "position";
  }

  /** Open a file picker and start placement of the selected GLB. */
  openFilePicker(ctx: EditorToolContext): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".glb,.gltf";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.importFile(ctx, file);
    });
    input.click();
  }

  /** Import a GLB file (from file picker or drag-and-drop). */
  async importFile(ctx: EditorToolContext, file: File): Promise<void> {
    const importGeneration = ++this.importGeneration;
    const lifecycleGeneration = this.getLifecycleGeneration();
    const objectUrl = URL.createObjectURL(file);
    const assetLoader = this.levelManager.getAssetLoader();
    let transientGLTF: Awaited<ReturnType<typeof assetLoader.loadTransient>> | null = null;
    let adoptedScene: THREE.Object3D | null = null;
    try {
      transientGLTF = await assetLoader.loadTransient(objectUrl);
      if (!this.isImportCurrent(importGeneration, lifecycleGeneration)) {
        assetLoader.disposeTransient(transientGLTF);
        transientGLTF = null;
        return;
      }
      const assetPath = `/assets/models/${file.name}`;

      // Adopt and clone synchronously: there is no lifecycle gap after the
      // final freshness check in which a stale import can enter the cache.
      const gltf = assetLoader.adopt(assetPath, transientGLTF);
      transientGLTF = null;

      // The canonical cache owns the parsed source; adopt() returned a fully
      // independent scene whose ownership transfers to the preview/final object.
      const clone = gltf.scene;
      adoptedScene = clone;
      // Store animation clips on the cloned scene for later use
      if (gltf.animations?.length) {
        clone.userData.animations = gltf.animations;
      }
      this.startPlacement(ctx, clone, assetPath);
      this.onImported(assetPath);
      console.warn(
        `[Editor] Imported "${file.name}" for this session. ` +
          `Copy the file to public/assets/models/ for it to persist across reloads.`,
      );
      adoptedScene = null;
    } catch (err) {
      console.error("[Editor] Failed to import GLB:", err);
      if (adoptedScene) {
        if (this.glbPreview === adoptedScene) this.cancelPlacement(ctx);
        else assetLoader.disposeObject(adoptedScene);
      } else {
        this.cancelPlacement(ctx);
      }
      this.onError("Imported model preview could not be prepared. No editor changes were made.");
      this.onFinished();
    } finally {
      if (transientGLTF) assetLoader.disposeTransient(transientGLTF);
      // Revoke the blob URL (the GLTF data is now cached under assetPath via put())
      // Don't call evict() — that would dispose the shared scene/materials.
      URL.revokeObjectURL(objectUrl);
    }
  }

  /* ---- Tool interface ---- */

  onPointerDown(ctx: EditorToolContext, e: MouseEvent): boolean {
    if (e.button !== 0) return false;
    if (this.placementPhase === "position" && this.glbPreview) {
      this.confirmPlacement(ctx);
      return true;
    }
    return false;
  }

  update(ctx: EditorToolContext, _dt: number): void {
    this.updatePreview(ctx);
  }

  onKeyDown(ctx: EditorToolContext, e: KeyboardEvent): boolean {
    if (e.code === "Escape") {
      this.cancelPendingImport(ctx);
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
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          const previewMaterial = material as THREE.MeshStandardMaterial;
          previewMaterial.transparent = true;
          previewMaterial.opacity = 0.4;
          previewMaterial.depthWrite = false;
        }
      }
    });
    ctx.scene.add(this.glbPreview);
    this.placementPhase = "position";
  }

  private updatePreview(ctx: EditorToolContext): void {
    if (this.placementPhase !== "position" || !this.glbPreview) return;
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
    const finalObj = this.glbPreview;
    const position = finalObj.position.clone();
    const assetPath = this.pendingGLBAsset;
    let body: RAPIER.RigidBody | null = null;
    let published = false;
    let publicationAttempted = false;
    const editorObj: EditorObject = {
      id: finalObj.uuid,
      name: `GLB_${++glbNameCounter}`,
      mesh: finalObj,
      source: { type: "glb", asset: assetPath },
      transform: {
        position: [position.x, position.y, position.z],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      parentId: null,
      children: [],
      visible: true,
      locked: false,
      physicsType: "static",
    };

    try {
      // Prepare the descriptor before allocating a body.
      const box = new THREE.Box3().setFromObject(finalObj);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const colliderDesc = RAPIER.ColliderDesc.cuboid(
        Math.max(size.x / 2, 0.01),
        Math.max(size.y / 2, 0.01),
        Math.max(size.z / 2, 0.01),
      );
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
      body = ctx.physicsWorld.world.createRigidBody(bodyDesc);
      const collider = ctx.physicsWorld.world.createCollider(colliderDesc, body);
      editorObj.body = body;
      editorObj.collider = collider;

      finalObj.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          const finalMaterial = material as THREE.MeshStandardMaterial;
          finalMaterial.transparent = false;
          finalMaterial.opacity = 1;
          finalMaterial.depthWrite = true;
        }
        child.castShadow = true;
        child.receiveShadow = true;
      });
      finalObj.position.copy(position);
      finalObj.userData.editorSource = editorObj.source;
      ctx.scene.remove(finalObj);

      publicationAttempted = true;
      published = ctx.history.push(
        createOwnedCreationCommand(
          () => {
            ctx.addEditorObject(editorObj, ctx.scene);
            ctx.syncHierarchy();
            ctx.eventBus.emit("editor:objectAdded", { id: editorObj.id });
            ctx.setSelection(editorObj);
          },
          () => {
            ctx.removeEditorObject(editorObj.id);
            ctx.syncHierarchy();
            ctx.eventBus.emit("editor:objectRemoved", { id: editorObj.id });
          },
          () => ctx.rollbackEditorObject(editorObj),
        ),
      );
      if (!published) throw new Error("History rejected GLB placement.");
      this.glbPreview = null;
      this.pendingGLBAsset = null;
      this.placementPhase = "idle";
      this.onFinished();
    } catch (error) {
      console.error("[Editor] GLB placement failed:", error);
      if (publicationAttempted) {
        ctx.rollbackEditorObject(editorObj);
      } else {
        ctx.scene.remove(finalObj);
        if (body) ctx.physicsWorld.removeBody(body);
      }
      this.levelManager.getAssetLoader().disposeObject(finalObj);
      this.glbPreview = null;
      this.pendingGLBAsset = null;
      this.placementPhase = "idle";
      this.onError("Imported model could not be placed. No editor changes were made.");
      this.onFinished();
    }
  }

  cancelPlacement(ctx: EditorToolContext): void {
    if (this.glbPreview) {
      ctx.scene.remove(this.glbPreview);
      this.levelManager.getAssetLoader().disposeObject(this.glbPreview);
    }
    this.glbPreview = null;
    this.pendingGLBAsset = null;
    this.placementPhase = "idle";
  }

  cancelPendingImport(ctx: EditorToolContext): void {
    this.importGeneration++;
    this.cancelPlacement(ctx);
  }

  private isImportCurrent(importGeneration: number, lifecycleGeneration: number): boolean {
    return this.importGeneration === importGeneration && this.getLifecycleGeneration() === lifecycleGeneration;
  }
}
