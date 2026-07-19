import { describe, expect, it } from "vitest";
import { createDefaultKeyboardBindings } from "./InputBindings";
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

  it("uses the configured primary code label for every remappable keyboard action", () => {
    const bindings = createDefaultKeyboardBindings();
    bindings.moveForward[0] = "ArrowUp";
    bindings.moveBackward[0] = "Numpad2";
    bindings.moveLeft[0] = "Home";
    bindings.moveRight[0] = "PageDown";
    bindings.jump[0] = "NumpadEnter";
    bindings.interact[0] = "KeyZ";
    bindings.crouch[0] = "ControlRight";
    bindings.sprint[0] = "ShiftRight";

    expect(getInputGlyph("moveForward", "keyboard", bindings)).toBe("Up Arrow");
    expect(getInputGlyph("moveBackward", "keyboard", bindings)).toBe("Numpad 2");
    expect(getInputGlyph("moveLeft", "keyboard", bindings)).toBe("Home");
    expect(getInputGlyph("moveRight", "keyboard", bindings)).toBe("PageDown");
    expect(getInputGlyph("jump", "keyboard", bindings)).toBe("NumpadEnter");
    expect(getInputGlyph("interact", "keyboard", bindings)).toBe("Z");
    expect(getInputGlyph("crouch", "keyboard", bindings)).toBe("Right Ctrl");
    expect(getInputGlyph("sprint", "keyboard", bindings)).toBe("Right Shift");
  });

  it("keeps gamepad and touch glyphs unchanged when custom bindings are supplied", () => {
    const bindings = createDefaultKeyboardBindings();
    bindings.jump[0] = "KeyZ";
    bindings.interact[0] = "NumpadEnter";
    bindings.crouch[0] = "ControlRight";
    bindings.sprint[0] = "ShiftRight";

    expect(getInputGlyph("interact", "gamepad", bindings)).toBe("X");
    expect(getInputGlyph("jump", "touch", bindings)).toBe("↑");
    expect(getInputGlyph("crouch", "gamepad", bindings)).toBe("B");
    expect(getInputGlyph("sprint", "touch", bindings)).toBe("⇧");
  });
});
