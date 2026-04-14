import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type { GameLoop } from "@core/GameLoop";
import RAPIER from "@dimforge/rapier3d-compat";
import { exitPointerLockIfSupported } from "@input/pointerLock";
import type { InteractionManager } from "@interaction/InteractionManager";
import type { LevelManager } from "@level/LevelManager";
import { LevelSaveStore } from "@level/LevelSaveStore";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type { RendererManager } from "@renderer/RendererManager";
import * as THREE from "three";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { BRUSH_REGISTRY, getBrushById } from "./brushes/index";
import { CommandHistory } from "./CommandHistory";
import { EditorDocument } from "./EditorDocument";
import type { EditorObject } from "./EditorObject";
import { FreeCamera } from "./FreeCamera";
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

export class EditorManager {
  private active = false;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private selectionHelper: THREE.BoxHelper | null = null;
  private dragStartTransform: {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  } | null = null;

  /* ---- Data model ---- */
  private document: EditorDocument;

  /* ---- Play-test state ---- */
  private playTestActive = false;
  private playTestSnapshot: string | null = null;
  private playTestCameraState: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
  private playTestStopButton: HTMLElement | null = null;

  /* ---- Subsystems ---- */
  private gizmo: TransformGizmo;
  private grid: SnapGrid;
  private gridWasVisible = true;
  private freeCamera: FreeCamera;
  private history = new CommandHistory();

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
    this.freeCamera = new FreeCamera(this.renderer.camera, this.renderer.canvas);
    this.grid = new SnapGrid(this.renderer.scene);

    /* ---- Panels ---- */
    this.toolbarPanel = new ToolbarPanel({
      onSave: () => this.saveLevel(),
      onLoad: () => this.loadLevel(),
      onImportGLB: () => this.onImportGLB(),
      onUndo: () => this.history.undo(),
      onRedo: () => this.history.redo(),
      onToggleSnap: () => this.toggleSnap(),
      onToggleGrid: () => {
        this.grid.toggleGrid();
        this.toolbarPanel.setGridActive(this.grid.isVisible());
      },
      onSetMode: (mode) => this.setTransformMode(mode),
      onPlayTest: () => this.startPlayTest(),
    });

    this.brushPanel = new BrushPanel((brushId) => this.onBrushSelected(brushId));

    this.hierarchyPanel = new HierarchyPanel({
      onSelect: (id) => this.selectById(id),
      onDelete: (id) => this.deleteById(id),
      onDuplicate: (id) => this.duplicateById(id),
      onRename: (id, name) => {
        this.document.renameById(id, name);
        this.syncHierarchy();
      },
      onToggleVisible: (id) => {
        const wasSelected = this.document.selected?.id === id;
        this.document.toggleVisibleById(id);
        // If hiding the selected object, deselect to detach gizmo/inspector
        if (wasSelected) {
          const obj = this.document.findById(id);
          if (obj && !obj.visible) {
            this.setSelection(null);
          }
        }
        this.syncHierarchy();
      },
      onToggleLock: (id) => {
        const wasSelected = this.document.selected?.id === id;
        this.document.toggleLockById(id);
        // toggleLockById clears document.selected directly; sync gizmo/inspector
        if (wasSelected && !this.document.selected) {
          this.setSelection(null);
        }
        this.syncHierarchy();
      },
      onReparent: (childId, newParentId) => {
        this.document.reparentById(childId, newParentId);
        this.syncHierarchy();
      },
      onGroup: (ids) => {
        const groupObj = this.document.groupObjects(ids);
        if (groupObj) {
          this.syncHierarchy();
          this.setSelection(groupObj);
        }
      },
      onUngroup: (groupId) => {
        const wasSelected = this.document.selected;
        if (this.document.ungroupObject(groupId)) {
          if (wasSelected && wasSelected.id === groupId) this.setSelection(null);
          this.syncHierarchy();
        }
      },
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

    /* ---- Tools ---- */
    this.selectionTool = new SelectionTool();
    this.brushPlacementTool = new BrushPlacementTool({
      onFinished: () => this.switchTool("selection"),
      onBrushChanged: (brushId) => this.brushPanel.setActiveBrush(brushId),
    });
    this.glbPlacementTool = new GLBPlacementTool({
      levelManager: this.levelManager,
      onFinished: () => this.switchTool("selection"),
    });
    this.tools.set(this.selectionTool.id, this.selectionTool);
    this.tools.set(this.brushPlacementTool.id, this.brushPlacementTool);
    this.tools.set(this.glbPlacementTool.id, this.glbPlacementTool);
    this.activeTool = this.selectionTool;

    this.unsubs.push(this.eventBus.on("editor:toggle", () => this.toggle()));

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
    this.activeTool.update?.(this.buildToolContext(), dt);
    this.selectionHelper?.update();
  }

  dispose(): void {
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
      addEditorObject: (obj, parent) => this.document.addObject(obj, parent),
      removeEditorObject: (id) => {
        const obj = this.document.findById(id);
        if (obj) this.document.removeObject(obj);
      },
      syncHierarchy: () => this.syncHierarchy(),
      syncInspector: () => {
        if (this.document.selected) this.inspectorPanel.setSelection(this.document.selected);
      },
    };
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

  /**
   * @param rebuildObjects - When true (default), scans levelManager for objects.
   *   Set to false when restoring from play-test snapshot (applyLoadedLevel
   *   handles object population instead).
   */
  private enter(rebuildObjects = true): void {
    this.active = true;
    this.gameLoop.setSimulationEnabled(false);
    this.interactionManager.setEnabled(false);
    this.player.setActive(false);
    this.player.setEnabled(false); // Hide player mesh + disable physics
    // Ensure cursor is free and visible in editor mode
    exitPointerLockIfSupported();
    this.renderer.canvas.style.cursor = "default";
    this.eventBus.emit("editor:opened", undefined);
    this.freeCamera.enable();
    this.grid.setVisible(this.gridWasVisible);
    for (const panel of this.panels) panel.show();
    if (rebuildObjects) {
      this.buildEditorObjects();
    }
    this.syncHierarchy();
    this.syncToolbarState();
    this.bindEditorInput();
    this.renderer.canvas.addEventListener("dragover", this.onDragOver);
    this.renderer.canvas.addEventListener("drop", this.onDrop);
  }

  private exit(): void {
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
  }

  /* ==================================================================
   *  Play-test mode
   * ================================================================== */

  private startPlayTest(): void {
    if (this.playTestActive) return;

    // Sync all EditorObject transforms from live mesh state before serializing,
    // so the snapshot captures the actual current transforms (not stale data).
    for (const obj of this.document.objects) {
      this.updateEditorObjectTransform(obj);
    }

    // Serialize current level state
    const data = LevelSerializer.serialize("__playtest__", this.document.objects);
    this.playTestSnapshot = JSON.stringify(data);

    // Save camera state (enter() will call freeCamera.enable() which re-derives yaw/pitch)
    this.playTestCameraState = {
      position: this.renderer.camera.position.clone(),
      quaternion: this.renderer.camera.quaternion.clone(),
    };

    this.playTestActive = true;

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

  private async stopPlayTest(): Promise<void> {
    if (!this.playTestActive) return;

    // Remove stop button
    if (this.playTestStopButton) {
      this.playTestStopButton.remove();
      this.playTestStopButton = null;
    }

    this.playTestActive = false;

    // ── Step 1: Restore scene from snapshot BEFORE re-entering editor ──
    // Await to ensure all objects are fully spawned before entering editor.
    if (this.playTestSnapshot) {
      const data = JSON.parse(this.playTestSnapshot) as LevelData;
      try {
        await this.applyLoadedLevel(data);
      } catch (err) {
        console.error("[Editor] Failed to restore play-test snapshot:", err);
      }
      this.playTestSnapshot = null;
    }

    // ── Step 2: Re-enter editor mode (skip buildEditorObjects — objects
    //    are already populated by applyLoadedLevel) ──
    this.enter(false);

    // ── Step 3: Restore camera state ──
    if (this.playTestCameraState) {
      this.renderer.camera.position.copy(this.playTestCameraState.position);
      this.renderer.camera.quaternion.copy(this.playTestCameraState.quaternion);
      this.playTestCameraState = null;
      this.freeCamera.disable();
      this.freeCamera.enable();
    }

    // Clear selection and sync UI
    this.setSelection(null);
    this.syncHierarchy();
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

    // Ignore keyboard shortcuts when typing in an input or contenteditable
    const target = e.target as HTMLElement;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (target?.isContentEditable) return;

    const cmd = navigator.platform.toUpperCase().includes("MAC") ? e.metaKey : e.ctrlKey;

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
    if (e.code === "KeyE" && !cmd && this.document.selected) this.setTransformMode("rotate");
    if (e.code === "KeyR" && !cmd && this.document.selected) this.setTransformMode("scale");
    if (e.code === "KeyG" && !cmd) {
      this.grid.toggleGrid();
      this.toolbarPanel.setGridActive(this.grid.isVisible());
    }
    if (e.code === "KeyZ" && cmd) {
      this.history.undo();
      e.preventDefault();
    }
    if ((e.code === "KeyY" && cmd) || (e.code === "KeyZ" && cmd && e.shiftKey)) {
      this.history.redo();
      e.preventDefault();
    }
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
    this.freeCamera.disable();
    this.freeCamera.enable();
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
    this.document.objects = Array.from(map.values());
  }

  private buildEditorObject(mesh: THREE.Object3D): EditorObject {
    const source = this.detectSource(mesh);
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
      physicsType: "static",
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

  private deleteById(id: string): void {
    const obj = this.document.findById(id);
    if (!obj) return;
    this.setSelection(obj);
    this.deleteSelection();
  }

  private duplicateById(id: string): void {
    const newObj = this.document.duplicateById(id);
    if (!newObj) return;

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
      const body = this.physicsWorld.world.createRigidBody(bodyDesc);

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
      const collider = this.physicsWorld.world.createCollider(colliderDesc, body);
      newObj.body = body;
      newObj.collider = collider;
    }

    this.history.push({
      execute: () => {
        this.document.addObject(newObj, this.renderer.scene);
        this.syncHierarchy();
        this.eventBus.emit("editor:objectAdded", { id: newObj.id });
      },
      undo: () => {
        this.document.removeObject(newObj);
        this.syncHierarchy();
        this.eventBus.emit("editor:objectRemoved", { id: newObj.id });
      },
    });
    this.setSelection(newObj);
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
    if (!this.document.selected) return;
    const meshObj = this.document.selected.mesh as THREE.Mesh;
    if (!meshObj.isMesh || !meshObj.material) return;

    const mat = meshObj.material as THREE.MeshStandardMaterial;
    mat.color.set(material.color);
    mat.roughness = material.roughness;
    mat.metalness = material.metalness;
    mat.emissive.set(material.emissive);
    mat.emissiveIntensity = material.emissiveIntensity;
    mat.opacity = material.opacity;
    // Only trigger shader recompile when transparent flag actually changes
    // (uniform-only changes like color/roughness auto-sync without needsUpdate)
    const needsTransparent = material.opacity < 1;
    if (mat.transparent !== needsTransparent) {
      mat.transparent = needsTransparent;
      mat.needsUpdate = true;
    }

    // Update editor object material record
    this.document.selected.material = { ...material };
  }

  /* ==================================================================
   *  Physics type change
   * ================================================================== */

  private applyPhysicsTypeChange(id: string, type: "static" | "dynamic" | "kinematic"): void {
    const obj = this.document.findById(id);
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
    if (type === "static") {
      bodyDesc = RAPIER.RigidBodyDesc.fixed();
    } else if (type === "kinematic") {
      bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    } else {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic();
    }
    bodyDesc.setTranslation(pos.x, pos.y, pos.z);
    bodyDesc.setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w));

    const body = this.physicsWorld.world.createRigidBody(bodyDesc);

    // Recreate collider -- approximate from bounding box
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
    if (!this.document.selected) return;
    this.document.selected.mesh.position.set(transform.position[0], transform.position[1], transform.position[2]);
    this.document.selected.mesh.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
    this.document.selected.mesh.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
    this.document.selected.mesh.updateMatrixWorld(true);
    this.updateEditorObjectTransform(this.document.selected);
    this.applyPhysicsTransform(this.document.selected);
  }

  /* ==================================================================
   *  Gizmo callbacks
   * ================================================================== */

  private onDragStateChanged(dragging: boolean): void {
    if (dragging && this.document.selected) {
      this.dragStartTransform = {
        position: this.document.selected.mesh.position.clone(),
        rotation: this.document.selected.mesh.rotation.clone(),
        scale: this.document.selected.mesh.scale.clone(),
      };
    } else if (!dragging && this.document.selected && this.dragStartTransform) {
      const target = this.document.selected;
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
    if (!this.document.selected) return;
    this.updateEditorObjectTransform(this.document.selected);
    if (this.grid.enabled) {
      this.applySnapToSelection();
    }
    this.applyPhysicsTransform(this.document.selected);
    this.inspectorPanel.setSelection(this.document.selected);
    // Force world matrix update so BoxHelper.update() reads correct bounds
    this.document.selected.mesh.updateMatrixWorld(true);
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
    if (!this.document.selected) return;
    const snap = this.grid.positionSnap;
    const pos = this.document.selected.mesh.position;
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

  private applyPhysicsTransform(obj: EditorObject): void {
    if (!obj.body) return;
    const pos = obj.mesh.position;
    obj.body.setTranslation(new RAPIER.Vector3(pos.x, pos.y, pos.z), true);
    const q = obj.mesh.quaternion;
    obj.body.setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w), true);

    // Rebuild collider when scale changes (collider shape cannot be rescaled in-place).
    // Must handle different shape types: cuboid, cylinder, trimesh.
    if (obj.collider && obj.body) {
      obj.mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj.mesh);
      const size = box.getSize(new THREE.Vector3());

      // Determine if rebuild is needed by comparing against current AABB size
      const shapeType = obj.collider.shapeType();
      let needsRebuild = false;

      if (shapeType === RAPIER.ShapeType.Cuboid) {
        const cur = (obj.collider.shape as RAPIER.Cuboid).halfExtents;
        needsRebuild =
          Math.abs(cur.x - size.x / 2) > 0.001 ||
          Math.abs(cur.y - size.y / 2) > 0.001 ||
          Math.abs(cur.z - size.z / 2) > 0.001;
      } else {
        // For trimesh/cylinder: always rebuild on any scale change since
        // we can't easily compare the current shape's dimensions
        needsRebuild = true;
      }

      if (needsRebuild) {
        this.physicsWorld.world.removeCollider(obj.collider, true);
        // Use shape-appropriate collider if this is a brush object
        const meshObj = obj.mesh as THREE.Mesh;
        let colliderDesc: RAPIER.ColliderDesc;
        if (obj.source?.type === "brush" && obj.source.brush && meshObj.isMesh && meshObj.geometry) {
          colliderDesc = buildColliderDesc(obj.source.brush, meshObj.geometry, meshObj);
        } else {
          colliderDesc = RAPIER.ColliderDesc.cuboid(
            Math.max(size.x / 2, 0.01),
            Math.max(size.y / 2, 0.01),
            Math.max(size.z / 2, 0.01),
          );
        }
        obj.collider = this.physicsWorld.world.createCollider(colliderDesc, obj.body);
      }
    }
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
   *  Delete selection (with undo)
   * ================================================================== */

  private deleteSelection(): void {
    if (!this.document.selected) return;
    const target = this.document.selected;
    const parent = target.mesh.parent ?? this.renderer.scene;
    this.history.push({
      execute: () => {
        this.document.removeObject(target);
        this.levelManager.removeLevelObject(target.mesh);
        this.setSelection(null);
        this.syncHierarchy();
        this.eventBus.emit("editor:objectRemoved", { id: target.id });
      },
      undo: () => {
        this.document.addObject(target, parent);
        this.syncHierarchy();
        this.eventBus.emit("editor:objectAdded", { id: target.id });
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
    const name = window.prompt("Level name:", "custom");
    if (!name) return;
    // Preserve the original created timestamp when overwriting an existing level
    const existingLevels = LevelSaveStore.list();
    const existingMeta = existingLevels.find((m) => m.name === name);
    let existingCreated: string | undefined;
    if (existingMeta) {
      const existingData = LevelSaveStore.load(existingMeta.key);
      existingCreated = existingData?.created;
    }
    const data = LevelSerializer.serialize(name, this.document.objects, existingCreated);
    LevelSerializer.download(data);
    LevelSaveStore.save(data);
    this.eventBus.emit("editor:saved", { name: data.name });
  }

  private async loadLevel(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const data = await LevelSerializer.loadFromFile(file);
      if (!data) return;
      void this.applyLoadedLevel(data);
    });
    input.click();
  }

  private async applyLoadedLevel(data: LevelData): Promise<void> {
    // ── Phase 1: Remove ALL tracked editor objects ──
    for (const obj of this.document.objects) {
      if (obj.mesh.parent) {
        obj.mesh.parent.remove(obj.mesh);
      }
      if (obj.body) {
        this.physicsWorld.removeBody(obj.body);
        obj.body = undefined;
        obj.collider = undefined;
      } else if (obj.collider) {
        this.physicsWorld.removeCollider(obj.collider);
        obj.collider = undefined;
      }
    }
    this.document.objects = [];

    // ── Phase 2: Remove any remaining level-loaded objects from the scene ──
    // These are meshes that were loaded by LevelManager.loadFromJSON but are
    // NOT tracked in document.objects (e.g., after levelManager arrays were
    // already cleared by a previous restore).
    for (const mesh of [...this.levelManager.getLevelObjects()]) {
      this.renderer.scene.remove(mesh);
      this.levelManager.removeLevelObject(mesh);
    }

    // ── Phase 3: Remove any orphaned editor objects from scene ──
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
      await this.spawnSerializedObject(entry);
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
        obj.parentId = null;
        continue;
      }
      parent.mesh.add(obj.mesh);
      if (!parent.children) parent.children = [];
      if (!parent.children.includes(obj.id)) {
        parent.children.push(obj.id);
      }
      this.updateEditorObjectTransform(obj);
    }

    this.syncHierarchy();
    this.eventBus.emit("editor:loaded", { name: data.name });
  }

  private async spawnSerializedObject(entry: LevelData["objects"][number]): Promise<void> {
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
        const geometry = brush.buildPreviewGeometry(params);
        const material = brush.getDefaultMaterial();
        obj = new THREE.Mesh(geometry, material);
      }
    } else if (entry.source.type === "glb" && entry.source.asset) {
      try {
        const gltf = await this.levelManager.getAssetLoader().load(entry.source.asset);
        obj = skeletonClone(gltf.scene);
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
      }
    }
    if (!obj) return;

    obj.position.set(entry.transform.position[0], entry.transform.position[1], entry.transform.position[2]);
    obj.rotation.set(entry.transform.rotation[0], entry.transform.rotation[1], entry.transform.rotation[2]);
    obj.scale.set(entry.transform.scale[0], entry.transform.scale[1], entry.transform.scale[2]);
    obj.name = entry.name;
    obj.userData.editorSource = entry.source;

    const editorObj = this.buildEditorObject(obj);
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

    // Create physics body if applicable
    const isTransformOnlyGroup = entry.source.type === "primitive" && entry.source.primitive === "group";
    if (entry.physics && !isTransformOnlyGroup) {
      let bodyDesc: RAPIER.RigidBodyDesc;
      if (entry.physics.type === "static") {
        bodyDesc = RAPIER.RigidBodyDesc.fixed();
      } else if (entry.physics.type === "kinematic") {
        bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
      } else {
        bodyDesc = RAPIER.RigidBodyDesc.dynamic();
      }
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      bodyDesc.setTranslation(center.x, center.y, center.z);
      const body = this.physicsWorld.world.createRigidBody(bodyDesc);

      // Use shape-appropriate collider for brushes, AABB cuboid for others
      let colliderDesc: RAPIER.ColliderDesc;
      const meshObj = obj as THREE.Mesh;
      if (entry.source.type === "brush" && entry.source.brush && meshObj.isMesh && meshObj.geometry) {
        colliderDesc = buildColliderDesc(entry.source.brush, meshObj.geometry, meshObj);
      } else {
        const size = box.getSize(new THREE.Vector3());
        colliderDesc = RAPIER.ColliderDesc.cuboid(
          Math.max(size.x / 2, 0.01),
          Math.max(size.y / 2, 0.01),
          Math.max(size.z / 2, 0.01),
        );
      }

      const collider = this.physicsWorld.world.createCollider(colliderDesc, body);
      editorObj.body = body;
      editorObj.collider = collider;
      editorObj.physicsType = entry.physics.type as "static" | "dynamic" | "kinematic";
    }

    this.document.addObject(editorObj, this.renderer.scene);
  }
}
