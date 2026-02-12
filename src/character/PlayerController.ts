import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type {
  InputState,
  FixedUpdatable,
  PostPhysicsUpdatable,
  Updatable,
  Disposable,
  SpawnPointData,
} from '@core/types';
import { DEFAULT_PLAYER_CONFIG } from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { ColliderFactory } from '@physics/ColliderFactory';
import { CharacterFSM } from './CharacterFSM';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _desiredMove = new THREE.Vector3();
const _currentPos = new THREE.Vector3();
const _currentVel = new THREE.Vector3();
const _movingDirection = new THREE.Vector3();
const _movingObjectVelocityInCharacterDir = new THREE.Vector3();
const _wantToMoveVel = new THREE.Vector3();
const _rejectVel = new THREE.Vector3();
const _moveAccNeeded = new THREE.Vector3();
const _moveForceNeeded = new THREE.Vector3();
const _moveImpulse = new THREE.Vector3();
const _dragForce = new THREE.Vector3();
const _jumpVelocityVec = new THREE.Vector3();
const _jumpDirection = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _slopeRayOrigin = new THREE.Vector3();
const _slopeForward = new THREE.Vector3();
const _actualSlopeNormal = new THREE.Vector3(0, 1, 0);
const _standingForcePoint = new THREE.Vector3();
const _distanceFromCharacterToObject = new THREE.Vector3();
const _objectAngvelToLinvel = new THREE.Vector3();
const _velocityDiff = new THREE.Vector3();
const _movingObjectVelocity = new THREE.Vector3();
const _targetRotationDirection = new THREE.Vector3();
const _stepForward = new THREE.Vector3();
const _stepProbeLowOrigin = new THREE.Vector3();
const _stepProbeHighOrigin = new THREE.Vector3();
const _stepGroundProbeOrigin = new THREE.Vector3();
const _ladderProbePoint = new THREE.Vector3();
const _standProbeOrigin = new THREE.Vector3();
const _standProbeDir = new THREE.Vector3();
const _standProbeRight = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

const _rapierDown = new RAPIER.Vector3(0, -1, 0);
const _rapierUp = new RAPIER.Vector3(0, 1, 0);

/**
 * Dynamic rigidbody player controller with floating and impulse movement.
 */
export class PlayerController implements FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable {
  public readonly body: RAPIER.RigidBody;
  public readonly collider: RAPIER.Collider;
  public readonly mesh: THREE.Mesh;
  public readonly fsm: CharacterFSM;
  public readonly config = DEFAULT_PLAYER_CONFIG;

  public verticalVelocity = 0;
  public isGrounded = false;
  public cameraYaw = 0;

  private prevPosition = new THREE.Vector3();
  private currPosition = new THREE.Vector3();
  private lastInput: InputState | null = null;

  private canJump = false;
  private jumpBufferRemaining = 0;
  private remainingAirJumps = this.config.maxAirJumps;
  private isOnMovingObject = false;
  private floatingDistance = this.config.capsuleRadius + this.config.floatHeight;
  private standingCapsuleHalfHeight = this.config.capsuleHalfHeight;
  private crouchedCapsuleHalfHeight = Math.max(0.16, this.config.capsuleHalfHeight - this.config.crouchHeightOffset);
  private currentCapsuleHalfHeight = this.config.capsuleHalfHeight;
  private slopeAngle = 0;
  private actualSlopeAngle = 0;
  private currentGravityScale = 1;
  private groundedGrace = 0;
  private currentGroundBody: RAPIER.RigidBody | null = null;
  private currentGroundBodyType: number | null = null;
  private ladderZones: readonly THREE.Box3[] = [];
  private onLadder = false;
  private ropeAttached = false;
  private isCrouched = false;
  private crouchReleaseGraceSeconds = 0.18;
  private crouchReleaseGraceRemaining = 0;
  private crouchVisual = 0;
  private respawnPoint: SpawnPointData | null = null;

  get lastInputSnapshot(): InputState | null {
    return this.lastInput;
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

    const capsuleGeom = new THREE.CapsuleGeometry(
      this.config.capsuleRadius,
      this.config.capsuleHalfHeight * 2,
      8,
      16,
    );
    const capsuleMat = new THREE.MeshStandardMaterial({ color: 0x3388ff });
    this.mesh = new THREE.Mesh(capsuleGeom, capsuleMat);
    this.mesh.name = 'PlayerMesh';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);

    this.fsm = new CharacterFSM(this, this.eventBus);

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
    this.isGrounded = false;
    this.canJump = false;
    this.slopeAngle = 0;
    this.actualSlopeAngle = 0;
    _movingObjectVelocity.set(0, 0, 0);
    this.currentGroundBody = null;
    this.currentGroundBodyType = null;
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
    const input = this.lastInput;
    if (!input) return;

    this.prevPosition.copy(this.currPosition);
    if (input.jumpPressed) {
      this.jumpBufferRemaining = this.config.jumpBufferTime;
    } else {
      this.jumpBufferRemaining = Math.max(0, this.jumpBufferRemaining - dt);
    }

    const pos = this.body.translation();
    const vel = this.body.linvel();
    _currentPos.set(pos.x, pos.y, pos.z);
    _currentVel.set(vel.x, vel.y, vel.z);
    this.verticalVelocity = _currentVel.y;

    if (this.ropeAttached) {
      this.jumpBufferRemaining = 0;
      this.onLadder = false;
      this.setCrouchedState(false);
      this.floatingDistance = this.config.capsuleRadius + this.config.floatHeight;
      this.remainingAirJumps = this.config.maxAirJumps;
      const wasGrounded = this.isGrounded;
      this.isGrounded = false;
      this.canJump = false;
      this.groundedGrace = 0;
      if (wasGrounded) {
        this.eventBus.emit('player:grounded', false);
      }
      if (this.fsm.current !== 'air') {
        this.fsm.requestState('air');
      }
      return;
    }

    this.updateCrouchState(input.crouch, _currentPos, dt);
    this.floatingDistance = this.getTargetFloatingDistance();

    const movementLocked = this.fsm.current === 'interact';
    const inLadderZone = this.isInsideLadder(_currentPos);
    const wantsLadder = !movementLocked && (input.forward || input.backward || input.jumpPressed || this.onLadder);
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
    if (this.currentGravityScale === 0) {
      this.setGravityScale(1);
    }

    this.fsm.handleInput(input, this.isGrounded);
    this.fsm.update(dt);
    if (this.ropeAttached) {
      if (this.fsm.current !== 'air') {
        this.fsm.requestState('air');
      }
      return;
    }

    const desiredInputDir = this.computeMovementDirection(input);
    if (desiredInputDir.lengthSq() > 0.0001) {
      this.rotateToward(desiredInputDir, dt);
    }

    _rayOrigin.set(
      _currentPos.x,
      _currentPos.y - this.currentCapsuleHalfHeight,
      _currentPos.z,
    );

    const rayOrigin = new RAPIER.Vector3(_rayOrigin.x, _rayOrigin.y, _rayOrigin.z);
    const floatingRayHit = this.physicsWorld.castRay(
      rayOrigin,
      _rapierDown,
      this.config.floatingRayLength,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );

    _slopeForward.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    _slopeRayOrigin.copy(_rayOrigin).addScaledVector(_slopeForward, this.config.slopeRayOriginOffset);
    const slopeRayOrigin = new RAPIER.Vector3(_slopeRayOrigin.x, _slopeRayOrigin.y, _slopeRayOrigin.z);
    const slopeRayHit = this.physicsWorld.castRay(
      slopeRayOrigin,
      _rapierDown,
      this.config.slopeRayLength,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );

    this.actualSlopeAngle = 0;
    _actualSlopeNormal.set(0, 1, 0);
    if (slopeRayHit) {
      const n = this.physicsWorld.castRayAndGetNormal(
        slopeRayOrigin,
        _rapierDown,
        this.config.slopeRayLength,
        undefined,
        this.body,
      );
      if (n) {
        _actualSlopeNormal.set(n.normal.x, n.normal.y, n.normal.z).normalize();
        this.actualSlopeAngle = _actualSlopeNormal.angleTo(new THREE.Vector3(0, 1, 0));
      }
    }

    const closeToGround =
      floatingRayHit !== null &&
      floatingRayHit.timeOfImpact < this.floatingDistance + this.config.floatingRayHitForgiveness;
    const slopeAllowed = !slopeRayHit || this.actualSlopeAngle < this.config.slopeMaxAngle;
    if (closeToGround && slopeAllowed) {
      this.groundedGrace = this.config.coyoteTime;
    } else {
      this.groundedGrace = Math.max(0, this.groundedGrace - dt);
    }
    this.canJump = (closeToGround && slopeAllowed) || this.groundedGrace > 0;

    const wasGrounded = this.isGrounded;
    this.isGrounded = this.canJump;
    if (this.isGrounded) {
      this.remainingAirJumps = this.config.maxAirJumps;
    }
    if (this.isGrounded !== wasGrounded) {
      this.eventBus.emit('player:grounded', this.isGrounded);
    }

    this.slopeAngle = 0;
    if (
      slopeRayHit &&
      floatingRayHit &&
      slopeRayHit.timeOfImpact < this.floatingDistance + 0.5 &&
      this.canJump
    ) {
      this.slopeAngle = Number(
        Math.atan(
          (floatingRayHit.timeOfImpact - slopeRayHit.timeOfImpact) / this.config.slopeRayOriginOffset,
        ).toFixed(2),
      );
    }

    this.currentGroundBody = null;
    this.currentGroundBodyType = null;
    this.isOnMovingObject = false;
    _movingObjectVelocity.set(0, 0, 0);
    if (floatingRayHit?.collider.parent() && this.canJump) {
      const groundBody = floatingRayHit.collider.parent()!;
      const groundBodyType = groundBody.bodyType();
      this.currentGroundBody = groundBody;
      this.currentGroundBodyType = groundBodyType;
      _standingForcePoint.set(
        _rayOrigin.x,
        _rayOrigin.y - floatingRayHit.timeOfImpact,
        _rayOrigin.z,
      );

      if (groundBodyType === 0 || groundBodyType === 2) {
        this.isOnMovingObject = true;
        _distanceFromCharacterToObject
          .copy(_currentPos)
          .sub(new THREE.Vector3(
            groundBody.translation().x,
            groundBody.translation().y,
            groundBody.translation().z,
          ));
        const lv = groundBody.linvel();
        const av = groundBody.angvel();
        _objectAngvelToLinvel.crossVectors(
          new THREE.Vector3(av.x, av.y, av.z),
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

    const movementLockedNow = this.fsm.current === 'interact';
    const hasMovement = !movementLockedNow && (input.forward || input.backward || input.left || input.right);
    const run = input.sprint && !this.isCrouched;
    if (hasMovement) {
      this.applyMoveImpulse(run);
      this.applyStepAssist(desiredInputDir, run);
    }

    if (!movementLockedNow && this.jumpBufferRemaining > 0) {
      if (this.canJump) {
        this.fsm.requestState('jump');
        this.applyJumpImpulse(run, false);
        this.jumpBufferRemaining = 0;
        this.groundedGrace = 0;
        this.canJump = false;
      } else if (this.remainingAirJumps > 0) {
        this.fsm.requestState('jump');
        this.applyJumpImpulse(false, true);
        this.jumpBufferRemaining = 0;
        this.remainingAirJumps -= 1;
        this.groundedGrace = 0;
        this.canJump = false;
      }
    }

    if (floatingRayHit && this.canJump) {
      const floatingForce =
        this.config.floatingSpringK * (this.floatingDistance - floatingRayHit.timeOfImpact) -
        _currentVel.y * this.config.floatingDampingC;
      this.body.applyImpulse(new RAPIER.Vector3(0, floatingForce, 0), false);

      const standingBody = floatingRayHit.collider.parent();
      if (standingBody && floatingForce > 0 && this.shouldApplyGroundReaction(standingBody)) {
        standingBody.applyImpulseAtPoint(
          new RAPIER.Vector3(0, -floatingForce, 0),
          new RAPIER.Vector3(_standingForcePoint.x, _standingForcePoint.y, _standingForcePoint.z),
          true,
        );
      }
    }

    if (!hasMovement && this.canJump) {
      if (!this.isOnMovingObject) {
        _dragForce.set(
          -_currentVel.x * this.config.dragDamping,
          0,
          -_currentVel.z * this.config.dragDamping,
        );
      } else {
        _dragForce.set(
          (_movingObjectVelocity.x - _currentVel.x) * this.config.dragDamping,
          0,
          (_movingObjectVelocity.z - _currentVel.z) * this.config.dragDamping,
        );
      }
      this.body.applyImpulse(new RAPIER.Vector3(_dragForce.x, _dragForce.y, _dragForce.z), true);
    }

    if (_currentVel.y < -this.config.fallingMaxVelocity) {
      this.setGravityScale(0);
    } else {
      const falling = _currentVel.y < 0 && !this.canJump;
      this.setGravityScale(falling ? this.config.fallingGravityScale : 1);
    }

  }

  postPhysicsUpdate(_dt: number): void {
    const pos = this.body.translation();
    this.currPosition.set(pos.x, pos.y, pos.z);
  }

  private applyMoveImpulse(run: boolean): void {
    if (
      this.actualSlopeAngle < this.config.slopeMaxAngle &&
      Math.abs(this.slopeAngle) > 0.2 &&
      Math.abs(this.slopeAngle) < this.config.slopeMaxAngle
    ) {
      _movingDirection.set(0, Math.sin(this.slopeAngle), Math.cos(this.slopeAngle));
    } else if (this.actualSlopeAngle >= this.config.slopeMaxAngle) {
      const sy = Math.sin(this.slopeAngle);
      _movingDirection.set(0, sy > 0 ? 0 : sy, sy > 0 ? 0.1 : 1);
    } else {
      _movingDirection.set(0, 0, 1);
    }
    _movingDirection.applyQuaternion(this.mesh.quaternion).normalize();

    _movingObjectVelocityInCharacterDir.copy(_movingObjectVelocity).projectOnVector(_movingDirection);
    const angleBetween =
      _movingObjectVelocity.lengthSq() > 0.0001 ? _movingObjectVelocity.angleTo(_movingDirection) : 0;

    const wantToMoveMag = _currentVel.dot(_movingDirection);
    _wantToMoveVel.set(_movingDirection.x * wantToMoveMag, 0, _movingDirection.z * wantToMoveMag);
    _rejectVel.copy(_currentVel).sub(_wantToMoveVel);

    const crouchMult = this.isCrouched ? this.config.crouchSpeedMultiplier : 1;
    const targetSpeed = this.config.moveSpeed * crouchMult * (run ? this.config.sprintMultiplier : 1);
    _moveAccNeeded.set(
      (_movingDirection.x * (targetSpeed + _movingObjectVelocityInCharacterDir.x) -
        (_currentVel.x -
          _movingObjectVelocity.x * Math.sin(angleBetween) +
          _rejectVel.x * (this.isOnMovingObject ? 0 : this.config.rejectVelocityMultiplier))) /
        this.config.acceleration,
      0,
      (_movingDirection.z * (targetSpeed + _movingObjectVelocityInCharacterDir.z) -
        (_currentVel.z -
          _movingObjectVelocity.z * Math.sin(angleBetween) +
          _rejectVel.z * (this.isOnMovingObject ? 0 : this.config.rejectVelocityMultiplier))) /
        this.config.acceleration,
    );
    _moveForceNeeded.copy(_moveAccNeeded).multiplyScalar(this.body.mass());

    _targetRotationDirection.copy(this.computeMovementDirection(this.lastInput!));
    const targetAngle = Math.atan2(_targetRotationDirection.x, _targetRotationDirection.z);
    const currentAngle = this.mesh.rotation.y;
    const angleDiff = ((targetAngle - currentAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const characterRotated = Math.abs(angleDiff) < 0.2;
    const turnMult = characterRotated ? 1 : this.config.turnVelocityMultiplier;
    const airControlMult = this.canJump ? 1 : this.config.airDragMultiplier;

    _moveImpulse.set(
      _moveForceNeeded.x * turnMult * airControlMult,
      this.slopeAngle === 0
        ? 0
        : _movingDirection.y *
            turnMult *
            (_movingDirection.y > 0 ? this.config.slopeUpExtraForce : this.config.slopeDownExtraForce) *
            (run ? this.config.sprintMultiplier : 1),
      _moveForceNeeded.z * turnMult * airControlMult,
    );

    this.body.applyImpulseAtPoint(
      new RAPIER.Vector3(_moveImpulse.x, _moveImpulse.y, _moveImpulse.z),
      new RAPIER.Vector3(_currentPos.x, _currentPos.y + this.config.moveImpulsePointY, _currentPos.z),
      true,
    );

    if (
      this.currentGroundBody &&
      this.currentGroundBodyType === 0 &&
      this.shouldApplyGroundReaction(this.currentGroundBody)
    ) {
      const groundMass = Math.max(this.currentGroundBody.mass(), 0.001);
      const massRatio = this.body.mass() / groundMass;
      const groundImpulse = _moveImpulse.clone().multiplyScalar(Math.min(1, 1 / massRatio)).negate();
      this.currentGroundBody.applyImpulseAtPoint(
        new RAPIER.Vector3(groundImpulse.x, 0, groundImpulse.z),
        new RAPIER.Vector3(_standingForcePoint.x, _standingForcePoint.y, _standingForcePoint.z),
        true,
      );
    }
  }

  private applyJumpImpulse(run: boolean, airJump: boolean): void {
    const jumpVel =
      (run ? this.config.sprintJumpMultiplier : 1) *
      this.config.jumpForce *
      (airJump ? this.config.airJumpForceMultiplier : 1);
    _jumpVelocityVec.set(_currentVel.x, jumpVel, _currentVel.z);
    _jumpDirection
      .set(0, jumpVel * this.config.slopeJumpMultiplier, 0)
      .projectOnVector(_actualSlopeNormal)
      .add(_jumpVelocityVec);

    this.body.setLinvel(
      new RAPIER.Vector3(_jumpDirection.x, _jumpDirection.y, _jumpDirection.z),
      true,
    );

    if (this.currentGroundBody && this.shouldApplyGroundReaction(this.currentGroundBody)) {
      const down = -jumpVel * this.config.jumpForceToGroundMultiplier * 0.5;
      this.currentGroundBody.applyImpulseAtPoint(
        new RAPIER.Vector3(0, down, 0),
        new RAPIER.Vector3(_standingForcePoint.x, _standingForcePoint.y, _standingForcePoint.z),
        true,
      );
    }
  }

  private applyStepAssist(desiredInputDir: THREE.Vector3, run: boolean): void {
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
      new RAPIER.Vector3(_stepProbeLowOrigin.x, _stepProbeLowOrigin.y, _stepProbeLowOrigin.z),
      new RAPIER.Vector3(_stepForward.x, _stepForward.y, _stepForward.z),
      probeDist,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );
    if (!lowHit || lowHit.timeOfImpact > probeDist) return;

    const highHit = this.physicsWorld.castRay(
      new RAPIER.Vector3(_stepProbeHighOrigin.x, _stepProbeHighOrigin.y, _stepProbeHighOrigin.z),
      new RAPIER.Vector3(_stepForward.x, _stepForward.y, _stepForward.z),
      probeDist,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );
    if (highHit) return;

    const lv = this.body.linvel();
    const upBoost = run ? 3.4 : 3.0;
    const fwdBoost = run ? 1.35 : 1.2;
    if (lv.y < upBoost) {
      this.body.setLinvel(
        new RAPIER.Vector3(
          lv.x + _stepForward.x * fwdBoost,
          Math.max(lv.y, upBoost),
          lv.z + _stepForward.z * fwdBoost,
        ),
        true,
      );
      const p = this.body.translation();
      const stepUp = run ? 0.12 : 0.1;
      this.body.setTranslation(
        new RAPIER.Vector3(
          p.x + _stepForward.x * 0.05,
          p.y + stepUp,
          p.z + _stepForward.z * 0.05,
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
      new RAPIER.Vector3(
        _stepGroundProbeOrigin.x,
        _stepGroundProbeOrigin.y,
        _stepGroundProbeOrigin.z,
      ),
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
        const p = this.body.translation();
        this.body.setTranslation(
          new RAPIER.Vector3(
            p.x + _stepForward.x * 0.06,
            p.y + Math.min(stepHeight + 0.02, maxStepHeight),
            p.z + _stepForward.z * 0.06,
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
    this.setGravityScale(0);
    this.body.setLinvel(
      new RAPIER.Vector3(
        lv.x * 0.2,
        climbDir * climbSpeed,
        lv.z * 0.2,
      ),
      true,
    );

    if (input.jumpPressed) {
      this.onLadder = false;
      this.setGravityScale(1);
      this.jumpBufferRemaining = 0;
      this.remainingAirJumps = this.config.maxAirJumps;
      this.body.setLinvel(
        new RAPIER.Vector3(lv.x * 0.6, Math.max(this.config.jumpForce * 0.9, 3.2), lv.z * 0.6),
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
    this.body.setTranslation(new RAPIER.Vector3(pos.x, pos.y - deltaHalf, pos.z), true);
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
      new RAPIER.Vector3(_standProbeOrigin.x, _standProbeOrigin.y, _standProbeOrigin.z),
      _rapierUp,
      probeLength,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );
    return hit != null;
  }

  private shouldApplyGroundReaction(body: RAPIER.RigidBody | null): boolean {
    if (!body) return false;
    const data = body.userData;
    if (typeof data !== 'object' || data === null) return true;
    const kind = (data as { kind?: unknown }).kind;
    return kind !== 'floating-platform';
  }

  private setGravityScale(scale: number): void {
    if (Math.abs(this.currentGravityScale - scale) < 0.0001) return;
    this.currentGravityScale = scale;
    this.body.setGravityScale(scale, true);
  }

  update(_dt: number, alpha: number): void {
    this.mesh.position.lerpVectors(this.prevPosition, this.currPosition, alpha);
    const target = this.isCrouched ? 1 : 0;
    this.crouchVisual += (target - this.crouchVisual) * 0.25;
    const scaleY = 1 - this.crouchVisual * 0.28;
    const scaleXZ = 1 + this.crouchVisual * 0.04;
    this.mesh.scale.set(scaleXZ, scaleY, scaleXZ);
  }

  setInput(input: InputState): void {
    this.lastInput = input;
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
    this.setGravityScale(1);
    this.jumpBufferRemaining = 0;
    this.remainingAirJumps = this.config.maxAirJumps;
    if (this.fsm.current !== 'air') {
      this.fsm.requestState('air');
    }
  }

  detachFromRope(): void {
    this.ropeAttached = false;
  }

  getCameraForward(): THREE.Vector3 {
    _forward.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraYaw);
    return _forward;
  }

  getCameraRight(): THREE.Vector3 {
    _right.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraYaw);
    return _right;
  }

  computeMovementDirection(input: InputState): THREE.Vector3 {
    _desiredMove.set(0, 0, 0);

    const fwd = this.getCameraForward();
    const rgt = this.getCameraRight();

    if (input.forward) _desiredMove.add(fwd);
    if (input.backward) _desiredMove.sub(fwd);
    if (input.right) _desiredMove.add(rgt);
    if (input.left) _desiredMove.sub(rgt);

    if (_desiredMove.lengthSq() > 0) {
      _desiredMove.normalize();
    }

    return _desiredMove;
  }

  rotateToward(direction: THREE.Vector3, dt: number): void {
    if (direction.lengthSq() < 0.001) return;
    const targetAngle = Math.atan2(direction.x, direction.z);
    const currentAngle = this.mesh.rotation.y;
    const diff = ((targetAngle - currentAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.mesh.rotation.y += diff * Math.min(1, this.config.turnSpeed * dt);
  }

  get position(): THREE.Vector3 {
    return this.currPosition;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.physicsWorld.removeBody(this.body);
  }
}
