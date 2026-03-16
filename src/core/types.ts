import type * as THREE from 'three';
import type * as RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleController } from '@vehicle/VehicleController';
import type { ThrowableObject } from '@interaction/interactables/ThrowableObject';

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
  readonly primary: boolean;
  readonly primaryPressed: boolean;
  readonly altitudeUp: boolean;
  readonly altitudeDown: boolean;
  readonly moveX: number;   // -1..1 (left/right analog axis)
  readonly moveY: number;   // -1..1 (backward/forward analog axis)
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
  primary: false,
  primaryPressed: false,
  altitudeUp: false,
  altitudeDown: false,
  moveX: 0,
  moveY: 0,
  sprint: false,
  mouseDeltaX: 0,
  mouseDeltaY: 0,
  mouseWheelDelta: 0,
});

/**
 * All FSM state identifiers.
 * Const-object union: adding a new state = 1 entry here + 1 file + 1 line in CharacterFSM.
 * Typos in state transitions are caught at compile time.
 */
export const STATE = {
  idle: 'idle',
  move: 'move',
  jump: 'jump',
  air: 'air',
  airJump: 'airJump',
  interact: 'interact',
  crouch: 'crouch',
  carry: 'carry',
  grab: 'grab',
} as const;

export type StateId = typeof STATE[keyof typeof STATE];

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
  apexHangThreshold: number;
  apexGravityScale: number;
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
  lookAhead: number;
  speedFovBoost: number;
  lateralDriftScale: number;
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
  'player:landed': { impactSpeed: number };
  'player:jumped': { airJump: boolean; run: boolean; jumpVel: number; position: THREE.Vector3; groundPosition: THREE.Vector3 };
  'player:respawned': { reason: string };
  'interaction:focusChanged': { id: string | null; label: string | null };
  'interaction:triggered': { id: string };
  'interaction:blocked': { id: string; reason: string };
  'interaction:grabStart': { body: RAPIER.RigidBody; offset: THREE.Vector3 };
  'interaction:grabEnd': undefined;
  'interaction:pickUp': { object: ThrowableObject };
  'interaction:throw': { direction: THREE.Vector3; force: number };
  'interaction:drop': undefined;
  'interaction:holdProgress': { id: string; progress: number } | null;
  'checkpoint:activated': { id: string; position: { x: number; y: number; z: number } };
  'objective:set': { id: string; text: string };
  'objective:completed': { id: string; text: string };
  'level:loaded': { name: string };
  'level:unloaded': { name: string };
  'loading:progress': { progress: number };
  'collectible:changed': { count: number };
  'health:changed': { current: number; max: number };
  'player:dying': { reason: string };
  'player:deathMidpoint': undefined;
  'vehicle:enter': { vehicle: VehicleController };
  'vehicle:exit': { position: THREE.Vector3 };
  'vehicle:engineStart': undefined;
  'vehicle:engineStop': undefined;
  'vehicle:speedUpdate': { speedNorm: number };
  'menu:toggle': undefined;
  'menu:opened': { screen: string };
  'menu:closed': undefined;
  'debug:toggle': undefined;
  'debug:showColliders': boolean;
  'debug:showLightHelpers': boolean;
  'debug:postProcessing': boolean;
  'debug:shadows': boolean;
  'debug:cameraCollision': boolean;
  'debug:exposure': number;
  'debug:graphicsProfile': { profile: 'performance' | 'balanced' | 'cinematic' };
  'debug:aoOnly': boolean;
  'debug:aaMode': { mode: 'smaa' | 'fxaa' | 'none' };
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
  'debug:envBackgroundIntensity': number;
  'debug:envBackgroundBlurriness': number;
  'debug:environment': string;
  'debug:environmentRotation': number;
  'debug:shadowQuality': { tier: 'auto' | 'performance' | 'balanced' | 'cinematic' };
  'debug:casEnabled': boolean;
  'debug:casStrength': number;
  'debug:showShadowFrustums': boolean;
  'editor:toggle': undefined;
  'editor:opened': undefined;
  'editor:closed': undefined;
  'editor:objectSelected': { id: string } | null;
  'editor:objectAdded': { id: string };
  'editor:objectRemoved': { id: string };
  'editor:saved': { name: string };
  'editor:loaded': { name: string };
  'audio:musicVolume': number;
  'audio:sfxVolume': number;
  'audio:masterVolume': number;
  'ui:click': undefined;
  'ui:hover': undefined;
}
