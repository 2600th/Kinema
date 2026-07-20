import { describe, expect, it } from "vitest";
import { FEEDBACK_PRESETS } from "./FeedbackPresets";

describe("FEEDBACK_PRESETS", () => {
  it("keeps discrete action feedback proportionate", () => {
    expect(FEEDBACK_PRESETS.pickup.fovPunch).toBe(0.5);
    expect(FEEDBACK_PRESETS.drop.fovPunch).toBe(0.5);
    expect(FEEDBACK_PRESETS.sprintStart.fovPunch).toBeGreaterThan(0);
    expect(FEEDBACK_PRESETS.sprintStart.fovPunch).toBeLessThanOrEqual(0.5);
    expect(FEEDBACK_PRESETS.collectible.fovPunch).toBe(0.3);
    expect(FEEDBACK_PRESETS.vehicleEnter).toMatchObject({
      trauma: 0.15,
      particles: "vehicleTransitionDust",
    });
    expect(FEEDBACK_PRESETS.vehicleExit).toEqual(FEEDBACK_PRESETS.vehicleEnter);
  });

  it("uses semantic ladder and rope edges without adding crouch visuals", () => {
    expect(FEEDBACK_PRESETS.ladderAttach.fovPunch).toBeGreaterThan(FEEDBACK_PRESETS.ladderRelease.fovPunch);
    expect(FEEDBACK_PRESETS.ropeAttach.fovPunch).toBe(FEEDBACK_PRESETS.ladderAttach.fovPunch);
    expect(FEEDBACK_PRESETS.ropeRelease.fovPunch).toBe(FEEDBACK_PRESETS.ladderRelease.fovPunch);
    expect("crouch" in FEEDBACK_PRESETS).toBe(false);
  });

  it("defines held vehicle boost as a sustained offset, not an impulse", () => {
    expect(FEEDBACK_PRESETS.vehicleBoost).toEqual({ sustainedFov: 3 });
    expect("fovPunch" in FEEDBACK_PRESETS.vehicleBoost).toBe(false);
  });
});
