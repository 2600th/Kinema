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
    { identity: null, expected: "Untitled" },
    {
      identity: { name: "procedural", origin: "system" as const, kind: "procedural" as const },
      expected: "Untitled",
    },
    {
      identity: { name: "station:vfx", origin: "system" as const, kind: "station" as const },
      expected: "Untitled",
    },
    { identity: { name: "museum", origin: "system" as const, kind: "asset" as const }, expected: "museum" },
    {
      identity: { name: "procedural", origin: "authored" as const, kind: "authored" as const },
      expected: "procedural",
    },
    {
      identity: { name: "station:vfx", origin: "authored" as const, kind: "authored" as const },
      expected: "station:vfx",
    },
    {
      identity: { name: "Authored Lab", origin: "authored" as const, kind: "authored" as const },
      expected: "Authored Lab",
    },
  ])("normalizes loaded document identity $identity", ({ identity, expected }) => {
    expect(normalizeEditorDocumentName(identity)).toBe(expected);
  });
});
