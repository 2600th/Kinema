import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { InputState, SpawnPointData } from '@core/types';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { toRapierQuat } from '@physics/PhysicsHelpers';
import { COLLISION_GROUP_VEHICLE, VEHICLE_DOMINANCE_GROUP } from '@core/constants';
import type { VehicleController } from './VehicleController';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _desiredVel = new THREE.Vector3();
const _currVel = new THREE.Vector3();
const _exitProbe = new THREE.Vector3();
const _droneExitCandidates = [
  new THREE.Vector3( 1.2, 0, 0),   // right
  new THREE.Vector3(-1.2, 0, 0),   // left
  new THREE.Vector3( 0,   0, 1.2), // rear
];
const _yawQuat = new THREE.Quaternion();
const _tiltQuat = new THREE.Quaternion();
const _tiltEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _yawEuler = new THREE.Euler(0, 0, 0, 'YXZ');

const _drv3A = new RAPIER.Vector3(0, 0, 0);
const _drv3B = new RAPIER.Vector3(0, 0, 0);

// Shape cast box for ground detection (matches drone footprint, more stable on edges)
const _droneGroundBox = new RAPIER.Cuboid(0.5, 0.1, 0.5);
const _droneGroundQuat = new RAPIER.Quaternion(0, 0, 0, 1);

function _setDRV(v: RAPIER.Vector3, x: number, y: number, z: number): RAPIER.Vector3 {
  v.x = x; v.y = y; v.z = z;
  return v;
}

export class DroneController implements VehicleController {
  readonly id: string;
  readonly type = 'drone' as const;
  readonly body: RAPIER.RigidBody;
  readonly mesh: THREE.Object3D;
  readonly exitOffset = new THREE.Vector3(1.2, 0, 0);
  readonly cameraLookMode = 'yawOnly' as const;
  readonly cameraConfig = {
    distance: 8,
    heightOffset: 2.4,
    pitchMin: -1.5,
  };

  private input: InputState | null = null;
  private yaw = 0;
  private hasPose = false;
  // Per-instance interpolation buffers (module-scope would be shared across instances).
  private readonly _prevPos = new THREE.Vector3();
  private readonly _currPos = new THREE.Vector3();
  private readonly _prevQuat = new THREE.Quaternion();
  private readonly _currQuat = new THREE.Quaternion();
  private verticalSuppressSeconds = 0;
  private controlYaw: number | null = null;
  private visualPitch = 0;
  private visualRoll = 0;
  private actionRoll = 0;
  private rollTimeRemaining = 0;
  private rollDirection = 1;
  private hoverTargetY: number | null = null;
  private rotorMeshes: THREE.Object3D[] = [];

  private readonly moveSpeed = 10;
  private readonly responsiveness = 14; // higher = snappier
  private readonly yawResponsiveness = 16;
  private readonly groundRayMax = 250;
  private readonly defaultHoverHeight = 4.2; // meters above ground (feel target)
  private readonly hoverMinHeight = 1.8;
  private readonly hoverMaxHeight = 22;
  private readonly hoverK = 6.5; // outer P: height error -> desired vertical speed
  private readonly hoverKi = 2.0; // inner I: integral gain for speed error
  private readonly hoverMaxIntegral = 5; // anti-windup clamp
  private hoverSpeedIntegral = 0;
  private readonly hoverMaxVerticalSpeed = 10;
  private readonly hoverAdjustSpeedKeyboard = 7.5; // m/s via Space/C when piloting
  private readonly rollDuration = 0.45;
  private readonly rollCooldownDuration = 0.45;
  private rollCooldown = 0;

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
    this.body.userData = { kind: 'vehicle' };
    this.body.enableCcd(true);
    this.body.setDominanceGroup(VEHICLE_DOMINANCE_GROUP);
    this.body.setLinearDamping(2.8);
    this.body.setAngularDamping(3.2);
    // Parked drone uses normal gravity (it will settle on the ground).
    // WHY: Any "auto-landing/parking" logic has proven brittle across Rapier builds.
    this.body.setGravityScale(1, true);
    this.body.setLinvel(_setDRV(_drv3A, 0, 0, 0), true);
    this.body.setAngvel(_setDRV(_drv3B, 0, 0, 0), true);
    // Keep it upright; yaw is driven explicitly while piloting.
    this.body.setEnabledRotations(false, true, false, true);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.6, 0.2, 0.6)
      .setDensity(1.0)
      .setFriction(1.2)
      .setRestitution(0.02)
      .setCollisionGroups(COLLISION_GROUP_VEHICLE);
    this.physicsWorld.world.createCollider(colliderDesc, this.body);

    this.mesh = this.createDroneMesh();
    this.mesh.position.copy(position);
    this.scene.add(this.mesh);
  }

  enter(_input: InputState): void {
    this.input = _input;
    this.hoverTargetY = null;
    this.hoverSpeedIntegral = 0;
    this.rollTimeRemaining = 0;
    this.rollCooldown = 0;
    this.actionRoll = 0;
    // Great-feel flight: disable gravity while piloting and directly control velocity.
    this.body.setGravityScale(0, true);
    // Prevent mid-air sleeping from "freezing" the drone.
    this.setBodyCanSleep(false);
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setLinvel(_setDRV(_drv3A, 0, 0, 0), true);
    this.body.setAngvel(_setDRV(_drv3B, 0, 0, 0), true);
    this.body.setEnabledRotations(false, true, false, true);
    // Avoid "enter" inheriting a stuck jump/crouch for a couple frames.
    this.verticalSuppressSeconds = 0.25;
    // Align to the camera yaw (if available) so controls feel consistent.
    if (this.controlYaw != null) {
      this.yaw = this.controlYaw;
    }

    // Rise to a readable "default" hover height when entering the drone.
    // This makes takeoff consistent even if the drone was parked on the ground.
    const p = this.body.translation();
    this.hoverTargetY = this.computeDefaultHoverY(p.x, p.y, p.z, true);
  }

  exit(): SpawnPointData {
    const pos = this.body.translation();
    this.input = null;
    this.visualPitch = 0;
    this.visualRoll = 0;
    this.actionRoll = 0;
    this.rollTimeRemaining = 0;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setGravityScale(1, true);
    // Let the drone settle naturally; allow sleeping once it comes to rest.
    this.setBodyCanSleep(true);
    this.body.setEnabledRotations(false, true, false, true);
    // Ensure gravity is applied immediately.
    const lv = this.body.linvel();
    this.body.setLinvel(_setDRV(_drv3A, lv.x, Math.min(lv.y, 0), lv.z), true);
    this.body.setAngvel(_setDRV(_drv3B, 0, 0, 0), true);
    this.body.wakeUp();
    const rot = this.body.rotation();
    _quat.set(rot.x, rot.y, rot.z, rot.w);
    const basePos = new THREE.Vector3(pos.x, pos.y, pos.z);

    // Probe exit positions with downward raycast to find ground, then add
    // capsule clearance so the player doesn't spawn inside the floor.
    const capsuleClearance = 1.1; // capsule half-height + radius + margin

    for (const candidate of _droneExitCandidates) {
      _exitProbe.copy(candidate).applyQuaternion(_quat).add(basePos);
      const dx = _exitProbe.x - basePos.x;
      const dz = _exitProbe.z - basePos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.001) continue;
      const blocked = this.physicsWorld.castRay(
        _setDRV(_drv3A, basePos.x, basePos.y, basePos.z),
        _setDRV(_drv3B, dx / dist, 0, dz / dist),
        dist,
        undefined,
        this.body,
        (c) => !c.isSensor(),
      );
      if (!blocked || blocked.timeOfImpact >= dist - 0.1) {
        // Find ground below exit point so the player lands properly
        const groundHit = this.physicsWorld.castRay(
          _setDRV(_drv3A, _exitProbe.x, _exitProbe.y + 2, _exitProbe.z),
          _setDRV(_drv3B, 0, -1, 0),
          50,
          undefined,
          this.body,
          (c) => !c.isSensor(),
        );
        if (groundHit) {
          _exitProbe.y = (_exitProbe.y + 2) - groundHit.timeOfImpact + capsuleClearance;
        }
        return { position: _exitProbe.clone() };
      }
    }
    // Fallback
    _exitProbe.copy(_droneExitCandidates[0]).applyQuaternion(_quat).add(basePos);
    _exitProbe.y = basePos.y + capsuleClearance;
    return { position: _exitProbe.clone() };
  }

  setInput(input: InputState): void {
    this.input = input;
  }

  setControlYaw(yaw: number): void {
    if (!Number.isFinite(yaw)) return;
    this.controlYaw = yaw;
  }

  fixedUpdate(_dt: number): void {
    if (!this.input) return;
    const input = this.input;

    this.verticalSuppressSeconds = Math.max(0, this.verticalSuppressSeconds - _dt);
    this.rollCooldown = Math.max(0, this.rollCooldown - _dt);

    // Mouse look is owned by OrbitFollowCamera. Drive drone yaw from camera yaw.
    if (this.controlYaw != null) {
      const nextYaw = dampAngle(this.yaw, this.controlYaw, this.yawResponsiveness, _dt);
      this.yaw = nextYaw;
    }
    _yawEuler.set(0, this.yaw, 0);
    _quat.setFromEuler(_yawEuler);
    this.body.setRotation(toRapierQuat(_quat), true);

    const moveX = input.moveX;
    const moveZ = input.moveY;
    const moveY = this.verticalSuppressSeconds > 0 ? 0 : input.vehicleVertical;

    if (input.jumpPressed && this.rollCooldown <= 0) {
      this.rollDirection = moveX !== 0 ? -Math.sign(moveX) : 1;
      this.rollTimeRemaining = this.rollDuration;
      this.rollCooldown = this.rollCooldownDuration;
    }

    // Movement uses yaw-only for direction so pitch doesn't cause unintended vertical drift.
    _yawQuat.setFromEuler(_yawEuler);
    _forward.set(0, 0, -1).applyQuaternion(_yawQuat);
    _right.set(1, 0, 0).applyQuaternion(_yawQuat);

    const targetSpeed = this.moveSpeed * (input.sprint ? 1.5 : 1.0);

    // Altitude control:
    // - On enter we set a default hover altitude above ground.
    // - While piloting, mouse/stick Y nudges the hover target up/down.
    // - Space/C also nudges the target for keyboard-only play.
    const p = this.body.translation();
    if (this.hoverTargetY == null) {
      this.hoverTargetY = this.computeDefaultHoverY(p.x, p.y, p.z, false);
    }
    const groundY = this.getGroundY(p.x, p.y, p.z);
    if (this.verticalSuppressSeconds <= 0) {
      // Space/C nudges the target for keyboard-only play.
      this.hoverTargetY += moveY * this.hoverAdjustSpeedKeyboard * _dt;
    }
    if (groundY != null) {
      const minY = groundY + this.getBodyGroundClearance() + this.hoverMinHeight;
      const maxY = groundY + this.getBodyGroundClearance() + this.hoverMaxHeight;
      this.hoverTargetY = THREE.MathUtils.clamp(this.hoverTargetY, minY, maxY);
    }
    // Cascaded hover controller: outer P (altitude→desired speed) + inner PI (speed→thrust)
    const desiredSpeed = THREE.MathUtils.clamp(
      (this.hoverTargetY - p.y) * this.hoverK,
      -this.hoverMaxVerticalSpeed,
      this.hoverMaxVerticalSpeed,
    );
    // Inner PI loop: speed error → corrected velocity
    const currentVelY = this.body.linvel().y;
    const speedError = desiredSpeed - currentVelY;
    this.hoverSpeedIntegral += speedError * _dt;
    // Anti-windup: clamp integral and partially reset on error sign flip
    this.hoverSpeedIntegral = THREE.MathUtils.clamp(
      this.hoverSpeedIntegral, -this.hoverMaxIntegral, this.hoverMaxIntegral,
    );
    if (Math.sign(speedError) !== Math.sign(this.hoverSpeedIntegral) && Math.abs(this.hoverSpeedIntegral) > 0.5) {
      this.hoverSpeedIntegral *= 0.5;
    }
    const desiredVelY = desiredSpeed + this.hoverKi * this.hoverSpeedIntegral;

    _desiredVel.set(0, desiredVelY, 0);
    _desiredVel.addScaledVector(_forward, moveZ * targetSpeed);
    _desiredVel.addScaledVector(_right, moveX * targetSpeed);

    const lv = this.body.linvel();
    _currVel.set(lv.x, lv.y, lv.z);
    const t = 1 - Math.exp(-this.responsiveness * _dt);
    _currVel.lerp(_desiredVel, t);
    this.body.setLinvel(_setDRV(_drv3A, _currVel.x, _currVel.y, _currVel.z), true);

    // Visual bank (mesh-only) for better feel/readability.
    const targetPitch = THREE.MathUtils.clamp(-moveZ * 0.12, -0.22, 0.22);
    const targetRoll = THREE.MathUtils.clamp(-moveX * 0.18, -0.32, 0.32);
    const bankT = 1 - Math.exp(-10 * _dt);
    this.visualPitch += (targetPitch - this.visualPitch) * bankT;
    this.visualRoll += (targetRoll - this.visualRoll) * bankT;
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

  update(dt: number, alpha: number): void {
    if (!this.hasPose) return;
    this.mesh.position.lerpVectors(this._prevPos, this._currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this._prevQuat, this._currQuat, alpha);
    if (this.rollTimeRemaining > 0) {
      const rollProgress = 1 - this.rollTimeRemaining / this.rollDuration;
      this.actionRoll = this.rollDirection * rollProgress * Math.PI * 2;
      this.rollTimeRemaining = Math.max(0, this.rollTimeRemaining - dt);
    } else {
      this.actionRoll = 0;
    }
    // Apply mesh-only banking after base interpolation so physics stays stable.
    _tiltEuler.set(this.visualPitch, 0, this.visualRoll + this.actionRoll);
    _tiltQuat.setFromEuler(_tiltEuler);
    this.mesh.quaternion.multiply(_tiltQuat);

    // Spin rotors
    const rotorSpeed = 20 * dt;
    for (const rotor of this.rotorMeshes) {
      rotor.rotation.y += rotorSpeed;
    }
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
      else if (m.material) m.material.dispose();
    });
    this.physicsWorld.removeBody(this.body);
  }

  private createDroneMesh(): THREE.Object3D {
    const group = new THREE.Group();

    // Main chassis (sleek sci-fi look)
    const chassisMat = new THREE.MeshStandardMaterial({ color: 0x2a3040, metalness: 0.8, roughness: 0.2 });
    const chassis = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.24, 6), chassisMat);
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    group.add(chassis);

    // Glowing core
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 3.0 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), coreMat);
    core.position.y = 0.1;
    group.add(core);

    // Arms and rotors
    const armMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.4 });
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.5, roughness: 0.3, transparent: true, opacity: 0.7 });

    const armOffsets = [
      new THREE.Vector3(0.75, 0, 0.75),
      new THREE.Vector3(-0.75, 0, 0.75),
      new THREE.Vector3(0.75, 0, -0.75),
      new THREE.Vector3(-0.75, 0, -0.75),
    ];

    armOffsets.forEach(pos => {
      // connecting arm
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, pos.length(), 6), armMat);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
      arm.position.copy(pos).multiplyScalar(0.5);
      arm.castShadow = true;
      group.add(arm);

      // motor housing
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.18, 8), chassisMat);
      motor.position.copy(pos);
      motor.castShadow = true;
      group.add(motor);

      // rotor blades (thin cylinder, spun in update)
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 12), rotorMat);
      rotor.position.copy(pos);
      rotor.position.y += 0.1;
      rotor.castShadow = true;
      group.add(rotor);
      this.rotorMeshes.push(rotor);
    });

    // Front indicator light
    const frontLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.5 }));
    frontLight.position.set(0, 0, -0.45);
    group.add(frontLight);

    return group;
  }

  private setBodyCanSleep(canSleep: boolean): void {
    // rapier3d-compat types don't expose this on all versions; guard at runtime.
    const b = this.body as unknown as { setCanSleep?: (v: boolean) => void };
    b.setCanSleep?.(canSleep);
  }

  private getBodyGroundClearance(): number {
    // Collider is cuboid(0.6, 0.2, 0.6) so half-height is 0.2.
    return 0.2 + 0.04;
  }

  private getGroundY(x: number, y: number, z: number): number | null {
    // Primary: shape cast with box matching drone footprint (stable on ledge edges)
    const shapeHit = this.physicsWorld.castShape(
      _setDRV(_drv3A, x, y, z),
      _droneGroundQuat,
      _setDRV(_drv3B, 0, -1, 0),
      _droneGroundBox,
      0,
      this.groundRayMax,
      undefined,
      this.body,
      undefined,
      (c) => !c.isSensor(),
    );
    if (shapeHit) return y - shapeHit.time_of_impact;

    // Fallback: long ray for large gaps where shape cast might miss
    const hit = this.physicsWorld.castRay(
      _setDRV(_drv3A, x, y, z),
      _setDRV(_drv3B, 0, -1, 0),
      this.groundRayMax,
      undefined,
      this.body,
      (c) => !c.isSensor(),
    );
    if (!hit) return null;
    return y - hit.timeOfImpact;
  }

  private computeDefaultHoverY(x: number, y: number, z: number, riseOnly: boolean): number {
    const groundY = this.getGroundY(x, y, z);
    if (groundY == null) return y;
    const desired = groundY + this.getBodyGroundClearance() + this.defaultHoverHeight;
    return riseOnly ? Math.max(y, desired) : desired;
  }
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  // Damped move along the shortest angular distance.
  const twoPi = Math.PI * 2;
  const delta = ((((target - current) % twoPi) + Math.PI * 3) % twoPi) - Math.PI;
  const t = 1 - Math.exp(-lambda * dt);
  return current + delta * t;
}
