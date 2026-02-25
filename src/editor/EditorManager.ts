import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { GameLoop } from '@core/GameLoop';
import type { RendererManager } from '@renderer/RendererManager';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { LevelManager } from '@level/LevelManager';
import type { PlayerController } from '@character/PlayerController';
import type { InteractionManager } from '@interaction/InteractionManager';
import { TransformGizmo } from './TransformGizmo';
import { SnapGrid } from './SnapGrid';
import { FreeCamera } from './FreeCamera';
import { CommandHistory } from './CommandHistory';
import { LevelSerializer, type LevelData } from './LevelSerializer';
import type { EditorObject } from './EditorObject';
import { ToolbarPanel } from './panels/ToolbarPanel';
import { BrushPanel } from './panels/BrushPanel';
import { HierarchyPanel } from './panels/HierarchyPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { type BrushDefinition } from './brushes/Brush';
import { getBrushById, BRUSH_REGISTRY } from './brushes/index';

type PlacementPhase = 'idle' | 'position';

let brushNameCounter = 0;

export class EditorManager {
  private active = false;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private editorObjects: EditorObject[] = [];
  private selected: EditorObject | null = null;
  private selectionHelper: THREE.BoxHelper | null = null;
  private dragStartTransform: {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  } | null = null;

  /* ---- Brush placement state ---- */
  private placementPhase: PlacementPhase = 'idle';
  private activeBrush: BrushDefinition | null = null;
  private previewMesh: THREE.Mesh | null = null;
  private placementPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /* ---- Subsystems (kept) ---- */
  private gizmo: TransformGizmo;
  private grid: SnapGrid;
  private gridWasVisible = true;
  private freeCamera: FreeCamera;
  private history = new CommandHistory();

  /* ---- Panels (new) ---- */
  private toolbarPanel: ToolbarPanel;
  private brushPanel: BrushPanel;
  private hierarchyPanel: HierarchyPanel;
  private inspectorPanel: InspectorPanel;
  private panels: { build(): void; show(): void; hide(): void; getElement(): HTMLDivElement; dispose(): void }[];

  constructor(
    private renderer: RendererManager,
    private physicsWorld: PhysicsWorld,
    private eventBus: EventBus,
    private gameLoop: GameLoop,
    private levelManager: LevelManager,
    private player: PlayerController,
    private interactionManager: InteractionManager,
  ) {
    this.injectStyles();

    this.freeCamera = new FreeCamera(this.renderer.camera, this.renderer.canvas);
    this.grid = new SnapGrid(this.renderer.scene);

    /* ---- Panels ---- */
    this.toolbarPanel = new ToolbarPanel({
      onSave: () => this.saveLevel(),
      onLoad: () => this.loadLevel(),
      onUndo: () => this.history.undo(),
      onRedo: () => this.history.redo(),
      onToggleSnap: () => this.toggleSnap(),
      onToggleGrid: () => this.grid.toggleGrid(),
      onSetMode: (mode) => this.gizmo.setMode(mode),
    });

    this.brushPanel = new BrushPanel((brushId) => this.onBrushSelected(brushId));

    this.hierarchyPanel = new HierarchyPanel({
      onSelect: (id) => this.selectById(id),
      onDelete: (id) => this.deleteById(id),
      onDuplicate: (id) => this.duplicateById(id),
      onRename: (id, name) => this.renameById(id, name),
      onToggleVisible: (id) => this.toggleVisibleById(id),
      onToggleLock: (id) => this.toggleLockById(id),
      onReparent: (childId, newParentId) => this.reparentById(childId, newParentId),
      onGroup: (ids) => this.groupObjects(ids),
      onUngroup: (groupId) => this.ungroupObject(groupId),
    });

    this.inspectorPanel = new InspectorPanel({
      onTransformChange: (_id, t) => this.applyInspectorTransform(t),
      onMaterialChange: (_id, m) => this.applyMaterialChange(m),
      onPhysicsTypeChange: (id, type) => this.applyPhysicsTypeChange(id, type),
    });

    /* Build and append all panels */
    this.panels = [this.toolbarPanel, this.brushPanel, this.hierarchyPanel, this.inspectorPanel];
    for (const panel of this.panels) {
      panel.build();
      document.body.appendChild(panel.getElement());
    }

    /* ---- Gizmo ---- */
    this.gizmo = new TransformGizmo(
      this.renderer.camera,
      this.renderer.canvas,
      this.renderer.scene,
      (dragging) => this.onDragStateChanged(dragging),
      () => this.onGizmoObjectChanged(),
    );
    this.gizmo.setSnaps(this.grid.positionSnap, this.grid.rotationSnap, this.grid.scaleSnap);

    this.eventBus.on('editor:toggle', () => this.toggle());
  }

  /* ==================================================================
   *  Public API
   * ================================================================== */

  isActive(): boolean {
    return this.active;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.freeCamera.update(dt);
    this.updateGridHeight();
    this.updatePlacementPreview();
    this.selectionHelper?.update();
  }

  dispose(): void {
    for (const panel of this.panels) panel.dispose();
    this.gizmo.dispose(this.renderer.scene);
    this.grid.dispose(this.renderer.scene);
    this.clearSelectionHelper();
  }

  toggle(): void {
    if (this.active) {
      this.exit();
    } else {
      this.enter();
    }
  }

  /* ==================================================================
   *  CSS injection
   * ================================================================== */

  private injectStyles(): void {
    if (document.getElementById('ke-editor-styles')) return;
    const link = document.createElement('link');
    link.id = 'ke-editor-styles';
    link.rel = 'stylesheet';
    link.href = new URL('./styles/editor.css', import.meta.url).href;
    document.head.appendChild(link);
  }

  /* ==================================================================
   *  Enter / Exit
   * ================================================================== */

  private enter(): void {
    this.active = true;
    this.gameLoop.setSimulationEnabled(false);
    this.interactionManager.setEnabled(false);
    this.player.setActive(false);
    document.exitPointerLock();
    this.eventBus.emit('editor:opened', undefined);
    this.freeCamera.enable();
    this.grid.setVisible(this.gridWasVisible);
    for (const panel of this.panels) panel.show();
    this.buildEditorObjects();
    this.syncHierarchy();
    this.bindEditorInput();
  }

  private exit(): void {
    this.active = false;
    this.gameLoop.setSimulationEnabled(true);
    this.interactionManager.setEnabled(true);
    this.player.setActive(true);
    this.gridWasVisible = this.grid.isVisible();
    this.grid.setVisible(false);
    this.eventBus.emit('editor:closed', undefined);
    this.freeCamera.disable();
    for (const panel of this.panels) panel.hide();
    this.cancelPlacement();
    this.setSelection(null);
    this.unbindEditorInput();
    this.gizmo.attach(null);
  }

  /* ==================================================================
   *  Input binding
   * ================================================================== */

  private bindEditorInput(): void {
    this.renderer.canvas.addEventListener('mousedown', this.onMouseDown);
    this.renderer.canvas.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('keydown', this.onKeyDown);
  }

  private unbindEditorInput(): void {
    this.renderer.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.renderer.canvas.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.active) return;
    // Ignore clicks on panel UI
    if (this.isClickOnPanel(e.target as Node)) return;

    if (e.button === 2 || e.button === 1) return; // right/middle for camera

    if (e.button === 0) {
      if (this.placementPhase === 'position' && this.previewMesh) {
        this.confirmPlacement();
        return;
      }
      this.selectAtPointer(e.clientX, e.clientY);
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.active) return;
    const rect = this.renderer.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;

    // Ignore keyboard shortcuts when typing in an input
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'KeyW' && !e.ctrlKey) this.gizmo.setMode('translate');
    if (e.code === 'KeyE' && !e.ctrlKey) this.gizmo.setMode('rotate');
    if (e.code === 'KeyR' && !e.ctrlKey) this.gizmo.setMode('scale');
    if (e.code === 'Escape') this.cancelPlacement();
    if (e.code === 'KeyG' && !e.ctrlKey) this.grid.toggleGrid();
    if (e.code === 'KeyZ' && e.ctrlKey) {
      this.history.undo();
      e.preventDefault();
    }
    if (e.code === 'KeyY' && e.ctrlKey) {
      this.history.redo();
      e.preventDefault();
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      this.deleteSelection();
      e.preventDefault();
    }

    // Brush shortcuts 1-8
    const digitMatch = e.code.match(/^Digit([1-8])$/);
    if (digitMatch && !e.ctrlKey && !e.altKey) {
      const idx = parseInt(digitMatch[1], 10) - 1;
      if (idx < BRUSH_REGISTRY.length) {
        const brush = BRUSH_REGISTRY[idx];
        // Toggle: if same brush already active, deselect
        if (this.activeBrush?.id === brush.id) {
          this.onBrushSelected(null);
        } else {
          this.onBrushSelected(brush.id);
        }
      }
    }
  };

  /** Check if a DOM target is inside any panel element. */
  private isClickOnPanel(target: Node): boolean {
    for (const panel of this.panels) {
      if (panel.getElement().contains(target)) return true;
    }
    return false;
  }

  /* ==================================================================
   *  Selection
   * ================================================================== */

  private selectAtPointer(clientX: number, clientY: number): void {
    const rect = this.renderer.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
    const meshes = this.editorObjects
      .filter((obj) => !obj.locked)
      .map((obj) => obj.mesh);
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (!hits.length) {
      this.setSelection(null);
      return;
    }
    const mesh = hits[0].object;
    const target = this.editorObjects.find(
      (obj) => obj.mesh === mesh || obj.mesh.getObjectById(mesh.id) !== undefined,
    );
    this.setSelection(target ?? null);
  }

  private selectById(id: string | null): void {
    if (!id) {
      this.setSelection(null);
      return;
    }
    const obj = this.editorObjects.find((o) => o.id === id);
    this.setSelection(obj ?? null);
  }

  private setSelection(obj: EditorObject | null): void {
    this.selected = obj;
    this.gizmo.attach(obj?.mesh ?? null);
    this.inspectorPanel.setSelection(obj);
    this.hierarchyPanel.setSelection(obj?.id ?? null);
    this.setSelectionHelper(obj?.mesh ?? null);
    this.eventBus.emit('editor:objectSelected', obj ? { id: obj.id } : null);
  }

  private setSelectionHelper(target: THREE.Object3D | null): void {
    this.clearSelectionHelper();
    if (!target) return;
    const helper = new THREE.BoxHelper(target, 0x4fc3f7);
    const material = helper.material as THREE.LineBasicMaterial;
    material.depthTest = false;
    material.transparent = true;
    material.opacity = 0.85;
    this.ensureHelperNormals(helper);
    this.renderer.scene.add(helper);
    this.selectionHelper = helper;
  }

  private ensureHelperNormals(root: THREE.Object3D): void {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry || !('attributes' in mesh.geometry)) return;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      if (geometry.attributes.normal) return;
      const position = geometry.attributes.position;
      if (!position) return;
      const count = position.count;
      const normals = new Float32Array(count * 3);
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    });
  }

  private clearSelectionHelper(): void {
    if (!this.selectionHelper) return;
    this.renderer.scene.remove(this.selectionHelper);
    this.selectionHelper = null;
  }

  /* ==================================================================
   *  Build editor objects from scene
   * ================================================================== */

  private buildEditorObjects(): void {
    const map = new Map<string, EditorObject>();
    for (const obj of this.levelManager.getLevelObjects()) {
      if (obj instanceof THREE.Mesh) {
        const entry = this.buildEditorObject(obj);
        map.set(obj.uuid, entry);
      }
    }
    for (const dyn of this.levelManager.getDynamicBodies()) {
      const existing = map.get(dyn.mesh.uuid);
      if (existing) {
        existing.body = dyn.body;
        existing.collider = dyn.body.collider(0) ?? undefined;
      } else {
        const entry = this.buildEditorObject(dyn.mesh);
        entry.body = dyn.body;
        entry.collider = dyn.body.collider(0) ?? undefined;
        map.set(dyn.mesh.uuid, entry);
      }
    }
    this.editorObjects = Array.from(map.values());
  }

  private buildEditorObject(mesh: THREE.Object3D): EditorObject {
    const source = this.detectSource(mesh);
    const transform = {
      position: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] as [number, number, number],
    };

    // Extract material properties if it's a standard material
    let material: EditorObject['material'];
    const meshObj = mesh as THREE.Mesh;
    if (meshObj.isMesh && meshObj.material) {
      const mat = meshObj.material as THREE.MeshStandardMaterial;
      if (mat.isMeshStandardMaterial) {
        material = {
          color: '#' + mat.color.getHexString(),
          roughness: mat.roughness,
          metalness: mat.metalness,
          emissive: '#' + mat.emissive.getHexString(),
          emissiveIntensity: mat.emissiveIntensity,
          opacity: mat.opacity,
        };
      }
    }

    return {
      id: mesh.uuid,
      name: mesh.name || 'Object',
      mesh,
      source,
      transform,
      parentId: null,
      children: [],
      visible: mesh.visible,
      locked: false,
      material,
      physicsType: 'static',
    };
  }

  private detectSource(
    mesh: THREE.Object3D,
  ): { type: 'primitive' | 'glb' | 'sprite' | 'brush'; asset?: string; primitive?: string; brush?: string } {
    const userSource = (mesh.userData as { editorSource?: { type: string; asset?: string; primitive?: string; brush?: string } })
      .editorSource;
    if (userSource) {
      return {
        type: userSource.type as 'primitive' | 'glb' | 'sprite' | 'brush',
        asset: userSource.asset,
        primitive: userSource.primitive,
        brush: userSource.brush,
      };
    }
    if ((mesh as THREE.Sprite).isSprite) {
      return { type: 'sprite' };
    }
    if ((mesh as THREE.Mesh).isMesh && (mesh as THREE.Mesh).geometry) {
      const geomType = (mesh as THREE.Mesh).geometry.type;
      if (geomType.includes('Box')) return { type: 'primitive', primitive: 'cube' };
      if (geomType.includes('Sphere')) return { type: 'primitive', primitive: 'sphere' };
      if (geomType.includes('Cylinder')) return { type: 'primitive', primitive: 'cylinder' };
      if (geomType.includes('Plane')) return { type: 'primitive', primitive: 'plane' };
    }
    return { type: 'primitive', primitive: 'cube' };
  }

  /* ==================================================================
   *  Brush placement
   * ================================================================== */

  private onBrushSelected(brushId: string | null): void {
    this.cancelPlacement();
    if (!brushId) {
      this.activeBrush = null;
      this.placementPhase = 'idle';
      this.brushPanel.setActiveBrush(null);
      return;
    }
    const brush = getBrushById(brushId);
    if (!brush) return;

    this.activeBrush = brush;
    this.placementPhase = 'position';
    this.brushPanel.setActiveBrush(brushId);

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
    this.renderer.scene.add(this.previewMesh);
  }

  private updatePlacementPreview(): void {
    if (this.placementPhase !== 'position' || !this.previewMesh) return;
    this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
    const point = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.placementPlane, point);
    if (this.grid.enabled) {
      point.x = Math.round(point.x / this.grid.positionSnap) * this.grid.positionSnap;
      point.y = Math.round(point.y / this.grid.positionSnap) * this.grid.positionSnap;
      point.z = Math.round(point.z / this.grid.positionSnap) * this.grid.positionSnap;
    }
    this.previewMesh.position.copy(point);
  }

  private confirmPlacement(): void {
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
      const body = this.physicsWorld.world.createRigidBody(bodyDesc);
      // Approximate collider from the geometry bounding box
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!;
      const halfW = (bb.max.x - bb.min.x) / 2;
      const halfH = (bb.max.y - bb.min.y) / 2;
      const halfD = (bb.max.z - bb.min.z) / 2;
      const colliderDesc = RAPIER.ColliderDesc.cuboid(halfW, halfH, halfD);
      const collider = this.physicsWorld.world.createCollider(colliderDesc, body);
      editorObj.body = body;
      editorObj.collider = collider;
    }

    // Push to undo stack
    this.history.push({
      execute: () => {
        this.addEditorObject(editorObj, this.renderer.scene);
        this.syncHierarchy();
        this.eventBus.emit('editor:objectAdded', { id: editorObj.id });
      },
      undo: () => {
        this.removeEditorObject(editorObj);
        this.syncHierarchy();
        this.eventBus.emit('editor:objectRemoved', { id: editorObj.id });
      },
    });

    // Select the new object, return to idle
    this.setSelection(editorObj);
    this.cancelPlacement();
  }

  private cancelPlacement(): void {
    if (this.previewMesh) {
      this.renderer.scene.remove(this.previewMesh);
      if (this.previewMesh.geometry) this.previewMesh.geometry.dispose();
      if (this.previewMesh.material) {
        (this.previewMesh.material as THREE.Material).dispose();
      }
    }
    this.previewMesh = null;
    this.placementPhase = 'idle';
    // Don't clear activeBrush here so brush bar keeps highlight if user wants another
  }

  /* ==================================================================
   *  Hierarchy operations
   * ================================================================== */

  private deleteById(id: string): void {
    const obj = this.editorObjects.find((o) => o.id === id);
    if (!obj) return;
    this.setSelection(obj);
    this.deleteSelection();
  }

  private duplicateById(id: string): void {
    const obj = this.editorObjects.find((o) => o.id === id);
    if (!obj) return;

    const clone = obj.mesh.clone(true);
    clone.position.addScalar(0.5); // Offset slightly
    const newObj: EditorObject = {
      ...structuredClone({
        id: '',
        name: obj.name + '_copy',
        source: obj.source,
        transform: {
          position: [clone.position.x, clone.position.y, clone.position.z] as [number, number, number],
          rotation: [clone.rotation.x, clone.rotation.y, clone.rotation.z] as [number, number, number],
          scale: [clone.scale.x, clone.scale.y, clone.scale.z] as [number, number, number],
        },
        parentId: obj.parentId ?? null,
        children: [],
        visible: obj.visible ?? true,
        locked: false,
        material: obj.material,
        brushParams: obj.brushParams,
        physicsType: obj.physicsType ?? 'static',
      }),
      id: clone.uuid,
      mesh: clone,
    };

    this.history.push({
      execute: () => {
        this.addEditorObject(newObj, this.renderer.scene);
        this.syncHierarchy();
        this.eventBus.emit('editor:objectAdded', { id: newObj.id });
      },
      undo: () => {
        this.removeEditorObject(newObj);
        this.syncHierarchy();
        this.eventBus.emit('editor:objectRemoved', { id: newObj.id });
      },
    });
    this.setSelection(newObj);
  }

  private renameById(id: string, name: string): void {
    const obj = this.editorObjects.find((o) => o.id === id);
    if (!obj) return;
    const oldName = obj.name;
    obj.name = name;
    obj.mesh.name = name;
    this.syncHierarchy();
    // No undo for rename — too trivial
    void oldName; // suppress unused
  }

  private toggleVisibleById(id: string): void {
    const obj = this.editorObjects.find((o) => o.id === id);
    if (!obj) return;
    const newVisible = !(obj.visible ?? true);
    obj.visible = newVisible;
    obj.mesh.visible = newVisible;
    this.syncHierarchy();
  }

  private toggleLockById(id: string): void {
    const obj = this.editorObjects.find((o) => o.id === id);
    if (!obj) return;
    obj.locked = !(obj.locked ?? false);
    // If locked and selected, deselect
    if (obj.locked && this.selected === obj) {
      this.setSelection(null);
    }
    this.syncHierarchy();
  }

  private reparentById(childId: string, newParentId: string | null): void {
    const child = this.editorObjects.find((o) => o.id === childId);
    if (!child) return;

    // Remove from old parent
    if (child.parentId) {
      const oldParent = this.editorObjects.find((o) => o.id === child.parentId);
      if (oldParent?.children) {
        oldParent.children = oldParent.children.filter((cid) => cid !== childId);
      }
    }

    // Set new parent
    child.parentId = newParentId ?? null;

    if (newParentId) {
      const newParent = this.editorObjects.find((o) => o.id === newParentId);
      if (newParent) {
        if (!newParent.children) newParent.children = [];
        newParent.children.push(childId);
        // Reparent in scene graph
        newParent.mesh.add(child.mesh);
      }
    } else {
      // Reparent to scene root
      this.renderer.scene.add(child.mesh);
    }

    this.syncHierarchy();
  }

  private groupObjects(ids: string[]): void {
    if (ids.length === 0) return;
    const objects = ids
      .map((id) => this.editorObjects.find((o) => o.id === id))
      .filter((o): o is EditorObject => o != null);
    if (objects.length === 0) return;

    const group = new THREE.Group();
    group.name = 'Group';
    this.renderer.scene.add(group);

    const groupObj: EditorObject = {
      id: group.uuid,
      name: 'Group',
      mesh: group,
      source: { type: 'primitive', primitive: 'group' },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      parentId: null,
      children: ids.slice(),
      visible: true,
      locked: false,
      physicsType: 'static',
    };

    // Move objects into group
    for (const obj of objects) {
      obj.parentId = group.uuid;
      group.add(obj.mesh);
    }

    this.editorObjects.push(groupObj);
    this.syncHierarchy();
    this.setSelection(groupObj);
  }

  private ungroupObject(groupId: string): void {
    const groupObj = this.editorObjects.find((o) => o.id === groupId);
    if (!groupObj || !groupObj.children || groupObj.children.length === 0) return;

    // Move children to scene root
    for (const childId of groupObj.children) {
      const child = this.editorObjects.find((o) => o.id === childId);
      if (child) {
        child.parentId = null;
        this.renderer.scene.add(child.mesh);
      }
    }

    // Remove group
    this.renderer.scene.remove(groupObj.mesh);
    this.editorObjects = this.editorObjects.filter((o) => o.id !== groupId);
    if (this.selected === groupObj) this.setSelection(null);
    this.syncHierarchy();
  }

  /* ==================================================================
   *  Material editing
   * ================================================================== */

  private applyMaterialChange(material: {
    color: string;
    roughness: number;
    metalness: number;
    emissive: string;
    emissiveIntensity: number;
    opacity: number;
  }): void {
    if (!this.selected) return;
    const meshObj = this.selected.mesh as THREE.Mesh;
    if (!meshObj.isMesh || !meshObj.material) return;

    const mat = meshObj.material as THREE.MeshStandardMaterial;
    mat.color.set(material.color);
    mat.roughness = material.roughness;
    mat.metalness = material.metalness;
    mat.emissive.set(material.emissive);
    mat.emissiveIntensity = material.emissiveIntensity;
    mat.opacity = material.opacity;
    mat.transparent = material.opacity < 1;
    mat.needsUpdate = true;

    // Update editor object material record
    this.selected.material = { ...material };
  }

  /* ==================================================================
   *  Physics type change
   * ================================================================== */

  private applyPhysicsTypeChange(id: string, type: 'static' | 'dynamic' | 'kinematic'): void {
    const obj = this.editorObjects.find((o) => o.id === id);
    if (!obj) return;

    // Remove old body/collider
    if (obj.body) {
      this.physicsWorld.removeBody(obj.body);
      obj.body = undefined;
      obj.collider = undefined;
    } else if (obj.collider) {
      this.physicsWorld.removeCollider(obj.collider);
      obj.collider = undefined;
    }

    // Create new body with correct type
    const pos = obj.mesh.position;
    const q = obj.mesh.quaternion;
    let bodyDesc: RAPIER.RigidBodyDesc;
    if (type === 'static') {
      bodyDesc = RAPIER.RigidBodyDesc.fixed();
    } else if (type === 'kinematic') {
      bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    } else {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic();
    }
    bodyDesc.setTranslation(pos.x, pos.y, pos.z);
    bodyDesc.setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w));

    const body = this.physicsWorld.world.createRigidBody(bodyDesc);

    // Recreate collider — approximate from bounding box
    const meshObj = obj.mesh as THREE.Mesh;
    let colliderDesc: RAPIER.ColliderDesc;
    if (meshObj.isMesh && meshObj.geometry) {
      meshObj.geometry.computeBoundingBox();
      const bb = meshObj.geometry.boundingBox!;
      const s = obj.mesh.scale;
      const halfW = ((bb.max.x - bb.min.x) / 2) * s.x;
      const halfH = ((bb.max.y - bb.min.y) / 2) * s.y;
      const halfD = ((bb.max.z - bb.min.z) / 2) * s.z;
      colliderDesc = RAPIER.ColliderDesc.cuboid(halfW, halfH, halfD);
    } else {
      colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
    }

    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);
    obj.body = body;
    obj.collider = collider;
    obj.physicsType = type;
  }

  /* ==================================================================
   *  Inspector transform
   * ================================================================== */

  private applyInspectorTransform(transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }): void {
    if (!this.selected) return;
    this.selected.mesh.position.set(transform.position[0], transform.position[1], transform.position[2]);
    this.selected.mesh.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
    this.selected.mesh.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
    this.updateEditorObjectTransform(this.selected);
    this.applyPhysicsTransform(this.selected);
  }

  /* ==================================================================
   *  Gizmo callbacks
   * ================================================================== */

  private onDragStateChanged(dragging: boolean): void {
    if (dragging && this.selected) {
      this.dragStartTransform = {
        position: this.selected.mesh.position.clone(),
        rotation: this.selected.mesh.rotation.clone(),
        scale: this.selected.mesh.scale.clone(),
      };
    } else if (!dragging && this.selected && this.dragStartTransform) {
      const target = this.selected;
      const before = this.dragStartTransform;
      const after = {
        position: target.mesh.position.clone(),
        rotation: target.mesh.rotation.clone(),
        scale: target.mesh.scale.clone(),
      };
      this.history.push({
        execute: () => this.applyTransform(target, after),
        undo: () => this.applyTransform(target, before),
      });
      this.dragStartTransform = null;
    }
  }

  private onGizmoObjectChanged(): void {
    if (!this.selected) return;
    this.updateEditorObjectTransform(this.selected);
    if (this.grid.enabled) {
      this.applySnapToSelection();
    }
    this.applyPhysicsTransform(this.selected);
    this.inspectorPanel.setSelection(this.selected);
  }

  /* ==================================================================
   *  Snap
   * ================================================================== */

  private toggleSnap(): void {
    this.grid.toggleSnap();
    if (this.grid.enabled) {
      this.gizmo.setSnaps(this.grid.positionSnap, this.grid.rotationSnap, this.grid.scaleSnap);
    } else {
      this.gizmo.setSnaps(null, null, null);
    }
    this.toolbarPanel.setSnapActive(this.grid.enabled);
  }

  private applySnapToSelection(): void {
    if (!this.selected) return;
    const snap = this.grid.positionSnap;
    const pos = this.selected.mesh.position;
    pos.set(
      Math.round(pos.x / snap) * snap,
      Math.round(pos.y / snap) * snap,
      Math.round(pos.z / snap) * snap,
    );
  }

  /* ==================================================================
   *  Transform helpers
   * ================================================================== */

  private updateEditorObjectTransform(obj: EditorObject): void {
    obj.transform.position = [obj.mesh.position.x, obj.mesh.position.y, obj.mesh.position.z];
    obj.transform.rotation = [obj.mesh.rotation.x, obj.mesh.rotation.y, obj.mesh.rotation.z];
    obj.transform.scale = [obj.mesh.scale.x, obj.mesh.scale.y, obj.mesh.scale.z];
  }

  private applyPhysicsTransform(obj: EditorObject): void {
    if (!obj.body) return;
    const pos = obj.mesh.position;
    obj.body.setTranslation(new RAPIER.Vector3(pos.x, pos.y, pos.z), true);
    const q = obj.mesh.quaternion;
    obj.body.setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w), true);
  }

  private applyTransform(
    obj: EditorObject,
    transform: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 },
  ): void {
    obj.mesh.position.copy(transform.position);
    obj.mesh.rotation.copy(transform.rotation);
    obj.mesh.scale.copy(transform.scale);
    this.updateEditorObjectTransform(obj);
    this.applyPhysicsTransform(obj);
    this.inspectorPanel.setSelection(obj);
  }

  /* ==================================================================
   *  Editor object add / remove
   * ================================================================== */

  private addEditorObject(obj: EditorObject, parent?: THREE.Object3D): void {
    const targetParent = parent ?? this.renderer.scene;
    if (!obj.mesh.parent) {
      targetParent.add(obj.mesh);
    }
    if (!this.editorObjects.includes(obj)) {
      this.editorObjects.push(obj);
    }
    obj.body?.setEnabled(true);
    obj.collider?.setEnabled(true);
  }

  private removeEditorObject(obj: EditorObject): void {
    const parent = obj.mesh.parent;
    if (parent) {
      parent.remove(obj.mesh);
    }
    obj.body?.setEnabled(false);
    obj.collider?.setEnabled(false);
    this.editorObjects = this.editorObjects.filter((entry) => entry !== obj);
    if (this.selected === obj) {
      this.setSelection(null);
    }
  }

  private deleteSelection(): void {
    if (!this.selected) return;
    const target = this.selected;
    const parent = target.mesh.parent ?? this.renderer.scene;
    this.history.push({
      execute: () => {
        this.removeEditorObject(target);
        this.syncHierarchy();
        this.eventBus.emit('editor:objectRemoved', { id: target.id });
      },
      undo: () => {
        this.addEditorObject(target, parent);
        this.syncHierarchy();
        this.eventBus.emit('editor:objectAdded', { id: target.id });
      },
    });
  }

  /* ==================================================================
   *  Grid height (raycast downward to find floor)
   * ================================================================== */

  private updateGridHeight(): void {
    if (!this.grid.isVisible()) return;
    const camPos = this.renderer.camera.position;
    const originY = camPos.y + 0.5;
    const origin = new RAPIER.Vector3(camPos.x, originY, camPos.z);
    const dir = new RAPIER.Vector3(0, -1, 0);
    let exclude: RAPIER.Collider | undefined = undefined;
    for (let i = 0; i < 3; i += 1) {
      const hit = this.physicsWorld.castRay(
        origin,
        dir,
        400,
        exclude,
        undefined,
        (c) => !c.isSensor(),
      );
      if (!hit) return;
      const n = this.physicsWorld.castRayAndGetNormal(origin, dir, hit.timeOfImpact + 0.001, exclude);
      if (n?.normal?.y != null && n.normal.y > 0.25) {
        const groundY = originY - hit.timeOfImpact;
        this.grid.grid.position.y = groundY + 0.01;
        return;
      }
      exclude = hit.collider;
    }
  }

  /* ==================================================================
   *  Panel sync
   * ================================================================== */

  private syncHierarchy(): void {
    this.hierarchyPanel.setObjects(this.editorObjects);
  }

  /* ==================================================================
   *  Save / Load
   * ================================================================== */

  private async saveLevel(): Promise<void> {
    const data = LevelSerializer.serialize('custom', this.editorObjects);
    LevelSerializer.download(data);
    this.eventBus.emit('editor:saved', { name: data.name });
  }

  private async loadLevel(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const data = await LevelSerializer.loadFromFile(file);
      if (!data) return;
      void this.applyLoadedLevel(data);
    });
    input.click();
  }

  private async applyLoadedLevel(data: LevelData): Promise<void> {
    // Remove editor-spawned objects
    for (const obj of this.editorObjects) {
      if (obj.mesh.userData.editorSource) {
        this.renderer.scene.remove(obj.mesh);
        if (obj.body) {
          this.physicsWorld.removeBody(obj.body);
        } else if (obj.collider) {
          this.physicsWorld.removeCollider(obj.collider);
        }
      }
    }
    this.editorObjects = this.editorObjects.filter((obj) => !obj.mesh.userData.editorSource);

    // Spawn loaded objects (v1 format — Task 9 will update this for v2)
    for (const entry of data.objects) {
      this.spawnSerializedObject(entry);
    }

    this.syncHierarchy();
    this.eventBus.emit('editor:loaded', { name: data.name });
  }

  private spawnSerializedObject(entry: LevelData['objects'][number]): void {
    // Simplified v1 spawn — creates basic primitives from serialized data
    let obj: THREE.Object3D | null = null;
    if (entry.source.type === 'primitive' && entry.source.primitive) {
      let geometry: THREE.BufferGeometry;
      const p = entry.source.primitive;
      if (p === 'sphere') geometry = new THREE.SphereGeometry(0.5, 16, 16);
      else if (p === 'cylinder') geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
      else if (p === 'capsule') geometry = new THREE.CapsuleGeometry(0.4, 0.6, 6, 12);
      else if (p === 'plane') geometry = new THREE.PlaneGeometry(1, 1);
      else geometry = new THREE.BoxGeometry(1, 1, 1);
      obj = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb0c4de, roughness: 0.6 }));
    } else if (entry.source.type === 'brush' && entry.source.brush) {
      const brush = getBrushById(entry.source.brush);
      if (brush) {
        const defaultParams = {
          anchor: new THREE.Vector3(0, 0, 0),
          current: new THREE.Vector3(1, 0, 1),
          normal: new THREE.Vector3(0, 1, 0),
          height: 1,
        };
        const geometry = brush.buildPreviewGeometry(defaultParams);
        const material = brush.getDefaultMaterial();
        obj = new THREE.Mesh(geometry, material);
      }
    }
    if (!obj) return;

    obj.position.set(entry.transform.position[0], entry.transform.position[1], entry.transform.position[2]);
    obj.rotation.set(entry.transform.rotation[0], entry.transform.rotation[1], entry.transform.rotation[2]);
    obj.scale.set(entry.transform.scale[0], entry.transform.scale[1], entry.transform.scale[2]);
    obj.userData.editorSource = entry.source;

    const editorObj = this.buildEditorObject(obj);
    editorObj.name = entry.name;
    editorObj.source = entry.source;

    // Create physics body if applicable
    if (entry.physics) {
      const pos = obj.position;
      let bodyDesc: RAPIER.RigidBodyDesc;
      if (entry.physics.type === 'static') {
        bodyDesc = RAPIER.RigidBodyDesc.fixed();
      } else if (entry.physics.type === 'kinematic') {
        bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
      } else {
        bodyDesc = RAPIER.RigidBodyDesc.dynamic();
      }
      bodyDesc.setTranslation(pos.x, pos.y, pos.z);
      const body = this.physicsWorld.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
      const collider = this.physicsWorld.world.createCollider(colliderDesc, body);
      editorObj.body = body;
      editorObj.collider = collider;
      editorObj.physicsType = entry.physics.type as 'static' | 'dynamic' | 'kinematic';
    }

    this.addEditorObject(editorObj, this.renderer.scene);
  }
}
