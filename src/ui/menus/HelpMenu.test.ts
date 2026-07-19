import { createDefaultKeyboardBindings } from "@input/InputBindings";
import { describe, expect, it } from "vitest";
import { getHelpBindings } from "./HelpMenu";

function bindingKeys(source: "keyboard" | "gamepad" | "touch", bindings = createDefaultKeyboardBindings()): string[] {
  return getHelpBindings(source, bindings).flatMap((section) => section.bindings.map((binding) => binding.key));
}

describe("getHelpBindings", () => {
  it("shows keyboard controls for keyboard input", () => {
    expect(bindingKeys("keyboard")).toEqual(expect.arrayContaining(["W A S D", "Space", "Left Shift", "C", "F"]));
  });

  it("shows gamepad controls for gamepad input", () => {
    const keys = bindingKeys("gamepad");
    expect(keys).toEqual(expect.arrayContaining(["Left Stick", "A", "LB", "B", "X"]));
    expect(keys).not.toContain("Menu");
  });

  it("shows touch controls for touch input", () => {
    const keys = bindingKeys("touch");
    expect(keys).toEqual(expect.arrayContaining(["Left Stick", "↑", "⇧", "↓", "✋"]));
    expect(keys).not.toContain("Primary");
    expect(keys).not.toContain("Menu");
  });

  it("shows configured movement and action primaries for keyboard input", () => {
    const bindings = createDefaultKeyboardBindings();
    bindings.moveForward[0] = "ArrowUp";
    bindings.moveBackward[0] = "Numpad2";
    bindings.moveLeft[0] = "Home";
    bindings.moveRight[0] = "PageDown";
    bindings.jump[0] = "NumpadEnter";
    bindings.interact[0] = "KeyZ";
    bindings.crouch[0] = "ControlRight";
    bindings.sprint[0] = "ShiftRight";

    expect(bindingKeys("keyboard", bindings)).toEqual(
      expect.arrayContaining(["Up Arrow Home Numpad 2 PageDown", "NumpadEnter", "Right Ctrl", "Right Shift", "Z"]),
    );
  });

  it("reflects later binding changes when keyboard help is rebuilt", () => {
    const bindings = createDefaultKeyboardBindings();
    expect(bindingKeys("keyboard", bindings)).toContain("F");

    bindings.interact[0] = "KeyZ";

    expect(bindingKeys("keyboard", bindings)).toContain("Z");
    expect(bindingKeys("keyboard", bindings)).not.toContain("F");
  });

  it("does not change gamepad or touch rows for custom keyboard bindings", () => {
    const bindings = createDefaultKeyboardBindings();
    bindings.interact[0] = "KeyZ";

    expect(bindingKeys("gamepad", bindings)).toEqual(expect.arrayContaining(["Left Stick", "A", "LB", "B", "X"]));
    expect(bindingKeys("touch", bindings)).toEqual(expect.arrayContaining(["Left Stick", "↑", "⇧", "↓", "✋"]));
  });
});
