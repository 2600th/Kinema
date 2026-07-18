import { describe, expect, it } from "vitest";
import { getInputGlyph } from "./InputGlyphs";

describe("input glyphs", () => {
  it("maps shared gameplay actions for every input source", () => {
    expect(getInputGlyph("interact", "keyboard")).toBe("F");
    expect(getInputGlyph("interact", "gamepad")).toBe("X");
    expect(getInputGlyph("interact", "touch")).toBe("✋");
    expect(getInputGlyph("jump", "keyboard")).toBe("Space");
    expect(getInputGlyph("jump", "gamepad")).toBe("A");
    expect(getInputGlyph("jump", "touch")).toBe("↑");
    expect(getInputGlyph("crouch", "gamepad")).toBe("B");
    expect(getInputGlyph("sprint", "touch")).toBe("⇧");
  });
});
