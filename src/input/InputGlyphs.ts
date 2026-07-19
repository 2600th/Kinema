import type { InputSource } from "@core/types";
import {
  DEFAULT_KEYBOARD_BINDINGS,
  getKeyboardCodeLabel,
  type KeyboardBindingAction,
  type ReadonlyKeyboardBindings,
} from "./InputBindings";

export type InputAction = "interact" | "jump" | "sprint" | "crouch";

const INPUT_GLYPHS: Readonly<Record<InputAction, Readonly<Record<InputSource, string>>>> = {
  interact: { keyboard: "F", gamepad: "X", touch: "✋" },
  jump: { keyboard: "Space", gamepad: "A", touch: "↑" },
  sprint: { keyboard: "Shift", gamepad: "LB", touch: "⇧" },
  crouch: { keyboard: "C", gamepad: "B", touch: "↓" },
};

export function getInputGlyph(
  action: KeyboardBindingAction,
  source: "keyboard",
  bindings?: ReadonlyKeyboardBindings,
): string;
export function getInputGlyph(action: InputAction, source: InputSource, bindings?: ReadonlyKeyboardBindings): string;
export function getInputGlyph(
  action: KeyboardBindingAction,
  source: InputSource,
  bindings?: ReadonlyKeyboardBindings,
): string {
  if (source === "keyboard") {
    if (!bindings && action in INPUT_GLYPHS) {
      return INPUT_GLYPHS[action as InputAction].keyboard;
    }
    return getKeyboardCodeLabel(bindings?.[action][0] ?? DEFAULT_KEYBOARD_BINDINGS[action][0]);
  }
  return INPUT_GLYPHS[action as InputAction][source];
}
