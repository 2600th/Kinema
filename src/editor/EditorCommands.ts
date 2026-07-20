import type RAPIER from "@dimforge/rapier3d-compat";
import type { RemovedLevelObjectTracking } from "@level/LevelManager";
import type * as THREE from "three";
import type { Command } from "./CommandHistory";
import type { EditorObject } from "./EditorObject";

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
  color: readonly [number, number, number];
  roughness: number;
  metalness: number;
  emissive: readonly [number, number, number];
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
}>;

export type EditorMaterialState = Readonly<{
  serialized: EditorSerializedMaterialState | undefined;
  live: readonly EditorLiveMaterialState[];
}>;

export type EditorPhysicsType = "static" | "dynamic" | "kinematic";
export type EditorPhysicsResourceRecipe = Readonly<{
  bodyDesc?: RAPIER.RigidBodyDesc;
  colliderDesc?: RAPIER.ColliderDesc;
  colliderAttachedToBody: boolean;
}>;
export type EditorPhysicsState = Readonly<{
  type: EditorPhysicsType;
  levelTracked: boolean;
  hasBody: boolean;
  hasCollider: boolean;
  resourceRecipe?: EditorPhysicsResourceRecipe;
}>;
export type EditorHierarchyNodeState = Readonly<{
  object: EditorObject;
  documentIndex: number;
  parent: THREE.Object3D | null;
  childIndex: number;
  parentId: string | null;
  children: readonly string[];
  localTransform: EditorTransformState;
}>;
export type EditorHierarchySnapshot = Readonly<{
  nodes: readonly EditorHierarchyNodeState[];
  selection: EditorObject | null;
}>;
export type EditorHierarchyTrackingState = Readonly<{
  object: EditorObject;
  tracked: boolean;
  tracking: RemovedLevelObjectTracking;
}>;
export type EditorStructuralHierarchyState = Readonly<{
  type: "structure";
  operation: "reparent" | "group" | "ungroup";
  document: EditorHierarchySnapshot;
  tracking: readonly EditorHierarchyTrackingState[];
  physicsRootIds: readonly string[];
}>;
export type EditorScalarHierarchyState =
  | Readonly<{ type: "rename"; id: string; name: string }>
  | Readonly<{ type: "visibility"; id: string; visible: boolean; selectionId: string | null }>
  | Readonly<{ type: "lock"; id: string; locked: boolean; selectionId: string | null }>;
export type EditorHierarchyState = EditorScalarHierarchyState | EditorStructuralHierarchyState;
export type EditorSubtreeState = Readonly<{ rootId: string }>;
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
  finalizeDetachedHierarchyObject(object: EditorObject): void;
  afterMutation(notice: EditorMutationNotice): void;
  reportFailure(reason: string): void;
}

type DeleteSubtreeMutationHost = Pick<
  EditorMutationHost,
  "detachSubtree" | "restoreSubtree" | "finalizeDetachedSubtree" | "afterMutation" | "reportFailure"
>;

export function createStateCommand<T>(before: T, after: T, apply: (value: T) => boolean): Command {
  return { execute: () => apply(after), undo: () => apply(before) };
}

export function createOwnedCreationCommand(
  execute: () => unknown,
  undo: () => unknown,
  discardDetached: () => void,
): Command {
  let applied = false;
  let discarded = false;
  return {
    execute: () => {
      if (discarded || applied) return false;
      if (execute() === false) return false;
      applied = true;
      return true;
    },
    undo: () => {
      if (discarded || !applied) return false;
      if (undo() === false) return false;
      applied = false;
      return true;
    },
    discard: () => {
      if (discarded) return;
      discarded = true;
      if (!applied) discardDetached();
    },
  };
}

type ScalarMutationHost = { applyHierarchy(state: EditorScalarHierarchyState): boolean };

function buildScalarCommand(
  host: ScalarMutationHost,
  before: EditorScalarHierarchyState,
  after: EditorScalarHierarchyState,
): CommandBuildResult {
  if (!before.id.trim()) return { ok: false, reason: "Cannot edit an object without an id." };
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return { ok: false, reason: `Object "${before.id}" already has the requested value.` };
  }
  return { ok: true, command: createStateCommand(before, after, (state) => host.applyHierarchy(state)) };
}

export function buildRenameCommand(
  host: ScalarMutationHost,
  id: string,
  beforeName: string,
  afterName: string,
): CommandBuildResult {
  return buildScalarCommand(
    host,
    Object.freeze({ type: "rename", id, name: beforeName }),
    Object.freeze({ type: "rename", id, name: afterName }),
  );
}

export function buildVisibilityCommand(
  host: ScalarMutationHost,
  id: string,
  beforeVisible: boolean,
  afterVisible: boolean,
  selectionId: string | null,
): CommandBuildResult {
  return buildScalarCommand(
    host,
    Object.freeze({ type: "visibility", id, visible: beforeVisible, selectionId }),
    Object.freeze({
      type: "visibility",
      id,
      visible: afterVisible,
      selectionId: !afterVisible && selectionId === id ? null : selectionId,
    }),
  );
}

export function buildLockCommand(
  host: ScalarMutationHost,
  id: string,
  beforeLocked: boolean,
  afterLocked: boolean,
  selectionId: string | null,
): CommandBuildResult {
  return buildScalarCommand(
    host,
    Object.freeze({ type: "lock", id, locked: beforeLocked, selectionId }),
    Object.freeze({
      type: "lock",
      id,
      locked: afterLocked,
      selectionId: afterLocked && selectionId === id ? null : selectionId,
    }),
  );
}

export function buildReparentCommand(
  host: Pick<EditorMutationHost, "applyHierarchy">,
  before: EditorStructuralHierarchyState,
  after: EditorStructuralHierarchyState,
): CommandBuildResult {
  if (before.operation !== "reparent" || after.operation !== "reparent") {
    return { ok: false, reason: "Reparent history requires reparent snapshots." };
  }
  return { ok: true, command: createStateCommand(before, after, (state) => host.applyHierarchy(state)) };
}

type StructuralHierarchyMutationHost = Pick<EditorMutationHost, "applyHierarchy" | "finalizeDetachedHierarchyObject">;

function buildOwnedGroupCommand(
  host: StructuralHierarchyMutationHost,
  before: EditorStructuralHierarchyState,
  after: EditorStructuralHierarchyState,
  group: EditorObject,
  operation: "group" | "ungroup",
  detachedWhenApplied: boolean,
): CommandBuildResult {
  if (before.operation !== operation || after.operation !== operation) {
    return { ok: false, reason: `${operation} history requires ${operation} snapshots.` };
  }
  let applied = false;
  let discarded = false;
  return {
    ok: true,
    command: {
      execute: () => {
        if (applied || !host.applyHierarchy(after)) return false;
        applied = true;
        return true;
      },
      undo: () => {
        if (!applied || !host.applyHierarchy(before)) return false;
        applied = false;
        return true;
      },
      discard: () => {
        if (discarded) return;
        discarded = true;
        if (applied === detachedWhenApplied) host.finalizeDetachedHierarchyObject(group);
      },
    },
  };
}

export function buildGroupCommand(
  host: StructuralHierarchyMutationHost,
  before: EditorStructuralHierarchyState,
  after: EditorStructuralHierarchyState,
  group: EditorObject,
): CommandBuildResult {
  return buildOwnedGroupCommand(host, before, after, group, "group", false);
}

export function buildUngroupCommand(
  host: StructuralHierarchyMutationHost,
  before: EditorStructuralHierarchyState,
  after: EditorStructuralHierarchyState,
  group: EditorObject,
): CommandBuildResult {
  return buildOwnedGroupCommand(host, before, after, group, "ungroup", true);
}

type MaterialMutationHost = Pick<EditorMutationHost, "applyMaterial">;
type TransformMutationHost = Pick<EditorMutationHost, "applyTransform">;
type PhysicsMutationHost = Pick<EditorMutationHost, "replacePhysics">;

function snapshotTransform(state: EditorTransformState): EditorTransformState {
  return Object.freeze({
    position: Object.freeze([...state.position] as [number, number, number]),
    rotation: Object.freeze([...state.rotation] as [number, number, number]),
    scale: Object.freeze([...state.scale] as [number, number, number]),
  });
}

function transformStatesEqual(before: EditorTransformState, after: EditorTransformState): boolean {
  return (
    before.position.every((value, index) => value === after.position[index]) &&
    before.rotation.every((value, index) => value === after.rotation[index]) &&
    before.scale.every((value, index) => value === after.scale[index])
  );
}

export function buildSetTransformCommand(
  host: TransformMutationHost,
  id: string,
  before: EditorTransformState,
  after: EditorTransformState,
): CommandBuildResult {
  if (!id.trim()) return { ok: false, reason: "Cannot transform an object without an id." };
  if (transformStatesEqual(before, after)) {
    return { ok: false, reason: `Object "${id}" already has the requested transform.` };
  }
  const beforeSnapshot = snapshotTransform(before);
  const afterSnapshot = snapshotTransform(after);
  return {
    ok: true,
    command: createStateCommand(beforeSnapshot, afterSnapshot, (state) => host.applyTransform(id, state)),
  };
}

export function buildSetPhysicsTypeCommand(
  host: PhysicsMutationHost,
  id: string,
  before: EditorPhysicsState,
  after: EditorPhysicsState,
): CommandBuildResult {
  if (!id.trim()) return { ok: false, reason: "Cannot change physics without an object id." };
  if (
    before.type === after.type &&
    before.levelTracked === after.levelTracked &&
    before.hasBody === after.hasBody &&
    before.hasCollider === after.hasCollider
  ) {
    return { ok: false, reason: `Object "${id}" already has the requested physics type.` };
  }
  const beforeSnapshot = Object.freeze({ ...before });
  const afterSnapshot = Object.freeze({ ...after });
  return {
    ok: true,
    command: createStateCommand(beforeSnapshot, afterSnapshot, (state) => host.replacePhysics(id, state)),
  };
}

function materialStatesEqual(before: EditorMaterialState, after: EditorMaterialState): boolean {
  if (before.serialized === undefined || after.serialized === undefined) {
    if (before.serialized !== after.serialized) return false;
  } else if (
    before.serialized.color !== after.serialized.color ||
    before.serialized.roughness !== after.serialized.roughness ||
    before.serialized.metalness !== after.serialized.metalness ||
    before.serialized.emissive !== after.serialized.emissive ||
    before.serialized.emissiveIntensity !== after.serialized.emissiveIntensity ||
    before.serialized.opacity !== after.serialized.opacity
  ) {
    return false;
  }
  if (before.live.length !== after.live.length) return false;
  return before.live.every((snapshot, index) => {
    const other = after.live[index];
    return (
      other !== undefined &&
      snapshot.material === other.material &&
      snapshot.color[0] === other.color[0] &&
      snapshot.color[1] === other.color[1] &&
      snapshot.color[2] === other.color[2] &&
      snapshot.roughness === other.roughness &&
      snapshot.metalness === other.metalness &&
      snapshot.emissive[0] === other.emissive[0] &&
      snapshot.emissive[1] === other.emissive[1] &&
      snapshot.emissive[2] === other.emissive[2] &&
      snapshot.emissiveIntensity === other.emissiveIntensity &&
      snapshot.opacity === other.opacity &&
      snapshot.transparent === other.transparent
    );
  });
}

export function buildMaterialCommand(
  host: MaterialMutationHost,
  id: string,
  before: EditorMaterialState,
  after: EditorMaterialState,
): CommandBuildResult {
  if (!id.trim()) return { ok: false, reason: "Cannot edit material without an object id." };
  if (materialStatesEqual(before, after)) {
    return { ok: false, reason: `Object "${id}" already has the requested material.` };
  }
  return { ok: true, command: createStateCommand(before, after, (state) => host.applyMaterial(id, state)) };
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportCommandFailure(host: DeleteSubtreeMutationHost, reason: string): void {
  try {
    host.reportFailure(reason);
  } catch (error) {
    console.error("[Editor] Mutation failure reporting failed:", error);
  }
}

function publishMutation(
  host: DeleteSubtreeMutationHost,
  state: EditorSubtreeState,
  phase: "detached" | "restored",
): void {
  try {
    host.afterMutation({ type: "subtree-delete", phase, rootId: state.rootId });
  } catch (error) {
    reportCommandFailure(host, `Delete ${phase}, but editor UI publication failed. ${describeFailure(error)}`);
  }
}

export function buildDeleteSubtreeCommand(host: DeleteSubtreeMutationHost, rootId: string): CommandBuildResult {
  if (!rootId.trim()) return { ok: false, reason: "Cannot delete a subtree without a root id." };

  const state: EditorSubtreeState = Object.freeze({ rootId });
  let applied = false;
  let discarded = false;
  return {
    ok: true,
    command: {
      execute: () => {
        if (applied) return false;
        try {
          if (!host.detachSubtree(state)) {
            reportCommandFailure(host, `Delete failed for subtree "${rootId}"; no changes were kept.`);
            return false;
          }
        } catch (error) {
          reportCommandFailure(host, `Delete failed for subtree "${rootId}". ${describeFailure(error)}`);
          return false;
        }
        applied = true;
        publishMutation(host, state, "detached");
        return true;
      },
      undo: () => {
        if (!applied) return false;
        try {
          if (!host.restoreSubtree(state)) {
            reportCommandFailure(host, `Restore failed for deleted subtree "${rootId}"; deletion remains applied.`);
            return false;
          }
        } catch (error) {
          reportCommandFailure(
            host,
            `Restore failed for deleted subtree "${rootId}"; deletion remains applied. ${describeFailure(error)}`,
          );
          return false;
        }
        applied = false;
        publishMutation(host, state, "restored");
        return true;
      },
      discard: () => {
        if (discarded) return;
        discarded = true;
        if (applied) host.finalizeDetachedSubtree(state);
      },
    },
  };
}
