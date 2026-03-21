import type { StateId } from '@core/types';

/** Single animation clip binding. */
export interface ClipDef {
  /** Exact clip name in the GLB (e.g. "Jog_Fwd_Loop"). */
  clip: string;
  /** true = LoopRepeat, false = LoopOnce + clampWhenFinished. */
  loop: boolean;
  /** Playback speed multiplier. Default 1.0. */
  timeScale?: number;
}

/** Three-tier speed-based locomotion blend for the 'move' state. */
export interface LocomotionBlend {
  walk: string;
  jog: string;
  sprint: string;
  /** [walkToJog, jogToSprint] transition thresholds in m/s. */
  thresholds: [number, number];
}

/** Binary speed switch: idle clip when stationary, moving clip when speed > 0.1 m/s. */
export interface SpeedSwitch {
  idle: string;
  moving: string;
}

/** Data-driven animation configuration for a character. */
export interface AnimationProfile {
  id: string;
  /** URL to the GLB containing the character mesh. */
  modelUrl: string;
  /** URLs to GLBs to extract animation clips from (can include modelUrl). */
  animationUrls: string[];
  /** FSM state → clip definition. */
  stateMap: Partial<Record<StateId, ClipDef>>;
  /** Speed-based walk/jog/sprint blend for the 'move' state. */
  locomotion?: LocomotionBlend;
  /** Speed-switch for crouch state (idle vs forward). */
  crouchLocomotion?: SpeedSwitch;
  /** Speed-switch for carry state (idle vs walk-carry). */
  carryLocomotion?: SpeedSwitch;
  /** Fallback chain: if state clip missing, try fallback state's clip. */
  fallbacks?: Partial<Record<StateId, StateId>>;
  /** Optional clip name for one-shot death animation. */
  deathClip?: string;
  /** Optional clip name for one-shot throw animation. */
  throwClip?: string;
}
