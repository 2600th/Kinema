import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EditorTool, EditorToolContext } from './EditorTool';
import type { BrushDefinition } from '../brushes/Brush';
import type { EditorObject } from '../EditorObject';
import { getBrushById } from '../brushes/index';

type PlacementPhase = 'idle' | 'position';

let brushNameCounter = 0;

/**
 * Brush placement tool: creates a transparent preview mesh that follows the
 * pointer and snaps to the grid, then finalises placement on click.
 */
export class BrushPlacementTool implements EditorTool {
  readonly id = 'brush-placement';

  private placementPhase: PlacementPhase = 'idle';
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
    this.placementPhase = 'position';
    this.onBrushChanged(brushId);

    // Create preview mesh with default params
    const defaultParams = {
      anchor: new THREE.Vector3(0, 0, 0),
      current: new THREE.Vector3(1, 0, 1),
      normal: new THREE.Vector3(0, 1, 0),
      height: 1,
    };
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
    if (this.placementPhase === 'position' && this.previewMesh) {
      this.confirmPlacement(ctx);
      return true;
    }
    return false;
  }

  update(ctx: EditorToolContext, _dt: number): void {
    this.updatePlacementPreview(ctx);
  }

  onKeyDown(ctx: EditorToolContext, e: KeyboardEvent): boolean {
    if (e.code === 'Escape') {
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
    if (this.placementPhase !== 'position') return;
    if (!this.previewMesh) return;

    ctx.raycaster.setFromCamera(ctx.mouse, ctx.camera);
    const point = new THREE.Vector3();
    ctx.raycaster.ray.intersectPlane(this.placementPlane, point);

    if (ctx.snapGrid.enabled) {
      const snap = ctx.snapGrid.positionSnap;
      point.x = Math.round(point.x / snap) * snap;
      point.y = Math.round(point.y / snap) * snap;
      point.z = Math.round(point.z / snap) * snap;
    }
    this.previewMesh.position.copy(point);
  }

  private confirmPlacement(ctx: EditorToolContext): void {
    if (!this.activeBrush || !this.previewMesh) return;

    const brush = this.activeBrush;
    const position = this.previewMesh.position.clone();

    // Create final mesh
    const defaultParams = {
      anchor: new THREE.Vector3(0, 0, 0),
      current: new THREE.Vector3(1, 0, 1),
      normal: new THREE.Vector3(0, 1, 0),
      height: 1,
    };
    const geometry = brush.buildPreviewGeometry(defaultParams);
    const material = brush.getDefaultMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(position);

    // Extract material properties for editor object
    const matProps: NonNullable<EditorObject['material']> = {
      color: '#' + material.color.getHexString(),
      roughness: material.roughness,
      metalness: material.metalness,
      emissive: '#' + material.emissive.getHexString(),
      emissiveIntensity: material.emissiveIntensity,
      opacity: material.opacity,
    };

    // Build editor object
    const editorObj: EditorObject = {
      id: mesh.uuid,
      name: `${brush.label}_${++brushNameCounter}`,
      mesh,
      source: { type: 'brush', brush: brush.id },
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
      brushParams: { width: 1, height: 1, depth: 1 },
      physicsType: 'static',
    };

    mesh.userData.editorSource = editorObj.source;

    // Create static physics body/collider for physical brushes (not spawn or trigger)
    if (brush.id !== 'spawn' && brush.id !== 'trigger') {
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
      const body = ctx.physicsWorld.world.createRigidBody(bodyDesc);
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!;
      const halfW = (bb.max.x - bb.min.x) / 2;
      const halfH = (bb.max.y - bb.min.y) / 2;
      const halfD = (bb.max.z - bb.min.z) / 2;
      const colliderDesc = RAPIER.ColliderDesc.cuboid(halfW, halfH, halfD);
      const collider = ctx.physicsWorld.world.createCollider(colliderDesc, body);
      editorObj.body = body;
      editorObj.collider = collider;
    }

    // Push to undo stack
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

    // Select the new object, clean up preview
    ctx.setSelection(editorObj);
    this.cleanupPreview(ctx);
    // Stay in placement mode for rapid placement of the same brush
    this.startBrush(ctx, brush.id);
  }

  cancelPlacement(ctx: EditorToolContext): void {
    this.cleanupPreview(ctx);
    this.placementPhase = 'idle';
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
