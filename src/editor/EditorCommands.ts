import type { Command } from "./CommandHistory";

export type EditorTransformState = Readonly<{
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: readonly [number, number, number];
}>;

export type EditorSerializedMaterialState = Readonly<{
  color: string;
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
}>;

export type EditorLiveMaterialState = Readonly<{
  material: object;
  color: string;
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
}>;

export type EditorMaterialState = Readonly<{
  serialized: EditorSerializedMaterialState | undefined;
  live: readonly EditorLiveMaterialState[];
}>;

export type EditorPhysicsState = unknown;
export type EditorHierarchyState = unknown;
export type EditorSubtreeState = unknown;
export type EditorMutationNotice = unknown;

export type CommandBuildResult = { ok: true; command: Command } | { ok: false; reason: string };

export interface EditorMutationHost {
  applyTransform(id: string, state: EditorTransformState): boolean;
  applyMaterial(id: string, state: EditorMaterialState): boolean;
  replacePhysics(id: string, state: EditorPhysicsState): boolean;
  applyHierarchy(state: EditorHierarchyState): boolean;
  detachSubtree(state: EditorSubtreeState): boolean;
  restoreSubtree(state: EditorSubtreeState): boolean;
  finalizeDetachedSubtree(state: EditorSubtreeState): void;
  afterMutation(notice: EditorMutationNotice): void;
  reportFailure(reason: string): void;
}

export function createStateCommand<T>(before: T, after: T, apply: (value: T) => boolean): Command {
  return { execute: () => apply(after), undo: () => apply(before) };
}
