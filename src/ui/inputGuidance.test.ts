import { describe, expect, it } from "vitest";
import { getDroneAltitudeGuidance, getThrowGuidance } from "./inputGuidance";

describe("input guidance", () => {
  it.each([
    ["keyboard", "LMB to throw"],
    ["gamepad", "RT to throw"],
    ["touch", "Interact to throw"],
  ] as const)("describes throwing for %s", (source, expected) => {
    expect(getThrowGuidance(source)).toBe(expected);
  });

  it.each([
    ["keyboard", "E / Q to change drone altitude"],
    ["gamepad", "Right Stick ↑ / ↓ to change drone altitude"],
    ["touch", "Right Look Zone ↑ / ↓ to change drone altitude"],
  ] as const)("describes drone altitude for %s", (source, expected) => {
    expect(getDroneAltitudeGuidance(source)).toBe(expected);
  });
});
