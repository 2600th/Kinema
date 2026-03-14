import type * as THREE from 'three';
import type * as RAPIER from '@dimforge/rapier3d-compat';
import type { InputState, PlayerConfig } from '@core/types';
import type { CharacterFSM } from '../CharacterFSM';
import type { CharacterMotor, GroundInfo } from '../CharacterMotor';
import type { GrabCarryController } from '../GrabCarryController';
import type { EventBus } from '@core/EventBus';
import type { PhysicsWorld } from '@physics/PhysicsWorld';

/** Shared context that CharacterModes read and write. */
export interface PlayerContext {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: THREE.Group;
  readonly config: PlayerConfig;
  readonly motor: CharacterMotor;
  readonly grabCarry: GrabCarryController;
  readonly fsm: CharacterFSM;
  readonly eventBus: EventBus;
  readonly physicsWorld: PhysicsWorld;

  cameraYaw: number;
  verticalVelocity: number;
  prevVerticalVelocity: number;
  jumpActive: boolean;
  jumpBufferRemaining: number;
  remainingAirJumps: number;
  isCrouched: boolean;
  isGrounded: boolean;
  canJump: boolean;
  groundInfo: GroundInfo;
  isOnMovingObject: boolean;
  currentGroundBody: RAPIER.RigidBody | null;

  // Capsule geometry state
  currentCapsuleHalfHeight: number;
  standingCapsuleHalfHeight: number;
  crouchedCapsuleHalfHeight: number;
  floatingDistance: number;
  actualSlopeAngle: number;

  // Crouch release grace
  crouchReleaseGraceRemaining: number;
  readonly crouchReleaseGraceSeconds: number;
  crouchVisual: number;

  // Positions & velocities (pre-synced by PlayerController before mode tick)
  readonly currentPos: THREE.Vector3;
  readonly currentVel: THREE.Vector3;
  readonly currPosition: THREE.Vector3;
  readonly prevPosition: THREE.Vector3;
  readonly groundPosition: THREE.Vector3;

  // Moving platform velocity (written by GroundedMode)
  readonly movingObjectVelocity: THREE.Vector3;

  /** Compute camera-relative movement direction from input. */
  computeMovementDirection(input: InputState): THREE.Vector3;
  /** Get last input snapshot (for canStandUp). */
  readonly lastInput: InputState | null;
}

/** Interface for pluggable locomotion modes. */
export interface CharacterMode {
  readonly id: string;
  /** Called when this mode becomes active. */
  enter?(ctx: PlayerContext): void;
  /** Called when switching away from this mode. */
  exit?(ctx: PlayerContext): void;
  /** Per-tick physics. Return a mode ID to switch to, or null to stay. */
  fixedUpdate(ctx: PlayerContext, input: InputState, dt: number): string | null;
}
