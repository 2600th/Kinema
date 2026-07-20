import { describe, expect, it, vi } from "vitest";
import { CommandHistory } from "./CommandHistory";
import * as EditorCommandModule from "./EditorCommands";
import {
  buildDeleteSubtreeCommand,
  buildLockCommand,
  buildRenameCommand,
  buildSetPhysicsTypeCommand,
  buildSetTransformCommand,
  buildVisibilityCommand,
  type CommandBuildResult,
  createStateCommand,
  type EditorMutationHost,
  type EditorPhysicsState,
  type EditorScalarHierarchyState,
  type EditorStructuralHierarchyState,
  type EditorTransformState,
} from "./EditorCommands";
import type { EditorObject } from "./EditorObject";

function freezeTransform(
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  scale: readonly [number, number, number],
): EditorTransformState {
  return Object.freeze({
    position: Object.freeze(position),
    rotation: Object.freeze(rotation),
    scale: Object.freeze(scale),
  });
}

describe("createStateCommand", () => {
  it("applies immutable before and after state", () => {
    const applied: EditorTransformState[] = [];
    const before = freezeTransform([0, 0, 0], [0, 0, 0], [1, 1, 1]);
    const after = freezeTransform([1, 2, 3], [0, 1, 0], [2, 2, 2]);
    const command = createStateCommand(before, after, (state) => {
      applied.push(state);
      return true;
    });
    expect(command.execute()).toBe(true);
    expect(command.undo()).toBe(true);
    expect(applied).toEqual([after, before]);
  });
});

describe("created-object command ownership", () => {
  it("finalizes detached ownership exactly once on clear and redo invalidation, but never while applied", () => {
    const createOwnedCreationCommand = (
      EditorCommandModule as unknown as {
        createOwnedCreationCommand?: (
          execute: () => boolean,
          undo: () => boolean,
          discardDetached: () => void,
        ) => import("./CommandHistory").Command;
      }
    ).createOwnedCreationCommand;
    expect(createOwnedCreationCommand).toBeTypeOf("function");
    if (!createOwnedCreationCommand) return;

    const appliedDiscard = vi.fn();
    const appliedHistory = new CommandHistory();
    expect(
      appliedHistory.push(
        createOwnedCreationCommand(
          () => true,
          () => true,
          appliedDiscard,
        ),
      ),
    ).toBe(true);
    appliedHistory.clear();
    expect(appliedDiscard).not.toHaveBeenCalled();

    const clearDiscard = vi.fn();
    const clearHistory = new CommandHistory();
    const clearCommand = createOwnedCreationCommand(
      () => true,
      () => true,
      clearDiscard,
    );
    expect(clearHistory.push(clearCommand)).toBe(true);
    expect(clearHistory.undo()).toBe(true);
    clearHistory.clear();
    clearCommand.discard?.();
    expect(clearDiscard).toHaveBeenCalledOnce();

    const invalidatedDiscard = vi.fn();
    const invalidatedHistory = new CommandHistory();
    expect(
      invalidatedHistory.push(
        createOwnedCreationCommand(
          () => true,
          () => true,
          invalidatedDiscard,
        ),
      ),
    ).toBe(true);
    expect(invalidatedHistory.undo()).toBe(true);
    expect(invalidatedHistory.push({ execute: () => true, undo: () => true })).toBe(true);
    expect(invalidatedDiscard).toHaveBeenCalledOnce();
  });
});

describe("buildSetTransformCommand", () => {
  it("round-trips exact immutable transform tuples through history", () => {
    const host = makeMutationHost();
    const before = freezeTransform([0, 0, 0], [0.1, 0.2, 0.3], [1, 1, 1]);
    const after = freezeTransform([4, -2, 7], [-0.4, 0.5, -0.6], [2, 3, 4]);
    const history = new CommandHistory();
    const command = unwrapCommand(buildSetTransformCommand(host, "target", before, after));

    expect(history.push(command)).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.redo()).toBe(true);
    expect(vi.mocked(host.applyTransform).mock.calls).toEqual([
      ["target", after],
      ["target", before],
      ["target", after],
    ]);
  });
});

describe("buildSetPhysicsTypeCommand", () => {
  it("replays immutable physics recipes for static to dynamic undo and redo", () => {
    const host = makeMutationHost();
    const before: EditorPhysicsState = Object.freeze({
      type: "static",
      levelTracked: true,
      hasBody: true,
      hasCollider: true,
    });
    const after: EditorPhysicsState = Object.freeze({
      type: "dynamic",
      levelTracked: true,
      hasBody: true,
      hasCollider: true,
    });
    const history = new CommandHistory();
    const command = unwrapCommand(buildSetPhysicsTypeCommand(host, "target", before, after));

    expect(history.push(command)).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.redo()).toBe(true);
    expect(vi.mocked(host.replacePhysics).mock.calls).toEqual([
      ["target", after],
      ["target", before],
      ["target", after],
    ]);
  });
});

function makeMutationHost(): EditorMutationHost {
  return {
    applyTransform: vi.fn(() => true),
    applyMaterial: vi.fn(() => true),
    replacePhysics: vi.fn(() => true),
    applyHierarchy: vi.fn(() => true),
    detachSubtree: vi.fn(() => true),
    restoreSubtree: vi.fn(() => true),
    finalizeDetachedSubtree: vi.fn(),
    finalizeDetachedHierarchyObject: vi.fn(),
    afterMutation: vi.fn(),
    reportFailure: vi.fn(),
  };
}

function buildDelete(host: EditorMutationHost, rootId = "root") {
  const result = buildDeleteSubtreeCommand(host, rootId);
  if (!result.ok) throw new Error(result.reason);
  return result.command;
}

function unwrapCommand(result: CommandBuildResult) {
  if (!result.ok) throw new Error(result.reason);
  return result.command;
}

function emptyHierarchyState(operation: "group" | "ungroup"): EditorStructuralHierarchyState {
  return Object.freeze({
    type: "structure",
    operation,
    document: Object.freeze({ nodes: Object.freeze([]), selection: null }),
    tracking: Object.freeze([]),
    physicsRootIds: Object.freeze([]),
  });
}

describe("scalar editor commands", () => {
  it("round-trips explicit rename, visibility, and lock state with one dirty notification per boundary", () => {
    const target = {
      id: "target",
      name: "Before",
      meshName: "Before",
      visible: true,
      meshVisible: true,
      locked: false,
    };
    let selectedId: string | null = target.id;
    const host = makeMutationHost();
    host.applyHierarchy = vi.fn((state: EditorScalarHierarchyState) => {
      if (state.id !== target.id) return false;
      if (state.type === "rename") {
        target.name = state.name;
        target.meshName = state.name;
      } else if (state.type === "visibility") {
        target.visible = state.visible;
        target.meshVisible = state.visible;
        selectedId = state.selectionId;
      } else {
        target.locked = state.locked;
        selectedId = state.selectionId;
      }
      return true;
    });
    const dirty = vi.fn();
    const history = new CommandHistory(dirty);
    const project = () => ({ ...target, selectedId });

    const cases = [
      {
        command: unwrapCommand(buildRenameCommand(host, target.id, "Before", "After")),
        beforeProjection: project(),
        afterProjection: { ...project(), name: "After", meshName: "After" },
      },
      {
        command: unwrapCommand(buildVisibilityCommand(host, target.id, true, false, target.id)),
        beforeProjection: project(),
        afterProjection: { ...project(), visible: false, meshVisible: false, selectedId: null },
      },
      {
        command: unwrapCommand(buildLockCommand(host, target.id, false, true, target.id)),
        beforeProjection: project(),
        afterProjection: { ...project(), locked: true, selectedId: null },
      },
    ];

    for (const { command, beforeProjection, afterProjection } of cases) {
      expect(history.push(command)).toBe(true);
      expect(project()).toEqual(afterProjection);
      expect(history.undo()).toBe(true);
      expect(project()).toEqual(beforeProjection);
      expect(history.redo()).toBe(true);
      expect(project()).toEqual(afterProjection);
      expect(history.undo()).toBe(true);
      expect(project()).toEqual(beforeProjection);
    }

    expect(dirty).toHaveBeenCalledTimes(cases.length * 4);
  });

  it("restores the exact prior selection when undoing hide and lock commands", () => {
    const selections: Array<string | null> = [];
    const host = makeMutationHost();
    host.applyHierarchy = vi.fn((state: EditorScalarHierarchyState) => {
      if (state.type !== "rename") selections.push(state.selectionId);
      return true;
    });
    const history = new CommandHistory();

    expect(history.push(unwrapCommand(buildVisibilityCommand(host, "target", true, false, "target")))).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.push(unwrapCommand(buildLockCommand(host, "target", false, true, "target")))).toBe(true);
    expect(history.undo()).toBe(true);

    expect(selections).toEqual([null, "target", null, "target"]);
  });

  it("rejects scalar no-ops before history can dirty or mutate", () => {
    const host = makeMutationHost();
    const dirty = vi.fn();
    const history = new CommandHistory(dirty);
    const results = [
      buildRenameCommand(host, "target", "Same", "Same"),
      buildVisibilityCommand(host, "target", true, true, "target"),
      buildLockCommand(host, "target", false, false, "target"),
    ];

    expect(results).toEqual([
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false }),
    ]);
    for (const result of results) {
      if (result.ok) history.push(result.command);
    }
    expect(host.applyHierarchy).not.toHaveBeenCalled();
    expect(dirty).not.toHaveBeenCalled();
  });
});

describe("buildDeleteSubtreeCommand", () => {
  it("reuses one subtree state across execute, undo, redo, and applied discard", () => {
    const host = makeMutationHost();
    const history = new CommandHistory();
    const command = buildDelete(host);

    expect(history.push(command)).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.redo()).toBe(true);
    history.clear();
    command.discard?.();

    const detachedStates = vi.mocked(host.detachSubtree).mock.calls.map(([state]) => state);
    const restoredState = vi.mocked(host.restoreSubtree).mock.calls[0]?.[0];
    const finalizedState = vi.mocked(host.finalizeDetachedSubtree).mock.calls[0]?.[0];
    expect(detachedStates).toHaveLength(2);
    expect(detachedStates[0]).toBe(detachedStates[1]);
    expect(restoredState).toBe(detachedStates[0]);
    expect(finalizedState).toBe(detachedStates[0]);
    expect(detachedStates[0]).toMatchObject({ rootId: "root" });
    expect(host.finalizeDetachedSubtree).toHaveBeenCalledOnce();
  });

  it("rejects a failed detach without mutation publication or finalization", () => {
    const host = makeMutationHost();
    vi.mocked(host.detachSubtree).mockReturnValue(false);
    const mutated = vi.fn();
    const history = new CommandHistory(mutated);

    expect(history.push(buildDelete(host))).toBe(false);
    history.clear();

    expect(mutated).not.toHaveBeenCalled();
    expect(host.afterMutation).not.toHaveBeenCalled();
    expect(host.finalizeDetachedSubtree).not.toHaveBeenCalled();
    expect(host.reportFailure).toHaveBeenCalledWith(expect.stringMatching(/delete/i));
  });

  it("retains applied ownership when restore fails and finalizes on discard", () => {
    const host = makeMutationHost();
    vi.mocked(host.restoreSubtree).mockReturnValue(false);
    const history = new CommandHistory();
    history.push(buildDelete(host));

    expect(history.undo()).toBe(false);
    history.clear();

    expect(host.finalizeDetachedSubtree).toHaveBeenCalledOnce();
    expect(host.reportFailure).toHaveBeenCalledWith(expect.stringMatching(/restore/i));
  });

  it("does not finalize live resources when an undone delete is discarded", () => {
    const host = makeMutationHost();
    const history = new CommandHistory();
    history.push(buildDelete(host));
    expect(history.undo()).toBe(true);

    history.clear();

    expect(host.finalizeDetachedSubtree).not.toHaveBeenCalled();
  });
});

describe("group and ungroup command ownership", () => {
  it("retains one group identity and finalizes it only when a group command is discarded while undone", () => {
    const buildGroupCommand = (
      EditorCommandModule as unknown as {
        buildGroupCommand?: (
          host: EditorMutationHost,
          before: EditorStructuralHierarchyState,
          after: EditorStructuralHierarchyState,
          group: EditorObject,
        ) => CommandBuildResult;
      }
    ).buildGroupCommand;
    expect(buildGroupCommand).toBeTypeOf("function");
    if (!buildGroupCommand) return;
    const before = emptyHierarchyState("group");
    const after = emptyHierarchyState("group");
    const group = { id: "group" } as EditorObject;
    const host = {
      ...makeMutationHost(),
      finalizeDetachedHierarchyObject: vi.fn(),
    };
    const command = unwrapCommand(buildGroupCommand(host, before, after, group));
    const history = new CommandHistory();

    expect(history.push(command)).toBe(true);
    history.clear();
    expect(host.finalizeDetachedHierarchyObject).not.toHaveBeenCalled();

    const undoneCommand = unwrapCommand(buildGroupCommand(host, before, after, group));
    expect(history.push(undoneCommand)).toBe(true);
    expect(history.undo()).toBe(true);
    history.clear();
    undoneCommand.discard?.();
    expect(host.finalizeDetachedHierarchyObject).toHaveBeenCalledOnce();
    expect(host.finalizeDetachedHierarchyObject).toHaveBeenCalledWith(group);
  });

  it("finalizes an ungrouped object only while the ungroup command remains applied", () => {
    const buildUngroupCommand = (
      EditorCommandModule as unknown as {
        buildUngroupCommand?: (
          host: EditorMutationHost,
          before: EditorStructuralHierarchyState,
          after: EditorStructuralHierarchyState,
          group: EditorObject,
        ) => CommandBuildResult;
      }
    ).buildUngroupCommand;
    expect(buildUngroupCommand).toBeTypeOf("function");
    if (!buildUngroupCommand) return;
    const before = emptyHierarchyState("ungroup");
    const after = emptyHierarchyState("ungroup");
    const group = { id: "group" } as EditorObject;
    const host = {
      ...makeMutationHost(),
      finalizeDetachedHierarchyObject: vi.fn(),
    };
    const command = unwrapCommand(buildUngroupCommand(host, before, after, group));
    const history = new CommandHistory();

    expect(history.push(command)).toBe(true);
    history.clear();
    command.discard?.();
    expect(host.finalizeDetachedHierarchyObject).toHaveBeenCalledOnce();
    expect(host.finalizeDetachedHierarchyObject).toHaveBeenCalledWith(group);

    host.finalizeDetachedHierarchyObject.mockClear();
    const undoneCommand = unwrapCommand(buildUngroupCommand(host, before, after, group));
    expect(history.push(undoneCommand)).toBe(true);
    expect(history.undo()).toBe(true);
    history.clear();
    expect(host.finalizeDetachedHierarchyObject).not.toHaveBeenCalled();
  });
});
