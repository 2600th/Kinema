import { describe, expect, it } from "vitest";
import {
  type EditorDocumentSnapshot,
  EditorDocumentState,
  normalizeEditorDocumentName,
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
    { dirty: false, active: false, playTesting: false, restoring: false, expected: false },
    { dirty: false, active: true, playTesting: false, restoring: false, expected: false },
    { dirty: false, active: false, playTesting: true, restoring: false, expected: false },
    { dirty: false, active: false, playTesting: false, restoring: true, expected: false },
    { dirty: true, active: false, playTesting: false, restoring: false, expected: false },
    { dirty: true, active: true, playTesting: false, restoring: false, expected: true },
    { dirty: true, active: false, playTesting: true, restoring: false, expected: true },
    { dirty: true, active: false, playTesting: false, restoring: true, expected: true },
    { dirty: true, active: true, playTesting: true, restoring: true, expected: true },
  ])(
    "derives unload protection for dirty=$dirty active=$active playTesting=$playTesting restoring=$restoring",
    ({ dirty, active, playTesting, restoring, expected }) => {
      expect(shouldProtectEditorUnload(dirty, active, playTesting, restoring)).toBe(expected);
    },
  );

  it.each([
    { loadedName: null, expected: "Untitled" },
    { loadedName: "procedural", expected: "Untitled" },
    { loadedName: "station:vfx", expected: "Untitled" },
    { loadedName: "Authored Lab", expected: "Authored Lab" },
  ])("normalizes loaded document name $loadedName", ({ loadedName, expected }) => {
    expect(normalizeEditorDocumentName(loadedName)).toBe(expected);
  });
});
