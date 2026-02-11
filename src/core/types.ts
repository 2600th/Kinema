import type * as THREE from 'three';

/** Frozen snapshot of input state — safe to read from any system */
export interface InputState {
  readonly forward: boolean;
  readonly backward: boolean;
  readonly left: boolean;
  readonly right: boolean;
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
  'interaction:focusChanged': { id: string | null; label: string | null };
  'interaction:triggered': { id: string };
  'level:loaded': { name: string };
  'level:unloaded': { name: string };
  'debug:toggle': undefined;
}
