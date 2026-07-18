import type { InputSource } from "@core/types";

export type InputAction = "interact" | "jump" | "sprint" | "crouch";

const INPUT_GLYPHS: Readonly<Record<InputAction, Readonly<Record<InputSource, string>>>> = {
  interact: { keyboard: "F", gamepad: "X", touch: "✋" },
  jump: { keyboard: "Space", gamepad: "A", touch: "↑" },
  sprint: { keyboard: "Shift", gamepad: "LB", touch: "⇧" },
  crouch: { keyboard: "C", gamepad: "B", touch: "↓" },
};

export function getInputGlyph(action: InputAction, source: InputSource): string {
  return INPUT_GLYPHS[action][source];
}
