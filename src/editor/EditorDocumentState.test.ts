import { describe, expect, it } from "vitest";
import {
  type EditorDocumentSnapshot,
  EditorDocumentState,
  shouldProtectEditorUnload,
} from "./EditorDocumentState";

describe("EditorDocumentState", () => {
  it("starts clean, emits once when dirtied, and records a saved name when cleaned", () => {
    const changes: EditorDocumentSnapshot[] = [];
    const state = new EditorDocumentState((value) => changes.push({ ...value }));

    expect(state.value).toEqual({ name: "Untitled", dirty: false });

    state.markDirty();
    state.markDirty();

    expect(state.value).toEqual({ name: "Untitled", dirty: true });
    expect(changes).toEqual([{ name: "Untitled", dirty: true }]);

    state.markClean("Saved Lab");

    expect(state.value).toEqual({ name: "Saved Lab", dirty: false });
  });

  it.each([
    { dirty: false, active: false, playTesting: false, expected: false },
    { dirty: false, active: true, playTesting: false, expected: false },
    { dirty: false, active: false, playTesting: true, expected: false },
    { dirty: false, active: true, playTesting: true, expected: false },
    { dirty: true, active: false, playTesting: false, expected: false },
    { dirty: true, active: true, playTesting: false, expected: true },
    { dirty: true, active: false, playTesting: true, expected: true },
    { dirty: true, active: true, playTesting: true, expected: true },
  ])(
    "derives unload protection for dirty=$dirty active=$active playTesting=$playTesting",
    ({ dirty, active, playTesting, expected }) => {
      expect(shouldProtectEditorUnload(dirty, active, playTesting)).toBe(expected);
    },
  );
});
