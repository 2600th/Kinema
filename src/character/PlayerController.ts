import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import {
  STATE,
  type InputState,
  type FixedUpdatable,
  type PostPhysicsUpdatable,
  type Updatable,
  type Disposable,
  type SpawnPointData,
} from '@core/types';
import { COLLISION_GROUP_WORLD_ONLY, DEFAULT_PLAYER_CONFIG } from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { ColliderFactory } from '@physics/ColliderFactory';
import { CharacterFSM } from './CharacterFSM';
import { CharacterVisual } from './CharacterVisual';
import { CharacterMotor, shouldApplyGroundReaction } from './CharacterMotor';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _desiredMove = new THREE.Vector3();
const _currentPos = new THREE.Vector3();
const _currentVel = new THREE.Vector3();
const _movingDirection = new THREE.Vector3();
const _jumpVelocityVec = new THREE.Vector3();
const _jumpDirection = new THREE.Vector3();
const _actualSlopeNormal = new THREE.Vector3(0, 1, 0);
const _standingForcePoint = new THREE.Vector3();
const _distanceFromCharacterToObject = new THREE.Vector3();
const _objectAngvelToLinvel = new THREE.Vector3();
const _velocityDiff = new THREE.Vector3();
const _movingObjectVelocity = new THREE.Vector3();
const _stepForward = new THREE.Vector3();
const _stepProbeLowOrigin = new THREE.Vector3();
const _stepProbeHighOrigin = new THREE.Vector3();
const _stepGroundProbeOrigin = new THREE.Vector3();
const _ladderProbePoint = new THREE.Vector3();
const _standProbeOrigin = new THREE.Vector3();
const _standProbeDir = new THREE.Vector3();
const _standProbeRight = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _grabTarget = new THREE.Vector3();
const _grabForward = new THREE.Vector3();
const _carryTarget = new THREE.Vector3();
const _slopeProjected = new THREE.Vector3();
const _groundBodyTranslation = new THREE.Vector3();
const _groundBodyAngvel = new THREE.Vector3();

const _rapierDown = new RAPIER.Vector3(0, -1, 0);
const _rapierUp = new RAPIER.Vector3(0, 1, 0);

// Pre-allocated Rapier vectors to avoid per-frame GC pressure.
// Use A/B/C when multiple live vectors are needed simultaneously (e.g. applyImpulseAtPoint).
const _rv3A = new RAPIER.Vector3(0, 0, 0);
const _rv3B = new RAPIER.Vector3(0, 0, 0);

/** Set x/y/z on a pre-allocated RAPIER.Vector3 and return it. */
function _setRV(v: RAPIER.Vector3, x: number, y: number, z: number): RAPIER.Vector3 {
  v.x = x; v.y = y; v.z = z;
  return v;
}

interface CarryableObject {
  readonly id: string;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: THREE.Object3D;
  readonly throwForce: number;
}

/**
 * Dynamic rigidbody player controller with floating and impulse movement.
 */
export class PlayerController implements FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable {
  public readonly body: RAPIER.RigidBody;
  public readonly collider: RAPIER.Collider;
  public readonly mesh: THREE.Group;
  public readonly fsm: CharacterFSM;
  public readonly motor: CharacterMotor;
  public readonly config = DEFAULT_PLAYER_CONFIG;

  public verticalVelocity = 0;
  public isGrounded = false;
  public cameraYaw = 0;

  private prevPosition = new THREE.Vector3();
  private currPosition = new THREE.Vector3();
  private lastInput: InputState | null = null;

  private canJump = false;
  private jumpActive = false;
  private prevVerticalVelocity = 0;
  private jumpBufferRemaining = 0;
  private remainingAirJumps = this.config.maxAirJumps;
  private isOnMovingObject = false;
  private floatingDistance = this.config.capsuleRadius + this.config.floatHeight;
  private standingCapsuleHalfHeight = this.config.capsuleHalfHeight;
  private crouchedCapsuleHalfHeight = Math.max(0.16, this.config.capsuleHalfHeight - this.config.crouchHeightOffset);
  private currentCapsuleHalfHeight = this.config.capsuleHalfHeight;
  private actualSlopeAngle = 0;
  private active = true;
  private currentGroundBody: RAPIER.RigidBody | null = null;
  private ladderZones: readonly THREE.Box3[] = [];
  private onLadder = false;
  private ropeAttached = false;
  private isCrouched = false;
  private crouchReleaseGraceSeconds = 0.18;
  private crouchReleaseGraceRemaining = 0;
  private crouchVisual = 0;
  private respawnPoint: SpawnPointData | null = null;
  private grabbedBody: RAPIER.RigidBody | null = null;
  private grabbedBodyType: number | null = null;
  private grabbedGravityScale: number | null = null;
  private grabbedCollisionGroups: number | null = null;
  private grabDistance = 1.2;
  private grabOffsetY = 0;
  private carriedObject: CarryableObject | null = null;
  private carriedBodyType: number | null = null;
  private carriedGravityScale: number | null = null;
  private carriedCollisionGroups: number | null = null;
  private cachedHorizontalSpeed = 0;
  private interactSuppressFrames = 0;

  get lastInputSnapshot(): InputState | null {
    return this.lastInput;
  }

  get isActive(): boolean {
    return this.active;
  }

  get crouching(): boolean {
    return this.isCrouched;
  }

  get isRopeAttached(): boolean {
    return this.ropeAttached;
  }

  getCameraHeightOffset(): number {
    // Camera needs a stronger crouch drop than the physics body offset
    // so it can follow through low tunnels instead of staying above roofs.
    return 0.95 * this.crouchVisual;
  }

  private colliderFactory: ColliderFactory;
  private characterVisual: CharacterVisual | null = null;
  private readonly capsuleMesh: THREE.Mesh;

  constructor(
    private physicsWorld: PhysicsWorld,
    private scene: THREE.Scene,
    private eventBus: EventBus,
  ) {
    this.colliderFactory = new ColliderFactory(physicsWorld);

    const { body, collider } = this.colliderFactory.createCapsuleBody(
      new THREE.Vector3(0, 5, 0),
      this.config.capsuleHalfHeight,
      this.config.capsuleRadius,
    );
    this.body = body;
    this.collider = collider;
    this.body.setAdditionalMass(this.config.mass, true);
    // Lock rigidbody rotations for stable capsule-ground contact.
    this.body.setEnabledRotations(false, false, false, true);
    this.body.setLinearDamping(0);
    this.body.setAngularDamping(0);
    this.body.setGravityScale(1, true);
    this.body.enableCcd(true);

    this.mesh = new THREE.Group();
    this.mesh.name = 'PlayerVisual';
    this.scene.add(this.mesh);

    const capsuleGeom = new THREE.CapsuleGeometry(this.config.capsuleRadius, this.config.capsuleHalfHeight * 2, 8, 16);
    const capsuleMat = new THREE.MeshStandardMaterial({ color: 0x3388ff });
    this.capsuleMesh = new THREE.Mesh(capsuleGeom, capsuleMat);
    this.capsuleMesh.name = 'PlayerCapsule';
    this.capsuleMesh.castShadow = true;
    this.capsuleMesh.receiveShadow = true;
    this.mesh.add(this.capsuleMesh);

    this.motor = new CharacterMotor();
    this.fsm = new CharacterFSM(this, this.eventBus);

    this.characterVisual = new CharacterVisual(this.mesh);
    void this.characterVisual.init(); // non-blocking; keeps capsule fallback if no model is present

    const pos = this.body.translation();
    this.currPosition.set(pos.x, pos.y, pos.z);
    this.prevPosition.copy(this.currPosition);
  }

  spawn(spawn: SpawnPointData): void {
    const p = spawn.position;
    this.body.setTranslation(new RAPIER.Vector3(p.x, p.y, p.z), true);
    this.body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
    this.body.setAngvel(new RAPIER.Vector3(0, 0, 0), true);

    const pos = this.body.translation();
    this.currPosition.set(pos.x, pos.y, pos.z);
    this.prevPosition.copy(this.currPosition);
    this.mesh.position.copy(this.currPosition);
    if (spawn.rotation) {
      this.mesh.rotation.y = spawn.rotation.y;
    }

    this.verticalVelocity = 0;
    this.prevVerticalVelocity = 0;
    this.isGrounded = false;
    this.canJump = false;
    this.jumpActive = false;
    this.actualSlopeAngle = 0;
    this.motor.reset();
    this.motor.setGravityScale(this.body, 1);
    _movingObjectVelocity.set(0, 0, 0);
    this.currentGroundBody = null;
    this.onLadder = false;
    this.jumpBufferRemaining = 0;
    this.remainingAirJumps = this.config.maxAirJumps;
    this.ropeAttached = false;
    this.isCrouched = false;
    this.crouchReleaseGraceRemaining = 0;
    this.crouchVisual = 0;
    this.mesh.scale.set(1, 1, 1);
    this.currentCapsuleHalfHeight = this.standingCapsuleHalfHeight;
    this.collider.setHalfHeight(this.standingCapsuleHalfHeight);
    this.respawnPoint = {
      position: spawn.position.clone(),
      rotation: spawn.rotation?.clone(),
    };
  }

  fixedUpdate(dt: number): void {
    if (!this.active) return;
    let input = this.lastInput;
    if (!input) return;

    // Mask interactPressed for a few frames after vehicle exit to prevent
    // the same press from triggering a grounded interaction.
    if (this.interactSuppressFrames > 0) {
      this.interactSuppressFrames--;
      if (input.interactPressed) {
        input = { ...input, interactPressed: false };
      }
    }

    let consumeInteractPressed = false;
    let consumeJumpPressed = false;

    this.prevPosition.copy(this.currPosition);

    if (this.grabbedBody && (input.jumpPressed || input.interactPressed)) {
      consumeInteractPressed = input.interactPressed;
      consumeJumpPressed = input.jumpPressed;
      this.fsm.requestState(STATE.idle);
    }

    if (this.carriedObject) {
      if (input.primaryPressed || input.interactPressed) {
        this.throwCarried();
        this.fsm.requestState(this.hasMovementInput(input) ? STATE.move : STATE.idle);
      } else if (input.crouchPressed) {
        this.dropCarried();
        this.fsm.requestState(this.hasMovementInput(input) ? STATE.move : STATE.idle);
      }
    }

    const inputForFsm: InputState =
      consumeInteractPressed || consumeJumpPressed
        ? {
            ...input,
            interactPressed: consumeInteractPressed ? false : input.interactPressed,
            jumpPressed: consumeJumpPressed ? false : input.jumpPressed,
          }
        : input;

    // Refill jump buffer AFTER grab/carry consumption so that a jumpPressed
    // used to drop an object doesn't also fill the jump buffer (phantom jump).
    // No suppression guard here — the buffer should always fill on a press.
    // Suppression only affects grounded detection, not input acceptance.
    if (inputForFsm.jumpPressed) {
      this.jumpBufferRemaining = this.config.jumpBufferTime;
    } else {
      this.jumpBufferRemaining = Math.max(0, this.jumpBufferRemaining - dt);
    }

    const pos = this.body.translation();
    const vel = this.body.linvel();
    _currentPos.set(pos.x, pos.y, pos.z);
    _currentVel.set(vel.x, vel.y, vel.z);
    this.prevVerticalVelocity = this.verticalVelocity;
    this.verticalVelocity = _currentVel.y;
    this.cachedHorizontalSpeed = Math.hypot(_currentVel.x, _currentVel.z);

    if (this.ropeAttached) {
      this.jumpBufferRemaining = 0;
      this.onLadder = false;
      this.setCrouchedState(false);
      this.floatingDistance = this.config.capsuleRadius + this.config.floatHeight;
      this.remainingAirJumps = this.config.maxAirJumps;
      const wasGrounded = this.isGrounded;
      this.isGrounded = false;
      this.canJump = false;
      this.motor.clearGroundedGrace();
      if (wasGrounded) {
        this.eventBus.emit('player:grounded', false);
      }
      if (this.fsm.current !== STATE.air) {
        this.fsm.requestState(STATE.air);
      }
      return;
    }

    this.updateCrouchState(input.crouch, _currentPos, dt);
    this.floatingDistance = this.getTargetFloatingDistance();

    const movementLocked = this.fsm.current === STATE.interact;
    const inLadderZone = this.isInsideLadder(_currentPos);
    // Only allow jump to trigger ladder grab while airborne — grounded jumps
    // should fire normally even inside a ladder zone.
    const wantsLadder = !movementLocked && (input.forward || input.backward || (input.jumpPressed && !this.isGrounded) || this.onLadder);
    this.onLadder = inLadderZone && wantsLadder;
    if (this.onLadder) {
      this.setCrouchedState(false);
      this.floatingDistance = this.config.capsuleRadius + this.config.floatHeight;
      const wasGrounded = this.isGrounded;
      this.isGrounded = true;
      this.canJump = true;
      this.remainingAirJumps = this.config.maxAirJumps;
      if (this.isGrounded !== wasGrounded) {
        this.eventBus.emit('player:grounded', this.isGrounded);
      }
      this.fsm.handleInput(input, true);
      this.fsm.update(dt);
      this.handleLadderMovement(input);
      return;
    }
    if (this.motor.gravityScale === 0) {
      this.motor.setGravityScale(this.body, 1);
    }

    this.fsm.handleInput(inputForFsm, this.isGrounded);
    this.fsm.update(dt);
    if (this.ropeAttached) {
      if (this.fsm.current !== STATE.air) {
        this.fsm.requestState(STATE.air);
      }
      return;
    }

    const desiredInputDir = this.computeMovementDirection(inputForFsm);
    if (desiredInputDir.lengthSq() > 0.0001) {
      this.rotateToward(desiredInputDir, dt);
    }

    // -- Ground detection (delegated to CharacterMotor) --
    const groundInfo = this.motor.queryGround(
      this.body, this.currentCapsuleHalfHeight, this.mesh.quaternion,
      this.config, this.physicsWorld, this.floatingDistance, dt,
    );
    this.actualSlopeAngle = groundInfo.slopeAngle;
    _actualSlopeNormal.copy(groundInfo.slopeNormal);
    _standingForcePoint.copy(groundInfo.standingForcePoint);
    this.canJump = groundInfo.canJump;

    const wasGrounded = this.isGrounded;
    this.isGrounded = groundInfo.isGrounded;
    if (this.isGrounded) {
      this.remainingAirJumps = this.config.maxAirJumps;
    }
    if (this.isGrounded !== wasGrounded) {
      this.eventBus.emit('player:grounded', this.isGrounded);
    }
    // Landing event: emit impact speed (relative to ground body) for camera dip / audio
    if (this.isGrounded && !wasGrounded) {
      const groundVy = groundInfo.floatingRayHit?.collider.parent()?.linvel().y ?? 0;
      const impactSpeed = Math.max(0, Math.abs(this.prevVerticalVelocity - groundVy));
      this.eventBus.emit('player:landed', { impactSpeed });
      this.jumpActive = false;
    }

    // Variable jump: cut jump short when player releases jump key while rising.
    // Cap velocity to the cut ceiling using Math.min so it never snaps UP.
    // The suppression window prevents cutting a just-fired buffered jump.
    if (!input.jump && this.verticalVelocity > 0 && this.jumpActive
        && !this.motor.isJumpSuppressed) {
      this.motor.applyJumpCut(this.body, this.config);
      this.verticalVelocity = this.body.linvel().y;
      this.jumpActive = false;
    }

    this.currentGroundBody = null;
    this.isOnMovingObject = false;
    _movingObjectVelocity.set(0, 0, 0);
    if (groundInfo.groundBody) {
      const groundBody = groundInfo.groundBody;
      const groundBodyType = groundBody.bodyType();
      this.currentGroundBody = groundBody;

      if (groundBodyType === 0 || groundBodyType === 2) {
        this.isOnMovingObject = true;
        const gbt = groundBody.translation();
        _groundBodyTranslation.set(gbt.x, gbt.y, gbt.z);
        _distanceFromCharacterToObject
          .copy(_currentPos)
          .sub(_groundBodyTranslation);
        const lv = groundBody.linvel();
        const av = groundBody.angvel();
        _groundBodyAngvel.set(av.x, av.y, av.z);
        _objectAngvelToLinvel.crossVectors(
          _groundBodyAngvel,
          _distanceFromCharacterToObject,
        );
        _movingObjectVelocity.set(
          lv.x + _objectAngvelToLinvel.x,
          lv.y,
          lv.z + _objectAngvelToLinvel.z,
        );

        const groundMass = Math.max(groundBody.mass(), 0.001);
        const massRatio = this.body.mass() / groundMass;
        _movingObjectVelocity.multiplyScalar(Math.min(1, 1 / massRatio));
        _velocityDiff.subVectors(_movingObjectVelocity, _currentVel);
        if (_velocityDiff.length() > 30) {
          _movingObjectVelocity.multiplyScalar(1 / _velocityDiff.length());
        }
      }
    }

    const movementLockedNow = this.fsm.current === STATE.interact;
    const hasMovement = !movementLockedNow && (input.moveX !== 0 || input.moveY !== 0);
    const run = this.fsm.current !== STATE.grab && input.sprint && !this.isCrouched;
    // Movement: use velocity steering (character-controller feel) instead of impulse accumulation.
    // WHY: Impulse-based locomotion felt floaty and caused direction drift when releasing strafe.
    this.applyMoveVelocity(desiredInputDir, run, hasMovement, dt, input);
    if (hasMovement) {
      this.applyStepAssist(desiredInputDir, run, dt);
    }

    if (!movementLockedNow && this.fsm.current !== STATE.grab && this.jumpBufferRemaining > 0) {
      if (this.canJump) {
        this.fsm.requestState(STATE.jump);
        this.applyJumpImpulse(run, false);
        this.jumpBufferRemaining = 0;
        this.motor.clearGroundedGrace();
        this.canJump = false;
      } else if (this.remainingAirJumps > 0) {
        this.fsm.requestState(STATE.airJump);
        this.applyJumpImpulse(false, true);
        this.jumpBufferRemaining = 0;
        this.remainingAirJumps -= 1;
        this.motor.clearGroundedGrace();
        this.canJump = false;
      }
    }

    // -- Floating spring force (delegated to CharacterMotor) --
    this.motor.applyFloatingSpring(this.body, groundInfo, this.config, this.floatingDistance);

    // Ground drag is handled by applyMoveVelocity() so we don't double-damp.

    // -- Gravity scaling (delegated to CharacterMotor) --
    this.motor.applyGravity(this.body, _currentVel.y, this.canJump, this.config);

    if (this.grabbedBody) {
      this.updateGrabbedBody();
    }
    if (this.carriedObject) {
      this.updateCarriedObject();
    }

  }

  postPhysicsUpdate(_dt: number): void {
    if (!this.active) return;
    const pos = this.body.translation();
    this.currPosition.set(pos.x, pos.y, pos.z);
  }

  private applyMoveVelocity(
    desiredInputDir: THREE.Vector3,
    run: boolean,
    hasMovement: boolean,
    dt: number,
    input?: InputState | null,
  ): void {
    // Target speed based on stance/state, scaled by analog stick magnitude.
    const crouchMult = this.isCrouched ? this.config.crouchSpeedMultiplier : 1;
    const grabMult = this.fsm.current === STATE.grab ? this.config.crouchSpeedMultiplier : 1;
    const stickMag = input ? Math.min(1, Math.hypot(input.moveX, input.moveY)) : 1;
    const targetSpeed =
      this.config.moveSpeed * crouchMult * grabMult * (run ? this.config.sprintMultiplier : 1) * stickMag;

    // Desired horizontal velocity (camera-relative input), plus moving-platform contribution.
    const platformVx = this.isOnMovingObject ? _movingObjectVelocity.x : 0;
    const platformVz = this.isOnMovingObject ? _movingObjectVelocity.z : 0;

    const lv = this.body.linvel();
    const grounded = this.canJump;
    const inAir = !grounded;

    // Slope projection: when grounded on a non-trivial slope, project movement
    // onto the slope surface so velocity follows the terrain instead of fighting it.
    const MIN_SLOPE_THRESHOLD = 0.05; // radians — ignore near-flat surfaces
    const onSlope = grounded && this.actualSlopeAngle > MIN_SLOPE_THRESHOLD;

    // Compute desired direction on XZ plane.
    _movingDirection.copy(desiredInputDir).setY(0);
    const hasDir = hasMovement && _movingDirection.lengthSq() > 0.0001;
    if (hasDir) _movingDirection.normalize();

    // If on a slope with active input, project the XZ direction onto the slope plane.
    // This gives the velocity a Y component that follows the surface.
    let useSlope = false;
    let slopeDirX = 0;
    let slopeDirY = 0;
    let slopeDirZ = 0;
    let slopeExtraMultiplier = 1;

    if (onSlope && hasDir) {
      // Project desired direction onto slope: dir - normal * dot(dir, normal)
      const dot = _movingDirection.x * _actualSlopeNormal.x +
                  _movingDirection.y * _actualSlopeNormal.y +
                  _movingDirection.z * _actualSlopeNormal.z;
      _slopeProjected.set(
        _movingDirection.x - _actualSlopeNormal.x * dot,
        _movingDirection.y - _actualSlopeNormal.y * dot,
        _movingDirection.z - _actualSlopeNormal.z * dot,
      );
      const projLen = _slopeProjected.length();
      if (projLen > 0.0001) {
        _slopeProjected.divideScalar(projLen);
        useSlope = true;
        slopeDirX = _slopeProjected.x;
        slopeDirY = _slopeProjected.y;
        slopeDirZ = _slopeProjected.z;

        // Determine uphill vs downhill: projected Y > 0 means moving uphill.
        if (slopeDirY > 0.001) {
          slopeExtraMultiplier = 1 + this.config.slopeUpExtraForce;
        } else if (slopeDirY < -0.001) {
          slopeExtraMultiplier = 1 + this.config.slopeDownExtraForce;
        }
      }
    }

    // Relative (to moving platform) velocity.
    const relVx0 = lv.x - platformVx;
    const relVz0 = lv.z - platformVz;

    // Snappy stop on ground, limited control in air.
    const accelLambdaGround = 30;
    const stopLambdaGround = 58;
    const sideKillLambdaGround = 82; // kill sideways drift fast when input direction changes
    const baseLambda = hasDir ? accelLambdaGround : stopLambdaGround;
    const lambda = inAir ? baseLambda * this.config.airControlFactor : baseLambda;
    const sideLambda = inAir ? sideKillLambdaGround * this.config.airControlFactor : sideKillLambdaGround;

    const t = 1 - Math.exp(-lambda * dt);
    const tSide = 1 - Math.exp(-sideLambda * dt);

    let nextVx: number;
    let nextVy: number;
    let nextVz: number;

    if (hasDir && useSlope) {
      // 3D decomposition along the slope-projected direction.
      // Parallel component: dot of relative velocity with slope direction.
      const relVy0 = lv.y;
      const vParMag0 = relVx0 * slopeDirX + relVy0 * slopeDirY + relVz0 * slopeDirZ;
      const vPerpX0 = relVx0 - slopeDirX * vParMag0;
      const vPerpY0 = relVy0 - slopeDirY * vParMag0;
      const vPerpZ0 = relVz0 - slopeDirZ * vParMag0;

      // Steer parallel speed toward target (with slope extra force), damp perpendicular.
      const adjustedTarget = targetSpeed * slopeExtraMultiplier;
      const vParMag = vParMag0 + (adjustedTarget - vParMag0) * t;
      const vPerpX = vPerpX0 + (0 - vPerpX0) * tSide;
      const vPerpY = vPerpY0 + (0 - vPerpY0) * tSide;
      const vPerpZ = vPerpZ0 + (0 - vPerpZ0) * tSide;

      nextVx = (slopeDirX * vParMag + vPerpX) + platformVx;
      nextVy = slopeDirY * vParMag + vPerpY;
      nextVz = (slopeDirZ * vParMag + vPerpZ) + platformVz;
    } else if (hasDir) {
      // Flat ground / air: original XZ-only logic.
      const dirX = _movingDirection.x;
      const dirZ = _movingDirection.z;
      const vParMag0 = relVx0 * dirX + relVz0 * dirZ;
      const vPerpX0 = relVx0 - dirX * vParMag0;
      const vPerpZ0 = relVz0 - dirZ * vParMag0;

      const vParMag = vParMag0 + (targetSpeed - vParMag0) * t;
      const vPerpX = vPerpX0 + (0 - vPerpX0) * tSide;
      const vPerpZ = vPerpZ0 + (0 - vPerpZ0) * tSide;

      nextVx = (dirX * vParMag + vPerpX) + platformVx;
      nextVy = lv.y;
      nextVz = (dirZ * vParMag + vPerpZ) + platformVz;
    } else {
      // No input: damp relative velocity to zero.
      nextVx = (relVx0 + (0 - relVx0) * t) + platformVx;
      nextVy = lv.y;
      nextVz = (relVz0 + (0 - relVz0) * t) + platformVz;
    }

    this.body.setLinvel(_setRV(_rv3A, nextVx, nextVy, nextVz), true);
  }

  private applyJumpImpulse(run: boolean, airJump: boolean): void {
    this.jumpActive = true;
    // Suppress ground detection for 3 frames after any jump to prevent
    // the floating ray from re-grounding and refilling air jumps instantly.
    this.motor.onJumpFired();
    const jumpVel =
      (run ? this.config.sprintJumpMultiplier : 1) *
      this.config.jumpForce *
      (airJump ? this.config.airJumpForceMultiplier : 1);

    if (airJump) {
      // Air jumps: pure vertical impulse, no slope projection (stale normal data).
      this.body.setLinvel(
        _setRV(_rv3A, _currentVel.x, jumpVel, _currentVel.z),
        true,
      );
    } else {
      // Ground jumps: project onto slope normal for natural slope-boosted takeoff.
      _jumpVelocityVec.set(_currentVel.x, jumpVel, _currentVel.z);
      _jumpDirection
        .set(0, jumpVel * this.config.slopeJumpMultiplier, 0)
        .projectOnVector(_actualSlopeNormal)
        .add(_jumpVelocityVec);

      this.body.setLinvel(
        _setRV(_rv3A, _jumpDirection.x, _jumpDirection.y, _jumpDirection.z),
        true,
      );
    }

    this.eventBus.emit('player:jumped', {
      airJump,
      run,
      jumpVel,
      position: this.currPosition.clone(),
      groundPosition: this.groundPosition.clone(),
    });

    if (this.currentGroundBody && shouldApplyGroundReaction(this.currentGroundBody)) {
      const down = -jumpVel * this.config.jumpForceToGroundMultiplier * 0.5;
      this.currentGroundBody.applyImpulseAtPoint(
        _setRV(_rv3A, 0, down, 0),
        _setRV(_rv3B, _standingForcePoint.x, _standingForcePoint.y, _standingForcePoint.z),
        true,
      );
    }
  }

  private applyStepAssist(desiredInputDir: THREE.Vector3, run: boolean, dt: number): void {
    if (!this.canJump && !this.isGrounded) return;
    if (desiredInputDir.lengthSq() < 0.0001) return;
    if (_currentVel.y > 0.55) return;

    _stepForward.copy(desiredInputDir).setY(0);
    if (_stepForward.lengthSq() < 0.0001) return;
    _stepForward.normalize();

    const probeDist = this.config.capsuleRadius + (run ? 0.95 : 0.85);
    _stepProbeLowOrigin.set(
      _currentPos.x,
      _currentPos.y - this.currentCapsuleHalfHeight + 0.08,
      _currentPos.z,
    );
    _stepProbeHighOrigin.set(
      _currentPos.x,
      _currentPos.y - this.currentCapsuleHalfHeight + 0.68,
      _currentPos.z,
    );

    const lowHit = this.physicsWorld.castRay(
      _setRV(_rv3A, _stepProbeLowOrigin.x, _stepProbeLowOrigin.y, _stepProbeLowOrigin.z),
      _setRV(_rv3B, _stepForward.x, _stepForward.y, _stepForward.z),
      probeDist,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );
    if (!lowHit || lowHit.timeOfImpact > probeDist) return;

    const highHit = this.physicsWorld.castRay(
      _setRV(_rv3A, _stepProbeHighOrigin.x, _stepProbeHighOrigin.y, _stepProbeHighOrigin.z),
      _setRV(_rv3B, _stepForward.x, _stepForward.y, _stepForward.z),
      probeDist,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );
    if (highHit) return;

    const lv = this.body.linvel();
    // Velocity-only step assist: fold the step-up displacement into the
    // vertical velocity so the physics solver handles it naturally without
    // teleporting the dynamic body (which can cause jitter, missed contacts,
    // or ghost-step behavior on edges).
    // At 60 Hz, a displacement of d metres/frame ≈ d * 60 m/s in velocity.
    const stepUpVel = (run ? 0.12 : 0.1) / dt; // per-frame displacement → velocity
    const fwdNudgeVel = 0.05 / dt;              // per-frame displacement → velocity
    const upBoost = run ? 3.4 : 3.0;
    const fwdBoost = run ? 1.35 : 1.2;
    if (lv.y < upBoost) {
      this.body.setLinvel(
        _setRV(_rv3A,
          lv.x + _stepForward.x * (fwdBoost + fwdNudgeVel),
          Math.max(lv.y, upBoost + stepUpVel),
          lv.z + _stepForward.z * (fwdBoost + fwdNudgeVel),
        ),
        true,
      );
    }

    // Ground probe ahead to keep capsule "stuck" to short stair runs/curbs while moving forward.
    _stepGroundProbeOrigin.set(
      _currentPos.x + _stepForward.x * (run ? 0.58 : 0.5),
      _currentPos.y - this.currentCapsuleHalfHeight + 0.75,
      _currentPos.z + _stepForward.z * (run ? 0.58 : 0.5),
    );
    const downHit = this.physicsWorld.castRay(
      _setRV(_rv3A, _stepGroundProbeOrigin.x, _stepGroundProbeOrigin.y, _stepGroundProbeOrigin.z),
      _rapierDown,
      1.4,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );
    if (downHit) {
      const groundAheadY = _stepGroundProbeOrigin.y - downHit.timeOfImpact;
      const feetY = _currentPos.y - this.currentCapsuleHalfHeight;
      const stepHeight = groundAheadY - feetY;
      const maxStepHeight = run ? 0.34 : 0.28;
      if (stepHeight > 0.02 && stepHeight <= maxStepHeight) {
        // Convert step-up displacement to velocity impulse instead of teleporting.
        const curLv = this.body.linvel();
        const clampedHeight = Math.min(stepHeight + 0.02, maxStepHeight);
        const stepVel = clampedHeight * 60;
        const fwdStepVel = 0.06 * 60;
        this.body.setLinvel(
          _setRV(_rv3A,
            curLv.x + _stepForward.x * fwdStepVel,
            Math.max(curLv.y, stepVel),
            curLv.z + _stepForward.z * fwdStepVel,
          ),
          true,
        );
      }
    }
  }

  private isInsideLadder(position: THREE.Vector3): boolean {
    _ladderProbePoint.copy(position);
    _ladderProbePoint.y -= this.currentCapsuleHalfHeight * 0.35;
    for (const zone of this.ladderZones) {
      if (zone.containsPoint(_ladderProbePoint)) {
        return true;
      }
    }
    return false;
  }

  private handleLadderMovement(input: InputState): void {
    const climbDir = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const climbSpeed = input.sprint ? 3.6 : 2.6;
    const lv = this.body.linvel();
    this.motor.setGravityScale(this.body, 0);
    this.body.setLinvel(
      _setRV(_rv3A, lv.x * 0.2, climbDir * climbSpeed, lv.z * 0.2),
      true,
    );

    if (input.jumpPressed) {
      this.onLadder = false;
      this.motor.setGravityScale(this.body, 1);
      this.jumpBufferRemaining = 0;
      this.remainingAirJumps = this.config.maxAirJumps;
      this.body.setLinvel(
        _setRV(_rv3A, lv.x * 0.6, Math.max(this.config.jumpForce * 0.9, 3.2), lv.z * 0.6),
        true,
      );
    }
  }

  private getTargetFloatingDistance(): number {
    return this.config.capsuleRadius + this.config.floatHeight;
  }

  private updateCrouchState(wantsCrouch: boolean, position: THREE.Vector3, dt: number): void {
    if (wantsCrouch) {
      this.crouchReleaseGraceRemaining = this.crouchReleaseGraceSeconds;
      this.setCrouchedState(true);
      return;
    }
    if (!this.isCrouched) {
      this.crouchReleaseGraceRemaining = 0;
      return;
    }
    const blocked = !this.canStandUp(position);
    if (blocked) {
      this.crouchReleaseGraceRemaining = this.crouchReleaseGraceSeconds;
      this.setCrouchedState(true);
      return;
    }
    if (this.crouchReleaseGraceRemaining > 0) {
      this.crouchReleaseGraceRemaining = Math.max(0, this.crouchReleaseGraceRemaining - dt);
      this.setCrouchedState(true);
      return;
    }
    this.setCrouchedState(false);
  }

  private setCrouchedState(crouched: boolean): void {
    if (this.isCrouched === crouched) return;
    this.isCrouched = crouched;
    if (!crouched) {
      this.crouchReleaseGraceRemaining = 0;
    }
    const targetHalf = crouched ? this.crouchedCapsuleHalfHeight : this.standingCapsuleHalfHeight;
    if (Math.abs(targetHalf - this.currentCapsuleHalfHeight) <= 0.0001) return;

    const pos = this.body.translation();
    const deltaHalf = this.currentCapsuleHalfHeight - targetHalf;
    this.currentCapsuleHalfHeight = targetHalf;
    this.collider.setHalfHeight(targetHalf);
    this.body.setTranslation(_setRV(_rv3A, pos.x, pos.y - deltaHalf, pos.z), true);
    this.body.wakeUp();
    this.currPosition.set(pos.x, pos.y - deltaHalf, pos.z);
    this.prevPosition.set(pos.x, pos.y - deltaHalf, pos.z);
    this.floatingDistance = this.getTargetFloatingDistance();
  }

  private canStandUp(position: THREE.Vector3): boolean {
    const standDelta = this.standingCapsuleHalfHeight - this.currentCapsuleHalfHeight;
    if (standDelta <= 0.001) return true;
    const probeLength = standDelta * 2 + 0.04;
    if (this.isStandProbeBlocked(position.x, position.y, position.z, probeLength)) {
      return false;
    }

    const input = this.lastInput;
    if (!input) return true;

    _standProbeDir.copy(this.computeMovementDirection(input)).setY(0);
    if (_standProbeDir.lengthSq() < 0.0001) {
      return true;
    }
    _standProbeDir.normalize();
    _standProbeRight.crossVectors(_standProbeDir, _worldUp).normalize();
    const forward = this.config.capsuleRadius * 0.95;
    const shoulder = this.config.capsuleRadius * 0.55;

    if (
      this.isStandProbeBlocked(
        position.x + _standProbeDir.x * forward,
        position.y,
        position.z + _standProbeDir.z * forward,
        probeLength,
      )
    ) {
      return false;
    }
    if (
      this.isStandProbeBlocked(
        position.x + _standProbeDir.x * forward + _standProbeRight.x * shoulder,
        position.y,
        position.z + _standProbeDir.z * forward + _standProbeRight.z * shoulder,
        probeLength,
      )
    ) {
      return false;
    }
    if (
      this.isStandProbeBlocked(
        position.x + _standProbeDir.x * forward - _standProbeRight.x * shoulder,
        position.y,
        position.z + _standProbeDir.z * forward - _standProbeRight.z * shoulder,
        probeLength,
      )
    ) {
      return false;
    }
    return true;
  }

  private isStandProbeBlocked(x: number, y: number, z: number, probeLength: number): boolean {
    _standProbeOrigin.set(
      x,
      y + this.currentCapsuleHalfHeight + this.config.capsuleRadius,
      z,
    );
    const hit = this.physicsWorld.castRay(
      _setRV(_rv3A, _standProbeOrigin.x, _standProbeOrigin.y, _standProbeOrigin.z),
      _rapierUp,
      probeLength,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );
    return hit != null;
  }

  update(_dt: number, alpha: number): void {
    if (!this.active) return;
    this.mesh.position.lerpVectors(this.prevPosition, this.currPosition, alpha);
    const target = this.isCrouched ? 1 : 0;
    this.crouchVisual += (target - this.crouchVisual) * (1 - Math.exp(-12 * _dt));
    const scaleY = 1 - this.crouchVisual * 0.28;
    const scaleXZ = 1 + this.crouchVisual * 0.04;
    this.mesh.scale.set(scaleXZ, scaleY, scaleXZ);
    // Sync animation playback speed to cached horizontal velocity to prevent foot-sliding.
    this.characterVisual?.setMovementSpeed(this.cachedHorizontalSpeed);

    this.characterVisual?.setState(this.fsm.current);
    this.characterVisual?.update(_dt);
  }

  setInput(input: InputState): void {
    this.lastInput = input;
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  suppressInteract(frames = 2): void {
    this.interactSuppressFrames = frames;
  }

  setEnabled(enabled: boolean): void {
    this.body.setEnabled(enabled);
    this.mesh.visible = enabled;
  }

  startGrab(body: RAPIER.RigidBody, offset?: THREE.Vector3): void {
    if (this.grabbedBody || this.carriedObject) return;
    this.grabbedBody = body;
    this.grabbedBodyType = body.bodyType();
    this.grabbedGravityScale = body.gravityScale();
    const collider = body.collider(0);
    if (collider) {
      const cg = collider as unknown as { collisionGroups?: () => number };
      this.grabbedCollisionGroups = cg.collisionGroups ? cg.collisionGroups() : null;
      collider.setCollisionGroups(COLLISION_GROUP_WORLD_ONLY);
    } else {
      this.grabbedCollisionGroups = null;
    }
    const bodyPos = body.translation();
    const sourceOffset =
      offset ?? new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z).sub(this.currPosition);
    this.grabDistance = Math.min(2.5, Math.max(0.8, Math.sqrt(sourceOffset.x ** 2 + sourceOffset.z ** 2)));
    this.grabOffsetY = sourceOffset.y;
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setGravityScale(0, true);
    this.fsm.requestState(STATE.grab);
  }

  endGrab(): void {
    if (!this.grabbedBody) return;
    const body = this.grabbedBody;
    const collider = body.collider(0);
    if (collider && this.grabbedCollisionGroups != null) {
      collider.setCollisionGroups(this.grabbedCollisionGroups);
    }
    const bodyType = this.grabbedBodyType ?? RAPIER.RigidBodyType.Dynamic;
    body.setBodyType(bodyType, true);
    body.setGravityScale(this.grabbedGravityScale ?? 1, true);
    if (bodyType === RAPIER.RigidBodyType.Dynamic) {
      const forward = this.getCameraForward().setY(0).normalize();
      body.applyImpulse(_setRV(_rv3A, forward.x * 0.25, 0, forward.z * 0.25), true);
    }
    this.grabbedBody = null;
    this.grabbedBodyType = null;
    this.grabbedGravityScale = null;
    this.grabbedCollisionGroups = null;
    this.eventBus.emit('interaction:grabEnd', undefined);
  }

  startCarry(object: CarryableObject): void {
    if (this.carriedObject || this.grabbedBody) return;
    this.carriedObject = object;
    this.carriedBodyType = object.body.bodyType();
    this.carriedGravityScale = object.body.gravityScale();
    const collider = object.collider as unknown as { collisionGroups?: () => number };
    this.carriedCollisionGroups = collider.collisionGroups ? collider.collisionGroups() : null;
    object.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    object.body.setGravityScale(0, true);
    object.collider.setCollisionGroups(COLLISION_GROUP_WORLD_ONLY);
    this.fsm.requestState(STATE.carry);
  }

  throwCarried(): void {
    if (!this.carriedObject) return;
    const object = this.carriedObject;
    this.releaseCarryBody();
    object.body.enableCcd(true);
    const forward = this.getCameraForward().normalize();
    // Treat throwForce as a *target throw speed* (m/s) rather than a raw impulse.
    // WHY: applying a fixed impulse makes small/light objects reach extreme
    // velocities and tunnel through walls even with contact events enabled.
    const targetSpeed = Math.max(0.5, Math.min(object.throwForce, 10));
    object.body.setLinvel(
      _setRV(_rv3A, forward.x * targetSpeed, forward.y * targetSpeed, forward.z * targetSpeed),
      true,
    );
    // Add some spin for readability.
    object.body.setAngvel(_setRV(_rv3B, forward.z * 6, 5, -forward.x * 6), true);
    this.eventBus.emit('interaction:throw', { direction: forward.clone(), force: targetSpeed });
  }

  dropCarried(): void {
    if (!this.carriedObject) return;
    const object = this.carriedObject;
    const forward = this.getCameraForward().setY(0).normalize();
    _carryTarget.copy(this.currPosition).addScaledVector(forward, 0.8);
    _carryTarget.y += this.currentCapsuleHalfHeight + 0.2;
    this.releaseCarryBody();
    object.body.setTranslation(_setRV(_rv3A, _carryTarget.x, _carryTarget.y, _carryTarget.z), true);
    object.body.setLinvel(_setRV(_rv3B, 0, 0, 0), true);
    this.eventBus.emit('interaction:drop', undefined);
  }

  private releaseCarryBody(): void {
    if (!this.carriedObject) return;
    const object = this.carriedObject;
    object.body.setBodyType(this.carriedBodyType ?? RAPIER.RigidBodyType.Dynamic, true);
    object.body.setGravityScale(this.carriedGravityScale ?? 1, true);
    if (this.carriedCollisionGroups != null) {
      object.collider.setCollisionGroups(this.carriedCollisionGroups);
    }
    this.carriedObject = null;
    this.carriedBodyType = null;
    this.carriedGravityScale = null;
    this.carriedCollisionGroups = null;
  }

  private updateGrabbedBody(): void {
    if (!this.grabbedBody) return;
    _grabForward.copy(this.getCameraForward()).setY(0);
    if (_grabForward.lengthSq() < 0.0001) {
      _grabForward.set(0, 0, -1);
    } else {
      _grabForward.normalize();
    }
    _grabTarget
      .set(_currentPos.x, _currentPos.y, _currentPos.z)
      .addScaledVector(_grabForward, this.grabDistance);
    _grabTarget.y += this.grabOffsetY;
    // Use only setNextKinematicTranslation so Rapier computes the correct
    // derived velocity for collision response. Mesh interpolation captures
    // the position after world.step() via postPhysicsUpdate().
    this.grabbedBody.setNextKinematicTranslation(_setRV(_rv3A, _grabTarget.x, _grabTarget.y, _grabTarget.z));
  }

  private updateCarriedObject(): void {
    if (!this.carriedObject) return;
    _carryTarget.set(_currentPos.x, _currentPos.y + this.currentCapsuleHalfHeight + 0.4, _currentPos.z);
    // Use only setNextKinematicTranslation so Rapier computes the correct
    // derived velocity for collision response. Mesh interpolation captures
    // the position after world.step() via postPhysicsUpdate().
    this.carriedObject.body.setNextKinematicTranslation(_setRV(_rv3A, _carryTarget.x, _carryTarget.y, _carryTarget.z));
  }

  private hasMovementInput(input: InputState): boolean {
    return input.moveX !== 0 || input.moveY !== 0;
  }

  setLadderZones(zones: readonly THREE.Box3[]): void {
    this.ladderZones = zones;
  }

  setRespawnPoint(spawn: SpawnPointData): void {
    this.respawnPoint = {
      position: spawn.position.clone(),
      rotation: spawn.rotation?.clone(),
    };
  }

  respawn(): void {
    if (!this.respawnPoint) return;
    this.spawn(this.respawnPoint);
  }

  attachToRope(): void {
    this.ropeAttached = true;
    this.onLadder = false;
    this.setCrouchedState(false);
    // Ensure rope dynamics are not amplified by carry-over fall gravity.
    this.motor.setGravityScale(this.body, 1);
    this.jumpBufferRemaining = 0;
    this.remainingAirJumps = this.config.maxAirJumps;
    if (this.fsm.current !== STATE.air) {
      this.fsm.requestState(STATE.air);
    }
  }

  detachFromRope(): void {
    this.ropeAttached = false;
  }

  getCameraForward(): THREE.Vector3 {
    _forward.set(0, 0, -1).applyAxisAngle(_worldUp, this.cameraYaw);
    return _forward;
  }

  getCameraRight(): THREE.Vector3 {
    _right.set(1, 0, 0).applyAxisAngle(_worldUp, this.cameraYaw);
    return _right;
  }

  computeMovementDirection(input: InputState): THREE.Vector3 {
    const fwd = this.getCameraForward();
    const rgt = this.getCameraRight();
    _desiredMove.set(0, 0, 0);
    _desiredMove.addScaledVector(fwd, input.moveY);
    _desiredMove.addScaledVector(rgt, input.moveX);
    if (_desiredMove.lengthSq() > 1) _desiredMove.normalize();
    return _desiredMove;
  }

  rotateToward(direction: THREE.Vector3, dt: number): void {
    if (direction.lengthSq() < 0.001) return;
    const targetAngle = Math.atan2(direction.x, direction.z);
    const currentAngle = this.mesh.rotation.y;
    const diff = ((targetAngle - currentAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.mesh.rotation.y += diff * (1 - Math.exp(-this.config.turnSpeed * dt));
  }

  get position(): THREE.Vector3 {
    return this.currPosition;
  }

  /** Position at ground contact (bottom of capsule + float offset). */
  private readonly _groundPos = new THREE.Vector3();
  get groundPosition(): THREE.Vector3 {
    const feetOffset = this.currentCapsuleHalfHeight + this.config.capsuleRadius + this.config.floatHeight;
    return this._groundPos.set(this.currPosition.x, this.currPosition.y - feetOffset, this.currPosition.z);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.capsuleMesh.geometry.dispose();
    (this.capsuleMesh.material as THREE.Material).dispose();
    this.characterVisual?.dispose();
    this.physicsWorld.removeBody(this.body);
  }
}
