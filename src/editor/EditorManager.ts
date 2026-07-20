import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type { GameLoop } from "@core/GameLoop";
import RAPIER from "@dimforge/rapier3d-compat";
import { exitPointerLockIfSupported } from "@input/pointerLock";
import type { InteractionManager } from "@interaction/InteractionManager";
import type { AddLevelObjectOptions, LevelManager, RemovedLevelObjectTracking } from "@level/LevelManager";
import { LevelSaveStore } from "@level/LevelSaveStore";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type { RendererManager } from "@renderer/RendererManager";
import * as THREE from "three";
import { BRUSH_REGISTRY, getBrushById } from "./brushes/index";
import { CommandHistory } from "./CommandHistory";
import {
  buildDeleteSubtreeCommand,
  buildGroupCommand,
  buildLockCommand,
  buildMaterialCommand,
  buildRenameCommand,
  buildReparentCommand,
  buildSetPhysicsTypeCommand,
  buildSetTransformCommand,
  buildUngroupCommand,
  buildVisibilityCommand,
  createOwnedCreationCommand,
  type EditorHierarchyState,
  type EditorHierarchyTrackingState,
  type EditorMaterialState,
  type EditorPhysicsResourceRecipe,
  type EditorPhysicsState,
  type EditorPhysicsType,
  type EditorSerializedMaterialState,
  type EditorStructuralHierarchyState,
  type EditorSubtreeState,
  type EditorTransformState,
} from "./EditorCommands";
import { EditorDocument, type EditorSubtreeSnapshot } from "./EditorDocument";
import {
  type EditorDocumentSnapshot,
  EditorDocumentState,
  normalizeEditorDocumentName,
  shouldProtectEditorUnload,
} from "./EditorDocumentState";
import { validateEditorLevelData } from "./EditorLevelValidator";
import { type EditorLoadToken, EditorLoadTransaction } from "./EditorLoadTransaction";
import type { EditorObject } from "./EditorObject";
import {
  effectiveScaleChanged,
  getObjectColliderBounds,
  getObjectWorldPhysicsPose,
  type ObjectWorldPhysicsPose,
  replacePhysicsResourcesAtomically,
  syncPhysicsSubtreeAtomically,
  validateObjectPhysicsTransform,
  validatePhysicsAttachment,
  validateWorldMatrixAttachment,
} from "./EditorPhysicsSync";
import { FreeCamera, type FreeCameraPose } from "./FreeCamera";
import { type LevelData, LevelSerializer } from "./LevelSerializer";
import { BrushPanel } from "./panels/BrushPanel";
import { HierarchyPanel } from "./panels/HierarchyPanel";
import { InspectorPanel } from "./panels/InspectorPanel";
import { ToolbarPanel } from "./panels/ToolbarPanel";
import { SnapGrid } from "./SnapGrid";
import { TransformGizmo } from "./TransformGizmo";
import { BrushPlacementTool, buildColliderDesc } from "./tools/BrushPlacementTool";
import type { EditorTool, EditorToolContext } from "./tools/EditorTool";
import { GLBPlacementTool } from "./tools/GLBPlacementTool";
import { SelectionTool } from "./tools/SelectionTool";

type EditorLoadResult = "completed" | "failed" | "superseded";
type EditorTransformSnapshot = EditorTransformState;
const neverRebuildCollider = (_entry: EditorObject, _nextPose: ObjectWorldPhysicsPose): boolean => false;

export function handleEditorHistoryShortcut(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "shiftKey" | "preventDefault">,
  undo: () => void,
  redo: () => void,
): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  if (event.code === "KeyY" || (event.code === "KeyZ" && event.shiftKey)) {
    redo();
    event.preventDefault();
    return true;
  }
  if (event.code === "KeyZ") {
    undo();
    event.preventDefault();
    return true;
  }
  return false;
}

export interface EditorWorkspaceObjectSnapshot {
  id: string;
  name: string;
  meshUuid: string;
  parentId: string | null;
  children: string[];
  visible: boolean;
  locked: boolean;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  source: EditorObject["source"];
  material?: EditorObject["material"];
  physicsType: "static" | "dynamic" | "kinematic";
}

export interface EditorWorkspaceSnapshot {
  selectedId: string | null;
  objects: EditorWorkspaceObjectSnapshot[];
}

type EditorDeleteSubtreeNodeTracking = {
  object: EditorObject;
  wasLevelTracked: boolean;
  tracking: RemovedLevelObjectTracking;
  retainedPhysics: NonNullable<RemovedLevelObjectTracking["physics"]> | undefined;
};
type EditorDeleteSubtreeTransaction = {
  snapshot: EditorSubtreeSnapshot;
  nodes: readonly EditorDeleteSubtreeNodeTracking[];
  selectedWithinSubtree: EditorObject | null;
  finalized: boolean;
};
type EditorGizmoDragSession = {
  objectId: string;
  object: EditorObject;
  before: EditorTransformSnapshot;
};

export class EditorManager {
  private active = false;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private selectionHelper: THREE.BoxHelper | null = null;
  private gizmoDragSession: EditorGizmoDragSession | null = null;
  private inspectorEditStartTransform: EditorTransformSnapshot | null = null;
  private inspectorEditObjectId: string | null = null;
  private materialEditSession: { objectId: string; before: EditorMaterialState } | null = null;

  /* ---- Data model ---- */
  private document: EditorDocument;
  private documentState: EditorDocumentState;

  /* ---- Play-test state ---- */
  private playTestActive = false;
  private restoringPlayTest = false;
  private playTestSnapshot: string | null = null;
  private playTestStopButton: HTMLElement | null = null;
  private unloadProtectionEnabled = false;
  private loadTransaction = new EditorLoadTransaction();

  /* ---- Subsystems ---- */
  private gizmo: TransformGizmo;
  private grid: SnapGrid;
  private gridWasVisible = true;
  private freeCamera: FreeCamera;
  private editorCameraPose: FreeCameraPose | null = null;
  private documentNeedsRebuild = true;
  private history: CommandHistory;
  private deleteSubtreeTransactions = new WeakMap<EditorSubtreeState, EditorDeleteSubtreeTransaction>();

  /* ---- Tools ---- */
  private tools = new Map<string, EditorTool>();
  private activeTool: EditorTool;
  private selectionTool: SelectionTool;
  private brushPlacementTool: BrushPlacementTool;
  private glbPlacementTool: GLBPlacementTool;

  /* ---- Panels ---- */
  private toolbarPanel: ToolbarPanel;
  private brushPanel: BrushPanel;
  private hierarchyPanel: HierarchyPanel;
  private inspectorPanel: InspectorPanel;
  private panels: { build(): void; show(): void; hide(): void; getElement(): HTMLDivElement; dispose(): void }[];
  private unsubs: (() => void)[] = [];

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

    this.document = new EditorDocument(this.renderer.scene, this.physicsWorld);
    this.documentState = new EditorDocumentState((state) => this.onDocumentStateChanged(state));
    this.history = new CommandHistory(
      () => this.markDirty(),
      () => this.loadTransaction.canMutate,
      () => this.showLoadBusyFeedback(),
    );
    this.freeCamera = new FreeCamera(this.renderer.camera, this.renderer.canvas);
    this.grid = new SnapGrid(this.renderer.scene);

    /* ---- Panels ---- */
    this.toolbarPanel = new ToolbarPanel({
      onSave: () => {
        if (this.guardDocumentMutation()) void this.saveLevel();
      },
      onLoad: () => this.loadLevel(),
      onImportGLB: () => this.onImportGLB(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onToggleSnap: () => this.toggleSnap(),
      onToggleGrid: () => {
        this.grid.toggleGrid();
        this.toolbarPanel.setGridActive(this.grid.isVisible());
      },
      onSetMode: (mode) => this.setTransformMode(mode),
      onPlayTest: () => this.startPlayTest(),
    });

    this.brushPanel = new BrushPanel((brushId) => {
      if (this.guardDocumentMutation()) this.onBrushSelected(brushId);
    });

    this.hierarchyPanel = new HierarchyPanel({
      onSelect: (id) => this.selectById(id),
      onDelete: (id) => this.deleteById(id),
      onDuplicate: (id) => this.duplicateById(id),
      onRename: (id, name) => this.renameById(id, name),
      onToggleVisible: (id) => this.toggleVisibilityById(id),
      onToggleLock: (id) => this.toggleLockById(id),
      onReparent: (childId, newParentId) => this.reparentById(childId, newParentId),
      onGroup: (ids) => this.groupObjects(ids),
      onUngroup: (groupId) => this.ungroupObject(groupId),
    });

    this.inspectorPanel = new InspectorPanel({
      onTransformChange: (_id, t, phase) => this.applyInspectorTransform(t, phase),
      onMaterialChange: (id, m, phase) => this.applyMaterialChange(id, m, phase),
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

    /* ---- Tools ---- */
    this.selectionTool = new SelectionTool();
    this.brushPlacementTool = new BrushPlacementTool({
      onFinished: () => this.switchTool("selection"),
      onBrushChanged: (brushId) => this.brushPanel.setActiveBrush(brushId),
      onError: (message) => this.toolbarPanel.showSaveError(message),
    });
    this.glbPlacementTool = new GLBPlacementTool({
      levelManager: this.levelManager,
      onFinished: () => this.switchTool("selection"),
      onImported: () => this.toolbarPanel.showSessionImportNotice(),
      onError: (message) => this.toolbarPanel.showSaveError(message),
      getLifecycleGeneration: () => this.loadTransaction.generation,
    });
    this.tools.set(this.selectionTool.id, this.selectionTool);
    this.tools.set(this.brushPlacementTool.id, this.brushPlacementTool);
    this.tools.set(this.glbPlacementTool.id, this.glbPlacementTool);
    this.activeTool = this.selectionTool;

    this.documentState.markClean(normalizeEditorDocumentName(this.levelManager.getCurrentLevelIdentity()));

    this.unsubs.push(this.eventBus.on("editor:toggle", () => this.toggle()));
    this.unsubs.push(this.eventBus.on("level:willUnload", () => this.prepareForExternalUnload()));
    this.unsubs.push(this.eventBus.on("level:loaded", ({ name }) => this.handleLevelLoaded(name)));

    // Hide editor panels + play-test stop button when menu overlay opens
    this.unsubs.push(
      this.eventBus.on("menu:opened", () => {
        if (this.active) {
          for (const panel of this.panels) panel.hide();
        }
        if (this.playTestStopButton) {
          this.playTestStopButton.style.display = "none";
        }
      }),
    );
    this.unsubs.push(
      this.eventBus.on("menu:closed", () => {
        if (this.active) {
          for (const panel of this.panels) panel.show();
        }
        if (this.playTestStopButton) {
          this.playTestStopButton.style.display = "";
        }
      }),
    );

    // Global Ctrl+P handler to stop play-test (persists while play-testing)
    const onGlobalKeyDown = (e: KeyboardEvent): void => {
      if (!this.playTestActive) return;
      const cmdKey = navigator.platform.toUpperCase().includes("MAC") ? e.metaKey : e.ctrlKey;
      if (e.code === "KeyP" && cmdKey) {
        e.preventDefault();
        void this.stopPlayTest();
      }
    };
    window.addEventListener("keydown", onGlobalKeyDown);
    this.unsubs.push(() => window.removeEventListener("keydown", onGlobalKeyDown));
  }

  private handleLevelLoaded(name: string): void {
    this.loadTransaction.invalidate();
    this.glbPlacementTool.cancelPendingImport(this.buildToolContext());
    this.restoringPlayTest = false;
    this.editorCameraPose = null;
    this.documentNeedsRebuild = true;
    this.toolbarPanel.setLoadBusy(false);
    this.history.clear();
    const identity = this.levelManager.getCurrentLevelIdentity();
    this.documentState.markClean(normalizeEditorDocumentName(identity ?? { name, origin: "system", kind: "asset" }));
  }

  /* ==================================================================
   *  Public API
   * ================================================================== */

  isActive(): boolean {
    return this.active;
  }

  isPlayTesting(): boolean {
    return this.playTestActive;
  }

  getObjectCount(): number {
    return this.document.objects.length;
  }

  isDirty(): boolean {
    return this.documentState.value.dirty;
  }

  getDocumentState(): Readonly<EditorDocumentSnapshot> {
    return this.documentState.value;
  }

  getEditorSnapshot(): EditorWorkspaceSnapshot {
    return {
      selectedId: this.document.selected?.id ?? null,
      objects: this.document.objects.map((object) => ({
        id: object.id,
        name: object.name,
        meshUuid: object.mesh.uuid,
        parentId: object.parentId ?? null,
        children: [...(object.children ?? [])],
        visible: object.visible ?? true,
        locked: object.locked ?? false,
        transform: {
          position: [...object.transform.position],
          rotation: [...object.transform.rotation],
          scale: [...object.transform.scale],
        },
        source: { ...object.source },
        material: object.material ? { ...object.material } : undefined,
        physicsType: object.physicsType ?? "static",
      })),
    };
  }

  setEditorCameraPose(pose: FreeCameraPose): void {
    this.freeCamera.restorePose(pose);
    this.editorCameraPose = this.freeCamera.capturePose();
  }

  shouldWarnBeforeUnload(): boolean {
    return shouldProtectEditorUnload(
      this.documentState.value.dirty,
      this.active,
      this.playTestActive,
      this.restoringPlayTest,
    );
  }

  undo(): void {
    if (!this.active || this.playTestActive) return;
    this.history.undo();
  }

  redo(): void {
    if (!this.active || this.playTestActive) return;
    this.history.redo();
  }

  update(dt: number): void {
    if (!this.active) return;
    this.freeCamera.update(dt);
    this.updateGridHeight();
    this.activeTool.update?.(this.buildToolContext(), dt);
    this.selectionHelper?.update();
  }

  dispose(): void {
    this.cancelPendingEdit();
    this.history.clear();
    this.loadTransaction.invalidate();
    this.glbPlacementTool.cancelPendingImport(this.buildToolContext());
    this.abortPlayTest();
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    for (const panel of this.panels) panel.dispose();
    this.gizmo.dispose(this.renderer.scene);
    this.grid.dispose(this.renderer.scene);
    this.clearSelectionHelper();
  }

  toggle(): void {
    if (this.playTestActive) return; // Don't toggle while play-testing
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
    if (document.getElementById("ke-editor-styles")) return;
    const link = document.createElement("link");
    link.id = "ke-editor-styles";
    link.rel = "stylesheet";
    link.href = new URL("./styles/editor.css", import.meta.url).href;
    document.head.appendChild(link);
  }

  /* ==================================================================
   *  Tool management
   * ================================================================== */

  private buildToolContext(): EditorToolContext {
    return {
      scene: this.renderer.scene,
      physicsWorld: this.physicsWorld,
      camera: this.renderer.camera,
      canvas: this.renderer.canvas,
      gizmo: this.gizmo,
      snapGrid: this.grid,
      history: this.history,
      eventBus: this.eventBus,
      raycaster: this.raycaster,
      mouse: this.mouse,
      editorObjects: this.document.objects,
      selected: this.document.selected,
      setSelection: (obj) => this.setSelection(obj),
      addEditorObject: (obj, parent) => this.addTrackedEditorObject(obj, parent),
      rollbackEditorObject: (obj) => this.rollbackEditorObject(obj),
      removeEditorObject: (id) => {
        const obj = this.document.findById(id);
        if (obj) this.removeTrackedEditorObject(obj);
      },
      syncHierarchy: () => this.syncHierarchy(),
      syncInspector: () => {
        if (this.document.selected) this.inspectorPanel.setSelection(this.document.selected);
      },
    };
  }

  private createLevelObjectTracking(
    obj: EditorObject,
    replacement?: Readonly<{
      type: EditorPhysicsType;
      body: RAPIER.RigidBody | undefined;
      collider: RAPIER.Collider | undefined;
    }>,
  ): AddLevelObjectOptions {
    const body = replacement ? replacement.body : obj.body;
    const collider = replacement ? replacement.collider : obj.collider;
    const physicsType = replacement ? replacement.type : obj.physicsType;
    const tracking: AddLevelObjectOptions = {};
    if (body || collider) {
      tracking.physics = { body, collider };
    } else if (!replacement) {
      tracking.physics = this.levelManager.getLevelObjectTracking(obj.mesh).physics;
    }
    if (physicsType === "dynamic" && body) {
      obj.mesh.updateWorldMatrix(true, false);
      const worldPos = obj.mesh.getWorldPosition(new THREE.Vector3());
      const worldQuat = obj.mesh.getWorldQuaternion(new THREE.Quaternion());
      tracking.dynamicBody = {
        mesh: obj.mesh,
        body,
        prevPos: worldPos.clone(),
        currPos: worldPos.clone(),
        prevQuat: worldQuat.clone(),
        currQuat: worldQuat.clone(),
        hasPose: false,
      };
    }
    return tracking;
  }

  private addTrackedEditorObject(obj: EditorObject, parent?: THREE.Object3D): void {
    this.document.addObject(obj, parent);
    this.levelManager.addLevelObject(obj.mesh, this.createLevelObjectTracking(obj));
  }

  private removeTrackedEditorObject(obj: EditorObject): RemovedLevelObjectTracking {
    const tracking = this.levelManager.removeLevelObject(obj.mesh);
    tracking.physics?.body?.setEnabled(false);
    tracking.physics?.collider?.setEnabled(false);
    this.document.removeObject(obj);
    return tracking;
  }

  private getDeleteSubtreeTransaction(state: EditorSubtreeState): EditorDeleteSubtreeTransaction | null {
    this.deleteSubtreeTransactions ??= new WeakMap();
    const existing = this.deleteSubtreeTransactions.get(state);
    if (existing) return existing;

    const snapshot = this.document.captureSubtree(state.rootId);
    if (!snapshot) return null;
    const levelObjects = new Set(this.levelManager.getLevelObjects());
    const nodes = snapshot.nodes.map(({ object }) => {
      const tracking = this.levelManager.getLevelObjectTracking(object.mesh);
      return Object.freeze({
        object,
        wasLevelTracked: levelObjects.has(object.mesh),
        tracking,
        retainedPhysics:
          tracking.physics ??
          (object.body || object.collider ? { body: object.body, collider: object.collider } : undefined),
      });
    });
    const subtreeIds = new Set(snapshot.nodes.map(({ object }) => object.id));
    const transaction: EditorDeleteSubtreeTransaction = {
      snapshot,
      nodes: Object.freeze(nodes),
      selectedWithinSubtree:
        this.document.selected && subtreeIds.has(this.document.selected.id) ? this.document.selected : null,
      finalized: false,
    };
    this.deleteSubtreeTransactions.set(state, transaction);
    return transaction;
  }

  private setRetainedPhysicsEnabled(node: EditorDeleteSubtreeNodeTracking, enabled: boolean): void {
    node.retainedPhysics?.body?.setEnabled(enabled);
    node.retainedPhysics?.collider?.setEnabled(enabled);
  }

  private restoreDeletedLevelTracking(transaction: EditorDeleteSubtreeTransaction): void {
    for (const node of transaction.nodes) {
      if (node.wasLevelTracked) this.levelManager.addLevelObject(node.object.mesh, node.tracking);
      else this.setRetainedPhysicsEnabled(node, true);
    }
  }

  private detachDeletedLevelTracking(transaction: EditorDeleteSubtreeTransaction): void {
    for (const node of [...transaction.nodes].reverse()) {
      if (node.wasLevelTracked) this.levelManager.removeLevelObject(node.object.mesh);
      this.setRetainedPhysicsEnabled(node, false);
    }
  }

  detachSubtree(state: EditorSubtreeState): boolean {
    const transaction = this.getDeleteSubtreeTransaction(state);
    if (!transaction || transaction.finalized) return false;
    const selectedBefore = this.document.selected;
    const inspectorEditBefore = this.inspectorEditStartTransform;
    const inspectorObjectBefore = this.inspectorEditObjectId;
    if (transaction.selectedWithinSubtree === selectedBefore) this.document.selected = null;
    this.clearInspectorEditSession();

    try {
      this.detachDeletedLevelTracking(transaction);
      if (!this.document.removeSubtree(transaction.snapshot)) {
        throw new Error("The editor document rejected subtree removal.");
      }
      return true;
    } catch (error) {
      try {
        if (!this.document.findById(transaction.snapshot.root.id)) {
          this.document.restoreSubtree(transaction.snapshot);
        }
        this.restoreDeletedLevelTracking(transaction);
      } catch (rollbackError) {
        console.error("[Editor] Delete rollback failed:", rollbackError);
      }
      this.document.selected = selectedBefore;
      this.inspectorEditStartTransform = inspectorEditBefore;
      this.inspectorEditObjectId = inspectorObjectBefore;
      console.error("[Editor] Subtree delete failed:", error);
      return false;
    }
  }

  restoreSubtree(state: EditorSubtreeState): boolean {
    this.deleteSubtreeTransactions ??= new WeakMap();
    const transaction = this.deleteSubtreeTransactions.get(state);
    if (!transaction || transaction.finalized) return false;
    const selectedBefore = this.document.selected;

    if (!this.document.restoreSubtree(transaction.snapshot)) return false;
    try {
      this.restoreDeletedLevelTracking(transaction);
      const synced = this.syncPhysicsSubtree(transaction.snapshot.root, neverRebuildCollider);
      if (!synced.ok) throw new Error(synced.reason);
      if (transaction.selectedWithinSubtree) this.document.selected = transaction.selectedWithinSubtree;
      return true;
    } catch (error) {
      try {
        this.detachDeletedLevelTracking(transaction);
        this.document.removeSubtree(transaction.snapshot);
      } catch (rollbackError) {
        console.error("[Editor] Restore rollback failed:", rollbackError);
      }
      this.document.selected = selectedBefore;
      console.error("[Editor] Deleted subtree restore failed:", error);
      return false;
    }
  }

  finalizeDetachedSubtree(state: EditorSubtreeState): void {
    this.deleteSubtreeTransactions ??= new WeakMap();
    const transaction = this.deleteSubtreeTransactions.get(state);
    if (!transaction || transaction.finalized) return;
    transaction.finalized = true;

    let firstFailure: unknown;
    for (const node of transaction.nodes) {
      try {
        if (node.wasLevelTracked) {
          this.levelManager.removeLevelObject(node.object.mesh, { removePhysics: true });
        } else if (node.retainedPhysics?.body) {
          this.physicsWorld.removeBody(node.retainedPhysics.body);
        } else if (node.retainedPhysics?.collider) {
          this.physicsWorld.removeCollider(node.retainedPhysics.collider);
        }
      } catch (error) {
        firstFailure ??= error;
      }
    }
    this.deleteSubtreeTransactions.delete(state);
    if (firstFailure) throw firstFailure;
  }

  afterMutation(notice: unknown): void {
    const mutation = notice as { type?: string; phase?: string; rootId?: string };
    if (mutation.type !== "subtree-delete" || !mutation.rootId) return;
    this.syncHierarchy();
    this.setSelection(this.document.selected);
    this.eventBus.emit(mutation.phase === "restored" ? "editor:objectAdded" : "editor:objectRemoved", {
      id: mutation.rootId,
    });
  }

  reportFailure(reason: string): void {
    this.showPhysicsMutationError(reason);
  }

  private rollbackEditorObject(obj: EditorObject): void {
    const wasSelected = this.document.selected === obj;
    const physics = this.levelManager.getLevelObjectTracking(obj.mesh).physics;
    const body = obj.body;
    const collider = obj.collider;
    this.levelManager.removeLevelObject(obj.mesh, { removePhysics: true });
    if (!physics) {
      if (body) this.physicsWorld.removeBody(body);
      else if (collider) this.physicsWorld.removeCollider(collider);
    }
    obj.body = undefined;
    obj.collider = undefined;
    this.document.removeObject(obj);
    if (wasSelected) {
      try {
        this.setSelection(null);
      } catch (error) {
        console.error("[Editor] Selection cleanup failed during rollback:", error);
        this.document.selected = null;
        this.gizmo.attach(null);
      }
    }
  }

  private switchTool(toolId: string): void {
    const tool = this.tools.get(toolId);
    if (!tool || tool === this.activeTool) return;
    const ctx = this.buildToolContext();
    this.activeTool.deactivate?.(ctx);
    this.activeTool = tool;
    this.activeTool.activate?.(ctx);
  }

  /* ==================================================================
   *  Enter / Exit
   * ================================================================== */

  private enter(): void {
    this.active = true;
    this.gameLoop.setSimulationEnabled(false);
    this.interactionManager.setEnabled(false);
    this.player.setActive(false);
    this.player.setEnabled(false); // Hide player mesh + disable physics
    // Ensure cursor is free and visible in editor mode
    exitPointerLockIfSupported();
    this.renderer.canvas.style.cursor = "default";
    this.eventBus.emit("editor:opened", undefined);
    if (this.editorCameraPose) {
      this.freeCamera.restorePose(this.editorCameraPose);
    } else {
      this.editorCameraPose = this.freeCamera.capturePose();
    }
    this.freeCamera.enable();
    this.grid.setVisible(this.gridWasVisible);
    for (const panel of this.panels) panel.show();
    if (this.documentNeedsRebuild) this.buildEditorObjects();
    this.syncHierarchy();
    this.syncToolbarState();
    this.bindEditorInput();
    this.renderer.canvas.addEventListener("dragover", this.onDragOver);
    this.renderer.canvas.addEventListener("drop", this.onDrop);
    this.syncUnloadProtection();
  }

  private exit(): void {
    this.editorCameraPose = this.freeCamera.capturePose();
    this.active = false;
    this.gameLoop.setSimulationEnabled(true);
    this.interactionManager.setEnabled(true);
    this.player.setActive(true);
    this.player.setEnabled(true); // Show player mesh + enable physics
    this.renderer.canvas.style.cursor = "";
    this.gridWasVisible = this.grid.isVisible();
    this.grid.setVisible(false);
    this.eventBus.emit("editor:closed", undefined);
    this.freeCamera.disable();
    for (const panel of this.panels) panel.hide();
    this.activeTool.deactivate?.(this.buildToolContext());
    this.switchTool("selection");
    this.setSelection(null);
    this.renderer.canvas.removeEventListener("dragover", this.onDragOver);
    this.renderer.canvas.removeEventListener("drop", this.onDrop);
    this.unbindEditorInput();
    this.gizmo.attach(null);
    this.syncUnloadProtection();
  }

  /* ==================================================================
   *  Play-test mode
   * ================================================================== */

  startPlayTest(): void {
    if (!this.active || this.playTestActive || !this.guardDocumentMutation()) return;
    if (!this.commitPendingEdit()) return;

    // Undo entries capture mesh/parent references that the play-test
    // restore (applyLoadedLevel) tears down and rebuilds; running them
    // afterwards re-parents meshes onto detached nodes. The play-test
    // boundary intentionally clears history.
    this.history.clear();

    // Sync all EditorObject transforms from live mesh state before serializing,
    // so the snapshot captures the actual current transforms (not stale data).
    for (const obj of this.document.objects) {
      this.updateEditorObjectTransform(obj);
    }

    // Serialize current level state
    const data = LevelSerializer.serialize("__playtest__", this.document.objects);
    this.playTestSnapshot = JSON.stringify(data);

    this.playTestActive = true;
    this.syncUnloadProtection();

    // Exit editor mode -- enables game simulation, player, etc.
    this.exit();

    // Determine spawn position from level data
    const spawnPos = new THREE.Vector3(
      data.spawnPoint.position[0],
      data.spawnPoint.position[1],
      data.spawnPoint.position[2],
    );
    const spawnRot = data.spawnPoint.rotation
      ? new THREE.Euler(data.spawnPoint.rotation[0], data.spawnPoint.rotation[1], data.spawnPoint.rotation[2])
      : undefined;

    // Hide editor-only gizmos (spawn/trigger cones) during play-test
    for (const obj of this.document.objects) {
      if (obj.source.type === "brush" && (obj.source.brush === "spawn" || obj.source.brush === "trigger")) {
        obj.mesh.visible = false;
      }
    }

    // Spawn the player at the spawn point
    this.player.spawn({ position: spawnPos, rotation: spawnRot });

    // Create floating transport bar with stop button (Unity-style)
    const stopBar = document.createElement("div");
    stopBar.className = "ke-toolbar ke-playtest-bar";
    Object.assign(stopBar.style, {
      position: "fixed",
      top: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "10001",
    });

    const stopBtn = document.createElement("button");
    stopBtn.className = "ke-btn ke-btn-stop";
    stopBtn.title = "Stop Play Test (Ctrl+P)";
    // Square stop icon
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("stroke", "none");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "4");
    rect.setAttribute("y", "4");
    rect.setAttribute("width", "16");
    rect.setAttribute("height", "16");
    rect.setAttribute("rx", "2");
    svg.appendChild(rect);
    stopBtn.appendChild(svg);

    const label = document.createElement("span");
    label.textContent = "Stop";
    label.style.fontSize = "12px";
    stopBtn.appendChild(label);

    stopBtn.addEventListener("click", () => {
      void this.stopPlayTest();
    });
    stopBar.appendChild(stopBtn);
    document.body.appendChild(stopBar);
    this.playTestStopButton = stopBar;
  }

  async stopPlayTest(): Promise<void> {
    if (!this.playTestActive) return;

    const restoreToken = this.loadTransaction.begin("playtest-restore");
    if (restoreToken === null) {
      this.showLoadBusyFeedback();
      return;
    }

    const snapshot = this.playTestSnapshot;
    this.restoringPlayTest = true;
    this.syncUnloadProtection();
    this.clearPlayTestState();

    try {
      // ── Step 1: Restore scene from snapshot BEFORE re-entering editor ──
      // Await to ensure all objects are fully spawned before entering editor.
      if (snapshot) {
        const data = JSON.parse(snapshot) as LevelData;
        const result = await this.applyLoadedLevel(data, "playtest-restore", restoreToken);
        if (result === "superseded") return;
        if (result === "failed") throw new Error("Snapshot reconstruction was incomplete.");
      } else {
        throw new Error("Play-test snapshot was unavailable.");
      }

      if (!this.loadTransaction.isCurrent(restoreToken)) return;

      // ── Step 2: Re-enter editor mode (skip buildEditorObjects — objects
      //    are already populated by applyLoadedLevel) ──
      this.enter();

      // Clear selection and sync UI
      this.setSelection(null);
      this.syncHierarchy();
    } catch (err) {
      if (!this.loadTransaction.isCurrent(restoreToken)) return;
      console.error("[Editor] Failed to restore play-test snapshot:", err);
      this.markDirty();
      if (!this.active) {
        try {
          this.enter();
        } catch (recoveryError) {
          console.error("[Editor] Failed to re-enter the editor after restore failure:", recoveryError);
        }
      }
      this.setSelection(null);
      this.syncHierarchy();
      this.toolbarPanel.showSaveError(
        "Play-test restore failed — the recovered document has unsaved changes and remains protected.",
      );
    } finally {
      const completion = this.loadTransaction.finish(restoreToken);
      if (completion === "completed") this.restoringPlayTest = false;
      this.syncUnloadProtection();
    }
  }

  abortPlayTest(): void {
    this.loadTransaction.invalidate();
    this.glbPlacementTool.cancelPendingImport(this.buildToolContext());
    this.restoringPlayTest = false;
    this.clearPlayTestState();
  }

  private clearPlayTestState(): void {
    this.playTestActive = false;
    this.playTestStopButton?.remove();
    this.playTestStopButton = null;
    this.playTestSnapshot = null;
    this.syncUnloadProtection();
  }

  /* ==================================================================
   *  Input binding
   * ================================================================== */

  private bindEditorInput(): void {
    this.renderer.canvas.addEventListener("mousedown", this.onMouseDown);
    this.renderer.canvas.addEventListener("mousemove", this.onMouseMove);
    // Use capture phase so editor Escape handling fires BEFORE InputManager's
    // bubble-phase handler (which unconditionally fires menu:toggle on Escape).
    window.addEventListener("keydown", this.onKeyDown, true);
  }

  private unbindEditorInput(): void {
    this.renderer.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.renderer.canvas.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("keydown", this.onKeyDown, true);
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.active) return;
    // Ignore clicks on panel UI
    if (this.isClickOnPanel(e.target as Node)) return;

    if (e.button === 2 || e.button === 1) return; // right/middle for camera
    if (!this.guardDocumentMutation()) return;

    // Delegate to active tool
    const ctx = this.buildToolContext();
    if (this.activeTool.onPointerDown?.(ctx, e)) return;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.active) return;
    const rect = this.renderer.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;

    if (!this.loadTransaction.canMutate) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.showLoadBusyFeedback();
      return;
    }

    const cmd = e.ctrlKey || e.metaKey;
    if (e.code === "KeyS" && cmd) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) void this.saveLevel();
      return;
    }

    // Ignore keyboard shortcuts when typing in an input or contenteditable
    const target = e.target as HTMLElement;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (target?.isContentEditable) return;

    if (e.code === "KeyP" && cmd) {
      e.preventDefault();
      this.startPlayTest();
      return;
    }

    // Escape: deselect object first, or cancel brush tool. Only let it through
    // to InputManager (which fires menu:toggle → pause) if nothing to deselect.
    if (e.code === "Escape") {
      const ctx = this.buildToolContext();
      // If brush tool is active, let it handle Escape (cancel placement)
      if (this.activeTool.onKeyDown?.(ctx, e)) {
        e.stopImmediatePropagation();
        return;
      }
      // If an object is selected, deselect it
      if (this.document.selected) {
        this.setSelection(null);
        e.stopImmediatePropagation();
        return;
      }
      // Nothing selected — let Escape propagate to InputManager → pause menu
      return;
    }

    // Delegate to active tool first
    const ctx = this.buildToolContext();
    if (this.activeTool.onKeyDown?.(ctx, e)) return;

    if (e.code === "KeyW" && !cmd && this.document.selected) this.setTransformMode("translate");
    if (e.code === "KeyE" && !cmd && this.document.selected) {
      this.setTransformMode("rotate");
      // KeyE is also FreeCamera "move down"; mark consumed so switching to
      // rotate mode doesn't simultaneously sink the camera.
      e.preventDefault();
    }
    if (e.code === "KeyR" && !cmd && this.document.selected) this.setTransformMode("scale");
    if (e.code === "KeyG" && !cmd) {
      this.grid.toggleGrid();
      this.toolbarPanel.setGridActive(this.grid.isVisible());
    }
    if (handleEditorHistoryShortcut(e, () => this.undo(), () => this.redo())) return;
    if (e.code === "Delete" || e.code === "Backspace") {
      this.deleteSelection();
      e.preventDefault();
    }
    if (e.code === "KeyF" && !cmd && this.document.selected) {
      this.focusSelection();
    }

    // Brush shortcuts 1-8
    const digitMatch = e.code.match(/^Digit([1-8])$/);
    if (digitMatch && !cmd && !e.altKey) {
      const idx = parseInt(digitMatch[1], 10) - 1;
      if (idx < BRUSH_REGISTRY.length) {
        const brush = BRUSH_REGISTRY[idx];
        // Toggle: if same brush already active, deselect
        if (this.brushPlacementTool.getActiveBrushId() === brush.id) {
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
   *  GLB import (delegates to GLBPlacementTool)
   * ================================================================== */

  private onImportGLB(): void {
    if (!this.guardDocumentMutation()) return;
    this.switchTool("glb-placement");
    this.glbPlacementTool.openFilePicker(this.buildToolContext());
  }

  private onDragOver = (e: DragEvent): void => {
    if (!this.active) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  private onDrop = (e: DragEvent): void => {
    if (!this.active) return;
    e.preventDefault();
    if (!this.guardDocumentMutation()) return;
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.name.endsWith(".glb") || file.name.endsWith(".gltf"))) {
      this.switchTool("glb-placement");
      void this.glbPlacementTool.importFile(this.buildToolContext(), file);
    }
  };

  /* ==================================================================
   *  Brush selection (delegates to BrushPlacementTool)
   * ================================================================== */

  private onBrushSelected(brushId: string | null): void {
    if (!this.guardDocumentMutation()) return;
    if (!brushId) {
      // Deselect brush, return to selection tool
      this.brushPanel.setActiveBrush(null);
      this.switchTool("selection");
      return;
    }

    // Switch to brush placement tool and start the brush
    this.switchTool("brush-placement");
    this.brushPlacementTool.startBrush(this.buildToolContext(), brushId);
  }

  /* ==================================================================
   *  Selection
   * ================================================================== */

  private selectById(id: string | null): void {
    if (!id) {
      this.setSelection(null);
      return;
    }
    const obj = this.document.findById(id);
    this.setSelection(obj ?? null);
  }

  private setSelection(obj: EditorObject | null): void {
    if (this.document.selected?.id !== obj?.id && !this.commitPendingEdit()) return;
    this.document.selected = obj;
    this.gizmo.attach(obj?.mesh ?? null);
    this.inspectorPanel.setSelection(obj);
    this.hierarchyPanel.setSelection(obj?.id ?? null);
    this.setSelectionHelper(obj?.mesh ?? null);
    this.eventBus.emit("editor:objectSelected", obj ? { id: obj.id } : null);
  }

  /** Frame the camera to look at and focus on the selected object (F key). */
  private focusSelection(): void {
    const obj = this.document.selected;
    if (!obj) return;

    // Compute bounding sphere for the object
    const box = new THREE.Box3().setFromObject(obj.mesh);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;

    // Position camera at a comfortable distance looking at the object
    const dist = Math.max(radius * 3, 2);
    const cam = this.renderer.camera;
    const dir = new THREE.Vector3().subVectors(cam.position, center).normalize();
    // If camera is exactly at center, use a default direction
    if (dir.lengthSq() < 0.001) dir.set(0, 0.5, 1).normalize();

    cam.position.copy(center).addScaledVector(dir, dist);

    // Update camera to look at the target
    cam.lookAt(center);

    // Re-sync FreeCamera yaw/pitch from the new quaternion
    this.freeCamera.syncOrientationFromCamera();
  }

  private setSelectionHelper(target: THREE.Object3D | null): void {
    this.clearSelectionHelper();
    if (!target) return;

    // Use BoxHelper which auto-updates to track the object's world-space AABB.
    // This is simpler and avoids parenting issues during play-test serialization.
    const helper = new THREE.BoxHelper(target, 0x4fc3f7);
    const material = helper.material as THREE.LineBasicMaterial;
    material.depthTest = false;
    material.transparent = true;
    material.opacity = 0.85;
    this.renderer.scene.add(helper);
    this.selectionHelper = helper;
  }

  private clearSelectionHelper(): void {
    if (!this.selectionHelper) return;
    this.renderer.scene.remove(this.selectionHelper);
    this.selectionHelper.geometry.dispose();
    (this.selectionHelper.material as THREE.Material).dispose();
    this.selectionHelper = null;
  }

  /* ==================================================================
   *  Build editor objects from scene
   * ================================================================== */

  private buildEditorObjects(): void {
    const map = new Map<string, EditorObject>();
    for (const obj of this.levelManager.getLevelObjects()) {
      // Accept Meshes and any Object3D tagged with editorSource (GLB Groups, etc.)
      // Skip lights and other internal objects.
      if (obj instanceof THREE.Mesh || obj.userData?.editorSource) {
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
    for (const entry of map.values()) {
      const parent = entry.mesh.parent ? map.get(entry.mesh.parent.uuid) : undefined;
      entry.parentId = parent?.id ?? null;
      entry.children = entry.mesh.children
        .map((child) => map.get(child.uuid)?.id)
        .filter((id): id is string => id !== undefined);
    }
    this.document.objects = Array.from(map.values());
    this.documentNeedsRebuild = false;
  }

  private buildEditorObject(mesh: THREE.Object3D): EditorObject {
    const source = this.detectSource(mesh);
    const tracking = this.levelManager.getLevelObjectTracking(mesh);
    const body = tracking.physics?.body;
    const collider = tracking.physics?.collider;
    const physicsType = body?.isDynamic() ? "dynamic" : body?.isKinematic() ? "kinematic" : "static";
    const transform = {
      position: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] as [number, number, number],
    };

    // Extract material properties — for Mesh directly, for Groups find first child mesh
    let material: EditorObject["material"];
    let matSource: THREE.MeshStandardMaterial | null = null;
    const meshObj = mesh as THREE.Mesh;
    if (meshObj.isMesh && meshObj.material) {
      const mat = meshObj.material as THREE.MeshStandardMaterial;
      if (mat.isMeshStandardMaterial) matSource = mat;
    }
    if (!matSource) {
      mesh.traverse((child) => {
        if (matSource) return;
        const cm = child as THREE.Mesh;
        if (cm.isMesh && cm.material) {
          const mat = cm.material as THREE.MeshStandardMaterial;
          if (mat.isMeshStandardMaterial) matSource = mat;
        }
      });
    }
    if (matSource) {
      material = {
        color: "#" + matSource.color.getHexString(),
        roughness: matSource.roughness,
        metalness: matSource.metalness,
        emissive: "#" + matSource.emissive.getHexString(),
        emissiveIntensity: matSource.emissiveIntensity,
        opacity: matSource.opacity,
      };
    }

    const missingAssetPath = mesh.userData.editorMissingAssetPath;
    return {
      id: mesh.uuid,
      name: mesh.name || "Object",
      mesh,
      source,
      transform,
      parentId: null,
      children: [],
      visible: mesh.visible,
      locked: false,
      material,
      physicsType,
      body,
      collider,
      missingAssetPath: typeof missingAssetPath === "string" ? missingAssetPath : undefined,
    };
  }

  private detectSource(mesh: THREE.Object3D): {
    type: "primitive" | "glb" | "sprite" | "brush";
    asset?: string;
    primitive?: string;
    brush?: string;
  } {
    const userSource = (
      mesh.userData as { editorSource?: { type: string; asset?: string; primitive?: string; brush?: string } }
    ).editorSource;
    if (userSource) {
      return {
        type: userSource.type as "primitive" | "glb" | "sprite" | "brush",
        asset: userSource.asset,
        primitive: userSource.primitive,
        brush: userSource.brush,
      };
    }
    if ((mesh as THREE.Sprite).isSprite) {
      return { type: "sprite" };
    }
    if ((mesh as THREE.Group).isGroup) {
      return { type: "primitive", primitive: "group" };
    }
    if ((mesh as THREE.Mesh).isMesh && (mesh as THREE.Mesh).geometry) {
      const geomType = (mesh as THREE.Mesh).geometry.type;
      if (geomType.includes("Box")) return { type: "primitive", primitive: "cube" };
      if (geomType.includes("Sphere")) return { type: "primitive", primitive: "sphere" };
      if (geomType.includes("Cylinder")) return { type: "primitive", primitive: "cylinder" };
      if (geomType.includes("Plane")) return { type: "primitive", primitive: "plane" };
    }
    return { type: "primitive", primitive: "cube" };
  }

  /* ==================================================================
   *  Hierarchy operations (delegate to EditorDocument)
   * ================================================================== */

  private renameById(id: string, name: string): void {
    if (!this.guardDocumentMutation() || !this.commitPendingEdit()) return;
    const target = this.document.findById(id);
    if (!target) return;
    const result = buildRenameCommand(this, id, target.name, name);
    if (result.ok) this.history.push(result.command);
  }

  private toggleVisibilityById(id: string): void {
    if (!this.guardDocumentMutation() || !this.commitPendingEdit()) return;
    const target = this.document.findById(id);
    if (!target) return;
    const visible = target.visible ?? true;
    const result = buildVisibilityCommand(this, id, visible, !visible, this.document.selected?.id ?? null);
    if (result.ok) this.history.push(result.command);
  }

  private toggleLockById(id: string): void {
    if (!this.guardDocumentMutation() || !this.commitPendingEdit()) return;
    const target = this.document.findById(id);
    if (!target) return;
    const locked = target.locked ?? false;
    const result = buildLockCommand(this, id, locked, !locked, this.document.selected?.id ?? null);
    if (result.ok) this.history.push(result.command);
  }

  private captureStructuralHierarchyState(
    operation: EditorStructuralHierarchyState["operation"],
    physicsRootIds: readonly string[],
    extraObjects: readonly EditorObject[] = [],
    trackingOverrides: ReadonlyMap<EditorObject, EditorHierarchyTrackingState> = new Map(),
  ): EditorStructuralHierarchyState {
    const trackedMeshes = new Set(this.levelManager.getLevelObjects());
    const objects = [...this.document.objects];
    for (const object of extraObjects) {
      if (!objects.includes(object)) objects.push(object);
    }
    const tracking = objects.map((object) => {
      const override = trackingOverrides.get(object);
      if (override) return override;
      return Object.freeze({
        object,
        tracked: trackedMeshes.has(object.mesh),
        tracking: Object.freeze({ ...this.levelManager.getLevelObjectTracking(object.mesh) }),
      });
    });
    return Object.freeze({
      type: "structure",
      operation,
      document: this.document.captureHierarchySnapshot(),
      tracking: Object.freeze(tracking),
      physicsRootIds: Object.freeze([...physicsRootIds]),
    });
  }

  private reconcileHierarchyTracking(target: readonly EditorHierarchyTrackingState[]): void {
    const currentlyTracked = new Set(this.levelManager.getLevelObjects());
    for (const entry of target) {
      const tracked = currentlyTracked.has(entry.object.mesh);
      if (tracked === entry.tracked) continue;
      if (entry.tracked) {
        this.levelManager.addLevelObject(entry.object.mesh, entry.tracking);
        currentlyTracked.add(entry.object.mesh);
      } else {
        const removed = this.levelManager.removeLevelObject(entry.object.mesh);
        removed.physics?.body?.setEnabled(false);
        removed.physics?.collider?.setEnabled(false);
        currentlyTracked.delete(entry.object.mesh);
      }
    }
  }

  private syncStructuralPhysics(rootIds: readonly string[]): void {
    for (const rootId of rootIds) {
      const root = this.document.findById(rootId);
      if (!root) continue;
      const result = this.syncPhysicsSubtree(root, neverRebuildCollider);
      if (!result.ok) throw new Error(result.reason);
    }
  }

  private applyStructuralHierarchy(state: EditorStructuralHierarchyState): boolean {
    const rollbackRoots = this.document.objects.filter((object) => !object.parentId).map((object) => object.id);
    const rollback = this.captureStructuralHierarchyState(
      state.operation,
      rollbackRoots,
      state.tracking.map(({ object }) => object),
    );
    try {
      if (!this.document.applyHierarchySnapshot(state.document)) {
        throw new Error("The editor document rejected the hierarchy snapshot.");
      }
      this.reconcileHierarchyTracking(state.tracking);
      this.syncStructuralPhysics(state.physicsRootIds);
    } catch (error) {
      let rollbackFailure = "";
      try {
        if (!this.document.applyHierarchySnapshot(rollback.document)) {
          throw new Error("The editor document rejected hierarchy rollback.");
        }
        this.reconcileHierarchyTracking(rollback.tracking);
        this.syncStructuralPhysics(rollback.physicsRootIds);
      } catch (rollbackError) {
        rollbackFailure = ` Rollback also failed. ${String(rollbackError)}`;
      }
      this.reportFailure(
        `Hierarchy ${state.operation} failed; no changes were kept. ${String(error)}${rollbackFailure}`,
      );
      return false;
    }

    this.syncSelectionAfterScalarMutation(state.document.selection?.id ?? null);
    try {
      this.syncHierarchy();
    } catch (error) {
      this.reportFailure(`Hierarchy ${state.operation} committed, but hierarchy publication failed. ${String(error)}`);
    }
    return true;
  }

  private hierarchyWouldCycle(child: EditorObject, nextParent: EditorObject): boolean {
    let cursor: EditorObject | undefined = nextParent;
    while (cursor) {
      if (cursor === child) return true;
      cursor = cursor.parentId ? this.document.findById(cursor.parentId) : undefined;
    }
    return false;
  }

  private reparentById(childId: string, newParentId: string | null): boolean {
    if (!this.guardDocumentMutation() || !this.commitPendingEdit()) return false;
    const child = this.document.findById(childId);
    const nextParentObject = newParentId ? this.document.findById(newParentId) : null;
    if (!child || (newParentId && !nextParentObject)) return false;
    if (child.parentId === newParentId) return false;
    if (nextParentObject && this.hierarchyWouldCycle(child, nextParentObject)) {
      this.reportFailure(
        nextParentObject === child
          ? "An object cannot be parented to itself."
          : "An object cannot be parented below one of its descendants.",
      );
      this.syncHierarchy();
      return false;
    }

    const nextParent = nextParentObject?.mesh ?? this.renderer.scene;
    const validation = validatePhysicsAttachment(child.mesh, nextParent, child.physicsType ?? "static");
    if (!validation.ok) {
      this.reportFailure(validation.reason);
      this.syncHierarchy();
      return false;
    }

    const before = this.captureStructuralHierarchyState("reparent", [child.id]);
    if (!this.document.reparentById(child.id, newParentId)) return false;
    const after = this.captureStructuralHierarchyState("reparent", [child.id]);
    if (!this.document.applyHierarchySnapshot(before.document)) {
      this.reportFailure("Reparent preparation failed while restoring the original hierarchy.");
      return false;
    }
    const result = buildReparentCommand(this, before, after);
    if (!result.ok) {
      this.reportFailure(result.reason);
      return false;
    }
    return this.history.push(result.command);
  }

  private validateGroupingRoots(roots: readonly EditorObject[]): { ok: true } | { ok: false; reason: string } {
    const center = new THREE.Vector3();
    for (const root of roots) {
      root.mesh.updateWorldMatrix(true, false);
      center.add(new THREE.Vector3().setFromMatrixPosition(root.mesh.matrixWorld));
    }
    center.multiplyScalar(1 / roots.length);
    const prospectiveGroupWorld = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z);
    const commonParentId = roots.every((root) => (root.parentId ?? null) === (roots[0]?.parentId ?? null))
      ? (roots[0]?.parentId ?? null)
      : null;
    const targetParent = commonParentId ? this.document.findById(commonParentId)?.mesh : this.renderer.scene;
    if (!targetParent) return { ok: false, reason: "The common hierarchy parent no longer exists." };
    targetParent.updateWorldMatrix(true, false);
    const groupValidation = validateWorldMatrixAttachment(prospectiveGroupWorld, targetParent.matrixWorld, "static");
    if (!groupValidation.ok) return groupValidation;
    for (const root of roots) {
      const validation = validateWorldMatrixAttachment(
        root.mesh.matrixWorld,
        prospectiveGroupWorld,
        root.physicsType ?? "static",
      );
      if (!validation.ok) return validation;
    }
    return { ok: true };
  }

  private groupObjects(ids: string[]): EditorObject | null {
    if (!this.guardDocumentMutation() || !this.commitPendingEdit()) return null;
    const roots = this.document.getGroupingRoots(ids);
    if (roots.length === 0) return null;
    const validation = this.validateGroupingRoots(roots);
    if (!validation.ok) {
      this.reportFailure(validation.reason);
      this.syncHierarchy();
      return null;
    }

    const group = this.document.createGroupObject(ids);
    if (!group) return null;
    const detachedTracking: EditorHierarchyTrackingState = Object.freeze({
      object: group,
      tracked: false,
      tracking: Object.freeze({}),
    });
    const before = this.captureStructuralHierarchyState(
      "group",
      roots.map(({ id }) => id),
      [group],
      new Map([[group, detachedTracking]]),
    );
    if (this.document.groupObjects(ids, group) !== group) {
      this.finalizeDetachedHierarchyObject(group);
      return null;
    }
    this.document.selected = group;
    const attachedTracking: EditorHierarchyTrackingState = Object.freeze({
      object: group,
      tracked: true,
      tracking: Object.freeze({ ...this.createLevelObjectTracking(group) }),
    });
    const after = this.captureStructuralHierarchyState(
      "group",
      [group.id],
      [group],
      new Map([[group, attachedTracking]]),
    );
    if (!this.document.applyHierarchySnapshot(before.document)) {
      this.reportFailure("Group preparation failed while restoring the original hierarchy.");
      return null;
    }
    const result = buildGroupCommand(this, before, after, group);
    if (!result.ok) {
      this.reportFailure(result.reason);
      this.finalizeDetachedHierarchyObject(group);
      return null;
    }
    if (!this.history.push(result.command)) {
      result.command.discard?.();
      return null;
    }
    return group;
  }

  private ungroupObject(groupId: string): boolean {
    if (!this.guardDocumentMutation() || !this.commitPendingEdit()) return false;
    const group = this.document.findById(groupId);
    if (!group?.children || group.children.length === 0) return false;
    const children = group.children
      .map((childId) => this.document.findById(childId))
      .filter((child): child is EditorObject => child !== undefined);
    if (children.length !== group.children.length) return false;
    const targetParent = group.parentId ? this.document.findById(group.parentId)?.mesh : this.renderer.scene;
    if (!targetParent) return false;
    for (const child of children) {
      const validation = validatePhysicsAttachment(child.mesh, targetParent, child.physicsType ?? "static");
      if (!validation.ok) {
        this.reportFailure(validation.reason);
        this.syncHierarchy();
        return false;
      }
    }

    const before = this.captureStructuralHierarchyState("ungroup", [group.id], [group]);
    const groupTracking = before.tracking.find(({ object }) => object === group);
    if (!groupTracking || !this.document.ungroupObject(group.id)) return false;
    const detachedTracking: EditorHierarchyTrackingState = Object.freeze({
      object: group,
      tracked: false,
      tracking: groupTracking.tracking,
    });
    const after = this.captureStructuralHierarchyState(
      "ungroup",
      children.map(({ id }) => id),
      [group],
      new Map([[group, detachedTracking]]),
    );
    if (!this.document.applyHierarchySnapshot(before.document)) {
      this.reportFailure("Ungroup preparation failed while restoring the original hierarchy.");
      return false;
    }
    const result = buildUngroupCommand(this, before, after, group);
    if (!result.ok) {
      this.reportFailure(result.reason);
      return false;
    }
    if (!this.history.push(result.command)) {
      result.command.discard?.();
      return false;
    }
    return true;
  }

  finalizeDetachedHierarchyObject(object: EditorObject): void {
    if (this.document.findById(object.id) === object || object.mesh.parent) return;
    const tracking = this.levelManager.getLevelObjectTracking(object.mesh);
    if (this.levelManager.getLevelObjects().includes(object.mesh) || tracking.physics) {
      this.levelManager.removeLevelObject(object.mesh, { removePhysics: true });
    } else if (object.body) {
      this.physicsWorld.removeBody(object.body);
    } else if (object.collider) {
      this.physicsWorld.removeCollider(object.collider);
    }
    object.body = undefined;
    object.collider = undefined;
  }

  applyHierarchy(state: EditorHierarchyState): boolean {
    if (state.type === "structure") return this.applyStructuralHierarchy(state);
    const target = this.document.findById(state.id);
    if (!target) return false;
    if (state.type === "rename") {
      target.name = state.name;
      target.mesh.name = state.name;
    } else if (state.type === "visibility") {
      target.visible = state.visible;
      target.mesh.visible = state.visible;
      this.syncSelectionAfterScalarMutation(state.selectionId);
    } else {
      target.locked = state.locked;
      this.syncSelectionAfterScalarMutation(state.selectionId);
    }
    if (state.type === "rename") this.syncSelectionAfterScalarMutation(this.document.selected?.id ?? null);
    try {
      this.syncHierarchy();
    } catch (error) {
      this.reportFailure(`Object ${state.type} committed, but hierarchy publication failed. ${String(error)}`);
    }
    return true;
  }

  private syncSelectionAfterScalarMutation(selectionId: string | null): void {
    const selection = selectionId ? (this.document.findById(selectionId) ?? null) : null;
    this.document.selected = selection;
    const publications = [
      () => this.gizmo.attach(selection?.mesh ?? null),
      () => this.inspectorPanel.setSelection(selection),
      () => this.hierarchyPanel.setSelection(selection?.id ?? null),
      () => this.setSelectionHelper(selection?.mesh ?? null),
      () => this.eventBus.emit("editor:objectSelected", selection ? { id: selection.id } : null),
    ];
    for (const publish of publications) {
      try {
        publish();
      } catch (error) {
        this.reportFailure(`Object property committed, but selection publication failed. ${String(error)}`);
      }
    }
  }

  deleteSubtree(rootId: string): boolean {
    if (!this.guardDocumentMutation()) return false;
    if (!this.commitPendingEdit()) return false;
    const result = buildDeleteSubtreeCommand(this, rootId);
    if (!result.ok) {
      this.reportFailure(result.reason);
      return false;
    }
    return this.history.push(result.command);
  }

  private deleteById(id: string): void {
    this.deleteSubtree(id);
  }

  private duplicateById(id: string): void {
    if (!this.guardDocumentMutation() || !this.commitPendingEdit()) return;
    const newObj = this.document.duplicateById(id);
    if (!newObj) return;
    let body: RAPIER.RigidBody | null = null;
    let publicationAttempted = false;
    try {
      // Create fresh physics body/collider for the duplicate (structuredClone
      // cannot clone live Rapier handles — the duplicated EditorObject has none).
      const meshObj = newObj.mesh as THREE.Mesh;
      if ((newObj.physicsType && newObj.physicsType !== "static") || meshObj.isMesh) {
        const pos = newObj.mesh.position;
        const q = newObj.mesh.quaternion;
        let bodyDesc: RAPIER.RigidBodyDesc;
        if (newObj.physicsType === "dynamic") {
          bodyDesc = RAPIER.RigidBodyDesc.dynamic();
        } else if (newObj.physicsType === "kinematic") {
          bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
        } else {
          bodyDesc = RAPIER.RigidBodyDesc.fixed();
        }
        bodyDesc.setTranslation(pos.x, pos.y, pos.z);
        bodyDesc.setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w));
        newObj.mesh.updateMatrixWorld(true);
        let colliderDesc: RAPIER.ColliderDesc;
        if (newObj.source?.type === "brush" && newObj.source.brush && meshObj.isMesh && meshObj.geometry) {
          colliderDesc = buildColliderDesc(newObj.source.brush, meshObj.geometry, meshObj);
        } else {
          const box = new THREE.Box3().setFromObject(newObj.mesh);
          const size = box.getSize(new THREE.Vector3());
          colliderDesc = RAPIER.ColliderDesc.cuboid(
            Math.max(size.x / 2, 0.01),
            Math.max(size.y / 2, 0.01),
            Math.max(size.z / 2, 0.01),
          );
        }
        body = this.physicsWorld.world.createRigidBody(bodyDesc);
        const collider = this.physicsWorld.world.createCollider(colliderDesc, body);
        newObj.body = body;
        newObj.collider = collider;
      }

      publicationAttempted = true;
      const published = this.history.push(
        createOwnedCreationCommand(
          () => {
            this.addTrackedEditorObject(newObj, this.renderer.scene);
            this.syncHierarchy();
            this.eventBus.emit("editor:objectAdded", { id: newObj.id });
            this.setSelection(newObj);
          },
          () => {
            this.removeTrackedEditorObject(newObj);
            this.syncHierarchy();
            this.eventBus.emit("editor:objectRemoved", { id: newObj.id });
          },
          () => this.rollbackEditorObject(newObj),
        ),
      );
      if (!published) throw new Error("History rejected duplicate placement.");
    } catch (error) {
      if (publicationAttempted) this.rollbackEditorObject(newObj);
      else if (body) this.physicsWorld.removeBody(body);
      console.error("[Editor] Duplicate failed:", error);
      this.showPhysicsMutationError("Duplicate failed; no copy was added.");
    }
  }

  /* ==================================================================
   *  Material editing
   * ================================================================== */

  private applyMaterialChange(id: string, material: EditorSerializedMaterialState, phase: "preview" | "commit"): void {
    if (!this.guardDocumentMutation()) return;
    const target = this.document.findById(id);
    if (!target) return;
    if (this.materialEditSession?.objectId !== id) {
      if (!this.commitPendingEdit()) return;
      const before = this.captureMaterialState(target);
      if (before.live.length === 0) return;
      this.materialEditSession = { objectId: id, before };
    }

    const preview = this.captureMaterialState(target, material);
    if (!this.applyMaterial(id, preview)) {
      this.materialEditSession = null;
      return;
    }
    if (phase === "commit") this.commitPendingEdit();
  }

  private collectLiveMaterials(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
    const materials: THREE.MeshStandardMaterial[] = [];
    const seen = new Set<THREE.MeshStandardMaterial>();
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const candidates = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of candidates) {
        if (!(material instanceof THREE.MeshStandardMaterial) || seen.has(material)) continue;
        seen.add(material);
        materials.push(material);
      }
    });
    return materials;
  }

  private captureMaterialState(target: EditorObject, preview?: EditorSerializedMaterialState): EditorMaterialState {
    const serialized = preview ?? target.material;
    const previewColor = preview ? new THREE.Color(preview.color) : null;
    const previewEmissive = preview ? new THREE.Color(preview.emissive) : null;
    const serializedSnapshot = serialized
      ? Object.freeze({
          color: serialized.color,
          roughness: serialized.roughness,
          metalness: serialized.metalness,
          emissive: serialized.emissive,
          emissiveIntensity: serialized.emissiveIntensity,
          opacity: serialized.opacity,
        })
      : undefined;
    const live = this.collectLiveMaterials(target.mesh).map((material) =>
      Object.freeze({
        material,
        color: Object.freeze([
          previewColor?.r ?? material.color.r,
          previewColor?.g ?? material.color.g,
          previewColor?.b ?? material.color.b,
        ] as [number, number, number]),
        roughness: preview ? preview.roughness : material.roughness,
        metalness: preview ? preview.metalness : material.metalness,
        emissive: Object.freeze([
          previewEmissive?.r ?? material.emissive.r,
          previewEmissive?.g ?? material.emissive.g,
          previewEmissive?.b ?? material.emissive.b,
        ] as [number, number, number]),
        emissiveIntensity: preview ? preview.emissiveIntensity : material.emissiveIntensity,
        opacity: preview ? preview.opacity : material.opacity,
        transparent: preview ? preview.opacity < 1 : material.transparent,
      }),
    );
    return Object.freeze({ serialized: serializedSnapshot, live: Object.freeze(live) });
  }

  applyMaterial(id: string, state: EditorMaterialState): boolean {
    const target = this.document.findById(id);
    if (!target || state.live.length === 0) return false;
    for (const snapshot of state.live) {
      const material = snapshot.material as THREE.MeshStandardMaterial;
      material.color.setRGB(snapshot.color[0], snapshot.color[1], snapshot.color[2]);
      material.roughness = snapshot.roughness;
      material.metalness = snapshot.metalness;
      material.emissive.setRGB(snapshot.emissive[0], snapshot.emissive[1], snapshot.emissive[2]);
      material.emissiveIntensity = snapshot.emissiveIntensity;
      material.opacity = snapshot.opacity;
      if (material.transparent !== snapshot.transparent) {
        material.transparent = snapshot.transparent;
        material.needsUpdate = true;
      }
    }
    target.material = state.serialized ? { ...state.serialized } : undefined;
    if (this.document.selected?.id === id) {
      try {
        this.inspectorPanel.setSelection(target);
      } catch (error) {
        this.reportFailure(`Material committed, but inspector publication failed. ${String(error)}`);
      }
    }
    return true;
  }

  private commitPendingMaterialEdit(): boolean {
    const session = this.materialEditSession;
    if (!session) return true;
    this.materialEditSession = null;
    const target = this.document.findById(session.objectId);
    if (!target) return false;
    const after = this.captureMaterialState(target);
    if (!this.applyMaterial(session.objectId, session.before)) return false;
    const result = buildMaterialCommand(this, session.objectId, session.before, after);
    if (!result.ok) return true;
    return this.history.push(result.command);
  }

  private cancelPendingMaterialEdit(): void {
    const session = this.materialEditSession;
    if (!session) return;
    this.materialEditSession = null;
    this.applyMaterial(session.objectId, session.before);
  }

  private commitPendingGizmoDrag(): boolean {
    const session = this.gizmoDragSession;
    if (!session) return true;
    this.gizmoDragSession = null;
    const current = this.document.findById(session.objectId);
    if (current !== session.object) {
      this.restorePendingGizmoDrag(session);
      return false;
    }
    const after = this.captureTransformState(session.object);
    return this.commitTransform(session.object, session.before, after);
  }

  private cancelPendingGizmoDrag(): void {
    const session = this.gizmoDragSession;
    if (!session) return;
    this.gizmoDragSession = null;
    this.restorePendingGizmoDrag(session);
  }

  private restorePendingGizmoDrag(session: EditorGizmoDragSession): boolean {
    this.restoreObjectTransform(session.object, session.before);
    const restored = this.syncPhysicsSubtree(session.object, neverRebuildCollider);
    if (restored.ok) return true;
    const reconciled = this.syncPhysicsSubtree(session.object, neverRebuildCollider);
    const rollbackFailure = reconciled.ok ? "" : ` Pose reconciliation also failed. ${reconciled.reason}`;
    this.showPhysicsMutationError(`Gizmo drag cancellation failed. ${restored.reason}${rollbackFailure}`);
    return reconciled.ok;
  }

  private commitPendingTransformEdit(): boolean {
    const before = this.inspectorEditStartTransform;
    const objectId = this.inspectorEditObjectId;
    if (!before || !objectId) return true;
    const target = this.document.findById(objectId);
    this.clearInspectorEditSession();
    if (!target) return false;
    return this.commitTransform(target, before, this.captureTransformState(target));
  }

  private cancelPendingTransformEdit(): void {
    const before = this.inspectorEditStartTransform;
    const objectId = this.inspectorEditObjectId;
    if (!before || !objectId) return;
    this.clearInspectorEditSession();
    const target = this.document.findById(objectId);
    if (!target) return;
    this.restoreObjectTransform(target, before);
    const restored = this.syncPhysicsSubtree(target, neverRebuildCollider);
    if (!restored.ok) {
      this.showPhysicsMutationError(`Transform preview cancellation failed. ${restored.reason}`);
    }
  }

  private commitPendingEdit(): boolean {
    return this.commitPendingGizmoDrag() && this.commitPendingTransformEdit() && this.commitPendingMaterialEdit();
  }

  private cancelPendingEdit(): void {
    this.cancelPendingGizmoDrag();
    this.cancelPendingTransformEdit();
    this.cancelPendingMaterialEdit();
  }

  private prepareForExternalUnload(): void {
    this.cancelPendingEdit();
    this.history.clear();
  }

  /* ==================================================================
   *  Physics type change
   * ================================================================== */

  private applyPhysicsTypeChange(id: string, type: "static" | "dynamic" | "kinematic"): void {
    if (!this.guardDocumentMutation() || !this.commitPendingEdit()) return;
    const obj = this.document.findById(id);
    if (!obj || obj.physicsType === type) return;

    const validation = validateObjectPhysicsTransform(obj.mesh, type);
    if (!validation.ok) {
      this.showPhysicsMutationError(validation.reason);
      this.inspectorPanel.setSelection(obj);
      return;
    }

    const before = this.capturePhysicsState(obj);
    const after = Object.freeze({
      type,
      levelTracked: before.levelTracked,
      hasBody: true,
      hasCollider: true,
      resourceRecipe: this.createPhysicsResourceRecipe(obj, type, true, true, false),
    });
    const result = buildSetPhysicsTypeCommand(this, id, before, after);
    if (result.ok) this.history.push(result.command);
  }

  private capturePhysicsState(obj: EditorObject): EditorPhysicsState {
    return Object.freeze({
      type: obj.physicsType ?? "static",
      levelTracked: this.levelManager.getLevelObjects().includes(obj.mesh),
      hasBody: obj.body !== undefined,
      hasCollider: obj.collider !== undefined,
      resourceRecipe: this.createPhysicsResourceRecipe(
        obj,
        obj.physicsType ?? "static",
        obj.body !== undefined,
        obj.collider !== undefined,
        true,
      ),
    });
  }

  replacePhysics(id: string, state: EditorPhysicsState): boolean {
    const obj = this.document.findById(id);
    if (!obj) return false;
    const validation = validateObjectPhysicsTransform(obj.mesh, state.type);
    if (!validation.ok) {
      this.showPhysicsMutationError(validation.reason);
      this.inspectorPanel.setSelection(obj);
      return false;
    }

    let recipe: EditorPhysicsResourceRecipe;
    try {
      recipe =
        state.resourceRecipe ??
        this.createPhysicsResourceRecipe(obj, state.type, state.hasBody, state.hasCollider, false);
    } catch (error) {
      this.showPhysicsMutationError(`Physics type change failed; the existing physics was kept. ${String(error)}`);
      this.inspectorPanel.setSelection(obj);
      return false;
    }

    type Publication = Readonly<{
      type: EditorPhysicsType;
      levelTracked: boolean;
      tracking: RemovedLevelObjectTracking;
      resourceRecipe: EditorPhysicsResourceRecipe;
    }>;
    type Resources = Readonly<{
      body?: RAPIER.RigidBody;
      collider?: RAPIER.Collider;
      tracking: Publication;
    }>;
    const currentType = obj.physicsType ?? "static";
    const currentLevelTracked = this.levelManager.getLevelObjects().includes(obj.mesh);
    const currentRecipe = this.createPhysicsResourceRecipe(
      obj,
      currentType,
      obj.body !== undefined,
      obj.collider !== undefined,
      true,
    );
    const current: Resources = {
      body: obj.body,
      collider: obj.collider,
      tracking: {
        type: currentType,
        levelTracked: currentLevelTracked,
        tracking: this.levelManager.getLevelObjectTracking(obj.mesh),
        resourceRecipe: currentRecipe,
      },
    };
    const publish = (resources: Resources): void => {
      if (this.levelManager.getLevelObjects().includes(obj.mesh)) {
        this.levelManager.updateLevelObjectPhysics(obj.mesh, {
          body: resources.body,
          collider: resources.collider,
        });
        this.levelManager.removeLevelObject(obj.mesh);
      }
      obj.body = resources.body;
      obj.collider = resources.collider;
      obj.physicsType = resources.tracking.type;
      if (resources.tracking.levelTracked) {
        this.levelManager.addLevelObject(obj.mesh, resources.tracking.tracking);
      }
      const { bodyDesc, colliderDesc } = resources.tracking.resourceRecipe;
      if (resources.body && bodyDesc && typeof resources.body.setEnabled === "function") {
        resources.body.setEnabled(bodyDesc.enabled);
      }
      if (resources.collider && colliderDesc && typeof resources.collider.setEnabled === "function") {
        resources.collider.setEnabled(colliderDesc.enabled);
      }
    };
    const retire = (resources: Resources): void => {
      if (resources.body) this.physicsWorld.removeBody(resources.body);
      else if (resources.collider) this.physicsWorld.removeCollider(resources.collider);
    };
    const createBody = (resourceRecipe: EditorPhysicsResourceRecipe): RAPIER.RigidBody | undefined =>
      resourceRecipe.bodyDesc ? this.physicsWorld.world.createRigidBody(resourceRecipe.bodyDesc) : undefined;
    const createCollider = (
      resourceRecipe: EditorPhysicsResourceRecipe,
      body: RAPIER.RigidBody | undefined,
    ): RAPIER.Collider | undefined => {
      if (!resourceRecipe.colliderDesc) return undefined;
      if (resourceRecipe.colliderAttachedToBody && !body) {
        throw new Error("Cannot recreate an attached collider without its rigid body.");
      }
      return this.physicsWorld.world.createCollider(
        resourceRecipe.colliderDesc,
        resourceRecipe.colliderAttachedToBody ? body : undefined,
      );
    };
    const createResources = (resourceRecipe: EditorPhysicsResourceRecipe, publication: Publication): Resources => {
      const body = createBody(resourceRecipe);
      let collider: RAPIER.Collider | undefined;
      try {
        collider = createCollider(resourceRecipe, body);
      } catch (error) {
        if (body) {
          try {
            this.physicsWorld.removeBody(body);
          } catch (cleanupError) {
            throw new Error(`${String(error)} Rollback cleanup failed: ${String(cleanupError)}`);
          }
        }
        throw error;
      }
      return {
        body,
        collider,
        tracking: {
          type: publication.type,
          levelTracked: publication.levelTracked,
          tracking: publication.levelTracked
            ? this.createLevelObjectTracking(obj, { type: publication.type, body, collider })
            : {},
          resourceRecipe,
        },
      };
    };
    const resourceIsLive = (resource: RAPIER.RigidBody | RAPIER.Collider | undefined): boolean => {
      if (!resource) return true;
      if (typeof resource.isValid !== "function") return true;
      try {
        return resource.isValid();
      } catch {
        return false;
      }
    };
    const result = replacePhysicsResourcesAtomically(current, {
      createBody: () => createBody(recipe),
      createCollider: (body) => createCollider(recipe, body),
      createTracking: (body, collider) => ({
        type: state.type,
        levelTracked: state.levelTracked,
        tracking: state.levelTracked ? this.createLevelObjectTracking(obj, { type: state.type, body, collider }) : {},
        resourceRecipe: recipe,
      }),
      publishReplacement: publish,
      restoreCurrent: publish,
      retireCurrent: retire,
      removeBody: (body) => this.physicsWorld.removeBody(body),
      removeCollider: (collider) => this.physicsWorld.removeCollider(collider),
      isCurrentLive: (resources) => resourceIsLive(resources.body) && resourceIsLive(resources.collider),
      recreateCurrent: () => createResources(currentRecipe, current.tracking),
    });
    if (!result.ok) {
      console.error("[Editor] Physics type change failed:", result.reason);
      this.showPhysicsMutationError(`Physics type change failed; the existing physics was kept. ${result.reason}`);
      this.inspectorPanel.setSelection(obj);
      return false;
    }
    this.inspectorPanel.setSelection(obj);
    return true;
  }

  /* ==================================================================
   *  Inspector transform
   * ================================================================== */

  private applyInspectorTransform(
    transform: {
      position: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
    },
    phase: "preview" | "commit",
  ): void {
    if (!this.guardDocumentMutation()) return;
    const selected = this.document.selected;
    if (!selected) return;
    const changed =
      !selected.mesh.position.toArray().every((value, index) => value === transform.position[index]) ||
      !selected.mesh.rotation
        .toArray()
        .slice(0, 3)
        .every((value, index) => value === transform.rotation[index]) ||
      !selected.mesh.scale.toArray().every((value, index) => value === transform.scale[index]);
    const previous = this.captureTransformState(selected);

    if (changed) {
      if (!this.inspectorEditStartTransform || this.inspectorEditObjectId !== selected.id) {
        this.inspectorEditStartTransform = previous;
        this.inspectorEditObjectId = selected.id;
      }
      selected.mesh.position.set(transform.position[0], transform.position[1], transform.position[2]);
      selected.mesh.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
      selected.mesh.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
      selected.mesh.updateWorldMatrix(true, true);
      const validation = this.validatePhysicsSubtree(selected);
      if (!validation.ok) {
        this.restoreObjectTransform(selected, previous);
        this.inspectorPanel.setSelection(selected);
        this.showPhysicsMutationError(validation.reason);
        return;
      }
      this.updateEditorObjectTransform(selected);
      const previewSync = this.syncPhysicsSubtree(selected, neverRebuildCollider);
      if (!previewSync.ok) {
        this.restoreObjectTransform(selected, previous);
        this.syncPhysicsSubtree(selected, neverRebuildCollider);
        this.inspectorPanel.setSelection(selected);
        this.showPhysicsMutationError(previewSync.reason);
        return;
      }
    }

    if (phase === "commit") this.commitPendingTransformEdit();
  }

  /* ==================================================================
   *  Gizmo callbacks
   * ================================================================== */

  private onDragStateChanged(dragging: boolean): void {
    if (!this.guardDocumentMutation()) return;
    if (dragging) {
      if (this.gizmoDragSession || !this.document.selected) return;
      const target = this.document.selected;
      this.gizmoDragSession = {
        objectId: target.id,
        object: target,
        before: this.captureTransformState(target),
      };
      return;
    }
    this.commitPendingGizmoDrag();
  }

  private onGizmoObjectChanged(): void {
    if (!this.guardDocumentMutation()) return;
    const selected = this.gizmoDragSession?.object ?? this.document.selected;
    if (!selected) return;
    if (this.grid.enabled) {
      this.applySnapToObject(selected);
    }
    selected.mesh.updateWorldMatrix(true, true);
    const validation = this.validatePhysicsSubtree(selected);
    if (!validation.ok) {
      selected.mesh.position.fromArray(selected.transform.position);
      selected.mesh.rotation.set(...selected.transform.rotation);
      selected.mesh.scale.fromArray(selected.transform.scale);
      selected.mesh.updateWorldMatrix(true, true);
      this.syncPhysicsSubtree(selected, neverRebuildCollider);
      this.inspectorPanel.setSelection(selected);
      this.showPhysicsMutationError(validation.reason);
      return;
    }
    this.updateEditorObjectTransform(selected);
    this.syncPhysicsSubtree(selected, neverRebuildCollider);
    this.inspectorPanel.setSelection(selected);
    // Force world matrix update so BoxHelper.update() reads correct bounds
    selected.mesh.updateMatrixWorld(true);
  }

  /* ==================================================================
   *  Transform mode + toolbar sync
   * ================================================================== */

  private currentTransformMode: "translate" | "rotate" | "scale" = "translate";

  private setTransformMode(mode: "translate" | "rotate" | "scale"): void {
    this.currentTransformMode = mode;
    this.gizmo.setMode(mode);
    this.toolbarPanel.setActiveMode(mode);
  }

  private syncToolbarState(): void {
    this.toolbarPanel.setActiveMode(this.currentTransformMode);
    this.toolbarPanel.setSnapActive(this.grid.enabled);
    this.toolbarPanel.setGridActive(this.grid.isVisible());
    const state = this.documentState.value;
    this.toolbarPanel.setDocumentState(state.name, state.dirty);
  }

  private markDirty(): void {
    this.documentState.markDirty();
  }

  private guardDocumentMutation(): boolean {
    if (this.loadTransaction.canMutate) return true;
    this.showLoadBusyFeedback();
    return false;
  }

  private showLoadBusyFeedback(): void {
    this.toolbarPanel.showSaveError(
      "Load already in progress — wait for it to finish before editing or loading another level.",
    );
  }

  private onDocumentStateChanged(state: Readonly<EditorDocumentSnapshot>): void {
    this.toolbarPanel.setDocumentState(state.name, state.dirty);
    this.syncUnloadProtection();
  }

  private syncUnloadProtection(): void {
    const enabled = this.shouldWarnBeforeUnload();
    if (enabled === this.unloadProtectionEnabled) return;
    this.unloadProtectionEnabled = enabled;
    this.eventBus.emit("editor:unloadProtectionChanged", enabled);
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

  private applySnapToObject(object: EditorObject): void {
    const snap = this.grid.positionSnap;
    const pos = object.mesh.position;
    pos.set(Math.round(pos.x / snap) * snap, Math.round(pos.y / snap) * snap, Math.round(pos.z / snap) * snap);
  }

  /* ==================================================================
   *  Transform helpers
   * ================================================================== */

  private updateEditorObjectTransform(obj: EditorObject): void {
    obj.transform.position = [obj.mesh.position.x, obj.mesh.position.y, obj.mesh.position.z];
    obj.transform.rotation = [obj.mesh.rotation.x, obj.mesh.rotation.y, obj.mesh.rotation.z];
    obj.transform.scale = [obj.mesh.scale.x, obj.mesh.scale.y, obj.mesh.scale.z];
  }

  private captureTransformState(obj: EditorObject): EditorTransformState {
    return Object.freeze({
      position: Object.freeze(obj.mesh.position.toArray()),
      rotation: Object.freeze(obj.mesh.rotation.toArray().slice(0, 3) as [number, number, number]),
      scale: Object.freeze(obj.mesh.scale.toArray()),
    });
  }

  private restoreObjectTransform(obj: EditorObject, transform: EditorTransformSnapshot): void {
    obj.mesh.position.fromArray(transform.position);
    obj.mesh.rotation.set(...transform.rotation);
    obj.mesh.scale.fromArray(transform.scale);
    obj.mesh.updateWorldMatrix(true, true);
    this.updateEditorObjectTransform(obj);
  }

  private clearInspectorEditSession(): void {
    this.inspectorEditStartTransform = null;
    this.inspectorEditObjectId = null;
  }

  private physicsSubtree(root: EditorObject): EditorObject[] {
    const nodes = new Set<THREE.Object3D>();
    root.mesh.traverse((node) => nodes.add(node));
    return this.document.objects.filter((entry) => nodes.has(entry.mesh));
  }

  private validatePhysicsSubtree(root: EditorObject): { ok: true } | { ok: false; reason: string } {
    for (const obj of this.physicsSubtree(root)) {
      const validation = validateObjectPhysicsTransform(obj.mesh, obj.physicsType ?? "static");
      if (!validation.ok) return validation;
    }
    return { ok: true };
  }

  private showPhysicsMutationError(reason: string): void {
    this.toolbarPanel.showSaveError(`Physics edit rejected â€” ${reason}`);
  }

  private buildEditorColliderDesc(obj: EditorObject, worldScale?: THREE.Vector3): RAPIER.ColliderDesc {
    const mesh = obj.mesh as THREE.Mesh;
    const scale = worldScale ?? getObjectWorldPhysicsPose(obj.mesh).scale;
    if (obj.source.type === "brush" && obj.source.brush && mesh.isMesh && mesh.geometry) {
      const scaleProxy = new THREE.Mesh(mesh.geometry);
      scaleProxy.scale.copy(scale);
      return buildColliderDesc(obj.source.brush, mesh.geometry, scaleProxy);
    }
    const bounds = getObjectColliderBounds(obj.mesh);
    return RAPIER.ColliderDesc.cuboid(
      Math.max(bounds.halfExtents.x, 0.01),
      Math.max(bounds.halfExtents.y, 0.01),
      Math.max(bounds.halfExtents.z, 0.01),
    ).setTranslation(bounds.center.x, bounds.center.y, bounds.center.z);
  }

  private snapshotEditorColliderDesc(collider: RAPIER.Collider, attachedToBody: boolean): RAPIER.ColliderDesc | null {
    const candidate = collider as unknown as Record<string, unknown>;
    const requiredMethods = [
      attachedToBody ? "translationWrtParent" : "translation",
      attachedToBody ? "rotationWrtParent" : "rotation",
      "isSensor",
      "isEnabled",
      "friction",
      "restitution",
      "mass",
      "frictionCombineRule",
      "restitutionCombineRule",
      "collisionGroups",
      "solverGroups",
      "activeHooks",
      "activeEvents",
      "activeCollisionTypes",
      "contactForceEventThreshold",
      "contactSkin",
    ];
    if (!candidate.shape || requiredMethods.some((method) => typeof candidate[method] !== "function")) return null;

    const translation = attachedToBody ? collider.translationWrtParent() : collider.translation();
    const rotation = attachedToBody ? collider.rotationWrtParent() : collider.rotation();
    const desc = new RAPIER.ColliderDesc(collider.shape)
      .setSensor(collider.isSensor())
      .setEnabled(collider.isEnabled())
      .setFriction(collider.friction())
      .setRestitution(collider.restitution())
      .setMass(collider.mass())
      .setFrictionCombineRule(collider.frictionCombineRule())
      .setRestitutionCombineRule(collider.restitutionCombineRule())
      .setCollisionGroups(collider.collisionGroups())
      .setSolverGroups(collider.solverGroups())
      .setActiveHooks(collider.activeHooks())
      .setActiveEvents(collider.activeEvents())
      .setActiveCollisionTypes(collider.activeCollisionTypes())
      .setContactForceEventThreshold(collider.contactForceEventThreshold())
      .setContactSkin(collider.contactSkin());
    if (translation) desc.setTranslation(translation.x, translation.y, translation.z);
    if (rotation) desc.setRotation(rotation);
    return desc;
  }

  private createPhysicsResourceRecipe(
    obj: EditorObject,
    type: EditorPhysicsType,
    hasBody: boolean,
    hasCollider: boolean,
    preserveLiveResources: boolean,
  ): EditorPhysicsResourceRecipe {
    const pose = getObjectWorldPhysicsPose(obj.mesh);
    let bodyDesc: RAPIER.RigidBodyDesc | undefined;
    if (hasBody) {
      bodyDesc =
        type === "static"
          ? RAPIER.RigidBodyDesc.fixed()
          : type === "kinematic"
            ? RAPIER.RigidBodyDesc.kinematicPositionBased()
            : RAPIER.RigidBodyDesc.dynamic();
      let bodyPosition = pose.position;
      let bodyRotation = pose.rotation;
      if (
        preserveLiveResources &&
        obj.body &&
        typeof obj.body.translation === "function" &&
        typeof obj.body.rotation === "function"
      ) {
        bodyPosition = obj.body.translation() as THREE.Vector3;
        bodyRotation = obj.body.rotation() as THREE.Quaternion;
      }
      bodyDesc.setTranslation(bodyPosition.x, bodyPosition.y, bodyPosition.z);
      bodyDesc.setRotation(new RAPIER.Quaternion(bodyRotation.x, bodyRotation.y, bodyRotation.z, bodyRotation.w));
      if (preserveLiveResources && obj.body && typeof obj.body.isEnabled === "function") {
        bodyDesc.setEnabled(obj.body.isEnabled());
      }
    }

    let colliderDesc: RAPIER.ColliderDesc | undefined;
    if (hasCollider) {
      colliderDesc =
        preserveLiveResources && obj.collider
          ? (this.snapshotEditorColliderDesc(obj.collider, hasBody) ?? undefined)
          : undefined;
      if (!colliderDesc) {
        colliderDesc = this.buildEditorColliderDesc(obj, pose.scale);
        if (!hasBody) {
          const localPosition = new THREE.Vector3(
            colliderDesc.translation.x,
            colliderDesc.translation.y,
            colliderDesc.translation.z,
          );
          const localRotation = new THREE.Quaternion(
            colliderDesc.rotation.x,
            colliderDesc.rotation.y,
            colliderDesc.rotation.z,
            colliderDesc.rotation.w,
          );
          const worldPosition = localPosition.applyQuaternion(pose.rotation).add(pose.position);
          const worldRotation = pose.rotation.clone().multiply(localRotation);
          colliderDesc.setTranslation(worldPosition.x, worldPosition.y, worldPosition.z);
          colliderDesc.setRotation(worldRotation);
        }
      }
    }
    return Object.freeze({ bodyDesc, colliderDesc, colliderAttachedToBody: hasBody });
  }

  private prepareEditorColliderRestore(obj: EditorObject, collider: RAPIER.Collider): () => RAPIER.Collider {
    const desc = this.snapshotEditorColliderDesc(collider, true);
    if (!desc) throw new Error("Cannot capture the collider restore recipe.");
    return () => {
      if (!obj.body) throw new Error("Cannot restore a collider without its rigid body.");
      return this.physicsWorld.world.createCollider(desc, obj.body);
    };
  }

  private syncPhysicsSubtree(
    root: EditorObject,
    shouldRebuildCollider: (entry: EditorObject, nextPose: ObjectWorldPhysicsPose) => boolean,
  ): { ok: true } | { ok: false; reason: string } {
    const subtree = this.physicsSubtree(root);
    const result = syncPhysicsSubtreeAtomically(root.mesh, subtree, {
      shouldRebuildCollider,
      buildColliderDesc: (obj) => this.buildEditorColliderDesc(obj),
      createCollider: (desc, body) => this.physicsWorld.world.createCollider(desc, body as RAPIER.RigidBody),
      removeCollider: (collider) => this.physicsWorld.world.removeCollider(collider, true),
      isColliderLive: (collider) => collider.isValid(),
      prepareColliderRestore: (obj, collider) => this.prepareEditorColliderRestore(obj, collider),
      commitCollider: (obj, replacement) => {
        obj.collider = replacement;
        if (obj.body && this.levelManager.getLevelObjects().includes(obj.mesh)) {
          this.levelManager.updateLevelObjectPhysics(obj.mesh, { body: obj.body, collider: replacement });
        }
      },
    });
    if (!result.ok) console.error("[Editor] Physics subtree sync failed:", result.reason);
    return result;
  }

  applyTransform(id: string, transform: EditorTransformState): boolean {
    const obj = this.document.findById(id);
    if (!obj) return false;
    const previous = this.captureTransformState(obj);
    const previousSerialized = {
      position: [...obj.transform.position] as [number, number, number],
      rotation: [...obj.transform.rotation] as [number, number, number],
      scale: [...obj.transform.scale] as [number, number, number],
    };
    const previousWorldScales = new Map(
      this.physicsSubtree(obj).map((entry) => [entry, getObjectWorldPhysicsPose(entry.mesh).scale.clone()]),
    );
    obj.mesh.position.fromArray(transform.position);
    obj.mesh.rotation.set(...transform.rotation);
    obj.mesh.scale.fromArray(transform.scale);
    this.updateEditorObjectTransform(obj);
    const synced = this.syncPhysicsSubtree(obj, (entry, nextPose) => {
      const previousWorldScale = previousWorldScales.get(entry);
      return previousWorldScale ? effectiveScaleChanged(previousWorldScale, nextPose.scale) : false;
    });
    if (!synced.ok) {
      this.restoreObjectTransform(obj, previous);
      obj.transform = previousSerialized;
      this.syncPhysicsSubtree(obj, neverRebuildCollider);
      this.inspectorPanel.setSelection(obj);
      this.showPhysicsMutationError(`Transform failed; the edit was reverted. ${synced.reason}`);
      return false;
    }
    this.inspectorPanel.setSelection(obj);
    return true;
  }

  private commitTransform(obj: EditorObject, before: EditorTransformState, after: EditorTransformState): boolean {
    this.restoreObjectTransform(obj, before);
    const restored = this.syncPhysicsSubtree(obj, neverRebuildCollider);
    if (!restored.ok) {
      const reconciled = this.syncPhysicsSubtree(obj, neverRebuildCollider);
      this.inspectorPanel.setSelection(obj);
      const rollbackFailure = reconciled.ok ? "" : ` Rollback pose reconciliation also failed. ${reconciled.reason}`;
      this.showPhysicsMutationError(
        `Transform failed; the preview could not be restored. ${restored.reason}${rollbackFailure}`,
      );
      return false;
    }
    const result = buildSetTransformCommand(this, obj.id, before, after);
    if (!result.ok) return true;
    return this.history.push(result.command);
  }

  /* ==================================================================
   *  Delete selection (with undo)
   * ================================================================== */

  private deleteSelection(): void {
    const target = this.document.selected;
    if (target) this.deleteSubtree(target.id);
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
    let exclude: RAPIER.Collider | undefined;
    for (let i = 0; i < 3; i += 1) {
      const hit = this.physicsWorld.castRay(origin, dir, 400, exclude, undefined, (c) => !c.isSensor());
      if (!hit) return;
      const n = this.physicsWorld.castRayAndGetNormal(origin, dir, hit.timeOfImpact + 0.001, exclude);
      if (n?.normal?.y != null && n.normal.y > 0.25) {
        const groundY = originY - hit.timeOfImpact;
        this.grid.setHeight(groundY);
        return;
      }
      exclude = hit.collider;
    }
  }

  /* ==================================================================
   *  Panel sync
   * ================================================================== */

  private syncHierarchy(): void {
    this.hierarchyPanel.setObjects(this.document.objects);
  }

  /* ==================================================================
   *  Save / Load
   * ================================================================== */

  private async saveLevel(): Promise<void> {
    if (!this.commitPendingEdit()) return;
    const currentName = this.documentState.value.name;
    const name = window.prompt("Level name:", currentName === "Untitled" ? "custom" : currentName)?.trim();
    if (!name) return;
    // Preserve the original created timestamp when overwriting an existing level
    const existingLevels = LevelSaveStore.list();
    const existingMeta = existingLevels.find((m) => m.name === name);
    if (existingMeta) {
      const overwrite = window.confirm(`A level named "${name}" already exists. Overwrite it?`);
      if (!overwrite) return;
    }
    let existingCreated: string | undefined;
    if (existingMeta) {
      const existingData = LevelSaveStore.load(existingMeta.key);
      existingCreated = existingData?.created;
    }
    const data = LevelSerializer.serialize(name, this.document.objects, existingCreated);
    LevelSerializer.download(data);
    const result = LevelSaveStore.save(data);
    if (!result.ok) {
      const message =
        result.reason === "quota"
          ? "Save failed — storage full. A file download was started instead."
          : "Save failed — browser storage unavailable. A file download was started instead.";
      this.toolbarPanel.showSaveError(message);
      return;
    }
    this.documentState.markClean(data.name);
    this.toolbarPanel.clearSaveError();
    this.eventBus.emit("editor:saved", { name: data.name });
  }

  private async loadLevel(): Promise<void> {
    if (this.loadTransaction.isBusy) {
      this.showLoadBusyFeedback();
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const loadToken = this.loadTransaction.begin("user-load");
      if (loadToken === null) {
        this.showLoadBusyFeedback();
        return;
      }
      this.glbPlacementTool.cancelPendingImport(this.buildToolContext());
      this.toolbarPanel.setLoadBusy(true);
      try {
        const data = await LevelSerializer.loadFromFile(file);
        if (!this.loadTransaction.isCurrent(loadToken)) return;
        if (!data) {
          this.toolbarPanel.showSaveError("Load rejected — the selected file is not valid Kinema level JSON.");
          return;
        }
        await this.applyLoadedLevel(data, "user-load", loadToken);
      } finally {
        const completion = this.loadTransaction.finish(loadToken);
        if (completion === "completed") this.toolbarPanel.setLoadBusy(false);
      }
    });
    input.click();
  }

  private async applyLoadedLevel(
    data: LevelData,
    intent: "user-load" | "playtest-restore",
    loadToken: EditorLoadToken,
  ): Promise<EditorLoadResult> {
    return this.applyLoadedLevelContents(data, intent, loadToken);
  }

  private async applyLoadedLevelContents(
    data: LevelData,
    intent: "user-load" | "playtest-restore",
    loadToken: EditorLoadToken,
  ): Promise<EditorLoadResult> {
    if (intent === "user-load") {
      const validation = validateEditorLevelData(data);
      if (!validation.ok) {
        console.warn(`[Editor] Rejected level load: ${validation.reason}`);
        this.toolbarPanel.showSaveError(
          "Load rejected — one or more objects or hierarchy links could not be reconstructed.",
        );
        return "failed";
      }
    }
    if (!this.loadTransaction.isCurrent(loadToken)) return "superseded";
    if (intent === "user-load") this.cancelPendingEdit();
    if (intent === "user-load") this.history.clear();

    try {
      const levelTrackedMeshes = new Set(this.levelManager.getLevelObjects());
      this.setSelection(null);
      this.levelManager.unload();

      // Phase 1: remove editor document objects not already owned by LevelManager.
      for (const obj of this.document.objects) {
        if (obj.mesh.parent) {
          obj.mesh.parent.remove(obj.mesh);
        }
        if (!levelTrackedMeshes.has(obj.mesh) && obj.body) {
          this.physicsWorld.removeBody(obj.body);
          obj.body = undefined;
          obj.collider = undefined;
        } else if (!levelTrackedMeshes.has(obj.mesh) && obj.collider) {
          this.physicsWorld.removeCollider(obj.collider);
          obj.collider = undefined;
        }
        if (levelTrackedMeshes.has(obj.mesh)) {
          obj.body = undefined;
          obj.collider = undefined;
        }
      }
      this.document.objects = [];

      // Phase 2: remove any remaining level-loaded objects from the scene.
      // These are meshes that were loaded by LevelManager.loadFromJSON but are
      // NOT tracked in document.objects (e.g., after levelManager arrays were
      // already cleared by a previous restore).
      for (const mesh of [...this.levelManager.getLevelObjects()]) {
        this.renderer.scene.remove(mesh);
        this.levelManager.removeLevelObject(mesh, { removePhysics: true });
      }

      // Phase 3: remove any orphaned editor objects from scene.
      // Safety sweep: catches GLB Groups, Meshes, or any Object3D tagged with
      // editorSource that survived previous restores. Only collect roots (objects
      // whose parent is NOT also tagged) to avoid removing children twice.
      const orphanedRoots: THREE.Object3D[] = [];
      this.renderer.scene.traverse((child) => {
        if (child.userData?.editorSource && !child.parent?.userData?.editorSource) {
          orphanedRoots.push(child);
        }
      });
      for (const node of orphanedRoots) {
        node.parent?.remove(node);
      }

      // ── Phase 4: Spawn fresh objects from the snapshot ──
      for (const entry of data.objects) {
        if (!this.loadTransaction.isCurrent(loadToken)) return "superseded";
        if (!(await this.spawnSerializedObject(entry, loadToken))) {
          if (!this.loadTransaction.isCurrent(loadToken)) return "superseded";
          throw new Error(`Object "${entry.id}" could not be reconstructed.`);
        }
        if (!this.loadTransaction.isCurrent(loadToken)) return "superseded";
      }

      // ── Phase 5: Reconstruct parent-child hierarchy ──
      // spawnSerializedObject adds all objects as direct scene children.
      // Resolve parentId references and re-attach children to their parents.
      for (const obj of this.document.objects) {
        obj.children = [];
      }
      for (const obj of this.document.objects) {
        if (!obj.parentId) continue;
        const parent = this.document.findById(obj.parentId);
        if (!parent) {
          throw new Error(`Parent "${obj.parentId}" for object "${obj.id}" was not reconstructed.`);
        }
        parent.mesh.add(obj.mesh);
        if (obj.mesh.parent !== parent.mesh) {
          throw new Error(`Hierarchy edge "${obj.parentId}" -> "${obj.id}" could not be reconstructed.`);
        }
        if (!parent.children) parent.children = [];
        if (!parent.children.includes(obj.id)) {
          parent.children.push(obj.id);
        }
        this.updateEditorObjectTransform(obj);
      }

      this.renderer.scene.updateWorldMatrix(true, true);
      for (const entry of data.objects) {
        if (!this.loadTransaction.isCurrent(loadToken)) return "superseded";
        const obj = this.document.findById(entry.id);
        if (!obj) throw new Error(`Object "${entry.id}" disappeared before physics reconstruction.`);
        this.createSerializedObjectPhysics(obj, entry);
        this.levelManager.removeLevelObject(obj.mesh);
        this.levelManager.addLevelObject(obj.mesh, this.createLevelObjectTracking(obj));
      }
      this.documentNeedsRebuild = false;
    } catch (err) {
      if (!this.loadTransaction.isCurrent(loadToken)) return "superseded";
      console.error(`[Editor] ${intent === "user-load" ? "Level load" : "Play-test restore"} failed:`, err);
      this.markDirty();
      this.syncHierarchy();
      this.toolbarPanel.showSaveError(
        intent === "user-load"
          ? "Load failed — the recovered document has unsaved changes and remains protected."
          : "Play-test restore failed — the recovered document has unsaved changes and remains protected.",
      );
      return "failed";
    }

    if (!this.loadTransaction.isCurrent(loadToken)) return "superseded";
    if (intent === "user-load") {
      this.documentState.markClean(data.name);
      this.toolbarPanel.clearSaveError();
    }
    this.syncHierarchy();
    this.eventBus.emit("editor:loaded", { name: data.name });
    return "completed";
  }

  private async spawnSerializedObject(
    entry: LevelData["objects"][number],
    loadToken: EditorLoadToken,
  ): Promise<boolean> {
    let obj: THREE.Object3D | null = null;
    if (entry.source.type === "primitive" && entry.source.primitive) {
      const p = entry.source.primitive;
      if (p === "group") {
        obj = new THREE.Group();
      } else {
        let geometry: THREE.BufferGeometry;
        if (p === "sphere") geometry = new THREE.SphereGeometry(0.5, 16, 16);
        else if (p === "cylinder") geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
        else if (p === "capsule") geometry = new THREE.CapsuleGeometry(0.4, 0.6, 6, 12);
        else if (p === "plane") geometry = new THREE.PlaneGeometry(1, 1);
        else geometry = new THREE.BoxGeometry(1, 1, 1);
        obj = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb0c4de, roughness: 0.6 }));
      }
    } else if (entry.source.type === "brush" && entry.source.brush) {
      const brush = getBrushById(entry.source.brush);
      if (brush) {
        // Use the brush's own default params — NOT hardcoded (1,0,1)/height:1
        const bp = brush.defaultParams;
        const params = {
          anchor: bp?.anchor?.clone() ?? new THREE.Vector3(0, 0, 0),
          current: bp?.current?.clone() ?? new THREE.Vector3(1, 0, 1),
          normal: bp?.normal?.clone() ?? new THREE.Vector3(0, 1, 0),
          height: bp?.height ?? 1,
        };
        // Rebuild geometry from the serialized footprint when present —
        // otherwise saved brushParams are write-only and any future
        // param-editing feature would silently lose its edits on load.
        const saved = entry.brushParams;
        if (saved) {
          params.current = params.anchor.clone().add(new THREE.Vector3(saved.width ?? 1, 0, saved.depth ?? 1));
          params.height = saved.height ?? params.height;
        }
        const geometry = brush.buildPreviewGeometry(params);
        const material = brush.getDefaultMaterial();
        obj = new THREE.Mesh(geometry, material);
      }
    } else if (entry.source.type === "glb" && entry.source.asset) {
      try {
        const gltf = await this.levelManager.getAssetLoader().load(entry.source.asset);
        obj = gltf.scene;
        // Preserve animation clips
        if (gltf.animations?.length) {
          obj.userData.animations = gltf.animations;
        }
      } catch (err) {
        console.warn(`[Editor] Failed to load GLB "${entry.source.asset}", using placeholder`, err);
        obj = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true }),
        );
        obj.userData.editorMissingAssetPath = entry.source.asset;
      }
    }
    if (!this.loadTransaction.isCurrent(loadToken)) return false;
    if (!obj) return false;

    obj.position.set(entry.transform.position[0], entry.transform.position[1], entry.transform.position[2]);
    obj.rotation.set(entry.transform.rotation[0], entry.transform.rotation[1], entry.transform.rotation[2]);
    obj.scale.set(entry.transform.scale[0], entry.transform.scale[1], entry.transform.scale[2]);
    obj.name = entry.name;
    obj.userData.editorSource = entry.source;

    const editorObj = this.buildEditorObject(obj);
    editorObj.id = entry.id;
    editorObj.name = entry.name;
    editorObj.source = entry.source;
    editorObj.parentId = entry.parentId ?? null;
    editorObj.visible = entry.visible ?? true;
    editorObj.locked = entry.locked ?? false;
    editorObj.spawnTag = entry.spawnTag;
    obj.visible = editorObj.visible;

    // Apply material properties from serialized data.
    // For GLBs (Groups), traverse children to find the first MeshStandardMaterial.
    if (entry.material) {
      const applyMat = (target: THREE.Object3D): void => {
        if (target instanceof THREE.Mesh && target.material instanceof THREE.MeshStandardMaterial) {
          const mat = target.material;
          mat.color.set(entry.material!.color);
          mat.roughness = entry.material!.roughness;
          mat.metalness = entry.material!.metalness;
          mat.emissive.set(entry.material!.emissive);
          mat.emissiveIntensity = entry.material!.emissiveIntensity;
          if (entry.material!.opacity < 1) {
            mat.transparent = true;
            mat.opacity = entry.material!.opacity;
          }
        }
      };
      if (obj instanceof THREE.Mesh) {
        applyMat(obj);
      } else {
        obj.traverse(applyMat);
      }
      editorObj.material = entry.material;
    }

    if (entry.brushParams) {
      editorObj.brushParams = entry.brushParams;
    }

    editorObj.physicsType = entry.physics?.type ?? "static";
    this.document.addObject(editorObj, this.renderer.scene);
    // Track the visual immediately so an external load that supersedes a later
    // awaited object can still tear down this partially reconstructed document.
    this.levelManager.addLevelObject(editorObj.mesh);
    return this.document.findById(entry.id) === editorObj && obj.parent === this.renderer.scene;
  }

  private createSerializedObjectPhysics(editorObj: EditorObject, entry: LevelData["objects"][number]): void {
    const isTransformOnlyGroup = entry.source.type === "primitive" && entry.source.primitive === "group";
    if (!entry.physics || isTransformOnlyGroup || !editorObj.visible) return;

    const pose = getObjectWorldPhysicsPose(editorObj.mesh);
    const bodyDesc =
      entry.physics.type === "static"
        ? RAPIER.RigidBodyDesc.fixed()
        : entry.physics.type === "kinematic"
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.dynamic();
    bodyDesc.setTranslation(pose.position.x, pose.position.y, pose.position.z);
    bodyDesc.setRotation(new RAPIER.Quaternion(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w));
    const colliderDesc = this.buildEditorColliderDesc(editorObj, pose.scale);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);

    let collider: RAPIER.Collider;
    try {
      collider = this.physicsWorld.world.createCollider(colliderDesc, body);
    } catch (error) {
      this.physicsWorld.removeBody(body);
      throw error;
    }
    editorObj.body = body;
    editorObj.collider = collider;
  }
}
