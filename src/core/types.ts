import type * as THREE from 'three';

/** Frozen snapshot of input state — safe to read from any system */
export interface InputState {
  readonly forward: boolean;
  readonly backward: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly crouch: boolean;
  readonly crouchPressed: boolean;
  readonly jump: boolean;
  readonly jumpPressed: boolean;
  readonly interact: boolean;
  readonly interactPressed: boolean;
  readonly sprint: boolean;
  readonly mouseDeltaX: number;
  readonly mouseDeltaY: number;
  readonly mouseWheelDelta: number;
}

/** Default (no-input) state */
export const NULL_INPUT: InputState = Object.freeze({
  forward: false,
  backward: false,
  left: false,
  right: false,
  crouch: false,
  crouchPressed: false,
  jump: false,
  jumpPressed: false,
  interact: false,
  interactPressed: false,
  sprint: false,
  mouseDeltaX: 0,
  mouseDeltaY: 0,
  mouseWheelDelta: 0,
});

/**
 * All FSM state identifiers.
 * String-based to allow adding states without editing core type unions.
 */
export type StateId = string;

/** Objects that tick at fixed 60Hz */
export interface FixedUpdatable {
  fixedUpdate(dt: number): void;
}

/** Optional hook executed immediately after each physics step. */
export interface PostPhysicsUpdatable {
  postPhysicsUpdate(dt: number): void;
}

/** Objects that tick every render frame */
export interface Updatable {
  update(dt: number, alpha: number): void;
}

/** Disposable resources */
export interface Disposable {
  dispose(): void;
}

/** Player config */
export interface PlayerConfig {
  capsuleRadius: number;
  capsuleHalfHeight: number;
  floatHeight: number;
  moveSpeed: number;
  turnSpeed: number;
  sprintMultiplier: number;
  jumpForce: number;
  jumpForceToGroundMultiplier: number;
  slopeJumpMultiplier: number;
  sprintJumpMultiplier: number;
  airControlFactor: number;
  turnVelocityMultiplier: number;
  acceleration: number;
  rejectVelocityMultiplier: number;
  moveImpulsePointY: number;
  groundDrag: number;
  dragDamping: number;
  airDragMultiplier: number;
  floatingSpringK: number;
  floatingDampingC: number;
  floatingRayLength: number;
  floatingRayHitForgiveness: number;
  coyoteTime: number;
  jumpBufferTime: number;
  maxAirJumps: number;
  airJumpForceMultiplier: number;
  crouchHeightOffset: number;
  crouchSpeedMultiplier: number;
  slopeMaxAngle: number;
  slopeRayLength: number;
  slopeRayOriginOffset: number;
  slopeUpExtraForce: number;
  slopeDownExtraForce: number;
  fallingGravityScale: number;
  fallingMaxVelocity: number;
  mass: number;
  autoBalance: boolean;
  autoBalanceSpringK: number;
  autoBalanceDampingC: number;
  autoBalanceSpringOnY: number;
  autoBalanceDampingOnY: number;
}

/** Camera config */
export interface CameraConfig {
  distance: number;
  zoomMinDistance: number;
  zoomMaxDistance: number;
  heightOffset: number;
  pitchMin: number;
  pitchMax: number;
  mouseSensitivity: number;
  zoomSpeed: number;
  rotationDamping: number;
  positionDamping: number;
  fovDamping: number;
  sprintFovBoost: number;
  collisionOffset: number;
  collisionSpeed: number;
  spherecastRadius: number;
}

/** Spawn point data extracted from level */
export interface SpawnPointData {
  position: THREE.Vector3;
  rotation?: THREE.Euler;
}

/** Event map — every event name and its payload type */
export interface EventMap {
  'input:state': InputState;
  'player:stateChanged': { previous: StateId; current: StateId };
  'player:grounded': boolean;
  'player:respawned': { reason: string };
  'interaction:focusChanged': { id: string | null; label: string | null };
  'interaction:triggered': { id: string };
  'interaction:blocked': { id: string; reason: string };
  'checkpoint:activated': { id: string; position: { x: number; y: number; z: number } };
  'objective:set': { id: string; text: string };
  'objective:completed': { id: string; text: string };
  'level:loaded': { name: string };
  'level:unloaded': { name: string };
  'debug:toggle': undefined;
  'debug:showColliders': boolean;
  'debug:showLightHelpers': boolean;
  'debug:postProcessing': boolean;
  'debug:shadows': boolean;
  'debug:cameraCollision': boolean;
  'debug:exposure': number;
  'debug:graphicsQuality': { quality: 'low' | 'medium' | 'high' };
  'debug:aaMode': { mode: 'smaa' | 'fxaa' | 'taa' | 'none' };
  'debug:ssaoEnabled': boolean;
  'debug:ssrEnabled': boolean;
  'debug:ssrOpacity': number;
  'debug:ssrResolutionScale': number;
  'debug:bloomEnabled': boolean;
  'debug:bloomStrength': number;
  'debug:vignetteEnabled': boolean;
  'debug:vignetteDarkness': number;
  'debug:lutEnabled': boolean;
  'debug:lutStrength': number;
  'debug:lutName': string;
  'debug:ssgiEnabled': boolean;
  'debug:ssgiPreset': 'low' | 'medium' | 'high';
  'debug:ssgiRadius': number;
  'debug:ssgiGiIntensity': number;
  'debug:traaEnabled': boolean;
  'debug:envBackgroundIntensity': number;
  'debug:envBackgroundBlurriness': number;
  'debug:environment': string;
}
