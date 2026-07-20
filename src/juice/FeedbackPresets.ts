export type FeedbackParticlePreset = "vehicleTransitionDust";

export interface FeedbackPreset {
  readonly fovPunch?: number;
  readonly trauma?: number;
  readonly particles?: FeedbackParticlePreset;
  readonly sustainedFov?: number;
}

export const FEEDBACK_PRESETS = {
  pickup: { fovPunch: 0.5 },
  drop: { fovPunch: 0.5 },
  sprintStart: { fovPunch: 0.35 },
  ladderAttach: { fovPunch: 0.65 },
  ladderRelease: { fovPunch: 0.4 },
  ropeAttach: { fovPunch: 0.65 },
  ropeRelease: { fovPunch: 0.4 },
  vehicleEnter: { trauma: 0.15, particles: "vehicleTransitionDust" },
  vehicleExit: { trauma: 0.15, particles: "vehicleTransitionDust" },
  vehicleBoost: { sustainedFov: 3 },
  collectible: { fovPunch: 0.3 },
} as const satisfies Record<string, FeedbackPreset>;

export type FeedbackPresetKey = keyof typeof FEEDBACK_PRESETS;
