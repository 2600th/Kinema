import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { InputState, SpawnPointData } from '@core/types';
import { DEFAULT_PLAYER_CONFIG } from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { toRapierQuat } from '@physics/PhysicsHelpers';
import { COLLISION_GROUP_VEHICLE, VEHICLE_DOMINANCE_GROUP } from '@core/constants';
import type { VehicleController } from './VehicleController';

const _quat = new THREE.Quaternion();
const _targetQuat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _yawEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _worldUp = new THREE.Vector3(0, 1, 0);
const _chassisUp = new THREE.Vector3(0, 1, 0);
const _uprightAxis = new THREE.Vector3();
const _rv3A = new RAPIER.Vector3(0, 0, 0);
const _rv3B = new RAPIER.Vector3(0, 0, 0);
const _rqIdentity = new RAPIER.Quaternion(0, 0, 0, 1);
const _playerExitShape = new RAPIER.Capsule(
  DEFAULT_PLAYER_CONFIG.capsuleHalfHeight,
  DEFAULT_PLAYER_CONFIG.capsuleRadius,
);
const _exitCandidates = [
  new THREE.Vector3(-1.5, 0, 0),
  new THREE.Vector3(1.5, 0, 0),
  new THREE.Vector3(0, 0, 2.5),
] as const;

function _setCRV(v: RAPIER.Vector3, x: number, y: number, z: number): RAPIER.Vector3 {
  v.x = x; v.y = y; v.z = z;
  return v;
}

function getRigidBodyKind(body: RAPIER.RigidBody | null): string | null {
  if (!body) return null;
  const data = body.userData;
  if (typeof data !== 'object' || data === null) return null;
  const kind = (data as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : null;
}

type CarTuning = {
  readonly chassisHalfExtents: THREE.Vector3;
  readonly additionalMass: number;
  readonly centerOfMass: RAPIER.Vector3;
  readonly principalAngularInertia: RAPIER.Vector3;
  readonly additionalSolverIterations: number;
  readonly wheelRadius: number;
  readonly suspensionRestLength: number;
  readonly suspensionMaxTravel: number;
  readonly nominalSuspensionCompression: number;
  readonly nominalChassisClearance: number;
  readonly selfRightingTiltDot: number;
  readonly selfRightingSnapTiltDot: number;
  readonly suspensionStiffness: number;
  readonly suspensionCompression: number;
  readonly suspensionRelaxation: number;
  readonly maxSuspensionForce: number;
  readonly forwardEngineFront: number;
  readonly forwardEngineRear: number;
  readonly boostEngineFront: number;
  readonly boostEngineRear: number;
  readonly reverseEngineFront: number;
  readonly reverseEngineRear: number;
  readonly coastBrake: number;
  readonly serviceBrake: number;
  readonly handbrakeFrontBrake: number;
  readonly handbrakeRearBrake: number;
  readonly frontFrictionSlip: number;
  readonly rearFrictionSlip: number;
  readonly handbrakeRearFrictionSlip: number;
  readonly frontSideFriction: number;
  readonly rearSideFriction: number;
  readonly handbrakeRearSideFriction: number;
  readonly maxSteerAngle: number;
  readonly highSpeedSteerScale: number;
  readonly steerSpeed: number;
  readonly jumpVelocity: number;
  readonly jumpCooldownSeconds: number;
  readonly jumpCoyoteSeconds: number;
  readonly landingRecoverySeconds: number;
  readonly airSteerMultiplier: number;
  readonly airEngineMultiplier: number;
  readonly driveLinearDamping: number;
  readonly driveAngularDamping: number;
  readonly landingLinearDamping: number;
  readonly landingAngularDamping: number;
  readonly uprightAssistGrounded: number;
  readonly uprightAssistAir: number;
  readonly wheelVisualDropMax: number;
  readonly cabinRollScale: number;
  readonly cabinPitchScale: number;
  readonly maxForwardSpeed: number;
  readonly maxBoostSpeed: number;
};

export type CarRideGeometry = {
  readonly wheelRadius: number;
  readonly suspensionRestLength: number;
  readonly suspensionMaxTravel: number;
  readonly nominalSuspensionCompression: number;
  readonly nominalSuspensionLength: number;
  readonly wheelHardPointY: number;
  readonly wheelCenterYAtRest: number;
  readonly nominalGroundPlaneY: number;
  readonly nominalChassisClearance: number;
  readonly chassisHalfExtents: THREE.Vector3;
  readonly chassisColliderOffsetY: number;
  readonly chassisBottomY: number;
  readonly spawnYOffset: number;
  readonly bodyVisualCenterY: number;
  readonly cabinVisualCenterY: number;
};

const CAR_TUNING: CarTuning = {
  chassisHalfExtents: new THREE.Vector3(1.15, 0.18, 2.0),
  additionalMass: 1.8,
  centerOfMass: new RAPIER.Vector3(0, -0.35, 0.08),
  principalAngularInertia: new RAPIER.Vector3(2.2, 3.6, 1.8),
  additionalSolverIterations: 2,
  wheelRadius: 0.32,
  suspensionRestLength: 0.52,
  suspensionMaxTravel: 0.18,
  nominalSuspensionCompression: 0.1,
  nominalChassisClearance: 0.22,
  selfRightingTiltDot: 0.94,
  selfRightingSnapTiltDot: 0.86,
  suspensionStiffness: 22,
  suspensionCompression: 3.8,
  suspensionRelaxation: 5.2,
  maxSuspensionForce: 34,
  forwardEngineFront: 16,
  forwardEngineRear: 22,
  boostEngineFront: 21,
  boostEngineRear: 29,
  reverseEngineFront: 10,
  reverseEngineRear: 14,
  coastBrake: 0.35,
  serviceBrake: 1.8,
  handbrakeFrontBrake: 0.8,
  handbrakeRearBrake: 3.8,
  frontFrictionSlip: 2.4,
  rearFrictionSlip: 2.6,
  handbrakeRearFrictionSlip: 1.8,
  frontSideFriction: 1.65,
  rearSideFriction: 1.8,
  handbrakeRearSideFriction: 0.75,
  maxSteerAngle: Math.PI / 5.8,
  highSpeedSteerScale: 0.52,
  steerSpeed: 10.5,
  jumpVelocity: 4.6,
  jumpCooldownSeconds: 0.55,
  jumpCoyoteSeconds: 0.12,
  landingRecoverySeconds: 0.16,
  airSteerMultiplier: 0.38,
  airEngineMultiplier: 0.28,
  driveLinearDamping: 0.75,
  driveAngularDamping: 2.4,
  landingLinearDamping: 1.7,
  landingAngularDamping: 4.8,
  uprightAssistGrounded: 8.5,
  uprightAssistAir: 2.5,
  wheelVisualDropMax: 0.22,
  cabinRollScale: 0.022,
  cabinPitchScale: 0.018,
  maxForwardSpeed: 26,
  maxBoostSpeed: 31,
};

export function deriveCarRideGeometry(tuning: CarTuning = CAR_TUNING): CarRideGeometry {
  const nominalSuspensionCompression = THREE.MathUtils.clamp(
    tuning.nominalSuspensionCompression,
    0,
    tuning.suspensionRestLength + tuning.suspensionMaxTravel - 0.01,
  );
  const nominalSuspensionLength = tuning.suspensionRestLength - nominalSuspensionCompression;
  const wheelHardPointY = tuning.wheelRadius + tuning.suspensionRestLength;
  const nominalGroundPlaneY = nominalSuspensionCompression;
  const chassisColliderOffsetY =
    tuning.chassisHalfExtents.y + tuning.nominalChassisClearance + nominalGroundPlaneY;

  return {
    wheelRadius: tuning.wheelRadius,
    suspensionRestLength: tuning.suspensionRestLength,
    suspensionMaxTravel: tuning.suspensionMaxTravel,
    nominalSuspensionCompression,
    nominalSuspensionLength,
    wheelHardPointY,
    wheelCenterYAtRest: tuning.wheelRadius,
    nominalGroundPlaneY,
    nominalChassisClearance: tuning.nominalChassisClearance,
    chassisHalfExtents: tuning.chassisHalfExtents.clone(),
    chassisColliderOffsetY,
    chassisBottomY: chassisColliderOffsetY - tuning.chassisHalfExtents.y,
    spawnYOffset: nominalGroundPlaneY,
    bodyVisualCenterY: chassisColliderOffsetY,
    cabinVisualCenterY: chassisColliderOffsetY + 0.45,
  };
}

export const DEFAULT_CAR_RIDE_GEOMETRY = deriveCarRideGeometry();
export const CAR_SPAWN_Y_OFFSET = DEFAULT_CAR_RIDE_GEOMETRY.spawnYOffset;

function createWheelBaseCenters(ride: CarRideGeometry): readonly THREE.Vector3[] {
  return [
    new THREE.Vector3(1.1, ride.wheelCenterYAtRest, -1.5),
    new THREE.Vector3(-1.1, ride.wheelCenterYAtRest, -1.5),
    new THREE.Vector3(1.1, ride.wheelCenterYAtRest, 1.5),
    new THREE.Vector3(-1.1, ride.wheelCenterYAtRest, 1.5),
  ] as const;
}

export function isCarWheelQueryCandidate(
  isSensor: boolean,
  bodyKind: string | null,
  excludedBody: boolean,
): boolean {
  if (isSensor || excludedBody) return false;
  return bodyKind !== 'vehicle' && bodyKind !== 'throwable' && bodyKind !== 'player';
}

export function pickFirstClearCarExitCandidate(
  candidates: readonly THREE.Vector3[],
  isClear: (candidate: THREE.Vector3) => boolean,
): THREE.Vector3 {
  for (const candidate of candidates) {
    if (isClear(candidate)) return candidate.clone();
  }
  return candidates[0]?.clone() ?? new THREE.Vector3();
}

type WheelVisualNode = {
  readonly hardPoint: THREE.Vector3;
  steerPivot: THREE.Object3D | null;
  spinGroup: THREE.Object3D;
};

export type CarDriveCommand = {
  steerAngle: number;
  physicsSteerAngle: number;
  frontEngineForce: number;
  rearEngineForce: number;
  frontBrake: number;
  rearBrake: number;
  frontFrictionSlip: number;
  rearFrictionSlip: number;
  frontSideFriction: number;
  rearSideFriction: number;
  braking: boolean;
};

export function canCarJump(
  groundedWheelCount: number,
  groundedGraceRemaining: number,
  hopCooldown: number,
): boolean {
  return hopCooldown <= 0 && (groundedWheelCount >= 2 || groundedGraceRemaining > 0);
}

export function resolveCarDriveCommand(
  throttle: number,
  steerInput: number,
  currentSteerAngle: number,
  speed: number,
  grounded: boolean,
  handbrake: boolean,
  boosting: boolean,
  dt: number,
  tuning: CarTuning = CAR_TUNING,
): CarDriveCommand {
  const speedAbs = Math.abs(speed);
  const maxForward = boosting ? tuning.maxBoostSpeed : tuning.maxForwardSpeed;
  const speedNorm = THREE.MathUtils.clamp(speedAbs / Math.max(0.01, maxForward), 0, 1);
  const steerLimit = tuning.maxSteerAngle * (1 - speedNorm * (1 - tuning.highSpeedSteerScale));
  const targetSteerAngle = steerInput * steerLimit;
  const steerAngle = THREE.MathUtils.damp(
    currentSteerAngle,
    targetSteerAngle,
    handbrake ? tuning.steerSpeed * 1.2 : tuning.steerSpeed,
    dt,
  );

  let frontEngineForce = 0;
  let rearEngineForce = 0;
  let frontBrake = grounded ? tuning.coastBrake : 0;
  let rearBrake = grounded ? tuning.coastBrake : 0;
  let braking = false;

  if (throttle > 0.01) {
    if (speed < -0.5) {
      frontBrake = tuning.serviceBrake;
      rearBrake = tuning.serviceBrake;
      braking = true;
    } else {
      const engineFront = boosting ? tuning.boostEngineFront : tuning.forwardEngineFront;
      const engineRear = boosting ? tuning.boostEngineRear : tuning.forwardEngineRear;
      const groundedScale = grounded ? 1 : tuning.airEngineMultiplier;
      frontEngineForce = -engineFront * throttle * groundedScale;
      rearEngineForce = -engineRear * throttle * groundedScale;
      frontBrake = 0;
      rearBrake = 0;
    }
  } else if (throttle < -0.01) {
    if (speed > 0.5) {
      frontBrake = tuning.serviceBrake;
      rearBrake = tuning.serviceBrake;
      braking = true;
    } else {
      const reverseScale = Math.abs(throttle) * (grounded ? 1 : tuning.airEngineMultiplier);
      frontEngineForce = tuning.reverseEngineFront * reverseScale;
      rearEngineForce = tuning.reverseEngineRear * reverseScale;
      frontBrake = 0;
      rearBrake = 0;
    }
  }

  if (handbrake) {
    frontBrake = Math.max(frontBrake, tuning.handbrakeFrontBrake);
    rearBrake = Math.max(rearBrake, tuning.handbrakeRearBrake);
    braking = true;
  }

  const frontFrictionSlip = tuning.frontFrictionSlip;
  const rearFrictionSlip = handbrake ? tuning.handbrakeRearFrictionSlip : tuning.rearFrictionSlip;
  const frontSideFriction = tuning.frontSideFriction;
  const rearSideFriction = handbrake ? tuning.handbrakeRearSideFriction : tuning.rearSideFriction;
  const physicsSteerAngle = -(grounded ? steerAngle : steerAngle * tuning.airSteerMultiplier);

  return {
    steerAngle,
    physicsSteerAngle,
    frontEngineForce,
    rearEngineForce,
    frontBrake,
    rearBrake,
    frontFrictionSlip,
    rearFrictionSlip,
    frontSideFriction,
    rearSideFriction,
    braking,
  };
}

export class CarController implements VehicleController {
  readonly id: string;
  readonly body: RAPIER.RigidBody;
  readonly mesh: THREE.Object3D;
  readonly exitOffset = new THREE.Vector3(-1.5, 0, 0);
  readonly cameraConfig = {
    distance: 10,
    heightOffset: 2.5,
    positionDamping: 15,
  };

  private readonly vehicleController: RAPIER.DynamicRayCastVehicleController;
  private readonly rideGeometry = DEFAULT_CAR_RIDE_GEOMETRY;
  private readonly wheelVisualBaseCenters = createWheelBaseCenters(this.rideGeometry);
  private readonly wheelQueryExcludedBody: RAPIER.RigidBody | null;
  private input: InputState | null = null;
  private speed = 0;
  private steerAngle = 0;
  private braking = false;
  private hasPose = false;
  private groundedWheelCount = 0;
  private hopCooldown = 0;
  private groundedGraceRemaining = 0;
  private landingRecoveryRemaining = 0;
  private jumpVisualKick = 0;
  private suspensionOffset = 0;
  private visualRoll = 0;
  private visualPitch = 0;
  private readonly _prevPos = new THREE.Vector3();
  private readonly _currPos = new THREE.Vector3();
  private readonly _prevQuat = new THREE.Quaternion();
  private readonly _currQuat = new THREE.Quaternion();
  private readonly taillightMeshes: THREE.Mesh[] = [];
  private readonly wheelVisuals: WheelVisualNode[] = [];
  private readonly wheelSuspensionLengths = Array<number>(4).fill(this.rideGeometry.suspensionRestLength);
  private readonly wheelRotations = Array<number>(4).fill(0);
  private readonly wheelInContact = Array<boolean>(4).fill(false);
  private readonly wheelGroundHandles = Array<number | null>(4).fill(null);
  private readonly averageGroundNormal = new THREE.Vector3(0, 1, 0);
  private cabinMesh: THREE.Object3D | null = null;
  private readonly spawnPosition = new THREE.Vector3();
  private readonly spawnQuaternion = new THREE.Quaternion();

  constructor(
    id: string,
    position: THREE.Vector3,
    private physicsWorld: PhysicsWorld,
    private scene: THREE.Scene,
    ignoredWheelQueryBody?: RAPIER.RigidBody | null,
  ) {
    this.id = id;
    this.spawnPosition.copy(position);
    this.spawnQuaternion.identity();
    this.wheelQueryExcludedBody = ignoredWheelQueryBody ?? null;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z);
    this.body = this.physicsWorld.world.createRigidBody(bodyDesc);
    this.body.userData = { kind: 'vehicle' };
    this.body.enableCcd(true);
    this.body.setDominanceGroup(VEHICLE_DOMINANCE_GROUP);
    this.body.setEnabledRotations(true, true, true, true);
    this.body.setLinearDamping(CAR_TUNING.driveLinearDamping);
    this.body.setAngularDamping(CAR_TUNING.driveAngularDamping);
    this.body.setAdditionalSolverIterations(CAR_TUNING.additionalSolverIterations);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      this.rideGeometry.chassisHalfExtents.x,
      this.rideGeometry.chassisHalfExtents.y,
      this.rideGeometry.chassisHalfExtents.z,
    )
      .setTranslation(0, this.rideGeometry.chassisColliderOffsetY, 0)
      .setDensity(0)
      .setFriction(0.35)
      .setRestitution(0.05)
      .setCollisionGroups(COLLISION_GROUP_VEHICLE);
    this.physicsWorld.world.createCollider(colliderDesc, this.body);
    this.body.setAdditionalMassProperties(
      CAR_TUNING.additionalMass,
      CAR_TUNING.centerOfMass,
      CAR_TUNING.principalAngularInertia,
      _rqIdentity,
      true,
    );

    this.vehicleController = this.physicsWorld.world.createVehicleController(this.body);
    this.vehicleController.indexUpAxis = 1;
    (this.vehicleController as unknown as { setIndexForwardAxis: number }).setIndexForwardAxis = 2;
    this.configureVehicleController();

    this.mesh = this.createCarMesh();
    this.mesh.position.copy(position);
    this.scene.add(this.mesh);
    this.prewarmSuspensionPose();
  }

  enter(input: InputState): void {
    this.input = input;
    this.body.wakeUp();
    this.hopCooldown = 0;
    this.groundedGraceRemaining = 0;
    this.landingRecoveryRemaining = 0;
    this.jumpVisualKick = 0;
    this.prewarmSuspensionPose();
  }

  exit(): SpawnPointData {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    this.input = null;
    this.steerAngle = 0;
    this.braking = false;
    this.jumpVisualKick = 0;
    this.body.setLinvel(_setCRV(_rv3A, 0, 0, 0), true);
    this.body.setAngvel(_setCRV(_rv3B, 0, 0, 0), true);

    _quat.set(rot.x, rot.y, rot.z, rot.w);
    _tempEuler.setFromQuaternion(_quat, 'YXZ');
    _yawEuler.set(0, _tempEuler.y, 0);
    _quat.setFromEuler(_yawEuler);

    const basePos = new THREE.Vector3(pos.x, pos.y, pos.z);
    const exitY = basePos.y + 1.1;
    const transformedCandidates = _exitCandidates.map((candidate) =>
      candidate.clone().applyQuaternion(_quat).add(basePos).setY(exitY),
    );
    return {
      position: pickFirstClearCarExitCandidate(
        transformedCandidates,
        (candidate) => this.isExitCandidateClear(candidate),
      ),
    };
  }

  resetToSpawn(): void {
    this.input = null;
    this.speed = 0;
    this.steerAngle = 0;
    this.braking = false;
    this.groundedWheelCount = 0;
    this.hopCooldown = 0;
    this.groundedGraceRemaining = 0;
    this.landingRecoveryRemaining = 0;
    this.jumpVisualKick = 0;
    this.suspensionOffset = 0;
    this.visualRoll = 0;
    this.visualPitch = 0;
    this.hasPose = false;

    this.body.setTranslation(_setCRV(_rv3A, this.spawnPosition.x, this.spawnPosition.y, this.spawnPosition.z), true);
    this.body.setRotation(toRapierQuat(this.spawnQuaternion), true);
    this.body.setLinvel(_setCRV(_rv3A, 0, 0, 0), true);
    this.body.setAngvel(_setCRV(_rv3B, 0, 0, 0), true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.body.wakeUp();

    this.mesh.position.copy(this.spawnPosition);
    this.mesh.quaternion.copy(this.spawnQuaternion);
    if (this.cabinMesh) {
      this.cabinMesh.rotation.set(0, 0, 0);
    }
    this.prewarmSuspensionPose();
  }

  setInput(input: InputState): void {
    this.input = input;
  }

  fixedUpdate(dt: number): void {
    this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.groundedGraceRemaining = Math.max(0, this.groundedGraceRemaining - dt);
    this.landingRecoveryRemaining = Math.max(0, this.landingRecoveryRemaining - dt);
    this.jumpVisualKick = THREE.MathUtils.damp(this.jumpVisualKick, 0, 7, dt);

    const wasGrounded = this.groundedWheelCount >= 2;
    const input = this.input;
    const groundedForDrive = wasGrounded;
    const command = resolveCarDriveCommand(
      input?.moveY ?? 0,
      input?.moveX ?? 0,
      this.steerAngle,
      this.speed,
      groundedForDrive,
      input?.crouch ?? false,
      input?.sprint ?? false,
      dt,
    );
    this.steerAngle = command.steerAngle;
    this.braking = command.braking;

    this.applyWheelCommand(command);
    this.vehicleController.updateVehicle(
      dt,
      undefined,
      COLLISION_GROUP_VEHICLE,
      this.wheelQueryFilterPredicate,
    );
    this.syncVehicleStateFromController(dt);
    this.speed = -this.vehicleController.currentVehicleSpeed();

    const groundedNow = this.groundedWheelCount >= 2;
    if (groundedNow) {
      this.groundedGraceRemaining = CAR_TUNING.jumpCoyoteSeconds;
      if (!wasGrounded) {
        this.landingRecoveryRemaining = CAR_TUNING.landingRecoverySeconds;
      }
    }

    if (input?.jumpPressed && canCarJump(this.groundedWheelCount, this.groundedGraceRemaining, this.hopCooldown)) {
      this.body.applyImpulse(_setCRV(_rv3A, 0, this.body.mass() * CAR_TUNING.jumpVelocity, 0), true);
      this.body.wakeUp();
      this.hopCooldown = CAR_TUNING.jumpCooldownSeconds;
      this.groundedGraceRemaining = 0;
      this.landingRecoveryRemaining = 0;
      this.jumpVisualKick = 1;
    }

    this.applyUprightAssist(dt, groundedNow);
    this.updateDamping();
    this.updateVisualState(dt);
    this.applyWheelVisualState();
  }

  postPhysicsUpdate(_dt: number): void {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    if (!this.hasPose) {
      this._prevPos.set(pos.x, pos.y, pos.z);
      this._currPos.set(pos.x, pos.y, pos.z);
      this._prevQuat.set(rot.x, rot.y, rot.z, rot.w);
      this._currQuat.set(rot.x, rot.y, rot.z, rot.w);
      this.hasPose = true;
    } else {
      this._prevPos.copy(this._currPos);
      this._prevQuat.copy(this._currQuat);
      this._currPos.set(pos.x, pos.y, pos.z);
      this._currQuat.set(rot.x, rot.y, rot.z, rot.w);
    }
  }

  update(_dt: number, alpha: number): void {
    if (!this.hasPose) return;
    this.mesh.position.lerpVectors(this._prevPos, this._currPos, alpha);
    this.mesh.position.y += this.suspensionOffset;
    this.mesh.quaternion.slerpQuaternions(this._prevQuat, this._currQuat, alpha);
    this.applyWheelVisualState();
    if (this.cabinMesh) {
      this.cabinMesh.rotation.x = this.visualPitch;
      this.cabinMesh.rotation.z = this.visualRoll;
    }
    const brakeIntensity = this.braking ? 6.0 : 1.5;
    for (const taillight of this.taillightMeshes) {
      (taillight.material as THREE.MeshStandardMaterial).emissiveIntensity = brakeIntensity;
    }
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => mat.dispose());
      } else {
        mesh.material?.dispose();
      }
    });
    this.physicsWorld.world.removeVehicleController(this.vehicleController);
    this.physicsWorld.removeBody(this.body);
  }

  getDebugState(): {
    groundedWheelCount: number;
    wheelGroundHandles: readonly (number | null)[];
    rideGeometry: Pick<CarRideGeometry, 'nominalChassisClearance' | 'chassisBottomY' | 'nominalGroundPlaneY'>;
  } {
    return {
      groundedWheelCount: this.groundedWheelCount,
      wheelGroundHandles: [...this.wheelGroundHandles],
      rideGeometry: {
        nominalChassisClearance: this.rideGeometry.nominalChassisClearance,
        chassisBottomY: this.rideGeometry.chassisBottomY,
        nominalGroundPlaneY: this.rideGeometry.nominalGroundPlaneY,
      },
    };
  }

  private readonly wheelQueryFilterPredicate = (collider: RAPIER.Collider): boolean => {
    const parent = collider.parent();
    const excludedBody =
      parent !== null &&
      this.wheelQueryExcludedBody !== null &&
      parent.handle === this.wheelQueryExcludedBody.handle;
    return isCarWheelQueryCandidate(collider.isSensor(), getRigidBodyKind(parent), excludedBody);
  };

  private configureVehicleController(): void {
    for (let i = 0; i < this.wheelVisualBaseCenters.length; i++) {
      const baseCenter = this.wheelVisualBaseCenters[i];
      const hardPoint = new RAPIER.Vector3(
        baseCenter.x,
        this.rideGeometry.wheelHardPointY,
        baseCenter.z,
      );
      this.vehicleController.addWheel(
        hardPoint,
        new RAPIER.Vector3(0, -1, 0),
        new RAPIER.Vector3(-1, 0, 0),
        this.rideGeometry.suspensionRestLength,
        this.rideGeometry.wheelRadius,
      );
      this.vehicleController.setWheelSuspensionRestLength(i, this.rideGeometry.suspensionRestLength);
      this.vehicleController.setWheelMaxSuspensionTravel(i, this.rideGeometry.suspensionMaxTravel);
      this.vehicleController.setWheelSuspensionStiffness(i, CAR_TUNING.suspensionStiffness);
      this.vehicleController.setWheelSuspensionCompression(i, CAR_TUNING.suspensionCompression);
      this.vehicleController.setWheelSuspensionRelaxation(i, CAR_TUNING.suspensionRelaxation);
      this.vehicleController.setWheelMaxSuspensionForce(i, CAR_TUNING.maxSuspensionForce);
      this.vehicleController.setWheelBrake(i, 0);
      this.vehicleController.setWheelEngineForce(i, 0);
      this.vehicleController.setWheelSteering(i, 0);
      this.vehicleController.setWheelFrictionSlip(i, i < 2 ? CAR_TUNING.frontFrictionSlip : CAR_TUNING.rearFrictionSlip);
      this.vehicleController.setWheelSideFrictionStiffness(i, i < 2 ? CAR_TUNING.frontSideFriction : CAR_TUNING.rearSideFriction);
    }
  }

  private applyWheelCommand(command: CarDriveCommand): void {
    for (let i = 0; i < this.wheelVisualBaseCenters.length; i++) {
      const isFront = i < 2;
      this.vehicleController.setWheelSteering(i, isFront ? command.physicsSteerAngle : 0);
      this.vehicleController.setWheelEngineForce(i, isFront ? command.frontEngineForce : command.rearEngineForce);
      this.vehicleController.setWheelBrake(i, isFront ? command.frontBrake : command.rearBrake);
      this.vehicleController.setWheelFrictionSlip(i, isFront ? command.frontFrictionSlip : command.rearFrictionSlip);
      this.vehicleController.setWheelSideFrictionStiffness(i, isFront ? command.frontSideFriction : command.rearSideFriction);
    }
  }

  private syncVehicleStateFromController(dt: number): void {
    let avgCompression = 0;
    let groundedCount = 0;
    this.averageGroundNormal.set(0, 0, 0);

    for (let i = 0; i < this.wheelVisualBaseCenters.length; i++) {
      const contact = this.vehicleController.wheelIsInContact(i);
      this.wheelInContact[i] = contact;
      this.wheelGroundHandles[i] = this.vehicleController.wheelGroundObject(i)?.handle ?? null;
      if (contact) {
        groundedCount++;
      }

      const suspensionLength = this.vehicleController.wheelSuspensionLength(i);
      const resolvedLength = suspensionLength != null
        ? suspensionLength
        : Math.min(
            this.rideGeometry.suspensionRestLength + this.rideGeometry.suspensionMaxTravel,
            this.rideGeometry.suspensionRestLength + CAR_TUNING.wheelVisualDropMax,
          );
      this.wheelSuspensionLengths[i] = resolvedLength;
      avgCompression += Math.max(0, this.rideGeometry.suspensionRestLength - resolvedLength);

      const wheelRotation = this.vehicleController.wheelRotation(i);
      if (wheelRotation != null) {
        this.wheelRotations[i] = wheelRotation;
      }

      const contactNormal = this.vehicleController.wheelContactNormal(i);
      if (contactNormal) {
        this.averageGroundNormal.add(_chassisUp.set(contactNormal.x, contactNormal.y, contactNormal.z));
      }
    }

    this.groundedWheelCount = groundedCount;
    if (groundedCount > 0 && this.averageGroundNormal.lengthSq() > 0.0001) {
      this.averageGroundNormal.normalize();
    } else {
      this.averageGroundNormal.set(0, 1, 0);
    }

    const avgWheelCompression = avgCompression / this.wheelVisualBaseCenters.length;
    this.suspensionOffset = THREE.MathUtils.damp(this.suspensionOffset, avgWheelCompression * 0.08, 10, dt);
  }

  private applyUprightAssist(dt: number, grounded: boolean): void {
    const rot = this.body.rotation();
    _quat.set(rot.x, rot.y, rot.z, rot.w);
    _chassisUp.set(0, 1, 0).applyQuaternion(_quat);
    const uprightDot = THREE.MathUtils.clamp(_chassisUp.dot(_worldUp), -1, 1);
    const tiltSeverity = THREE.MathUtils.clamp(1 - uprightDot, 0, 1);
    _uprightAxis.crossVectors(_chassisUp, _worldUp);
    _uprightAxis.y = 0;
    if (_uprightAxis.lengthSq() > 0.00001) {
      const strengthBase = grounded ? CAR_TUNING.uprightAssistGrounded : CAR_TUNING.uprightAssistAir;
      const strength = strengthBase * (1 + tiltSeverity * (grounded ? 2.4 : 1.2));
      this.body.applyTorqueImpulse(
        _setCRV(
          _rv3A,
          _uprightAxis.x * strength * this.body.mass() * dt,
          0,
          _uprightAxis.z * strength * this.body.mass() * dt,
        ),
        true,
      );
    }

    const angVel = this.body.angvel();
    const lateralDamping = THREE.MathUtils.clamp(
      (grounded ? 4.5 : 1.8) * dt * (1 + tiltSeverity * 2.5),
      0,
      grounded ? 0.8 : 0.35,
    );
    this.body.setAngvel(
      _setCRV(
        _rv3B,
        angVel.x * (1 - lateralDamping),
        angVel.y,
        angVel.z * (1 - lateralDamping),
      ),
      true,
    );

    if (!grounded || uprightDot >= CAR_TUNING.selfRightingTiltDot) return;

    _tempEuler.setFromQuaternion(_quat, 'YXZ');
    _yawEuler.set(0, _tempEuler.y, 0);
    _targetQuat.setFromEuler(_yawEuler);

    const alignFactor = uprightDot < CAR_TUNING.selfRightingSnapTiltDot
      ? 0.22
      : THREE.MathUtils.clamp((CAR_TUNING.selfRightingTiltDot - uprightDot) * 0.85, 0.04, 0.12);
    _quat.slerp(_targetQuat, alignFactor);
    this.body.setRotation(toRapierQuat(_quat), true);

    if (uprightDot < 0.9) {
      const pos = this.body.translation();
      const lift = THREE.MathUtils.clamp((0.92 - uprightDot) * 0.18, 0.015, 0.045);
      this.body.setTranslation(_setCRV(_rv3A, pos.x, pos.y + lift, pos.z), true);
    }
  }

  private updateDamping(): void {
    const recovering = this.landingRecoveryRemaining > 0;
    this.body.setLinearDamping(recovering ? CAR_TUNING.landingLinearDamping : CAR_TUNING.driveLinearDamping);
    this.body.setAngularDamping(recovering ? CAR_TUNING.landingAngularDamping : CAR_TUNING.driveAngularDamping);
  }

  private updateVisualState(dt: number): void {
    const speedNorm = THREE.MathUtils.clamp(Math.abs(this.speed) / CAR_TUNING.maxBoostSpeed, 0, 1);
    const targetRoll = -this.steerAngle * speedNorm * CAR_TUNING.cabinRollScale;
    const targetPitch = (-Math.sign(this.speed) * (this.braking ? 1 : 0) * CAR_TUNING.cabinPitchScale * 0.8)
      + (this.jumpVisualKick * CAR_TUNING.cabinPitchScale * 1.8);
    this.visualRoll = THREE.MathUtils.damp(this.visualRoll, targetRoll, 8, dt);
    this.visualPitch = THREE.MathUtils.damp(this.visualPitch, targetPitch, 8, dt);
  }

  private createCarMesh(): THREE.Object3D {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a6878, metalness: 0.5, roughness: 0.35 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 4.0), bodyMat);
    body.position.y = this.rideGeometry.bodyVisualCenterY;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const cabin = new THREE.Group();
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, metalness: 0.35, roughness: 0.45 });
    const cabinBox = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 2.0), cabinMat);
    cabinBox.position.set(0, this.rideGeometry.cabinVisualCenterY, 0.2);
    cabinBox.castShadow = true;
    cabin.add(cabinBox);
    group.add(cabin);
    this.cabinMesh = cabin;

    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff5e8,
      emissive: 0xffe8cc,
      emissiveIntensity: 3.0,
      roughness: 0.2,
    });
    for (const side of [-0.7, 0.7]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.08), headlightMat);
      hl.position.set(side, this.rideGeometry.bodyVisualCenterY + 0.05, -2.04);
      group.add(hl);
    }

    const taillightMat = new THREE.MeshStandardMaterial({
      color: 0xcc2222,
      emissive: 0xcc2222,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    for (const side of [-0.7, 0.7]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.08), taillightMat);
      tl.position.set(side, this.rideGeometry.bodyVisualCenterY + 0.05, 2.04);
      group.add(tl);
      this.taillightMeshes.push(tl);
    }

    const tireGeom = new THREE.CylinderGeometry(this.rideGeometry.wheelRadius, this.rideGeometry.wheelRadius, 0.22, 16);
    tireGeom.rotateZ(Math.PI / 2);
    const rimGeom = new THREE.CylinderGeometry(this.rideGeometry.wheelRadius * 0.55, this.rideGeometry.wheelRadius * 0.55, 0.24, 10);
    rimGeom.rotateZ(Math.PI / 2);

    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.2, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.15 });

    this.wheelVisualBaseCenters.forEach((baseCenter, i) => {
      const spinGroup = new THREE.Group();
      const tire = new THREE.Mesh(tireGeom, tireMat);
      tire.castShadow = true;
      spinGroup.add(tire);
      const rim = new THREE.Mesh(rimGeom, rimMat);
      spinGroup.add(rim);

      const hardPoint = new THREE.Vector3(
        baseCenter.x,
        this.rideGeometry.wheelHardPointY,
        baseCenter.z,
      );

      if (i < 2) {
        const steerPivot = new THREE.Group();
        steerPivot.position.copy(baseCenter);
        steerPivot.add(spinGroup);
        group.add(steerPivot);
        this.wheelVisuals.push({ hardPoint, steerPivot, spinGroup });
      } else {
        spinGroup.position.copy(baseCenter);
        group.add(spinGroup);
        this.wheelVisuals.push({ hardPoint, steerPivot: null, spinGroup });
      }
    });

    return group;
  }

  private prewarmSuspensionPose(): void {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    _quat.set(rot.x, rot.y, rot.z, rot.w);

    let groundedCount = 0;
    let avgCompression = 0;
    this.averageGroundNormal.set(0, 0, 0);

    const localDown = new THREE.Vector3(0, -1, 0).applyQuaternion(_quat);
    for (let i = 0; i < this.wheelVisuals.length; i++) {
      const hardPoint = this.wheelVisuals[i].hardPoint.clone().applyQuaternion(_quat);
      hardPoint.x += pos.x;
      hardPoint.y += pos.y;
      hardPoint.z += pos.z;

      const maxToi = this.rideGeometry.suspensionRestLength + this.rideGeometry.suspensionMaxTravel + this.rideGeometry.wheelRadius;
      const rayHit = this.physicsWorld.castRay(
        _setCRV(_rv3A, hardPoint.x, hardPoint.y, hardPoint.z),
        _setCRV(_rv3B, localDown.x, localDown.y, localDown.z),
        maxToi,
        undefined,
        this.body,
        this.wheelQueryFilterPredicate,
        COLLISION_GROUP_VEHICLE,
      );

      if (rayHit) {
        groundedCount++;
        const suspensionLength = Math.max(0, rayHit.timeOfImpact - this.rideGeometry.wheelRadius);
        this.wheelSuspensionLengths[i] = suspensionLength;
        this.wheelInContact[i] = true;
        avgCompression += Math.max(0, this.rideGeometry.suspensionRestLength - suspensionLength);

        const normalHit = this.physicsWorld.castRayAndGetNormal(
          _setCRV(_rv3A, hardPoint.x, hardPoint.y, hardPoint.z),
          _setCRV(_rv3B, localDown.x, localDown.y, localDown.z),
          maxToi,
          undefined,
          this.body,
          this.wheelQueryFilterPredicate,
          COLLISION_GROUP_VEHICLE,
        );
        if (normalHit) {
          this.averageGroundNormal.add(_chassisUp.set(normalHit.normal.x, normalHit.normal.y, normalHit.normal.z));
        }
      } else {
        this.wheelSuspensionLengths[i] = Math.min(
          this.rideGeometry.suspensionRestLength + this.rideGeometry.suspensionMaxTravel,
          this.rideGeometry.suspensionRestLength + CAR_TUNING.wheelVisualDropMax,
        );
        this.wheelInContact[i] = false;
      }
    }

    this.groundedWheelCount = groundedCount;
    if (groundedCount > 0 && this.averageGroundNormal.lengthSq() > 0.0001) {
      this.averageGroundNormal.normalize();
      this.suspensionOffset = (avgCompression / this.wheelVisuals.length) * 0.08;
    } else {
      this.averageGroundNormal.set(0, 1, 0);
      this.suspensionOffset = 0;
    }
    this.syncVisualPoseImmediate();
  }

  private syncVisualPoseImmediate(): void {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    this._prevPos.set(pos.x, pos.y, pos.z);
    this._currPos.set(pos.x, pos.y, pos.z);
    this._prevQuat.set(rot.x, rot.y, rot.z, rot.w);
    this._currQuat.set(rot.x, rot.y, rot.z, rot.w);
    this.hasPose = true;
    this.mesh.position.set(pos.x, pos.y + this.suspensionOffset, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    this.applyWheelVisualState();
    if (this.cabinMesh) {
      this.cabinMesh.rotation.set(this.visualPitch, 0, this.visualRoll);
    }
  }

  private applyWheelVisualState(): void {
    for (let i = 0; i < this.wheelVisuals.length; i++) {
      const wheelVisual = this.wheelVisuals[i];
      const suspensionLength = THREE.MathUtils.clamp(
        this.wheelSuspensionLengths[i],
        0,
        this.rideGeometry.suspensionRestLength + this.rideGeometry.suspensionMaxTravel,
      );
      const centerY = wheelVisual.hardPoint.y - suspensionLength;

      if (wheelVisual.steerPivot) {
        wheelVisual.steerPivot.position.set(wheelVisual.hardPoint.x, centerY, wheelVisual.hardPoint.z);
        wheelVisual.steerPivot.rotation.y = -this.steerAngle;
      } else {
        wheelVisual.spinGroup.position.set(wheelVisual.hardPoint.x, centerY, wheelVisual.hardPoint.z);
      }
      wheelVisual.spinGroup.rotation.x = -this.wheelRotations[i];
    }
  }

  private isExitCandidateClear(candidate: THREE.Vector3): boolean {
    return !this.physicsWorld.intersectsShape(
      _setCRV(_rv3A, candidate.x, candidate.y, candidate.z),
      _rqIdentity,
      _playerExitShape,
      undefined,
      undefined,
      (collider) => {
        if (collider.isSensor()) return false;
        const parent = collider.parent();
        return !(parent && this.wheelQueryExcludedBody && parent.handle === this.wheelQueryExcludedBody.handle);
      },
    );
  }
}
