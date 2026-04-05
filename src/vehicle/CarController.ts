import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { InputState, SpawnPointData } from '@core/types';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { toRapierQuat } from '@physics/PhysicsHelpers';
import { COLLISION_GROUP_VEHICLE } from '@core/constants';
import type { VehicleController } from './VehicleController';

const _forward = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _yAxisUp = new THREE.Vector3(0, 1, 0);
const _yawEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _wheelWorldPos = new THREE.Vector3();
const _carRight = new THREE.Vector3();
const _carGroundNormal = new THREE.Vector3(0, 1, 0);
const _carGroundNormalSum = new THREE.Vector3();
const _driveDirection = new THREE.Vector3();
const _exitProbe = new THREE.Vector3();
const _exitCandidates = [
  new THREE.Vector3(-1.5, 0, 0),   // driver side (left)
  new THREE.Vector3( 1.5, 0, 0),   // passenger side (right)
  new THREE.Vector3( 0,   0, 2.5), // rear
];

const _crv3A = new RAPIER.Vector3(0, 0, 0);
const _crv3B = new RAPIER.Vector3(0, 0, 0);

function _setCRV(v: RAPIER.Vector3, x: number, y: number, z: number): RAPIER.Vector3 {
  v.x = x; v.y = y; v.z = z;
  return v;
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

  private input: InputState | null = null;
  private speed = 0;
  private yaw = 0;
  private steerAngle = 0;
  private hasPose = false;
  // Per-instance interpolation buffers (module-scope would be shared across instances).
  private readonly _prevPos = new THREE.Vector3();
  private readonly _currPos = new THREE.Vector3();
  private readonly _prevQuat = new THREE.Quaternion();
  private readonly _currQuat = new THREE.Quaternion();
  /** Steer pivot groups for front wheels (rotation.y = steerAngle). */
  private frontWheelSteers: THREE.Object3D[] = [];
  /** Spin groups inside front steer pivots (rotation.x += roll). */
  private frontWheelSpins: THREE.Object3D[] = [];
  /** Spin groups for rear wheels (rotation.x += roll). */
  private rearWheelSpins: THREE.Object3D[] = [];
  private cabinMesh: THREE.Object3D | null = null;

  private visualRoll = 0;
  private suspensionOffset = 0;
  private lateralSlip = 0;
  private simTime = 0;
  private taillightMeshes: THREE.Mesh[] = [];
  private braking = false;
  private groundedWheelCount = 0;
  private hopCooldown = 0;
  private readonly averageGroundNormal = new THREE.Vector3(0, 1, 0);
  private readonly spawnPosition = new THREE.Vector3();
  private readonly spawnQuaternion = new THREE.Quaternion();

  private readonly acceleration = 40;
  private readonly drag = 4;
  private readonly hopCooldownSeconds = 0.6;
  private readonly hopVelocity = 3.2;
  private readonly maxSteerAngle = Math.PI / 5;
  private readonly steerSpeed = 12;
  private readonly wheelRadius = 0.32;

  // 4-wheel suspension
  private readonly wheelOffsetPositions = [
    new THREE.Vector3( 1.1, 0.32, -1.5),  // front-right
    new THREE.Vector3(-1.1, 0.32, -1.5),  // front-left
    new THREE.Vector3( 1.1, 0.32,  1.5),  // rear-right
    new THREE.Vector3(-1.1, 0.32,  1.5),  // rear-left
  ];
  private readonly suspensionRestLength = 0.6;
  // Suspension K/C computed from body mass at construction time
  private suspensionStiffness = 18;
  private suspensionDamping = 3.5;
  private readonly wheelCompressions = [0, 0, 0, 0];

  // Per-axle lateral grip rates (front maintains grip during handbrake for steering)
  private readonly frontGripNormal = 15;
  private readonly frontGripHandbrake = 12;
  private readonly rearGripNormal = 13;
  private readonly rearGripHandbrake = 2.5;

  constructor(
    id: string,
    position: THREE.Vector3,
    private physicsWorld: PhysicsWorld,
    private scene: THREE.Scene,
  ) {
    this.id = id;
    this.spawnPosition.copy(position);
    this.spawnQuaternion.identity();

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z);
    this.body = this.physicsWorld.world.createRigidBody(bodyDesc);
    this.body.userData = { kind: 'vehicle' };
    this.body.enableCcd(true);
    // Lock X/Z rotations so the car stays upright; we control yaw visually & via angvel.
    this.body.setEnabledRotations(false, true, false, true);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(1.15, 0.2, 2.0)
      .setTranslation(0, 0.28, 0) // Align with chassis visual center
      .setFriction(0.0) // Manage our own lateral grip
      .setRestitution(0.1)
      .setCollisionGroups(COLLISION_GROUP_VEHICLE);
    this.physicsWorld.world.createCollider(colliderDesc, this.body);

    // Compute mass-normalized suspension constants from actual body mass.
    // Each wheel carries ~25% of the vehicle mass.
    const totalMass = this.body.mass();
    const sprungMass = totalMass / 4;
    const g = 9.81;
    // k = force needed to support sprung mass at rest at mid-travel (half rest length)
    this.suspensionStiffness = (sprungMass * g) / (this.suspensionRestLength * 0.5);
    // c = damping ratio * critical damping: ζ * 2 * sqrt(k * m), ζ=0.9 for sporty feel
    this.suspensionDamping = 0.9 * 2 * Math.sqrt(this.suspensionStiffness * sprungMass);

    this.mesh = this.createCarMesh();
    this.mesh.position.copy(position);
    this.scene.add(this.mesh);
    this.prewarmSuspensionPose();
  }

  enter(_input: InputState): void {
    this.input = _input;
    const rot = this.body.rotation();
    _quat.set(rot.x, rot.y, rot.z, rot.w);
    _tempEuler.setFromQuaternion(_quat, 'YXZ');
    this.yaw = _tempEuler.y;
    this.prewarmSuspensionPose();
  }

  exit(): SpawnPointData {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    // Clear driving state so the parked car coasts to a stop.
    this.input = null;
    this.speed = 0;
    this.steerAngle = 0;
    this.lateralSlip = 0;
    this.body.setLinvel(_setCRV(_crv3A, 0, 0, 0), true);
    this.body.setAngvel(_setCRV(_crv3B, 0, 0, 0), true);
    _quat.set(rot.x, rot.y, rot.z, rot.w);
    const basePos = new THREE.Vector3(pos.x, pos.y, pos.z);

    // Raise base to top of car so the player doesn't spawn inside the ground.
    // Car collider half-height is 0.2 with Y offset 0.28, so top ≈ 0.48 above body.
    // Add capsule half-height (0.35) + radius (0.3) clearance.
    const exitY = basePos.y + 1.1;

    // Probe multiple exit candidates, pick first clear one
    for (const candidate of _exitCandidates) {
      _exitProbe.copy(candidate).applyQuaternion(_quat).add(basePos);
      _exitProbe.y = exitY;
      const dx = _exitProbe.x - basePos.x;
      const dz = _exitProbe.z - basePos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.001) continue;
      const blocked = this.physicsWorld.castRay(
        _setCRV(_crv3A, basePos.x, basePos.y + 0.5, basePos.z),
        _setCRV(_crv3B, dx / dist, 0, dz / dist),
        dist,
        undefined,
        this.body,
        (c) => !c.isSensor(),
      );
      if (!blocked || blocked.timeOfImpact >= dist - 0.1) {
        return { position: _exitProbe.clone() };
      }
    }
    // Fallback: use first candidate anyway
    _exitProbe.copy(_exitCandidates[0]).applyQuaternion(_quat).add(basePos);
    _exitProbe.y = exitY;
    return { position: _exitProbe.clone() };
  }

  resetToSpawn(): void {
    this.speed = 0;
    this.steerAngle = 0;
    this.lateralSlip = 0;
    this.visualRoll = 0;
    this.suspensionOffset = 0;
    this.braking = false;
    this.groundedWheelCount = 0;
    this.hopCooldown = 0;
    this.yaw = 0;
    this.hasPose = false;

    this.body.setTranslation(_setCRV(_crv3A, this.spawnPosition.x, this.spawnPosition.y, this.spawnPosition.z), true);
    this.body.setRotation(toRapierQuat(this.spawnQuaternion), true);
    this.body.setLinvel(_setCRV(_crv3A, 0, 0, 0), true);
    this.body.setAngvel(_setCRV(_crv3B, 0, 0, 0), true);
    this.body.wakeUp();

    this.mesh.position.copy(this.spawnPosition);
    this.mesh.quaternion.copy(this.spawnQuaternion);
    if (this.cabinMesh) {
      this.cabinMesh.rotation.z = 0;
    }
    this.prewarmSuspensionPose();
  }

  setInput(input: InputState): void {
    this.input = input;
  }

  fixedUpdate(dt: number): void {
    this.simTime += dt;
    this.hopCooldown = Math.max(0, this.hopCooldown - dt);

    const input = this.input;
    const hasInput = input !== null;

    // --- Drive / steer input processing (only when occupied) ---
    if (hasInput) {
      const accelInput = input.moveY;
      const steerInput = input.moveX;
      const boosting = input.sprint;
      const handbrake = input.crouch;

      const maxForward = boosting ? 28 : 22;
      const maxReverse = 14;
      const accelRate = boosting ? 50 : this.acceleration;
      const reverseAccelRate = accelRate * 0.75;
      const coastRate = handbrake ? 30 : this.drag;
      const brakeRate = handbrake ? 60 : 45;

      // Acceleration with proper brake-before-reverse logic.
      if (accelInput > 0) {
        if (this.speed < -0.3) {
          this.speed = THREE.MathUtils.damp(this.speed, 0, brakeRate, dt);
        } else {
          this.speed = THREE.MathUtils.damp(this.speed, maxForward * accelInput, accelRate, dt);
        }
      } else if (accelInput < 0) {
        if (this.speed > 0.3) {
          this.speed = THREE.MathUtils.damp(this.speed, 0, brakeRate, dt);
        } else {
          this.speed = THREE.MathUtils.damp(this.speed, -maxReverse * Math.abs(accelInput), reverseAccelRate, dt);
        }
      } else {
        this.speed = THREE.MathUtils.damp(this.speed, 0, coastRate, dt);
      }

      if (handbrake && accelInput === 0) {
        this.speed = THREE.MathUtils.damp(this.speed, 0, brakeRate, dt);
      }

      // Speed-dependent steering: reduce max steer at high speed
      const speedAbs = Math.abs(this.speed);
      const speedNorm = THREE.MathUtils.clamp(speedAbs / Math.max(0.01, maxForward), 0, 1);
      const steerReduction = 1 - speedNorm * 0.5;
      const effectiveMaxSteer = this.maxSteerAngle * steerReduction;
      const targetSteer = steerInput * effectiveMaxSteer;
      this.steerAngle = THREE.MathUtils.damp(
        this.steerAngle,
        targetSteer,
        handbrake ? this.steerSpeed * 1.4 : this.steerSpeed,
        dt,
      );

      // Forward is -Z in the rest of the project; turn right on D (steerInput=+1).
      // Only rotate when the car is actually moving — no spinning in place.
      if (speedAbs > 0.5) {
        const speedFactor = THREE.MathUtils.clamp(speedAbs / Math.max(0.01, maxForward), 0, 1);
        const steerSign = Math.sign(this.speed);
        const turnRate = (handbrake ? 1.35 : 1.0) * 2.9;
        this.yaw -= this.steerAngle * steerSign * speedFactor * dt * turnRate;
      }
    }

    _yawEuler.set(0, this.yaw, 0);
    _quat.setFromEuler(_yawEuler);

    _forward.set(0, 0, -1).applyAxisAngle(_yAxisUp, this.yaw);
    _carRight.set(1, 0, 0).applyAxisAngle(_yAxisUp, this.yaw);

    // Override the physics rotation with our computed yaw.
    // Zero angular velocity since we fully own the rotation — prevents
    // residual angvel from solver contacts biasing lateral forces.
    this.body.setRotation(toRapierQuat(_quat), true);
    this.body.setAngvel(_setCRV(_crv3A, 0, 0, 0), true);

    const pos = this.body.translation();
    const currentVel = this.body.linvel();

    // --- 4-Wheel Suspension Raycasts (always run to keep parked cars on terrain) ---
    let anyWheelGrounded = false;
    let groundedWheelCount = 0;
    _carGroundNormalSum.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const localPos = this.wheelOffsetPositions[i];
      // Transform wheel position to world space
      _wheelWorldPos.copy(localPos).applyQuaternion(_quat);
      _wheelWorldPos.x += pos.x;
      _wheelWorldPos.y += pos.y;
      _wheelWorldPos.z += pos.z;

      const rayHit = this.physicsWorld.castRay(
        _setCRV(_crv3A, _wheelWorldPos.x, _wheelWorldPos.y, _wheelWorldPos.z),
        _setCRV(_crv3B, 0, -1, 0),
        this.suspensionRestLength + 0.5,
        undefined,
        this.body,
        (c) => !c.isSensor(),
      );

      if (rayHit && rayHit.timeOfImpact < this.suspensionRestLength + 0.3) {
        anyWheelGrounded = true;
        groundedWheelCount++;
        const compression = this.suspensionRestLength - rayHit.timeOfImpact;
        const prevCompression = this.wheelCompressions[i];
        const compressionVelocity = (compression - prevCompression) / dt;
        this.wheelCompressions[i] = compression;

        const normalHit = this.physicsWorld.castRayAndGetNormal(
          _setCRV(_crv3A, _wheelWorldPos.x, _wheelWorldPos.y, _wheelWorldPos.z),
          _setCRV(_crv3B, 0, -1, 0),
          this.suspensionRestLength + 0.5,
          undefined,
          this.body,
        );
        if (normalHit) {
          _carGroundNormalSum.add(_carGroundNormal.set(
            normalHit.normal.x,
            normalHit.normal.y,
            normalHit.normal.z,
          ));
        }

        const springForce = this.suspensionStiffness * compression - this.suspensionDamping * compressionVelocity;
        const impulse = Math.max(0, springForce) * dt;
        this.body.applyImpulseAtPoint(
          _setCRV(_crv3A, 0, impulse, 0),
          _setCRV(_crv3B, _wheelWorldPos.x, _wheelWorldPos.y, _wheelWorldPos.z),
          true,
        );
      } else {
        this.wheelCompressions[i] = 0;
      }
    }
    this.groundedWheelCount = groundedWheelCount;
    if (groundedWheelCount > 0 && _carGroundNormalSum.lengthSq() > 0.0001) {
      this.averageGroundNormal.copy(_carGroundNormalSum.normalize());
    } else {
      this.averageGroundNormal.set(0, 1, 0);
    }

    // --- Per-axle lateral grip with slip-angle based reduction ---
    const handbrake = hasInput && this.input!.crouch;
    const lateralVel = currentVel.x * _carRight.x + currentVel.z * _carRight.z;
    const forwardVel = currentVel.x * _forward.x + currentVel.z * _forward.z;

    // Slip angle: angle between car heading and actual velocity direction.
    // Higher slip = less grip (tire saturation).
    const slipAngle = Math.atan2(Math.abs(lateralVel), Math.abs(forwardVel) + 0.1);
    const slipFactor = slipAngle > 0.14
      ? Math.max(0.3, 1 - (slipAngle - 0.14) * 2)
      : 1;

    // Front axle: maintains grip during handbrake for steering authority
    const frontGripRate = handbrake ? this.frontGripHandbrake : this.frontGripNormal;
    const frontCorrection = (1 - Math.exp(-frontGripRate * dt)) * slipFactor;
    const frontGripImpulse = -lateralVel * frontCorrection * this.body.mass() * 0.5;

    // Rear axle: loses significantly more grip during handbrake for drifting
    const rearGripRate = handbrake ? this.rearGripHandbrake : this.rearGripNormal;
    const rearCorrection = (1 - Math.exp(-rearGripRate * dt)) * slipFactor;
    const rearGripImpulse = -lateralVel * rearCorrection * this.body.mass() * 0.5;

    // Apply combined lateral grip force at center of mass
    const totalGripImpulse = frontGripImpulse + rearGripImpulse;
    this.body.applyImpulse(
      _setCRV(_crv3A, _carRight.x * totalGripImpulse, 0, _carRight.z * totalGripImpulse),
      true,
    );
    // Apply yaw torque from differential front/rear grip (creates rotation during drift)
    // Front axle at -1.5z, rear at +1.5z relative to center of mass
    const axleHalfSpan = 1.5;
    const yawTorque = frontGripImpulse * (-axleHalfSpan) + rearGripImpulse * axleHalfSpan;
    if (Math.abs(yawTorque) > 0.001) {
      this.body.applyTorqueImpulse(_setCRV(_crv3A, 0, yawTorque, 0), true);
    }

    // --- Drive force ---
    if (anyWheelGrounded) {
      _driveDirection.copy(_forward).projectOnPlane(this.averageGroundNormal);
      if (_driveDirection.lengthSq() < 0.0001) {
        _driveDirection.copy(_forward);
      } else {
        _driveDirection.normalize();
      }
      const absImpulse = Math.abs(this.speed) * dt * 2.5;
      const curForwardVel = currentVel.x * _driveDirection.x + currentVel.y * _driveDirection.y + currentVel.z * _driveDirection.z;
      const driveDelta = this.speed - curForwardVel;
      const driveForce = THREE.MathUtils.clamp(driveDelta * 3.0, -absImpulse, absImpulse);
      this.body.applyImpulse(
        _setCRV(_crv3A, _driveDirection.x * driveForce, _driveDirection.y * driveForce, _driveDirection.z * driveForce),
        true,
      );
    } else {
      // Free fall: apply gravity assist
      this.body.applyImpulse(_setCRV(_crv3A, 0, -18.0 * dt, 0), true);
    }

    if (hasInput && input!.jumpPressed && this.groundedWheelCount >= 2 && this.hopCooldown <= 0) {
      this.body.applyImpulse(_setCRV(_crv3A, 0, this.body.mass() * this.hopVelocity, 0), true);
      this.body.wakeUp();
      this.hopCooldown = this.hopCooldownSeconds;
    }

    // Track braking state for taillight juice
    const accelForBrake = hasInput ? input!.moveY : 0;
    this.braking = hasInput && (
      input!.crouch ||
      (accelForBrake < 0 && this.speed > 0.3) ||
      (accelForBrake > 0 && this.speed < -0.3)
    );

    // Lateral drift tracking for visuals
    const handbrakeActive = hasInput && this.input!.crouch;
    const speedAbs = Math.abs(this.speed);
    const maxFwd = hasInput && this.input!.sprint ? 18 : 14;
    const speedNorm = THREE.MathUtils.clamp(speedAbs / Math.max(0.01, maxFwd), 0, 1);
    const driftFactor = handbrakeActive ? 0.08 : 0.02;
    const targetSlip = this.steerAngle * speedNorm * driftFactor * speedAbs;
    this.lateralSlip = THREE.MathUtils.damp(this.lateralSlip, targetSlip, 4.0, dt);

    // Visual body roll (damped toward target).
    const targetRoll = -this.steerAngle * speedNorm * 0.1;
    this.visualRoll = THREE.MathUtils.damp(this.visualRoll, targetRoll, 6.0, dt);

    // Suspension visual offset from average wheel compression
    const avgCompression = (this.wheelCompressions[0] + this.wheelCompressions[1] +
      this.wheelCompressions[2] + this.wheelCompressions[3]) * 0.25;
    this.suspensionOffset = avgCompression * 0.15;

    this.updateWheelVisuals(dt);
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
    if (this.cabinMesh) {
      this.cabinMesh.rotation.z = this.visualRoll;
    }
    // Brake light juice: brighter emissive when braking
    const brakeIntensity = this.braking ? 6.0 : 1.5;
    for (const tl of this.taillightMeshes) {
      (tl.material as THREE.MeshStandardMaterial).emissiveIntensity = brakeIntensity;
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
    this.physicsWorld.removeBody(this.body);
  }

  private createCarMesh(): THREE.Object3D {
    const group = new THREE.Group();
    // Forward is -Z. Headlights at -Z, taillights at +Z.

    // --- Body (single chassis box) ---
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a6878, metalness: 0.5, roughness: 0.35 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 4.0), bodyMat);
    body.position.y = 0.3;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // --- Cabin (visual roll applied here) ---
    const cabin = new THREE.Group();
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, metalness: 0.35, roughness: 0.45 });
    const cabinBox = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 2.0), cabinMat);
    cabinBox.position.set(0, 0.75, 0.2);
    cabinBox.castShadow = true;
    cabin.add(cabinBox);
    group.add(cabin);
    this.cabinMesh = cabin;

    // --- Headlights (front = -Z) ---
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff5e8, emissive: 0xffe8cc, emissiveIntensity: 3.0, roughness: 0.2,
    });
    for (const side of [-0.7, 0.7]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.08), headlightMat);
      hl.position.set(side, 0.35, -2.04);
      group.add(hl);
    }

    // --- Taillights (rear = +Z, glow brighter when braking) ---
    const taillightMat = new THREE.MeshStandardMaterial({
      color: 0xcc2222, emissive: 0xcc2222, emissiveIntensity: 1.5, roughness: 0.2,
    });
    for (const side of [-0.7, 0.7]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.08), taillightMat);
      tl.position.set(side, 0.35, 2.04);
      group.add(tl);
      this.taillightMeshes.push(tl);
    }

    // --- Wheels (tire + rim, 4 total) ---
    const tireGeom = new THREE.CylinderGeometry(this.wheelRadius, this.wheelRadius, 0.22, 16);
    tireGeom.rotateZ(Math.PI / 2);
    const rimGeom = new THREE.CylinderGeometry(this.wheelRadius * 0.55, this.wheelRadius * 0.55, 0.24, 10);
    rimGeom.rotateZ(Math.PI / 2);

    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.2, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.15 });

    this.wheelOffsetPositions.forEach((offset, i) => {
      const isFront = i < 2;
      const spinGroup = new THREE.Group();
      const tire = new THREE.Mesh(tireGeom, tireMat);
      tire.castShadow = true;
      spinGroup.add(tire);
      const rim = new THREE.Mesh(rimGeom, rimMat);
      spinGroup.add(rim);

      if (isFront) {
        const steerPivot = new THREE.Group();
        steerPivot.add(spinGroup);
        steerPivot.position.copy(offset);
        group.add(steerPivot);
        this.frontWheelSteers.push(steerPivot);
        this.frontWheelSpins.push(spinGroup);
      } else {
        spinGroup.position.copy(offset);
        group.add(spinGroup);
        this.rearWheelSpins.push(spinGroup);
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
    _carGroundNormalSum.set(0, 0, 0);

    for (let i = 0; i < 4; i++) {
      const localPos = this.wheelOffsetPositions[i];
      _wheelWorldPos.copy(localPos).applyQuaternion(_quat);
      _wheelWorldPos.x += pos.x;
      _wheelWorldPos.y += pos.y;
      _wheelWorldPos.z += pos.z;

      const rayHit = this.physicsWorld.castRay(
        _setCRV(_crv3A, _wheelWorldPos.x, _wheelWorldPos.y, _wheelWorldPos.z),
        _setCRV(_crv3B, 0, -1, 0),
        this.suspensionRestLength + 0.5,
        undefined,
        this.body,
        (c) => !c.isSensor(),
      );

      if (rayHit && rayHit.timeOfImpact < this.suspensionRestLength + 0.3) {
        groundedCount++;
        const compression = this.suspensionRestLength - rayHit.timeOfImpact;
        this.wheelCompressions[i] = compression;
        avgCompression += compression;

        const normalHit = this.physicsWorld.castRayAndGetNormal(
          _setCRV(_crv3A, _wheelWorldPos.x, _wheelWorldPos.y, _wheelWorldPos.z),
          _setCRV(_crv3B, 0, -1, 0),
          this.suspensionRestLength + 0.5,
          undefined,
          this.body,
        );
        if (normalHit) {
          _carGroundNormalSum.add(_carGroundNormal.set(
            normalHit.normal.x,
            normalHit.normal.y,
            normalHit.normal.z,
          ));
        }
      } else {
        this.wheelCompressions[i] = 0;
      }
    }

    this.groundedWheelCount = groundedCount;
    if (groundedCount > 0) {
      this.suspensionOffset = (avgCompression / groundedCount) * 0.15;
      if (_carGroundNormalSum.lengthSq() > 0.0001) {
        this.averageGroundNormal.copy(_carGroundNormalSum.normalize());
      } else {
        this.averageGroundNormal.set(0, 1, 0);
      }
    } else {
      this.suspensionOffset = 0;
      this.averageGroundNormal.set(0, 1, 0);
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
    if (this.cabinMesh) {
      this.cabinMesh.rotation.z = this.visualRoll;
    }
  }

  private updateWheelVisuals(dt: number): void {
    const roll = (this.speed * dt) / this.wheelRadius;
    // Front: steer on the pivot, spin on the inner group.
    // Negate steerAngle because positive Y rotation is counterclockwise from above,
    // but the wheels should visually turn right when steerAngle is positive.
    for (const steer of this.frontWheelSteers) {
      steer.rotation.y = -this.steerAngle;
    }
    for (const spin of this.frontWheelSpins) {
      spin.rotation.x += roll;
    }
    // Rear: spin only.
    for (const spin of this.rearWheelSpins) {
      spin.rotation.x += roll;
    }
  }
}
