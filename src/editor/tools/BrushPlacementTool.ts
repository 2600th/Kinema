import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { BrushDefinition, BrushParams } from "../brushes/Brush";
import { getBrushById } from "../brushes/index";
import type { EditorObject } from "../EditorObject";
import type { EditorTool, EditorToolContext } from "./EditorTool";

/** Merge brush-specific defaults with generic fallbacks. */
function buildDefaultParams(brush: BrushDefinition): BrushParams {
  const bp = brush.defaultParams;
  return {
    anchor: bp?.anchor?.clone() ?? new THREE.Vector3(0, 0, 0),
    current: bp?.current?.clone() ?? new THREE.Vector3(1, 0, 1),
    normal: bp?.normal?.clone() ?? new THREE.Vector3(0, 1, 0),
    height: bp?.height ?? 1,
  };
}

/**
 * Build a shape-appropriate Rapier ColliderDesc for a brush.
 * - block/floor: cuboid
 * - pillar: cylinder
 * - ramp/stairs/doorframe: trimesh (exact triangle collision)
 */
export function buildColliderDesc(
  brushId: string,
  geometry: THREE.BufferGeometry,
  mesh: THREE.Mesh,
): RAPIER.ColliderDesc {
  mesh.updateMatrixWorld(true);

  if (brushId === "pillar") {
    // Cylinder collider from bounding box
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) {
      throw new Error("[BrushPlacementTool] Missing bounding box for pillar collider.");
    }
    const sx = Math.abs(mesh.scale.x);
    const sy = Math.abs(mesh.scale.y);
    const sz = Math.abs(mesh.scale.z);
    const halfH = ((bb.max.y - bb.min.y) / 2) * sy;
    const radius = Math.max(((bb.max.x - bb.min.x) / 2) * sx, ((bb.max.z - bb.min.z) / 2) * sz);
    return RAPIER.ColliderDesc.cylinder(Math.max(halfH, 0.01), Math.max(radius, 0.01));
  }

  if (brushId === "ramp" || brushId === "stairs" || brushId === "doorframe") {
    // Trimesh collider for exact triangle-level collision
    const posAttr = geometry.getAttribute("position");
    const vertices = new Float32Array(posAttr.count * 3);
    const sx = mesh.scale.x;
    const sy = mesh.scale.y;
    const sz = mesh.scale.z;
    for (let i = 0; i < posAttr.count; i++) {
      vertices[i * 3] = posAttr.getX(i) * sx;
      vertices[i * 3 + 1] = posAttr.getY(i) * sy;
      vertices[i * 3 + 2] = posAttr.getZ(i) * sz;
    }
    let indices: Uint32Array;
    if (geometry.index) {
      indices = new Uint32Array(geometry.index.array);
    } else {
      // Unindexed geometry: generate sequential indices
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) indices[i] = i;
    }
    return RAPIER.ColliderDesc.trimesh(vertices, indices);
  }

  // Default: cuboid from world-space AABB (block, floor, etc.)
  const worldBox = new THREE.Box3().setFromObject(mesh);
  const size = worldBox.getSize(new THREE.Vector3());
  return RAPIER.ColliderDesc.cuboid(Math.max(size.x / 2, 0.01), Math.max(size.y / 2, 0.01), Math.max(size.z / 2, 0.01));
}

type PlacementPhase = "idle" | "position";

let brushNameCounter = 0;

/**
 * Brush placement tool: creates a transparent preview mesh that follows the
 * pointer and snaps to the grid, then finalises placement on click.
 */
export class BrushPlacementTool implements EditorTool {
  readonly id = "brush-placement";

  private placementPhase: PlacementPhase = "idle";
  private activeBrush: BrushDefinition | null = null;
  private previewMesh: THREE.Mesh | null = null;
  private placementPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** Callback fired when the tool returns to idle so EditorManager can switch tools. */
  private readonly onFinished: () => void;
  /** Callback to keep the BrushPanel highlight in sync. */
  private readonly onBrushChanged: (brushId: string | null) => void;

  constructor(opts: {
    onFinished: () => void;
    onBrushChanged: (brushId: string | null) => void;
  }) {
    this.onFinished = opts.onFinished;
    this.onBrushChanged = opts.onBrushChanged;
  }

  /* ---- Lifecycle ---- */

  deactivate(ctx: EditorToolContext): void {
    this.cancelPlacement(ctx);
    this.activeBrush = null;
  }

  /* ---- Public helpers called by EditorManager ---- */

  startBrush(ctx: EditorToolContext, brushId: string): void {
    this.cancelPlacement(ctx);

    const brush = getBrushById(brushId);
    if (!brush) return;

    this.activeBrush = brush;
    this.placementPhase = "position";
    this.onBrushChanged(brushId);

    // Create preview mesh with brush-specific or generic defaults
    const defaultParams = buildDefaultParams(brush);
    const geometry = brush.buildPreviewGeometry(defaultParams);
    const material = brush.getDefaultMaterial().clone();
    material.transparent = true;
    material.opacity = 0.4;
    material.depthWrite = false;
    this.previewMesh = new THREE.Mesh(geometry, material);
    this.previewMesh.castShadow = false;
    this.previewMesh.receiveShadow = false;
    ctx.scene.add(this.previewMesh);
  }

  getActiveBrushId(): string | null {
    return this.activeBrush?.id ?? null;
  }

  /* ---- Tool interface ---- */

  onPointerDown(ctx: EditorToolContext, e: MouseEvent): boolean {
    if (e.button !== 0) return false;
    if (this.placementPhase === "position" && this.previewMesh) {
      this.confirmPlacement(ctx);
      return true;
    }
    return false;
  }

  update(ctx: EditorToolContext, _dt: number): void {
    this.updatePlacementPreview(ctx);
  }

  onKeyDown(ctx: EditorToolContext, e: KeyboardEvent): boolean {
    if (e.code === "Escape") {
      this.cancelPlacement(ctx);
      this.activeBrush = null;
      this.onBrushChanged(null);
      this.onFinished();
      return true;
    }
    return false;
  }

  /* ---- Internals ---- */

  private updatePlacementPreview(ctx: EditorToolContext): void {
    if (this.placementPhase !== "position") return;
    if (!this.previewMesh) return;

    ctx.raycaster.setFromCamera(ctx.mouse, ctx.camera);
    const point = new THREE.Vector3();
    ctx.raycaster.ray.intersectPlane(this.placementPlane, point);

    if (ctx.snapGrid.enabled) {
      const snap = ctx.snapGrid.positionSnap;
      point.x = Math.round(point.x / snap) * snap;
      point.z = Math.round(point.z / snap) * snap;
    }

    // Offset Y so the object's bottom sits ON the ground plane.
    // Uses -bb.min.y (distance from local origin to bottom of bounds) which
    // handles meshes with non-centered pivots correctly.
    point.y += this.getGroundOffset(this.previewMesh);
    this.previewMesh.position.copy(point);
  }

  /** Returns the Y offset needed to place the mesh so its bottom touches Y=0. */
  private getGroundOffset(mesh: THREE.Mesh): number {
    if (!mesh.geometry) return 0;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (!bb) return 0;
    return -bb.min.y * mesh.scale.y;
  }

  private confirmPlacement(ctx: EditorToolContext): void {
    if (!this.activeBrush || !this.previewMesh) return;

    const brush = this.activeBrush;
    // Use the preview mesh position (already offset to sit on ground)
    const position = this.previewMesh.position.clone();

    // Create final mesh with brush-specific or generic defaults
    const defaultParams = buildDefaultParams(brush);
    const geometry = brush.buildPreviewGeometry(defaultParams);
    const material = brush.getDefaultMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(position);

    // Extract material properties for editor object
    const matProps: NonNullable<EditorObject["material"]> = {
      color: "#" + material.color.getHexString(),
      roughness: material.roughness,
      metalness: material.metalness,
      emissive: "#" + material.emissive.getHexString(),
      emissiveIntensity: material.emissiveIntensity,
      opacity: material.opacity,
    };

    // Build editor object
    const editorObj: EditorObject = {
      id: mesh.uuid,
      name: `${brush.label}_${++brushNameCounter}`,
      mesh,
      source: { type: "brush", brush: brush.id },
      transform: {
        position: [position.x, position.y, position.z],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      parentId: null,
      children: [],
      visible: true,
      locked: false,
      material: matProps,
      brushParams: {
        width: defaultParams.current.x - defaultParams.anchor.x || 1,
        height: defaultParams.height ?? 1,
        depth: defaultParams.current.z - defaultParams.anchor.z || 1,
      },
      physicsType: "static",
      spawnTag: brush.id === "spawn" ? "player" : undefined,
    };

    mesh.userData.editorSource = editorObj.source;

    // Create static physics body/collider for physical brushes (not spawn or trigger)
    if (brush.id !== "spawn" && brush.id !== "trigger") {
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
      const body = ctx.physicsWorld.world.createRigidBody(bodyDesc);
      const colliderDesc = buildColliderDesc(brush.id, geometry, mesh);
      const collider = ctx.physicsWorld.world.createCollider(colliderDesc, body);
      editorObj.body = body;
      editorObj.collider = collider;
    }

    // Push to undo stack
    ctx.history.push({
      execute: () => {
        ctx.addEditorObject(editorObj, ctx.scene);
        ctx.syncHierarchy();
        ctx.eventBus.emit("editor:objectAdded", { id: editorObj.id });
      },
      undo: () => {
        ctx.removeEditorObject(editorObj.id);
        ctx.syncHierarchy();
        ctx.eventBus.emit("editor:objectRemoved", { id: editorObj.id });
      },
    });

    // Select the new object, switch back to selection tool
    ctx.setSelection(editorObj);
    this.cleanupPreview(ctx);
    this.placementPhase = "idle";
    this.activeBrush = null;
    this.onBrushChanged(null);
    this.onFinished();
  }

  cancelPlacement(ctx: EditorToolContext): void {
    this.cleanupPreview(ctx);
    this.placementPhase = "idle";
  }

  private cleanupPreview(ctx: EditorToolContext): void {
    if (!this.previewMesh) return;
    ctx.scene.remove(this.previewMesh);
    if (this.previewMesh.geometry) this.previewMesh.geometry.dispose();
    if (this.previewMesh.material) {
      (this.previewMesh.material as THREE.Material).dispose();
    }
    this.previewMesh = null;
  }
}
