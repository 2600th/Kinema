import type { EventBus } from "@core/EventBus";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type * as THREE from "three";
import type { CommandHistory } from "../CommandHistory";
import type { EditorObject } from "../EditorObject";
import type { SnapGrid } from "../SnapGrid";
import type { TransformGizmo } from "../TransformGizmo";

export interface EditorToolContext {
  scene: THREE.Scene;
  physicsWorld: PhysicsWorld;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  gizmo: TransformGizmo;
  snapGrid: SnapGrid;
  history: CommandHistory;
  eventBus: EventBus;
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;
  editorObjects: EditorObject[];
  selected: EditorObject | null;
  setSelection(obj: EditorObject | null): void;
  addEditorObject(obj: EditorObject, parent?: THREE.Object3D): void;
  removeEditorObject(id: string): void;
  syncHierarchy(): void;
  syncInspector(): void;
}

export interface EditorTool {
  readonly id: string;
  activate?(ctx: EditorToolContext): void;
  deactivate?(ctx: EditorToolContext): void;
  onPointerDown?(ctx: EditorToolContext, e: MouseEvent): boolean;
  onPointerMove?(ctx: EditorToolContext, e: MouseEvent): void;
  onPointerUp?(ctx: EditorToolContext, e: MouseEvent): void;
  onKeyDown?(ctx: EditorToolContext, e: KeyboardEvent): boolean;
  update?(ctx: EditorToolContext, dt: number): void;
}
