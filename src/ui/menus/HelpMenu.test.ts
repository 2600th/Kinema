import { describe, expect, it } from "vitest";
import { getHelpBindings } from "./HelpMenu";

function bindingKeys(source: "keyboard" | "gamepad" | "touch"): string[] {
  return getHelpBindings(source).flatMap((section) => section.bindings.map((binding) => binding.key));
}

describe("getHelpBindings", () => {
  it("shows keyboard controls for keyboard input", () => {
    expect(bindingKeys("keyboard")).toEqual(expect.arrayContaining(["W A S D", "Space", "Shift", "C", "F"]));
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
});
