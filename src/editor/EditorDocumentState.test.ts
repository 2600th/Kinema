import { describe, expect, it } from "vitest";
import { type EditorDocumentSnapshot, EditorDocumentState } from "./EditorDocumentState";

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
});
