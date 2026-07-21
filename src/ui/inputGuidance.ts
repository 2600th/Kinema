import type { InputSource } from "@core/types";

export function getThrowGuidance(source: InputSource): string {
  if (source === "gamepad") return "RT to throw";
  if (source === "touch") return "Interact to throw";
  return "LMB to throw";
}

export function getDroneAltitudeGuidance(source: InputSource): string {
  if (source === "gamepad") return "Right Stick ↑ / ↓ to change drone altitude";
  if (source === "touch") return "Right Look Zone ↑ / ↓ to change drone altitude";
  return "E / Q to change drone altitude";
}
