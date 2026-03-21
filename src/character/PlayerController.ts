import { DEFAULT_PLAYER_CONFIG } from "@core/constants";
import type { EventBus } from "@core/EventBus";
import {
  type Disposable,
  type FixedUpdatable,
  type InputState,
  type PostPhysicsUpdatable,
  type SpawnPointData,
  STATE,
  type Updatable,
} from "@core/types";
import RAPIER from "@dimforge/rapier3d-compat";
import { ColliderFactory } from "@physics/ColliderFactory";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import * as THREE from "three";
import { CharacterFSM } from "./CharacterFSM";
import { CharacterMotor, type GroundInfo } from "./CharacterMotor";
import type { CharacterModel } from "./animation/CharacterModel";
import type { AnimationController } from "./animation/AnimationController";
import { createAnimatedCharacter } from "./animation/CharacterFactory";
import { PLAYER_PROFILE } from "./animation/profiles";
import type { AssetLoader } from "@level/AssetLoader";
import { type CarryableObject, GrabCarryController } from "./GrabCarryController";
import { AirMode } from "./modes/AirMode";
import type { CharacterMode, PlayerContext } from "./modes/CharacterMode";
import { GroundedMode } from "./modes/GroundedMode";
import { LadderMode } from "./modes/LadderMode";
import { RopeMode } from "./modes/RopeMode";

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _desiredMove = new THREE.Vector3();
const _currentPos = new THREE.Vector3();
const _currentVel = new THREE.Vector3();
const _movingObjectVelocity = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _ladderProbePoint = new THREE.Vector3();

/** Default GroundInfo used before the first motor query. */
const NULL_GROUND_INFO: GroundInfo = {
  closeToGround: false,
  movementGrounded: false,
  effectivelyGrounded: false,
  canJump: false,
  isGrounded: false,
  slopeAngle: 0,
  slopeNormal: new THREE.Vector3(0, 1, 0),
  standingSlopeAllowed: true,
  groundBody: null,
  floatingRayHit: null,
  groundedGrace: 0,
  standingForcePoint: new THREE.Vector3(),
};

/**
 * Dynamic rigidbody player controller with floating and impulse movement.
 * Acts as a thin orchestrator — locomotion logic lives in CharacterMode implementations.
 */
export class PlayerController implements FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable {
  public readonly body: RAPIER.RigidBody;
  public readonly collider: RAPIER.Collider;
  public readonly mesh: THREE.Group;
  public readonly fsm: CharacterFSM;
  public readonly motor: CharacterMotor;
  public readonly grabCarry: GrabCarryController;
  public readonly config = DEFAULT_PLAYER_CONFIG;

  public verticalVelocity = 0;
  public isGrounded = false;
  public cameraYaw = 0;

  private prevPosition = new THREE.Vector3();
  private currPosition = new THREE.Vector3();
  private lastInput: InputState | null = null;

  private canJump = false;
  private jumpActive = false;
  public prevVerticalVelocity = 0;
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
  private cachedHorizontalSpeed = 0;
  private interactSuppressFrames = 0;
  private groundInfo: GroundInfo = NULL_GROUND_INFO;

  // -- Mode system --
  private readonly modes: Map<string, CharacterMode>;
  private currentMode: CharacterMode;

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
    return 0.55 * this.crouchVisual;
  }

  /** Check if the current one-shot animation clip has finished playing. */
  isAnimationFinished(): boolean {
    return this.animator?.isClipFinished() ?? false;
  }

  private colliderFactory: ColliderFactory;
  private characterModel: CharacterModel | null = null;
  private animator: AnimationController | null = null;
  private readonly capsuleMesh: THREE.Mesh;

  constructor(
    private physicsWorld: PhysicsWorld,
    private scene: THREE.Scene,
    private eventBus: EventBus,
    private assetLoader: AssetLoader,
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
    this.body.setEnabledRotations(false, false, false, true);
    this.body.setLinearDamping(0);
    this.body.setAngularDamping(0);
    this.body.setGravityScale(1, true);
    this.body.enableCcd(true);

    this.mesh = new THREE.Group();
    this.mesh.name = "PlayerVisual";
    this.scene.add(this.mesh);

    const capsuleGeom = new THREE.CapsuleGeometry(this.config.capsuleRadius, this.config.capsuleHalfHeight * 2, 8, 16);
    const capsuleMat = new THREE.MeshStandardMaterial({ color: 0x3388ff });
    this.capsuleMesh = new THREE.Mesh(capsuleGeom, capsuleMat);
    this.capsuleMesh.name = "PlayerCapsule";
    this.capsuleMesh.castShadow = true;
    this.capsuleMesh.receiveShadow = true;
    this.mesh.add(this.capsuleMesh);

    this.motor = new CharacterMotor();
    this.grabCarry = new GrabCarryController();
    this.fsm = new CharacterFSM(this, this.eventBus);

    // Register all locomotion modes
    const groundedMode = new GroundedMode();
    this.modes = new Map<string, CharacterMode>([
      ["grounded", groundedMode],
      ["air", new AirMode()],
      ["ladder", new LadderMode()],
      ["rope", new RopeMode()],
    ]);
    this.currentMode = groundedMode;

    void this.initCharacter();

    this.eventBus.on('player:dying', () => {
      if (this.animator) {
        this.animator.playOneShot(PLAYER_PROFILE.deathClip ?? 'Death01');
      }
    });

    const pos = this.body.translation();
    this.currPosition.set(pos.x, pos.y, pos.z);
    this.prevPosition.copy(this.currPosition);
  }

  private async initCharacter(): Promise<void> {
    try {
      const { model, animator } = await createAnimatedCharacter(
        PLAYER_PROFILE, this.mesh, this.assetLoader,
      );
      this.characterModel = model;
      this.animator = animator;
      // Wire hand bone for grab/carry positioning
      this.grabCarry.setHandBone(model.handBone);
    } catch (err) {
      console.warn('[PlayerController] Character load failed, using capsule fallback:', err);
    }
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
    const resetMode = this.modes.get("grounded");
    if (resetMode) this.currentMode = resetMode;
    // Reset animation one-shot override (e.g., death) so FSM animations resume
    this.animator?.resetOneShot();
    this.respawnPoint = {
      position: spawn.position.clone(),
      rotation: spawn.rotation?.clone(),
    };
  }

  /** Build a mutable PlayerContext snapshot from controller state. */
  private buildContext(): PlayerContext {
    return {
      body: this.body,
      collider: this.collider,
      mesh: this.mesh,
      config: this.config,
      motor: this.motor,
      grabCarry: this.grabCarry,
      fsm: this.fsm,
      eventBus: this.eventBus,
      physicsWorld: this.physicsWorld,

      cameraYaw: this.cameraYaw,
      verticalVelocity: this.verticalVelocity,
      prevVerticalVelocity: this.prevVerticalVelocity,
      jumpActive: this.jumpActive,
      jumpBufferRemaining: this.jumpBufferRemaining,
      remainingAirJumps: this.remainingAirJumps,
      isCrouched: this.isCrouched,
      isGrounded: this.isGrounded,
      canJump: this.canJump,
      groundInfo: this.groundInfo,
      isOnMovingObject: this.isOnMovingObject,
      currentGroundBody: this.currentGroundBody,

      currentCapsuleHalfHeight: this.currentCapsuleHalfHeight,
      standingCapsuleHalfHeight: this.standingCapsuleHalfHeight,
      crouchedCapsuleHalfHeight: this.crouchedCapsuleHalfHeight,
      floatingDistance: this.floatingDistance,
      actualSlopeAngle: this.actualSlopeAngle,

      crouchReleaseGraceRemaining: this.crouchReleaseGraceRemaining,
      crouchReleaseGraceSeconds: this.crouchReleaseGraceSeconds,
      crouchVisual: this.crouchVisual,

      currentPos: _currentPos,
      currentVel: _currentVel,
      currPosition: this.currPosition,
      prevPosition: this.prevPosition,
      groundPosition: this.groundPosition,

      movingObjectVelocity: _movingObjectVelocity,

      onLadder: this.onLadder,
      ladderZones: this.ladderZones,
      ropeAttached: this.ropeAttached,

      computeMovementDirection: (input: InputState) => this.computeMovementDirection(input),
      lastInput: this.lastInput,
    };
  }

  /** Sync mutable context fields back into the controller after a mode tick. */
  private syncFromContext(ctx: PlayerContext): void {
    this.cameraYaw = ctx.cameraYaw;
    this.verticalVelocity = ctx.verticalVelocity;
    this.prevVerticalVelocity = ctx.prevVerticalVelocity;
    this.jumpActive = ctx.jumpActive;
    this.jumpBufferRemaining = ctx.jumpBufferRemaining;
    this.remainingAirJumps = ctx.remainingAirJumps;
    this.isCrouched = ctx.isCrouched;
    this.isGrounded = ctx.isGrounded;
    this.canJump = ctx.canJump;
    this.groundInfo = ctx.groundInfo;
    this.isOnMovingObject = ctx.isOnMovingObject;
    this.currentGroundBody = ctx.currentGroundBody;
    this.currentCapsuleHalfHeight = ctx.currentCapsuleHalfHeight;
    this.floatingDistance = ctx.floatingDistance;
    this.actualSlopeAngle = ctx.actualSlopeAngle;
    this.crouchReleaseGraceRemaining = ctx.crouchReleaseGraceRemaining;
    this.crouchVisual = ctx.crouchVisual;
    this.onLadder = ctx.onLadder;
    this.ropeAttached = ctx.ropeAttached;
  }

  /** Neutral input state used when no real input is available (pre-pointer-lock). */
  private static readonly NEUTRAL_INPUT: InputState = {
    forward: false, backward: false, left: false, right: false,
    crouch: false, crouchPressed: false, jump: false, jumpPressed: false,
    interact: false, interactPressed: false, primary: false, primaryPressed: false,
    altitudeUp: false, altitudeDown: false, moveX: 0, moveY: 0,
    sprint: false, mouseDeltaX: 0, mouseDeltaY: 0, mouseWheelDelta: 0,
  };

  fixedUpdate(dt: number): void {
    if (!this.active) return;
    // Use neutral input if no real input available yet (before pointer lock).
    // This ensures gravity and physics still apply so the player lands on the ground.
    let input = this.lastInput ?? PlayerController.NEUTRAL_INPUT;

    // -- Interact suppression (vehicle exit) --
    if (this.interactSuppressFrames > 0) {
      this.interactSuppressFrames--;
      if (input.interactPressed) {
        input = { ...input, interactPressed: false };
      }
    }

    // -- Grab/carry input consumption --
    let consumeInteractPressed = false;
    let consumeJumpPressed = false;

    this.prevPosition.copy(this.currPosition);

    if (this.grabCarry.isGrabbing && (input.jumpPressed || input.interactPressed)) {
      consumeInteractPressed = input.interactPressed;
      consumeJumpPressed = input.jumpPressed;
      this.fsm.requestState(STATE.idle);
    }

    if (this.grabCarry.isCarrying) {
      if (input.primaryPressed || input.interactPressed) {
        this.grabCarry.throwCarried(this.getCameraForward(), this.eventBus);
        this.animator?.playOneShot(PLAYER_PROFILE.throwClip ?? 'OverhandThrow', 0.1);
        this.fsm.requestState(this.hasMovementInput(input) ? STATE.move : STATE.idle);
      } else if (input.crouchPressed) {
        this.grabCarry.dropCarried(
          this.currPosition,
          this.currentCapsuleHalfHeight,
          this.getCameraForward(),
          this.eventBus,
        );
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

    // -- Jump buffer --
    if (inputForFsm.jumpPressed) {
      this.jumpBufferRemaining = this.config.jumpBufferTime;
    } else {
      this.jumpBufferRemaining = Math.max(0, this.jumpBufferRemaining - dt);
    }

    // -- Sync physics state --
    const pos = this.body.translation();
    const vel = this.body.linvel();
    _currentPos.set(pos.x, pos.y, pos.z);
    _currentVel.set(vel.x, vel.y, vel.z);
    this.prevVerticalVelocity = this.verticalVelocity;
    this.verticalVelocity = _currentVel.y;
    this.cachedHorizontalSpeed = Math.hypot(_currentVel.x, _currentVel.z);

    // -- Determine target mode --
    const targetModeId = this.determineTargetMode(inputForFsm);

    // -- Switch mode if needed --
    if (targetModeId !== this.currentMode.id) {
      this.switchMode(targetModeId);
    }

    // -- FSM update (skip for ladder — LadderMode handles its own FSM) --
    if (this.currentMode.id !== "ladder") {
      this.fsm.handleInput(inputForFsm, this.isGrounded);
      this.fsm.update(dt);
    }

    // -- Rotation (skip for rope/ladder — no player-driven movement) --
    if (this.currentMode.id !== "rope" && this.currentMode.id !== "ladder") {
      const desiredInputDir = this.computeMovementDirection(inputForFsm);
      if (desiredInputDir.lengthSq() > 0.0001) {
        this.rotateToward(desiredInputDir, dt);
      }
    }

    // -- Delegate to current mode --
    const ctx = this.buildContext();
    const nextModeId = this.currentMode.fixedUpdate(ctx, inputForFsm, dt);
    this.syncFromContext(ctx);

    if (nextModeId !== null && nextModeId !== this.currentMode.id) {
      this.switchMode(nextModeId);
    }

    // -- Grab/carry updates (mode-independent) --
    if (this.grabCarry.isGrabbing) {
      this.grabCarry.updateGrab(_currentPos, this.getCameraForward());
    }
    if (this.grabCarry.isCarrying) {
      this.grabCarry.updateCarry(_currentPos, this.currentCapsuleHalfHeight);
    }
  }

  /**
   * Determine which mode should be active based on current state.
   * Priority: rope > ladder > grounded > air.
   */
  private determineTargetMode(input: InputState): string {
    if (this.ropeAttached) return "rope";

    const movementLocked = this.fsm.current === STATE.interact;
    const inLadderZone = this.isInsideLadder(_currentPos);
    // Only allow jump to trigger ladder grab while airborne — grounded jumps
    // should fire normally even inside a ladder zone.
    const wantsLadder =
      !movementLocked && (input.forward || input.backward || (input.jumpPressed && !this.isGrounded) || this.onLadder);
    if (inLadderZone && wantsLadder) return "ladder";

    // When leaving ladder zone, restore gravity
    if (this.currentMode.id === "ladder" && !inLadderZone) {
      return "grounded";
    }

    // If currently in grounded or air mode, let the mode itself decide transitions
    // via its fixedUpdate return value.
    return this.currentMode.id === "ladder" ? "grounded" : this.currentMode.id;
  }

  private switchMode(modeId: string): void {
    const mode = this.modes.get(modeId);
    if (!mode) return;
    const ctx = this.buildContext();
    this.currentMode.exit?.(ctx);
    this.syncFromContext(ctx);
    this.currentMode = mode;
    const enterCtx = this.buildContext();
    this.currentMode.enter?.(enterCtx);
    this.syncFromContext(enterCtx);
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

  postPhysicsUpdate(_dt: number): void {
    if (!this.active) return;
    const pos = this.body.translation();
    this.currPosition.set(pos.x, pos.y, pos.z);
  }

  update(_dt: number, alpha: number): void {
    if (!this.active) return;
    this.mesh.position.lerpVectors(this.prevPosition, this.currPosition, alpha);
    const target = this.isCrouched ? 1 : 0;
    this.crouchVisual += (target - this.crouchVisual) * (1 - Math.exp(-12 * _dt));
    const scaleY = 1 - this.crouchVisual * 0.28;
    const scaleXZ = 1 + this.crouchVisual * 0.04;
    this.mesh.scale.set(scaleXZ, scaleY, scaleXZ);
    this.animator?.setSpeed(this.cachedHorizontalSpeed);
    this.animator?.setState(this.fsm.current);
    this.animator?.update(_dt);
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
    this.grabCarry.startGrab(body, this.currPosition, offset);
    if (this.grabCarry.isGrabbing) {
      this.fsm.requestState(STATE.grab);
    }
  }

  endGrab(): void {
    this.grabCarry.endGrab(this.getCameraForward(), this.eventBus);
  }

  startCarry(object: CarryableObject): void {
    this.grabCarry.startCarry(object);
    if (this.grabCarry.isCarrying) {
      this.fsm.requestState(STATE.carry);
    }
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
    this.switchMode("rope");
  }

  detachFromRope(): void {
    this.ropeAttached = false;
    // RopeMode.fixedUpdate will detect ropeAttached=false and return 'air'
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
    this.animator?.dispose();
    this.characterModel?.dispose();
    this.physicsWorld.removeBody(this.body);
  }
}
