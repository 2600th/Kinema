import { describe, expect, it } from "vitest";
import {
  createDefaultKeyboardBindings,
  DEFAULT_KEYBOARD_BINDINGS,
  getKeyboardCodeLabel,
  INPUT_ACTION_LABELS,
  isReservedBindingCode,
  RESERVED_BINDING_CODES,
  rebindKeyboardAction,
  sanitizeKeyboardBindings,
} from "./InputBindings";

describe("InputBindings", () => {
  it("provides the eight default action bindings and readable labels", () => {
    expect(DEFAULT_KEYBOARD_BINDINGS).toEqual({
      moveForward: ["KeyW", "ArrowUp"],
      moveBackward: ["KeyS", "ArrowDown"],
      moveLeft: ["KeyA", "ArrowLeft"],
      moveRight: ["KeyD", "ArrowRight"],
      jump: ["Space"],
      interact: ["KeyF"],
      crouch: ["KeyC", "ControlLeft"],
      sprint: ["ShiftLeft", "ShiftRight"],
    });
    expect(INPUT_ACTION_LABELS).toEqual({
      moveForward: "Move forward",
      moveBackward: "Move backward",
      moveLeft: "Move left",
      moveRight: "Move right",
      jump: "Jump",
      interact: "Interact",
      crouch: "Crouch",
      sprint: "Sprint",
    });
    expect(getKeyboardCodeLabel("KeyW")).toBe("W");
    expect(getKeyboardCodeLabel("ArrowUp")).toBe("Up Arrow");
    expect(getKeyboardCodeLabel("ShiftLeft")).toBe("Left Shift");
    expect(getKeyboardCodeLabel("Numpad7")).toBe("Numpad 7");
  });

  it("reserves menu and existing gameplay codes", () => {
    expect(RESERVED_BINDING_CODES).toEqual([
      "Escape",
      "Tab",
      "Backquote",
      "F1",
      "F6",
      "F7",
      "F8",
      "F9",
      "F10",
      "F11",
      "KeyE",
      "KeyQ",
    ]);
    for (const code of RESERVED_BINDING_CODES) {
      expect(isReservedBindingCode(code)).toBe(true);
    }
    expect(isReservedBindingCode("KeyR")).toBe(false);
  });

  it("creates isolated reset values without exposing mutable defaults", () => {
    const first = createDefaultKeyboardBindings();
    const second = createDefaultKeyboardBindings();

    first.moveForward[0] = "KeyZ";
    first.crouch.push("KeyX");

    expect(second).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    expect(DEFAULT_KEYBOARD_BINDINGS.moveForward).toEqual(["KeyW", "ArrowUp"]);
    expect(DEFAULT_KEYBOARD_BINDINGS.crouch).toEqual(["KeyC", "ControlLeft"]);
  });

  it("sanitizes malformed, reserved, and duplicate saved codes", () => {
    const sanitized = sanitizeKeyboardBindings({
      moveForward: ["Escape", 12],
      moveBackward: ["KeyS", "not-a-key-code"],
      jump: [],
      interact: ["KeyR"],
      crouch: ["KeyR", "ControlRight"],
      sprint: ["ShiftLeft", "ShiftRight", "KeyZ"],
    });

    expect(sanitized).toEqual({
      moveForward: ["KeyW", "ArrowUp"],
      moveBackward: ["KeyS", "ArrowDown"],
      moveLeft: ["KeyA", "ArrowLeft"],
      moveRight: ["KeyD", "ArrowRight"],
      jump: ["Space"],
      interact: ["KeyR"],
      crouch: ["KeyC", "ControlRight"],
      sprint: ["ShiftLeft", "ShiftRight"],
    });
    const allCodes = Object.values(sanitized).flat();
    expect(new Set(allCodes).size).toBe(allCodes.length);
  });

  it("returns an isolated default clone when the saved map is not an object", () => {
    const sanitized = sanitizeKeyboardBindings(null);
    sanitized.moveForward[0] = "KeyZ";

    expect(DEFAULT_KEYBOARD_BINDINGS.moveForward[0]).toBe("KeyW");
    expect(sanitizeKeyboardBindings(null)).toEqual(DEFAULT_KEYBOARD_BINDINGS);
  });

  it("swaps the exact conflicting slot with the target primary", () => {
    const original = createDefaultKeyboardBindings();
    const rebound = rebindKeyboardAction(original, "jump", "ArrowUp");

    expect(rebound.jump).toEqual(["ArrowUp"]);
    expect(rebound.moveForward).toEqual(["KeyW", "Space"]);
    expect(original).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    const allCodes = Object.values(rebound).flat();
    expect(new Set(allCodes).size).toBe(allCodes.length);
  });

  it("swaps another action's conflicting primary with the target primary", () => {
    const rebound = rebindKeyboardAction(createDefaultKeyboardBindings(), "jump", "KeyF");

    expect(rebound.jump).toEqual(["KeyF"]);
    expect(rebound.interact).toEqual(["Space"]);
  });

  it("swaps a target action's own alternate into its primary slot", () => {
    const rebound = rebindKeyboardAction(createDefaultKeyboardBindings(), "moveForward", "ArrowUp");

    expect(rebound.moveForward).toEqual(["ArrowUp", "KeyW"]);
  });

  it("treats same-primary, reserved, and invalid captures as no-ops", () => {
    const original = createDefaultKeyboardBindings();

    expect(rebindKeyboardAction(original, "jump", "Space")).toEqual(original);
    expect(rebindKeyboardAction(original, "jump", "Escape")).toEqual(original);
    expect(rebindKeyboardAction(original, "jump", "not-a-key-code")).toEqual(original);
  });

  it("replaces the primary when the captured code is unassigned", () => {
    const rebound = rebindKeyboardAction(createDefaultKeyboardBindings(), "interact", "KeyZ");

    expect(rebound.interact).toEqual(["KeyZ"]);
    expect(Object.values(rebound).flat()).not.toContain("KeyF");
  });

  it.each([
    "F13",
    "AudioVolumeUp",
    "BrowserBack",
    "Lang1",
  ])("accepts the standard KeyboardEvent.code value %s", (code) => {
    const rebound = rebindKeyboardAction(createDefaultKeyboardBindings(), "interact", code);

    expect(rebound.interact).toEqual([code]);
  });
});
