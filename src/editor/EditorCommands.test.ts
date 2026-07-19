import { describe, expect, it, vi } from "vitest";
import { CommandHistory } from "./CommandHistory";
import {
  buildDeleteSubtreeCommand,
  createStateCommand,
  type EditorMutationHost,
  type EditorTransformState,
} from "./EditorCommands";

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

function makeMutationHost(): EditorMutationHost {
  return {
    applyTransform: vi.fn(() => true),
    applyMaterial: vi.fn(() => true),
    replacePhysics: vi.fn(() => true),
    applyHierarchy: vi.fn(() => true),
    detachSubtree: vi.fn(() => true),
    restoreSubtree: vi.fn(() => true),
    finalizeDetachedSubtree: vi.fn(),
    afterMutation: vi.fn(),
    reportFailure: vi.fn(),
  };
}

function buildDelete(host: EditorMutationHost, rootId = "root") {
  const result = buildDeleteSubtreeCommand(host, rootId);
  if (!result.ok) throw new Error(result.reason);
  return result.command;
}

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
