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
const _carForward = new THREE.Vector3();
const _carRight = new THREE.Vector3();
const _carVelocity = new THREE.Vector3();
const _otherVelocity = new THREE.Vector3();
const _impactDirection = new THREE.Vector3();
const _contactPoint = new THREE.Vector3();
const _contactPointSum = new THREE.Vector3();
const _rv3A = new RAPIER.Vector3(0, 0, 0);
const _rv3B = new RAPIER.Vector3(0, 0, 0);
const _rqIdentity = new RAPIER.Quaternion(0, 0, 0, 1);
const _playerExitShape = new RAPIER.Capsule(
  DEFAULT_PLAYER_CONFIG.capsuleHalfHeight,
  DEFAULT_PLAYER_CONFIG.capsuleRadius,
);
const _exitCandidates = [
  new THREE.Vector3(-1.75, 0, 0),
  new THREE.Vector3(1.75, 0, 0),
  new THREE.Vector3(0, 0, 2.8),
] as const;
const CAR_EXIT_CAPSULE_CLEARANCE = 1.1;
const CAR_EXIT_GROUND_PROBE_RAY_HEIGHT = 2;
const CAR_EXIT_GROUND_PROBE_MAX_TOI = 50;
const ACTIVE_CAR_DOMINANCE_GROUP = 0;
const STEERING_DEBUG_AUTO_LOG_INTERVAL_FRAMES = 180;

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

export function isCarWheelQueryCandidate(
  isSensor: boolean,
  bodyKind: string | null,
  bodyType: RAPIER.RigidBodyType | null,
  excludedBody: boolean,
): boolean {
  if (isSensor || excludedBody) return false;
  if (bodyType === RAPIER.RigidBodyType.Dynamic && bodyKind !== 'floating-platform') return false;
  return bodyKind !== 'vehicle' && bodyKind !== 'throwable' && bodyKind !== 'player';
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
  readonly maxReverseSpeed: number;
  readonly driveAssistForwardAccel: number;
  readonly driveAssistBoostAccel: number;
  readonly driveAssistReverseAccel: number;
  readonly driveAssistCoastDecel: number;
  readonly driveAssistBrakeDecel: number;
  readonly driveAssistLateralGrip: number;
  readonly driveAssistHandbrakeGrip: number;
  readonly driveAssistAirGrip: number;
  readonly driveAssistYawRate: number;
  readonly driveAssistHandbrakeYawRate: number;
  readonly driveAssistYawResponse: number;
  readonly driveAssistYawTorqueScale: number;
  readonly contactPushMinClosingSpeed: number;
  readonly contactPushSpeedScale: number;
  readonly contactPushDriveTransferScale: number;
  readonly contactPushMaxImpulse: number;
  readonly contactPushMinForwardAlignment: number;
  readonly contactPushMaxVerticalSpeed: number;
  readonly contactPushMinGroundedWheels: number;
  readonly contactPushCarDragScale: number;
  readonly contactPushCarryHeightBlend: number;
  readonly supportMinNormalY: number;
  readonly supportMinSuspensionForce: number;
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
  additionalMass: 8.8,
  centerOfMass: new RAPIER.Vector3(0, -0.35, 0.08),
  principalAngularInertia: new RAPIER.Vector3(2.7, 4.4, 2.3),
  additionalSolverIterations: 6,
  wheelRadius: 0.32,
  suspensionRestLength: 0.52,
  suspensionMaxTravel: 0.18,
  nominalSuspensionCompression: 0.1,
  nominalChassisClearance: 0.22,
  selfRightingTiltDot: 0.94,
  selfRightingSnapTiltDot: 0.86,
  suspensionStiffness: 62,
  suspensionCompression: 4.8,
  suspensionRelaxation: 10.4,
  maxSuspensionForce: 136,
  forwardEngineFront: 2.5,
  forwardEngineRear: 4.0,
  boostEngineFront: 3.2,
  boostEngineRear: 5.2,
  reverseEngineFront: 1.6,
  reverseEngineRear: 2.8,
  coastBrake: 0.45,
  serviceBrake: 2.0,
  handbrakeFrontBrake: 0.8,
  handbrakeRearBrake: 4.0,
  frontFrictionSlip: 2.0,
  rearFrictionSlip: 2.2,
  handbrakeRearFrictionSlip: 1.8,
  frontSideFriction: 2.1,
  rearSideFriction: 2.3,
  handbrakeRearSideFriction: 0.48,
  maxSteerAngle: Math.PI / 5.8,
  highSpeedSteerScale: 0.68,
  steerSpeed: 12.5,
  jumpVelocity: 4.6,
  jumpCooldownSeconds: 0.55,
  jumpCoyoteSeconds: 0.12,
  landingRecoverySeconds: 0.16,
  airSteerMultiplier: 0.38,
  airEngineMultiplier: 0.28,
  driveLinearDamping: 0.11,
  driveAngularDamping: 0.82,
  landingLinearDamping: 0.45,
  landingAngularDamping: 1.85,
  uprightAssistGrounded: 8.5,
  uprightAssistAir: 2.5,
  wheelVisualDropMax: 0.22,
  cabinRollScale: 0.022,
  cabinPitchScale: 0.018,
  maxForwardSpeed: 28,
  maxBoostSpeed: 33,
  maxReverseSpeed: 13,
  driveAssistForwardAccel: 15.5,
  driveAssistBoostAccel: 19.5,
  driveAssistReverseAccel: 11.5,
  driveAssistCoastDecel: 4.4,
  driveAssistBrakeDecel: 16,
  driveAssistLateralGrip: 9.5,
  driveAssistHandbrakeGrip: 2.2,
  driveAssistAirGrip: 1.4,
  driveAssistYawRate: 1.95,
  driveAssistHandbrakeYawRate: 2.6,
  driveAssistYawResponse: 9.5,
  driveAssistYawTorqueScale: 0.9,
  contactPushMinClosingSpeed: 0.18,
  contactPushSpeedScale: 16,
  contactPushDriveTransferScale: 0.34,
  contactPushMaxImpulse: 2.35,
  contactPushMinForwardAlignment: 0.62,
  contactPushMaxVerticalSpeed: 1.2,
  contactPushMinGroundedWheels: 2,
  contactPushCarDragScale: 0.82,
  contactPushCarryHeightBlend: 1,
  supportMinNormalY: 0.56,
  supportMinSuspensionForce: 3.4,
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

export type CarSteeringDebugSample = {
  frame: number;
  timeSeconds: number;
  input: {
    moveX: number;
    moveY: number;
    sprint: boolean;
    jump: boolean;
  };
  command: CarDriveCommand;
  state: {
    contactWheelCount: number;
    groundedWheelCount: number;
    frontGroundedWheelCount: number;
    rearGroundedWheelCount: number;
    groundedTraction: number;
    averageSuspensionCompression: number;
    averageSuspensionForce: number;
    verticalVelocity: number;
    forwardSpeed: number;
    lateralSpeed: number;
    steerAngle: number;
    headingYaw: number;
    yawRate: number;
    driveImpulseMagnitude: number;
    contactPushImpulse: number;
    contactPushCarDrag: number;
    activeContactPushBodies: number;
  };
  wheels: {
    inContact: readonly boolean[];
    contactNormalY: readonly number[];
    groundKinds: readonly (string | null)[];
    suspensionLengths: readonly number[];
    suspensionForces: readonly number[];
    forwardImpulses: readonly number[];
    sideImpulses: readonly number[];
  };
  derived: {
    driveMode: 'forward' | 'reverse' | 'coast';
    expectedYawSign: number;
    actualYawSign: number;
    yawAgreement: boolean;
    steeringEffectiveness: number;
    suspectedForwardSteerLoss: boolean;
  };
};

type CarSteeringDebugTrace = {
  enabled: boolean;
  autoLog: boolean;
  label: string;
  capacity: number;
  sampleCount: number;
  incidentSampleCapacity: number;
  incidentSampleCount: number;
  incidentCount: number;
  samples: readonly CarSteeringDebugSample[];
  incidentSamples: readonly CarSteeringDebugSample[];
};

const DEFAULT_CAR_DRIVE_COMMAND: CarDriveCommand = {
  steerAngle: 0,
  physicsSteerAngle: 0,
  frontEngineForce: 0,
  rearEngineForce: 0,
  frontBrake: 0,
  rearBrake: 0,
  frontFrictionSlip: CAR_TUNING.frontFrictionSlip,
  rearFrictionSlip: CAR_TUNING.rearFrictionSlip,
  frontSideFriction: CAR_TUNING.frontSideFriction,
  rearSideFriction: CAR_TUNING.rearSideFriction,
  braking: false,
};

const DEFAULT_STEERING_DEBUG_TRACE_CAPACITY = 360;
const DEFAULT_STEERING_DEBUG_INCIDENT_CAPACITY = 120;

function computeSteeringDebugIncidentCapacity(sampleCapacity: number): number {
  return THREE.MathUtils.clamp(Math.floor(sampleCapacity / 3), 12, DEFAULT_STEERING_DEBUG_INCIDENT_CAPACITY);
}

function cloneCarSteeringDebugSample(sample: CarSteeringDebugSample): CarSteeringDebugSample {
  return {
    ...sample,
    input: { ...sample.input },
    command: { ...sample.command },
    state: { ...sample.state },
    wheels: {
      inContact: [...sample.wheels.inContact],
      contactNormalY: [...sample.wheels.contactNormalY],
      groundKinds: [...sample.wheels.groundKinds],
      suspensionLengths: [...sample.wheels.suspensionLengths],
      suspensionForces: [...sample.wheels.suspensionForces],
      forwardImpulses: [...sample.wheels.forwardImpulses],
      sideImpulses: [...sample.wheels.sideImpulses],
    },
    derived: { ...sample.derived },
  };
}

export function canCarJump(
  groundedWheelCount: number,
  groundedGraceRemaining: number,
  hopCooldown: number,
): boolean {
  return hopCooldown <= 0 && (groundedWheelCount >= 2 || groundedGraceRemaining > 0);
}

export function isCarWheelSupportingContact(
  inContact: boolean,
  contactNormalY: number,
  suspensionForce: number,
  tuning: CarTuning = CAR_TUNING,
): boolean {
  if (!inContact) return false;
  return contactNormalY >= tuning.supportMinNormalY && suspensionForce >= tuning.supportMinSuspensionForce;
}

export function computeCarDriveSpeedDelta(
  throttle: number,
  forwardSpeed: number,
  grounded: boolean,
  boosting: boolean,
  dt: number,
  tuning: CarTuning = CAR_TUNING,
): number {
  if (dt <= 0) return 0;
  const tractionScale = grounded ? 1 : tuning.airEngineMultiplier;
  const coastStep = tuning.driveAssistCoastDecel * tractionScale * dt;
  const brakeStep = tuning.driveAssistBrakeDecel * tractionScale * dt;

  if (Math.abs(throttle) <= 0.01) {
    return THREE.MathUtils.clamp(-forwardSpeed, -coastStep, coastStep);
  }

  if (throttle > 0) {
    if (forwardSpeed < -0.5) {
      return THREE.MathUtils.clamp(-forwardSpeed, -brakeStep, brakeStep);
    }
    const accelStep = (boosting ? tuning.driveAssistBoostAccel : tuning.driveAssistForwardAccel) * tractionScale * dt;
    const targetSpeed = throttle * (boosting ? tuning.maxBoostSpeed : tuning.maxForwardSpeed);
    return THREE.MathUtils.clamp(targetSpeed - forwardSpeed, -coastStep, accelStep);
  }

  const targetSpeed = -Math.abs(throttle) * tuning.maxReverseSpeed;
  if (forwardSpeed > 0.5) {
    return THREE.MathUtils.clamp(targetSpeed - forwardSpeed, -brakeStep, 0);
  }

  const reverseStep = tuning.driveAssistReverseAccel * tractionScale * dt;
  return THREE.MathUtils.clamp(targetSpeed - forwardSpeed, -reverseStep, reverseStep);
}

export function computeCarLateralGripDelta(
  lateralSpeed: number,
  grounded: boolean,
  handbrake: boolean,
  dt: number,
  tuning: CarTuning = CAR_TUNING,
): number {
  if (dt <= 0 || Math.abs(lateralSpeed) <= 0.0001) return 0;
  const grip = grounded
    ? (handbrake ? tuning.driveAssistHandbrakeGrip : tuning.driveAssistLateralGrip)
    : tuning.driveAssistAirGrip;
  const nextLateralSpeed = THREE.MathUtils.damp(lateralSpeed, 0, grip, dt);
  return nextLateralSpeed - lateralSpeed;
}

export function computeCarYawAssistAuthority(
  groundedWheelCount: number,
  frontGroundedWheelCount: number,
  rearGroundedWheelCount: number,
): number {
  if (groundedWheelCount < 2) return 0;
  if (frontGroundedWheelCount <= 0 || rearGroundedWheelCount <= 0) return 0;
  return groundedWheelCount >= 3 ? 1 : 0.45;
}

export function computeCarYawDirectionSign(
  steerInput: number,
  forwardSpeed: number,
): number {
  if (Math.abs(steerInput) <= 0.0001 || Math.abs(forwardSpeed) <= 0.0001) return 0;
  const steerYawSign = -Math.sign(steerInput);
  const travelYawSign = forwardSpeed >= 0 ? 1 : -1;
  return steerYawSign * travelYawSign;
}

export function computeCarContactPushImpulse(
  driveImpulseMagnitude: number,
  closingSpeed: number,
  targetMass: number,
  dt: number,
  tuning: CarTuning = CAR_TUNING,
): number {
  if (dt <= 0 || targetMass <= 0) return 0;
  const sustainedImpulse = Math.max(0, driveImpulseMagnitude) * tuning.contactPushDriveTransferScale;
  const speedImpulse = closingSpeed > tuning.contactPushMinClosingSpeed
    ? (closingSpeed - tuning.contactPushMinClosingSpeed)
      * THREE.MathUtils.clamp(Math.sqrt(targetMass), 0.85, 1.8)
      * tuning.contactPushSpeedScale
      * dt
    : 0;
  return Math.min(tuning.contactPushMaxImpulse, Math.max(sustainedImpulse, speedImpulse));
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
  readonly type = 'car' as const;
  readonly body: RAPIER.RigidBody;
  readonly mesh: THREE.Object3D;
  readonly exitOffset = new THREE.Vector3(-1.75, 0, 0);
  readonly cameraConfig = {
    distance: 10,
    heightOffset: 2.5,
    positionDamping: 15,
  };

  private readonly vehicleController: RAPIER.DynamicRayCastVehicleController;
  private readonly chassisCollider: RAPIER.Collider;
  private readonly rideGeometry = DEFAULT_CAR_RIDE_GEOMETRY;
  private readonly wheelVisualBaseCenters = createWheelBaseCenters(this.rideGeometry);
  private readonly wheelQueryExcludedBody: RAPIER.RigidBody | null;
  private input: InputState | null = null;
  private speed = 0;
  private steerAngle = 0;
  private braking = false;
  private hasPose = false;
  private contactWheelCount = 0;
  private groundedWheelCount = 0;
  private frontGroundedWheelCount = 0;
  private rearGroundedWheelCount = 0;
  private groundedTraction = 0;
  private hopCooldown = 0;
  private groundedGraceRemaining = 0;
  private landingRecoveryRemaining = 0;
  private jumpVisualKick = 0;
  private suspensionOffset = 0;
  private averageSuspensionCompression = 0;
  private averageSuspensionForce = 0;
  private forwardSpeed = 0;
  private lateralSpeed = 0;
  private lastDriveImpulseMagnitude = 0;
  private lastContactPushImpulse = 0;
  private lastContactPushCarDrag = 0;
  private activeContactPushBodies = 0;
  private visualRoll = 0;
  private visualPitch = 0;
  private headingYaw = 0;
  private readonly _prevPos = new THREE.Vector3();
  private readonly _currPos = new THREE.Vector3();
  private readonly _prevQuat = new THREE.Quaternion();
  private readonly _currQuat = new THREE.Quaternion();
  private readonly taillightMeshes: THREE.Mesh[] = [];
  private readonly wheelVisuals: WheelVisualNode[] = [];
  private readonly wheelSuspensionLengths = Array<number>(4).fill(this.rideGeometry.suspensionRestLength);
  private readonly wheelRotations = Array<number>(4).fill(0);
  private readonly wheelForwardImpulses = Array<number>(4).fill(0);
  private readonly wheelSideImpulses = Array<number>(4).fill(0);
  private readonly wheelSuspensionForces = Array<number>(4).fill(0);
  private readonly wheelContactNormalY = Array<number>(4).fill(1);
  private readonly wheelInContact = Array<boolean>(4).fill(false);
  private readonly wheelGroundHandles = Array<number | null>(4).fill(null);
  private readonly wheelGroundKinds = Array<string | null>(4).fill(null);
  private readonly averageGroundNormal = new THREE.Vector3(0, 1, 0);
  private cabinMesh: THREE.Object3D | null = null;
  private readonly spawnPosition = new THREE.Vector3();
  private readonly spawnQuaternion = new THREE.Quaternion();
  private lastDriveCommand: CarDriveCommand = { ...DEFAULT_CAR_DRIVE_COMMAND };
  private steeringDebugEnabled = false;
  private steeringDebugAutoLog = false;
  private steeringDebugLabel = '';
  private steeringDebugCapacity = DEFAULT_STEERING_DEBUG_TRACE_CAPACITY;
  private steeringDebugIncidentCapacity = computeSteeringDebugIncidentCapacity(DEFAULT_STEERING_DEBUG_TRACE_CAPACITY);
  private steeringDebugTrace: CarSteeringDebugSample[] = [];
  private steeringDebugIncidentSamples: CarSteeringDebugSample[] = [];
  private steeringDebugFrame = 0;
  private steeringDebugTimeSeconds = 0;
  private steeringDebugIncidentCount = 0;
  private lastSteeringDebugLogFrame = Number.NEGATIVE_INFINITY;

  constructor(
    id: string,
    position: THREE.Vector3,
    private physicsWorld: PhysicsWorld,
    private scene: THREE.Scene,
    ignoredWheelQueryBody?: RAPIER.RigidBody | null,
  ) {
    this.id = id;
    this.steeringDebugLabel = id;
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
      .setFriction(0.46)
      .setRestitution(0.05)
      .setCollisionGroups(COLLISION_GROUP_VEHICLE);
    this.chassisCollider = this.physicsWorld.world.createCollider(colliderDesc, this.body);
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
    this.body.setDominanceGroup(ACTIVE_CAR_DOMINANCE_GROUP);
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
    this.body.setDominanceGroup(VEHICLE_DOMINANCE_GROUP);
    this.steerAngle = 0;
    this.braking = false;
    this.jumpVisualKick = 0;

    _quat.set(rot.x, rot.y, rot.z, rot.w);
    _tempEuler.setFromQuaternion(_quat, 'YXZ');
    _yawEuler.set(0, _tempEuler.y, 0);
    _quat.setFromEuler(_yawEuler);

    const basePos = new THREE.Vector3(pos.x, pos.y, pos.z);
    const exitY = basePos.y + CAR_EXIT_CAPSULE_CLEARANCE;
    const transformedCandidates = _exitCandidates.map((candidate) =>
      candidate.clone().applyQuaternion(_quat).add(basePos).setY(exitY),
    );
    const projectedCandidates = transformedCandidates.map((candidate) =>
      this.projectExitCandidateToGround(candidate, exitY),
    );
    return {
      position: pickFirstClearCarExitCandidate(
        projectedCandidates,
        (candidate) => this.isExitCandidateClear(candidate),
      ),
    };
  }

  resetToSpawn(): void {
    this.input = null;
    this.speed = 0;
    this.steerAngle = 0;
    this.braking = false;
    this.contactWheelCount = 0;
    this.groundedWheelCount = 0;
    this.frontGroundedWheelCount = 0;
    this.rearGroundedWheelCount = 0;
    this.groundedTraction = 0;
    this.hopCooldown = 0;
    this.groundedGraceRemaining = 0;
    this.landingRecoveryRemaining = 0;
    this.jumpVisualKick = 0;
    this.suspensionOffset = 0;
    this.averageSuspensionCompression = 0;
    this.averageSuspensionForce = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.lastDriveImpulseMagnitude = 0;
    this.lastContactPushImpulse = 0;
    this.lastContactPushCarDrag = 0;
    this.activeContactPushBodies = 0;
    this.visualRoll = 0;
    this.visualPitch = 0;
    this.headingYaw = 0;
    this.lastDriveCommand = { ...DEFAULT_CAR_DRIVE_COMMAND };
    this.hasPose = false;
    this.wheelContactNormalY.fill(1);
    this.wheelGroundKinds.fill(null);

    this.body.setTranslation(_setCRV(_rv3A, this.spawnPosition.x, this.spawnPosition.y, this.spawnPosition.z), true);
    this.body.setRotation(toRapierQuat(this.spawnQuaternion), true);
    this.body.setDominanceGroup(VEHICLE_DOMINANCE_GROUP);
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
      input?.jump ?? false,
      input?.sprint ?? false,
      dt,
    );
    this.lastDriveCommand = { ...command };
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

    const groundedNow = this.groundedWheelCount >= 2;
    this.applyArcadeDriveAssists(dt, input, groundedNow);
    this.applyContactPushAssist(dt, input, groundedNow);
    this.updateArcadeMotionState();
    this.speed = this.forwardSpeed;

    if (groundedNow) {
      this.groundedGraceRemaining = CAR_TUNING.jumpCoyoteSeconds;
      if (!wasGrounded) {
        this.landingRecoveryRemaining = CAR_TUNING.landingRecoverySeconds;
      }
    }

    if (input?.crouchPressed && canCarJump(this.groundedWheelCount, this.groundedGraceRemaining, this.hopCooldown)) {
      this.body.applyImpulse(_setCRV(_rv3A, 0, this.body.mass() * CAR_TUNING.jumpVelocity, 0), true);
      this.body.wakeUp();
      this.hopCooldown = CAR_TUNING.jumpCooldownSeconds;
      this.groundedGraceRemaining = 0;
      this.landingRecoveryRemaining = 0;
      this.jumpVisualKick = 1;
    }

    this.applyUprightAssist(dt, groundedNow);
    this.updateDamping();
    this.recordSteeringDebugSample(dt, input, command);
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
    contactWheelCount: number;
    groundedWheelCount: number;
    frontGroundedWheelCount: number;
    rearGroundedWheelCount: number;
    groundedTraction: number;
    wheelGroundHandles: readonly (number | null)[];
    wheelGroundKinds: readonly (string | null)[];
    wheelContactNormalY: readonly number[];
    wheelSuspensionLengths: readonly number[];
    wheelForwardImpulses: readonly number[];
    wheelSideImpulses: readonly number[];
    wheelSuspensionForces: readonly number[];
    averageSuspensionCompression: number;
    averageSuspensionForce: number;
    suspensionOffset: number;
    verticalVelocity: number;
    forwardSpeed: number;
    lateralSpeed: number;
    steerAngle: number;
    headingYaw: number;
    yawRate: number;
    driveImpulseMagnitude: number;
    contactPushImpulse: number;
    contactPushCarDrag: number;
    activeContactPushBodies: number;
    lastDriveCommand: CarDriveCommand;
    rideGeometry: Pick<CarRideGeometry, 'nominalChassisClearance' | 'chassisBottomY' | 'nominalGroundPlaneY'>;
  } {
    const linvel = this.body.linvel();
    return {
      contactWheelCount: this.contactWheelCount,
      groundedWheelCount: this.groundedWheelCount,
      frontGroundedWheelCount: this.frontGroundedWheelCount,
      rearGroundedWheelCount: this.rearGroundedWheelCount,
      groundedTraction: this.groundedTraction,
      wheelGroundHandles: [...this.wheelGroundHandles],
      wheelGroundKinds: [...this.wheelGroundKinds],
      wheelContactNormalY: [...this.wheelContactNormalY],
      wheelSuspensionLengths: [...this.wheelSuspensionLengths],
      wheelForwardImpulses: [...this.wheelForwardImpulses],
      wheelSideImpulses: [...this.wheelSideImpulses],
      wheelSuspensionForces: [...this.wheelSuspensionForces],
      averageSuspensionCompression: this.averageSuspensionCompression,
      averageSuspensionForce: this.averageSuspensionForce,
      suspensionOffset: this.suspensionOffset,
      verticalVelocity: linvel.y,
      forwardSpeed: this.forwardSpeed,
      lateralSpeed: this.lateralSpeed,
      steerAngle: this.steerAngle,
      headingYaw: this.headingYaw,
      yawRate: this.body.angvel().y,
      driveImpulseMagnitude: this.lastDriveImpulseMagnitude,
      contactPushImpulse: this.lastContactPushImpulse,
      contactPushCarDrag: this.lastContactPushCarDrag,
      activeContactPushBodies: this.activeContactPushBodies,
      lastDriveCommand: { ...this.lastDriveCommand },
      rideGeometry: {
        nominalChassisClearance: this.rideGeometry.nominalChassisClearance,
        chassisBottomY: this.rideGeometry.chassisBottomY,
        nominalGroundPlaneY: this.rideGeometry.nominalGroundPlaneY,
      },
    };
  }

  enableSteeringDebugTrace(options?: { capacity?: number; autoLog?: boolean; label?: string | null }): CarSteeringDebugTrace {
    this.steeringDebugEnabled = true;
    this.steeringDebugAutoLog = options?.autoLog ?? false;
    this.steeringDebugCapacity = THREE.MathUtils.clamp(
      Math.floor(options?.capacity ?? DEFAULT_STEERING_DEBUG_TRACE_CAPACITY),
      30,
      2400,
    );
    this.steeringDebugIncidentCapacity = computeSteeringDebugIncidentCapacity(this.steeringDebugCapacity);
    this.steeringDebugLabel = options?.label?.trim() || this.id;
    this.clearSteeringDebugTrace();
    return this.getSteeringDebugTrace();
  }

  disableSteeringDebugTrace(): CarSteeringDebugTrace {
    this.steeringDebugEnabled = false;
    return this.getSteeringDebugTrace();
  }

  clearSteeringDebugTrace(): void {
    this.steeringDebugTrace = [];
    this.steeringDebugIncidentSamples = [];
    this.steeringDebugFrame = 0;
    this.steeringDebugTimeSeconds = 0;
    this.steeringDebugIncidentCount = 0;
    this.lastSteeringDebugLogFrame = Number.NEGATIVE_INFINITY;
  }

  getSteeringDebugTrace(): CarSteeringDebugTrace {
    return {
      enabled: this.steeringDebugEnabled,
      autoLog: this.steeringDebugAutoLog,
      label: this.steeringDebugLabel,
      capacity: this.steeringDebugCapacity,
      sampleCount: this.steeringDebugTrace.length,
      incidentSampleCapacity: this.steeringDebugIncidentCapacity,
      incidentSampleCount: this.steeringDebugIncidentSamples.length,
      incidentCount: this.steeringDebugIncidentCount,
      samples: this.steeringDebugTrace.map(cloneCarSteeringDebugSample),
      incidentSamples: this.steeringDebugIncidentSamples.map(cloneCarSteeringDebugSample),
    };
  }

  dumpSteeringDebugTrace(): CarSteeringDebugTrace {
    const trace = this.getSteeringDebugTrace();
    console.groupCollapsed(
      `[CarSteeringDebug:${trace.label}] samples=${trace.sampleCount} incidents=${trace.incidentCount} retainedIncidents=${trace.incidentSampleCount}`,
    );
    console.log(trace);
    console.table(trace.samples.map((sample) => ({
      frame: sample.frame,
      t: Number(sample.timeSeconds.toFixed(3)),
      moveX: sample.input.moveX,
      moveY: sample.input.moveY,
      forwardSpeed: Number(sample.state.forwardSpeed.toFixed(3)),
      lateralSpeed: Number(sample.state.lateralSpeed.toFixed(3)),
      yawRate: Number(sample.state.yawRate.toFixed(3)),
      steerAngle: Number(sample.command.physicsSteerAngle.toFixed(3)),
      grounded: sample.state.groundedWheelCount,
      contact: sample.state.contactWheelCount,
      traction: Number(sample.state.groundedTraction.toFixed(3)),
      suspectedForwardSteerLoss: sample.derived.suspectedForwardSteerLoss,
    })));
    if (trace.incidentSamples.length > 0) {
      console.table(trace.incidentSamples.map((sample) => ({
        frame: sample.frame,
        t: Number(sample.timeSeconds.toFixed(3)),
        moveX: sample.input.moveX,
        moveY: sample.input.moveY,
        forwardSpeed: Number(sample.state.forwardSpeed.toFixed(3)),
        lateralSpeed: Number(sample.state.lateralSpeed.toFixed(3)),
        yawRate: Number(sample.state.yawRate.toFixed(3)),
        grounded: sample.state.groundedWheelCount,
        frontGrounded: sample.state.frontGroundedWheelCount,
        rearGrounded: sample.state.rearGroundedWheelCount,
      })));
    }
    console.groupEnd();
    return trace;
  }

  private readonly wheelQueryFilterPredicate = (collider: RAPIER.Collider): boolean => {
    const parent = collider.parent();
    const excludedBody =
      parent !== null &&
      this.wheelQueryExcludedBody !== null &&
      parent.handle === this.wheelQueryExcludedBody.handle;
    return isCarWheelQueryCandidate(
      collider.isSensor(),
      getRigidBodyKind(parent),
      parent?.bodyType() ?? null,
      excludedBody,
    );
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
    let totalSuspensionForce = 0;
    let contactCount = 0;
    let groundedCount = 0;
    let frontGroundedCount = 0;
    let rearGroundedCount = 0;
    this.averageGroundNormal.set(0, 0, 0);

    for (let i = 0; i < this.wheelVisualBaseCenters.length; i++) {
      const contact = this.vehicleController.wheelIsInContact(i);
      this.wheelInContact[i] = contact;
      const groundBody = this.vehicleController.wheelGroundObject(i);
      this.wheelGroundHandles[i] = groundBody?.handle ?? null;
      this.wheelGroundKinds[i] = getRigidBodyKind(groundBody);
      if (contact) {
        contactCount++;
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
      this.wheelForwardImpulses[i] = this.vehicleController.wheelForwardImpulse(i) ?? 0;
      this.wheelSideImpulses[i] = this.vehicleController.wheelSideImpulse(i) ?? 0;
      this.wheelSuspensionForces[i] = this.vehicleController.wheelSuspensionForce(i) ?? 0;
      totalSuspensionForce += this.wheelSuspensionForces[i];

      const contactNormal = this.vehicleController.wheelContactNormal(i);
      this.wheelContactNormalY[i] = contactNormal?.y ?? 0;
      if (isCarWheelSupportingContact(contact, contactNormal?.y ?? 0, this.wheelSuspensionForces[i])) {
        groundedCount++;
        if (i < 2) {
          frontGroundedCount++;
        } else {
          rearGroundedCount++;
        }
        if (contactNormal) {
          this.averageGroundNormal.add(_chassisUp.set(contactNormal.x, contactNormal.y, contactNormal.z));
        }
      }
    }

    this.contactWheelCount = contactCount;
    this.groundedWheelCount = groundedCount;
    this.frontGroundedWheelCount = frontGroundedCount;
    this.rearGroundedWheelCount = rearGroundedCount;
    if (groundedCount > 0 && this.averageGroundNormal.lengthSq() > 0.0001) {
      this.averageGroundNormal.normalize();
    } else {
      this.averageGroundNormal.set(0, 1, 0);
    }

    const avgWheelCompression = avgCompression / this.wheelVisualBaseCenters.length;
    this.averageSuspensionCompression = avgWheelCompression;
    this.averageSuspensionForce = totalSuspensionForce / this.wheelVisualBaseCenters.length;
    this.groundedTraction = groundedCount > 0
      ? THREE.MathUtils.clamp(totalSuspensionForce / Math.max(1, this.body.mass() * 9.81), 0, 1)
      : 0;
    this.suspensionOffset = THREE.MathUtils.damp(this.suspensionOffset, avgWheelCompression * 0.06, 12, dt);
    this.updateArcadeMotionState();
  }

  private updateArcadeMotionState(): void {
    const rot = this.body.rotation();
    _quat.set(rot.x, rot.y, rot.z, rot.w);
    _tempEuler.setFromQuaternion(_quat, 'YXZ');
    this.headingYaw = _tempEuler.y;
    _carForward.set(0, 0, -1).applyQuaternion(_quat).setY(0);
    if (_carForward.lengthSq() <= 0.0001) {
      _carForward.set(0, 0, -1);
    } else {
      _carForward.normalize();
    }
    _carRight.set(1, 0, 0).applyQuaternion(_quat).setY(0);
    if (_carRight.lengthSq() <= 0.0001) {
      _carRight.set(1, 0, 0);
    } else {
      _carRight.normalize();
    }

    const linvel = this.body.linvel();
    _carVelocity.set(linvel.x, 0, linvel.z);
    this.forwardSpeed = _carVelocity.dot(_carForward);
    this.lateralSpeed = _carVelocity.dot(_carRight);
  }

  private applyArcadeDriveAssists(dt: number, input: InputState | null, grounded: boolean): void {
    const throttle = input?.moveY ?? 0;
    const steerInput = input?.moveX ?? 0;
    const handbrake = input?.jump ?? false;
    const boosting = input?.sprint ?? false;
    const tractionScale = grounded ? Math.max(0.35, this.groundedTraction) : CAR_TUNING.airEngineMultiplier;
    const driveSpeedDelta =
      computeCarDriveSpeedDelta(throttle, this.forwardSpeed, grounded, boosting, dt) * tractionScale;
    const appliedDriveImpulseMagnitude = Math.abs(this.body.mass() * driveSpeedDelta);
    const requestedDriveAccel = throttle > 0.01
      ? (boosting ? CAR_TUNING.driveAssistBoostAccel : CAR_TUNING.driveAssistForwardAccel) * throttle
      : throttle < -0.01
        ? CAR_TUNING.driveAssistReverseAccel * Math.abs(throttle)
        : 0;
    const driveIntentImpulseMagnitude = this.body.mass() * requestedDriveAccel * tractionScale * dt;
    const wheelDriveImpulseMagnitude = this.wheelForwardImpulses.reduce(
      (sum, impulse) => sum + Math.max(0, -impulse),
      0,
    );
    this.lastDriveImpulseMagnitude = Math.max(
      0,
      appliedDriveImpulseMagnitude,
      driveIntentImpulseMagnitude,
      wheelDriveImpulseMagnitude,
    );

    if (Math.abs(driveSpeedDelta) > 0.0001) {
      this.body.applyImpulse(
        _setCRV(
          _rv3A,
          _carForward.x * this.body.mass() * driveSpeedDelta,
          0,
          _carForward.z * this.body.mass() * driveSpeedDelta,
        ),
        true,
      );
    }

    const lateralDelta = computeCarLateralGripDelta(this.lateralSpeed, grounded, handbrake, dt) * tractionScale;
    if (Math.abs(lateralDelta) > 0.0001) {
      this.body.applyImpulse(
        _setCRV(
          _rv3A,
          _carRight.x * this.body.mass() * lateralDelta,
          0,
          _carRight.z * this.body.mass() * lateralDelta,
        ),
        true,
      );
    }

    const speedNorm = THREE.MathUtils.clamp(Math.abs(this.forwardSpeed) / CAR_TUNING.maxBoostSpeed, 0, 1);
    const yawAssistAuthority = computeCarYawAssistAuthority(
      this.groundedWheelCount,
      this.frontGroundedWheelCount,
      this.rearGroundedWheelCount,
    );
    const yawDirectionSign = computeCarYawDirectionSign(steerInput, this.forwardSpeed);
    if (Math.abs(steerInput) > 0.01 && yawAssistAuthority > 0 && yawDirectionSign !== 0 && (grounded || speedNorm > 0.1)) {
      const targetYawRate =
        Math.abs(steerInput)
        * yawDirectionSign
        * yawAssistAuthority
        * THREE.MathUtils.lerp(
          0.55,
          handbrake ? CAR_TUNING.driveAssistHandbrakeYawRate : CAR_TUNING.driveAssistYawRate,
          speedNorm,
        );
      const currentYawRate = this.body.angvel().y;
      const nextYawRate = THREE.MathUtils.damp(currentYawRate, targetYawRate, CAR_TUNING.driveAssistYawResponse, dt);
      const yawRateDelta = nextYawRate - currentYawRate;
      if (Math.abs(yawRateDelta) > 0.0001) {
        this.body.applyTorqueImpulse(
          _setCRV(_rv3B, 0, yawRateDelta * this.body.mass() * CAR_TUNING.driveAssistYawTorqueScale, 0),
          true,
        );
      }
    }
  }

  private applyContactPushAssist(dt: number, input: InputState | null, grounded: boolean): void {
    this.lastContactPushImpulse = 0;
    this.lastContactPushCarDrag = 0;
    this.activeContactPushBodies = 0;

    if (!input || input.moveY <= 0.05) return;
    if (!grounded || this.groundedWheelCount < CAR_TUNING.contactPushMinGroundedWheels) return;

    const carLinvel = this.body.linvel();
    if (Math.abs(carLinvel.y) > CAR_TUNING.contactPushMaxVerticalSpeed) return;

    const carTranslation = this.body.translation();
    this.physicsWorld.world.contactPairsWith(this.chassisCollider, (otherCollider) => {
      const otherBody = otherCollider.parent();
      if (!otherBody || otherBody.handle === this.body.handle) return;
      if (otherBody.bodyType() !== RAPIER.RigidBodyType.Dynamic) return;

      const otherKind = getRigidBodyKind(otherBody);
      if (
        otherKind === 'vehicle'
        || otherKind === 'player'
        || otherKind === 'throwable'
        || otherKind === 'floating-platform'
      ) return;

      let frontContacts = 0;
      let bestAlignment = 0;
      _contactPointSum.set(0, 0, 0);

      this.physicsWorld.world.contactPair(this.chassisCollider, otherCollider, (manifold) => {
        const solverContacts = manifold.numSolverContacts();
        for (let i = 0; i < solverContacts; i++) {
          const solverPoint = manifold.solverContactPoint(i);
          _contactPoint.set(solverPoint.x, solverPoint.y, solverPoint.z);
          _impactDirection
            .set(_contactPoint.x - carTranslation.x, 0, _contactPoint.z - carTranslation.z);

          if (_impactDirection.lengthSq() <= 0.0001) {
            _impactDirection.copy(_carForward);
          } else {
            _impactDirection.normalize();
          }

          const forwardAlignment = _carForward.dot(_impactDirection);
          if (forwardAlignment < CAR_TUNING.contactPushMinForwardAlignment) continue;

          frontContacts++;
          bestAlignment = Math.max(bestAlignment, forwardAlignment);
          _contactPointSum.add(_contactPoint);
        }
      });

      if (frontContacts === 0) return;

      _contactPointSum.multiplyScalar(1 / frontContacts);
      const otherLinvel = otherBody.linvel();
      const otherTranslation = otherBody.translation();
      _otherVelocity.set(otherLinvel.x, 0, otherLinvel.z);
      const closingSpeed = this.forwardSpeed - _otherVelocity.dot(_carForward);
      const impulseMagnitude = computeCarContactPushImpulse(
        this.lastDriveImpulseMagnitude,
        closingSpeed,
        otherBody.mass(),
        dt,
      );
      if (impulseMagnitude <= 0) return;

      const alignmentScale = THREE.MathUtils.lerp(
        0.72,
        1,
        THREE.MathUtils.clamp(
          (bestAlignment - CAR_TUNING.contactPushMinForwardAlignment)
            / Math.max(0.001, 1 - CAR_TUNING.contactPushMinForwardAlignment),
          0,
          1,
        ),
      );
      const resolvedImpulse = impulseMagnitude * alignmentScale;
      otherBody.applyImpulseAtPoint(
        _setCRV(
          _rv3A,
          _carForward.x * resolvedImpulse,
          0,
          _carForward.z * resolvedImpulse,
        ),
        _setCRV(
          _rv3B,
          _contactPointSum.x,
          THREE.MathUtils.lerp(_contactPointSum.y, otherTranslation.y, CAR_TUNING.contactPushCarryHeightBlend),
          _contactPointSum.z,
        ),
        true,
      );
      const carDragImpulse = resolvedImpulse
        * CAR_TUNING.contactPushCarDragScale
        * THREE.MathUtils.clamp(otherBody.mass() / Math.max(0.001, otherBody.mass() + this.body.mass()), 0.38, 0.72);
      if (carDragImpulse > 0) {
        this.body.applyImpulse(
          _setCRV(
            _rv3A,
            -_carForward.x * carDragImpulse,
            0,
            -_carForward.z * carDragImpulse,
          ),
          true,
        );
        const angvel = this.body.angvel();
        this.body.setAngvel(
          _setCRV(_rv3B, angvel.x * 0.72, angvel.y, angvel.z * 0.72),
          true,
        );
        this.lastContactPushCarDrag += carDragImpulse;
      }
      this.lastContactPushImpulse += resolvedImpulse;
      this.activeContactPushBodies += 1;
    });
  }

  private recordSteeringDebugSample(dt: number, input: InputState | null, command: CarDriveCommand): void {
    this.steeringDebugFrame += 1;
    this.steeringDebugTimeSeconds += dt;
    if (!this.steeringDebugEnabled) return;

    const moveX = input?.moveX ?? 0;
    const moveY = input?.moveY ?? 0;
    const yawRate = this.body.angvel().y;
    const verticalVelocity = this.body.linvel().y;
    const driveMode: 'forward' | 'reverse' | 'coast' = moveY > 0.1 ? 'forward' : moveY < -0.1 ? 'reverse' : 'coast';
    const expectedYawSign =
      Math.abs(moveX) > 0.15 && Math.abs(this.forwardSpeed) > 0.8
        ? computeCarYawDirectionSign(moveX, this.forwardSpeed)
        : 0;
    const actualYawSign = Math.abs(yawRate) > 0.08 ? Math.sign(yawRate) : 0;
    const yawAgreement = expectedYawSign === 0 || actualYawSign === 0 || expectedYawSign === actualYawSign;
    const steeringEffectiveness =
      Math.abs(command.physicsSteerAngle) > 0.001
        ? Math.abs(yawRate) / Math.abs(command.physicsSteerAngle)
        : 0;
    const suspectedForwardSteerLoss =
      moveY > 0.35
      && Math.abs(moveX) > 0.35
      && this.forwardSpeed > 2
      && this.groundedWheelCount >= 2
      && (!yawAgreement || (Math.abs(yawRate) < 0.18 && Math.abs(this.lateralSpeed) < 0.3));

    const sample: CarSteeringDebugSample = {
      frame: this.steeringDebugFrame,
      timeSeconds: this.steeringDebugTimeSeconds,
      input: {
        moveX,
        moveY,
        sprint: input?.sprint ?? false,
        jump: input?.jump ?? false,
      },
      command: { ...command },
      state: {
        contactWheelCount: this.contactWheelCount,
        groundedWheelCount: this.groundedWheelCount,
        frontGroundedWheelCount: this.frontGroundedWheelCount,
        rearGroundedWheelCount: this.rearGroundedWheelCount,
        groundedTraction: this.groundedTraction,
        averageSuspensionCompression: this.averageSuspensionCompression,
        averageSuspensionForce: this.averageSuspensionForce,
        verticalVelocity,
        forwardSpeed: this.forwardSpeed,
        lateralSpeed: this.lateralSpeed,
        steerAngle: this.steerAngle,
        headingYaw: this.headingYaw,
        yawRate,
        driveImpulseMagnitude: this.lastDriveImpulseMagnitude,
        contactPushImpulse: this.lastContactPushImpulse,
        contactPushCarDrag: this.lastContactPushCarDrag,
        activeContactPushBodies: this.activeContactPushBodies,
      },
      wheels: {
        inContact: [...this.wheelInContact],
        contactNormalY: [...this.wheelContactNormalY],
        groundKinds: [...this.wheelGroundKinds],
        suspensionLengths: [...this.wheelSuspensionLengths],
        suspensionForces: [...this.wheelSuspensionForces],
        forwardImpulses: [...this.wheelForwardImpulses],
        sideImpulses: [...this.wheelSideImpulses],
      },
      derived: {
        driveMode,
        expectedYawSign,
        actualYawSign,
        yawAgreement,
        steeringEffectiveness,
        suspectedForwardSteerLoss,
      },
    };

    this.steeringDebugTrace.push(sample);
    if (this.steeringDebugTrace.length > this.steeringDebugCapacity) {
      this.steeringDebugTrace.splice(0, this.steeringDebugTrace.length - this.steeringDebugCapacity);
    }

    if (!suspectedForwardSteerLoss) return;
    this.steeringDebugIncidentCount += 1;
    this.steeringDebugIncidentSamples.push(sample);
    if (this.steeringDebugIncidentSamples.length > this.steeringDebugIncidentCapacity) {
      this.steeringDebugIncidentSamples.splice(
        0,
        this.steeringDebugIncidentSamples.length - this.steeringDebugIncidentCapacity,
      );
    }
    if (
      !this.steeringDebugAutoLog
      || this.steeringDebugFrame - this.lastSteeringDebugLogFrame < STEERING_DEBUG_AUTO_LOG_INTERVAL_FRAMES
    ) return;
    this.lastSteeringDebugLogFrame = this.steeringDebugFrame;
    console.warn(`[CarSteeringDebug:${this.steeringDebugLabel}] suspected forward steering loss`, {
      frame: sample.frame,
      retainedIncidentSamples: this.steeringDebugIncidentSamples.length,
      incidentCount: this.steeringDebugIncidentCount,
      moveX: sample.input.moveX,
      moveY: sample.input.moveY,
      forwardSpeed: sample.state.forwardSpeed,
      lateralSpeed: sample.state.lateralSpeed,
      yawRate: sample.state.yawRate,
      groundedWheelCount: sample.state.groundedWheelCount,
      frontGroundedWheelCount: sample.state.frontGroundedWheelCount,
      rearGroundedWheelCount: sample.state.rearGroundedWheelCount,
      groundedTraction: sample.state.groundedTraction,
    });
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

    let contactCount = 0;
    let groundedCount = 0;
    let frontGroundedCount = 0;
    let rearGroundedCount = 0;
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
        contactCount++;
        const suspensionLength = Math.max(0, rayHit.timeOfImpact - this.rideGeometry.wheelRadius);
        this.wheelSuspensionLengths[i] = suspensionLength;
        this.wheelInContact[i] = true;
        this.wheelContactNormalY[i] = 0;
        this.wheelGroundKinds[i] = null;
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
          this.wheelContactNormalY[i] = normalHit.normal.y;
          if (normalHit.normal.y >= CAR_TUNING.supportMinNormalY) {
            groundedCount++;
            if (i < 2) {
              frontGroundedCount++;
            } else {
              rearGroundedCount++;
            }
            this.averageGroundNormal.add(_chassisUp.set(normalHit.normal.x, normalHit.normal.y, normalHit.normal.z));
          }
        }
      } else {
        this.wheelSuspensionLengths[i] = Math.min(
          this.rideGeometry.suspensionRestLength + this.rideGeometry.suspensionMaxTravel,
          this.rideGeometry.suspensionRestLength + CAR_TUNING.wheelVisualDropMax,
        );
        this.wheelInContact[i] = false;
        this.wheelContactNormalY[i] = 0;
        this.wheelGroundKinds[i] = null;
      }
    }

    this.contactWheelCount = contactCount;
    this.groundedWheelCount = groundedCount;
    this.frontGroundedWheelCount = frontGroundedCount;
    this.rearGroundedWheelCount = rearGroundedCount;
    if (groundedCount > 0 && this.averageGroundNormal.lengthSq() > 0.0001) {
      this.averageGroundNormal.normalize();
      this.suspensionOffset = (avgCompression / this.wheelVisuals.length) * 0.08;
    } else {
      this.averageGroundNormal.set(0, 1, 0);
      this.suspensionOffset = 0;
    }
    this.updateArcadeMotionState();
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

  private projectExitCandidateToGround(candidate: THREE.Vector3, fallbackY: number): THREE.Vector3 {
    const projected = candidate.clone();
    const groundHit = this.physicsWorld.castRay(
      _setCRV(
        _rv3A,
        candidate.x,
        candidate.y + CAR_EXIT_GROUND_PROBE_RAY_HEIGHT,
        candidate.z,
      ),
      _setCRV(_rv3B, 0, -1, 0),
      CAR_EXIT_GROUND_PROBE_MAX_TOI,
      undefined,
      this.body,
      (collider) => !collider.isSensor(),
    );

    if (!groundHit) {
      projected.y = fallbackY;
      return projected;
    }

    projected.y =
      candidate.y + CAR_EXIT_GROUND_PROBE_RAY_HEIGHT - groundHit.timeOfImpact + CAR_EXIT_CAPSULE_CLEARANCE;
    return projected;
  }
}
