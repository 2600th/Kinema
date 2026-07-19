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
