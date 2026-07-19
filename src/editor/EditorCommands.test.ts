import { describe, expect, it } from "vitest";
import { createStateCommand, type EditorTransformState } from "./EditorCommands";

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
