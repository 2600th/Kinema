import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { InputState, SpawnPointData } from '@core/types';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { toRapierQuat } from '@physics/PhysicsHelpers';
import { COLLISION_GROUP_WORLD } from '@core/constants';
import type { VehicleController } from './VehicleController';

const _forward = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _prevPos = new THREE.Vector3();
const _currPos = new THREE.Vector3();
const _prevQuat = new THREE.Quaternion();
const _currQuat = new THREE.Quaternion();
const _lateral = new THREE.Vector3();

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

  private readonly acceleration = 22;
  private readonly drag = 6;
  private readonly maxSteerAngle = Math.PI / 6;
  private readonly steerSpeed = 8;
  private readonly wheelRadius = 0.32;

  constructor(
    id: string,
    position: THREE.Vector3,
    private physicsWorld: PhysicsWorld,
    private scene: THREE.Scene,
  ) {
    this.id = id;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z);
    this.body = this.physicsWorld.world.createRigidBody(bodyDesc);
    this.body.enableCcd(true);
    // Lock X/Z rotations so the car stays upright; we control yaw visually & via angvel.
    this.body.setEnabledRotations(false, true, false, true);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(1.15, 0.2, 2.0)
      .setTranslation(0, 0.28, 0) // Align with chassis visual center
      .setFriction(0.0) // Manage our own lateral grip
      .setRestitution(0.1)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    this.physicsWorld.world.createCollider(colliderDesc, this.body);

    this.mesh = this.createCarMesh();
    this.mesh.position.copy(position);
    this.scene.add(this.mesh);
  }

  enter(_input: InputState): void {
    this.input = _input;
    const rot = this.body.rotation();
    _tempEuler.setFromQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w), 'YXZ');
    this.yaw = _tempEuler.y;
  }

  exit(): SpawnPointData {
    const pos = this.body.translation();
    // Clear driving state so the parked car coasts to a stop.
    this.input = null;
    this.speed = 0;
    this.steerAngle = 0;
    this.lateralSlip = 0;
    this.body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
    this.body.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
    return {
      position: new THREE.Vector3(pos.x, pos.y, pos.z).add(this.exitOffset),
    };
  }

  setInput(input: InputState): void {
    this.input = input;
  }

  fixedUpdate(dt: number): void {
    if (!this.input) return;
    const input = this.input;
    this.simTime += dt;

    const accelInput = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const steerInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const boosting = input.sprint;
    const handbrake = input.jump;

    const maxForward = boosting ? 18 : 14;
    const maxReverse = 6;
    const accelRate = boosting ? 26 : this.acceleration;
    const reverseAccelRate = accelRate * 0.5;
    const coastRate = handbrake ? 18 : this.drag;
    const brakeRate = handbrake ? 38 : 24;

    // Acceleration with proper brake-before-reverse logic.
    if (accelInput > 0) {
      if (this.speed < -0.3) {
        // Moving backward — brake to stop first.
        this.speed = THREE.MathUtils.damp(this.speed, 0, brakeRate, dt);
      } else {
        this.speed = THREE.MathUtils.damp(this.speed, maxForward, accelRate, dt);
      }
    } else if (accelInput < 0) {
      if (this.speed > 0.3) {
        // Moving forward — brake to stop first.
        this.speed = THREE.MathUtils.damp(this.speed, 0, brakeRate, dt);
      } else {
        // Actually reverse (slower acceleration, lower top speed).
        this.speed = THREE.MathUtils.damp(this.speed, -maxReverse, reverseAccelRate, dt);
      }
    } else {
      this.speed = THREE.MathUtils.damp(this.speed, 0, coastRate, dt);
    }

    if (handbrake && accelInput === 0) {
      this.speed = THREE.MathUtils.damp(this.speed, 0, brakeRate, dt);
    }

    const targetSteer = steerInput * this.maxSteerAngle;
    this.steerAngle = THREE.MathUtils.damp(
      this.steerAngle,
      targetSteer,
      handbrake ? this.steerSpeed * 1.4 : this.steerSpeed,
      dt,
    );

    // Forward is -Z in the rest of the project; turn right on D (steerInput=+1).
    const speedAbs = Math.abs(this.speed);
    const speedNorm = THREE.MathUtils.clamp(speedAbs / Math.max(0.01, maxForward), 0, 1);
    const speedFactor = 0.22 + 0.78 * speedNorm;
    const steerSign = Math.sign(this.speed !== 0 ? this.speed : accelInput !== 0 ? accelInput : 1);
    const turnRate = (handbrake ? 1.35 : 1.0) * 2.9;

    // Explicit yaw update (ensures exact turn logic without relying on velocity constraints)
    this.yaw -= this.steerAngle * steerSign * speedFactor * dt * turnRate;
    _quat.setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));

    _forward.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    // Lateral drift.
    const driftFactor = handbrake ? 0.08 : 0.02;
    const targetSlip = this.steerAngle * speedNorm * driftFactor * speedAbs;
    this.lateralSlip = THREE.MathUtils.damp(this.lateralSlip, targetSlip, 4.0, dt);
    _lateral.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    // Suspension bounce.
    this.suspensionOffset = Math.sin(this.simTime * 8.0) * speedNorm * 0.015;

    // Visual body roll (damped toward target).
    const targetRoll = -this.steerAngle * speedNorm * 0.06;
    this.visualRoll = THREE.MathUtils.damp(this.visualRoll, targetRoll, 6.0, dt);

    const pos = this.body.translation();
    const desiredVelocity = new THREE.Vector3()
      .addScaledVector(_forward, this.speed)
      .addScaledVector(_lateral, this.lateralSlip);

    // Ground snap: raycast down to follow terrain.
    const rayOffset = 0.8;
    const rayOrigin = new RAPIER.Vector3(pos.x, pos.y + rayOffset, pos.z);
    const rayHit = this.physicsWorld.castRay(
      rayOrigin,
      new RAPIER.Vector3(0, -1, 0),
      4.0,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );

    if (rayHit && rayHit.timeOfImpact < 2.5) {
      const distToGround = rayHit.timeOfImpact;
      // Target: wheels sit near ground level (tire bottom at y=0.0 in local space).
      const targetDist = rayOffset + 0.05;
      desiredVelocity.y = (distToGround - targetDist) * -15;
    } else {
      // free fall
      const currentVel = this.body.linvel();
      desiredVelocity.y = currentVel.y - 18.0 * dt;
    }

    this.body.setLinvel(new RAPIER.Vector3(desiredVelocity.x, desiredVelocity.y, desiredVelocity.z), true);

    // Override the physics rotation with our computed yaw
    this.body.setRotation(toRapierQuat(_quat), true);

    this.updateWheelVisuals(dt);
  }

  postPhysicsUpdate(_dt: number): void {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    if (!this.hasPose) {
      _prevPos.set(pos.x, pos.y, pos.z);
      _currPos.set(pos.x, pos.y, pos.z);
      _prevQuat.set(rot.x, rot.y, rot.z, rot.w);
      _currQuat.set(rot.x, rot.y, rot.z, rot.w);
      this.hasPose = true;
    } else {
      _prevPos.copy(_currPos);
      _prevQuat.copy(_currQuat);
      _currPos.set(pos.x, pos.y, pos.z);
      _currQuat.set(rot.x, rot.y, rot.z, rot.w);
    }
  }

  update(_dt: number, alpha: number): void {
    if (!this.hasPose) return;
    this.mesh.position.lerpVectors(_prevPos, _currPos, alpha);
    this.mesh.position.y += this.suspensionOffset;
    this.mesh.quaternion.slerpQuaternions(_prevQuat, _currQuat, alpha);
    if (this.cabinMesh) {
      this.cabinMesh.rotation.z = this.visualRoll;
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
    // Forward is -Z. Headlights/windshield at -Z, taillights at +Z.

    // --- Lower chassis ---
    const chassisMat = new THREE.MeshStandardMaterial({ color: 0x3a4050, metalness: 0.4, roughness: 0.4 });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.38, 4.2), chassisMat);
    chassis.position.y = 0.28;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    group.add(chassis);

    // Glowing side skirts
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x3388dd, emissive: 0x3388dd, emissiveIntensity: 1.5 });
    const leftSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.5), skirtMat);
    leftSkirt.position.set(1.2, 0.2, 0);
    group.add(leftSkirt);
    const rightSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.5), skirtMat);
    rightSkirt.position.set(-1.2, 0.2, 0);
    group.add(rightSkirt);

    // --- Fender flares over wheel wells ---
    const fenderPositions = [
      new THREE.Vector3(1.15, 0.42, -1.5),   // front-right
      new THREE.Vector3(-1.15, 0.42, -1.5),  // front-left
      new THREE.Vector3(1.15, 0.42, 1.5),    // rear-right
      new THREE.Vector3(-1.15, 0.42, 1.5),   // rear-left
    ];
    for (const pos of fenderPositions) {
      const fender = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.7), chassisMat);
      fender.position.copy(pos);
      fender.castShadow = true;
      group.add(fender);
    }

    // --- Upper cabin (visual roll applied here) ---
    const cabin = new THREE.Group();
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x404858, metalness: 0.3, roughness: 0.5 });
    const cabinMesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.45, 2.2), cabinMat);
    cabinMesh.position.set(0, 0.68, 0.3);
    cabinMesh.castShadow = true;
    cabinMesh.receiveShadow = true;
    cabin.add(cabinMesh);

    // Roof light bar (yellow emissive accent)
    const roofLightMat = new THREE.MeshStandardMaterial({ color: 0xccaa22, emissive: 0xccaa22, emissiveIntensity: 1.8 });
    const roofLight = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.2), roofLightMat);
    roofLight.position.set(0, 0.94, 0.3);
    cabin.add(roofLight);

    // Windshield (front glass) — faces -Z.
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x88bbdd, roughness: 0.05, metalness: 0.1,
      transmission: 0.9, thickness: 0.1, transparent: true, opacity: 0.5, emissive: 0x002244,
    });
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 0.08), glassMat);
    windshield.position.set(0, 0.72, -0.82);
    windshield.rotation.x = 0.25;
    cabin.add(windshield);

    const bumperMat = new THREE.MeshStandardMaterial({ color: 0x3a3e48, metalness: 0.2, roughness: 0.6 });
    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 0.5), bumperMat);
    frontBumper.position.set(0, 0.2, -2.25);
    frontBumper.castShadow = true;
    group.add(frontBumper);

    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 0.5), bumperMat);
    rearBumper.position.set(0, 0.2, 2.25);
    rearBumper.castShadow = true;
    group.add(rearBumper);

    // Sci-fi Spoiler
    const spoilerStrut1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), bumperMat);
    spoilerStrut1.position.set(0.8, 0.6, 1.8);
    cabin.add(spoilerStrut1);
    const spoilerStrut2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), bumperMat);
    spoilerStrut2.position.set(-0.8, 0.6, 1.8);
    cabin.add(spoilerStrut2);
    const spoilerWing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.4), chassisMat);
    spoilerWing.position.set(0, 0.8, 1.8);
    spoilerWing.rotation.x = -0.1;
    cabin.add(spoilerWing);
    const spoilerGlow = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 0.05), new THREE.MeshStandardMaterial({ color: 0xccaa22, emissive: 0xccaa22, emissiveIntensity: 2.0 }));
    spoilerGlow.position.set(0, 0.8, 1.98);
    cabin.add(spoilerGlow);

    group.add(cabin);
    this.cabinMesh = cabin;

    // --- Headlights (front = -Z) ---
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff5e8, emissive: 0xffe8cc, emissiveIntensity: 2.5, roughness: 0.2,
    });
    for (const side of [-0.75, 0.75]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.08), headlightMat);
      hl.position.set(side, 0.32, -2.15);
      group.add(hl);
    }

    // --- Taillights (rear = +Z) ---
    const taillightMat = new THREE.MeshStandardMaterial({
      color: 0xcc2222, emissive: 0xcc2222, emissiveIntensity: 2.5, roughness: 0.2,
    });
    for (const side of [-0.8, 0.8]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.08), taillightMat);
      tl.position.set(side, 0.32, 2.15);
      group.add(tl);
    }

    // --- Wheels (tire + rim) ---
    // Bake orientation into geometry so animation rotations stay on clean axes.
    const tireGeom = new THREE.CylinderGeometry(this.wheelRadius, this.wheelRadius, 0.22, 18);
    tireGeom.rotateZ(Math.PI / 2);
    const rimGeom = new THREE.CylinderGeometry(this.wheelRadius * 0.55, this.wheelRadius * 0.55, 0.24, 12);
    rimGeom.rotateZ(Math.PI / 2);

    const tireMat = new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.2, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.1 });
    const rimGlowMat = new THREE.MeshStandardMaterial({ color: 0x3388dd, emissive: 0x3388dd, emissiveIntensity: 1.5 });
    const rimGlowGeom = new THREE.CylinderGeometry(this.wheelRadius * 0.4, this.wheelRadius * 0.4, 0.26, 12);
    rimGlowGeom.rotateZ(Math.PI / 2);

    // Front wheels at -Z, rear at +Z.
    const wheelOffsets = [
      new THREE.Vector3(1.1, 0.32, -1.5),   // front-right
      new THREE.Vector3(-1.1, 0.32, -1.5),  // front-left
      new THREE.Vector3(1.1, 0.32, 1.5),    // rear-right
      new THREE.Vector3(-1.1, 0.32, 1.5),   // rear-left
    ];

    wheelOffsets.forEach((offset, i) => {
      const isFront = i < 2;

      // Spin group: holds tire + rim, rotation.x = roll (axle-aligned spin).
      const spinGroup = new THREE.Group();
      const tire = new THREE.Mesh(tireGeom, tireMat);
      tire.castShadow = true;
      tire.receiveShadow = true;
      spinGroup.add(tire);
      const rim = new THREE.Mesh(rimGeom, rimMat);
      spinGroup.add(rim);
      const rimGlow = new THREE.Mesh(rimGlowGeom, rimGlowMat);
      spinGroup.add(rimGlow);

      if (isFront) {
        // Steer pivot → spin group (decoupled Euler axes = no wobble).
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
