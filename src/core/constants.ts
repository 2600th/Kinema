import type { PlayerConfig, CameraConfig } from './types';

/** Fixed physics timestep (60 Hz) */
export const PHYSICS_TIMESTEP = 1 / 60;

/** Max frame delta to prevent spiral of death (250ms) */
export const MAX_FRAME_TIME = 0.25;

/** Gravity acceleration (m/s^2) */
export const GRAVITY = 9.81;

/** Terminal velocity for falling */
export const TERMINAL_VELOCITY = 50;

/** Ground snap raycast distance */
export const SNAP_TO_GROUND_DIST = 0.1;

/** Character controller skin width */
export const CC_OFFSET = 0.01;

/** Max slope the character can climb (radians) */
export const MAX_SLOPE_CLIMB_ANGLE = 1.0;

/** Min slope angle that forces sliding (radians) */
export const MIN_SLOPE_SLIDE_ANGLE = 1.1;

/** Autostep config */
export const AUTOSTEP = {
  maxHeight: 0.3,
  minWidth: 0.2,
  includeDynamicBodies: true,
} as const;

/** Default player configuration */
export const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
  capsuleRadius: 0.3,
  capsuleHalfHeight: 0.35,
  floatHeight: 0.3,
  // Default movement matches the old sprint speed.
  // Sprint remains a true 2x boost.
  moveSpeed: 7,
  turnSpeed: 15,
  sprintMultiplier: 2,
  jumpForce: 4,
  jumpForceToGroundMultiplier: 5,
  slopeJumpMultiplier: 0.25,
  sprintJumpMultiplier: 1.2,
  airControlFactor: 0.2,
  turnVelocityMultiplier: 0.2,
  acceleration: 8,
  rejectVelocityMultiplier: 4,
  moveImpulsePointY: 0.5,
  groundDrag: 0.15,
  dragDamping: 0.15,
  airDragMultiplier: 0.2,
  floatingSpringK: 1.6,
  floatingDampingC: 0.12,
  floatingRayLength: 2.3,
  floatingRayHitForgiveness: 0.1,
  coyoteTime: 0.08,
  jumpBufferTime: 0.12,
  maxAirJumps: 1,
  airJumpForceMultiplier: 0.92,
  crouchHeightOffset: 0.28,
  crouchSpeedMultiplier: 0.55,
  slopeMaxAngle: 1,
  slopeRayLength: 3.3,
  slopeRayOriginOffset: 0.27,
  slopeUpExtraForce: 0.1,
  slopeDownExtraForce: 0.2,
  fallingGravityScale: 2.5,
  fallingMaxVelocity: 20,
  mass: 70,
  autoBalance: false,
  autoBalanceSpringK: 1.2,
  autoBalanceDampingC: 0.04,
  autoBalanceSpringOnY: 0.7,
  autoBalanceDampingOnY: 0.05,
};

/** Default camera configuration */
export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  distance: 5,
  zoomMinDistance: 0.7,
  zoomMaxDistance: 7,
  heightOffset: 1.6,
  pitchMin: -1.3,
  pitchMax: 1.5,
  mouseSensitivity: 0.002,
  zoomSpeed: 1,
  rotationDamping: 11,
  positionDamping: 25,
  fovDamping: 8,
  sprintFovBoost: 6,
  collisionOffset: 0.7,
  collisionSpeed: 4,
  spherecastRadius: 0.2,
  lookAhead: 1.5,
  speedFovBoost: 4,
  lateralDriftScale: 0.35,
};

/** Interaction sensor dimensions */
export const INTERACTION_SENSOR_RADIUS = 2.5;
export const INTERACTION_SENSOR_HALF_HEIGHT = 1.0;

/**
 * Collision groups for physics filtering.
 * Rapier: (membership << 16) | filter. Interaction iff (a.membership & b.filter) && (b.membership & a.filter).
 * Bits: 0=world, 1=player, 2=playerSensor, 3=interactable.
 */
export const COLLISION_GROUP_WORLD = (1 << 16) | 3; // membership world, filter: world+player
export const COLLISION_GROUP_WORLD_ONLY = (1 << 16) | 1; // membership world, filter: world only
export const COLLISION_GROUP_PLAYER = (2 << 16) | 1; // membership player, filter: world
export const COLLISION_GROUP_PLAYER_SENSOR = (4 << 16) | 8; // membership playerSensor, filter: interactable
export const COLLISION_GROUP_INTERACTABLE = (8 << 16) | 4; // membership interactable, filter: playerSensor
