import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { InputState, SpawnPointData } from '@core/types';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { toRapierQuat } from '@physics/PhysicsHelpers';
import type { VehicleController } from './VehicleController';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _prevPos = new THREE.Vector3();
const _currPos = new THREE.Vector3();
const _prevQuat = new THREE.Quaternion();
const _currQuat = new THREE.Quaternion();
const _desiredVel = new THREE.Vector3();
const _currVel = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();

export class DroneController implements VehicleController {
  readonly id: string;
  readonly body: RAPIER.RigidBody;
  readonly mesh: THREE.Object3D;
  readonly exitOffset = new THREE.Vector3(1.2, 0, 0);
  readonly cameraConfig = {
    distance: 8,
    heightOffset: 3,
    pitchMin: -1.5,
  };

  private input: InputState | null = null;
  private yaw = 0;
  private pitch = 0;
  private hasPose = false;
  private verticalSuppressSeconds = 0;

  private readonly moveSpeed = 10;
  private readonly verticalSpeed = 6;
  private readonly responsiveness = 12; // higher = snappier

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
    this.body.setLinearDamping(2.4);
    this.body.setAngularDamping(2.2);
    // Keep the drone visible and stable (no drift) until a player enters it.
    this.body.setGravityScale(0, true);
    this.body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
    this.body.setAngvel(new RAPIER.Vector3(0, 0, 0), true);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.6, 0.2, 0.6)
      .setDensity(1.0);
    this.physicsWorld.world.createCollider(colliderDesc, this.body);

    const geom = new THREE.BoxGeometry(1.2, 0.3, 1.2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3cc6ff, metalness: 0.1, roughness: 0.4 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(position);
    this.mesh = mesh;
    this.scene.add(this.mesh);
  }

  enter(_input: InputState): void {
    this.input = _input;
    // "Fake" great-feel flight: disable gravity while piloting and directly control velocity.
    // This avoids hover drift and makes vertical movement consistent across frame rates.
    this.body.setGravityScale(0, true);
    this.body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
    // Avoid "enter" inheriting a stuck jump/crouch for a couple frames.
    this.verticalSuppressSeconds = 0.25;
    const rot = this.body.rotation();
    const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w), 'YXZ');
    this.yaw = euler.y;
    this.pitch = euler.x;
  }

  exit(): SpawnPointData {
    const pos = this.body.translation();
    this.input = null;
    this.body.setGravityScale(0, true);
    this.body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
    this.body.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
    return {
      position: new THREE.Vector3(pos.x, pos.y, pos.z).add(this.exitOffset),
    };
  }

  setInput(input: InputState): void {
    this.input = input;
  }

  fixedUpdate(_dt: number): void {
    if (!this.input) return;
    const input = this.input;

    this.verticalSuppressSeconds = Math.max(0, this.verticalSuppressSeconds - _dt);

    this.yaw -= input.mouseDeltaX * 0.002;
    this.pitch -= input.mouseDeltaY * 0.002;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.2, 1.2);

    _quat.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.body.setRotation(toRapierQuat(_quat), true);

    const moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const moveZ = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const rawMoveY = (input.jump ? 1 : 0) - (input.crouch ? 1 : 0);
    const moveY = this.verticalSuppressSeconds > 0 ? 0 : rawMoveY;

    // Movement uses yaw-only for direction so pitch doesn't cause unintended vertical drift.
    _yawQuat.setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    _forward.set(0, 0, -1).applyQuaternion(_yawQuat);
    _right.set(1, 0, 0).applyQuaternion(_yawQuat);

    const targetSpeed = this.moveSpeed * (input.sprint ? 1.5 : 1.0);
    _desiredVel.set(0, moveY * this.verticalSpeed, 0);
    _desiredVel.addScaledVector(_forward, moveZ * targetSpeed);
    _desiredVel.addScaledVector(_right, moveX * targetSpeed);

    const lv = this.body.linvel();
    _currVel.set(lv.x, lv.y, lv.z);
    const t = 1 - Math.exp(-this.responsiveness * _dt);
    _currVel.lerp(_desiredVel, t);
    this.body.setLinvel(new RAPIER.Vector3(_currVel.x, _currVel.y, _currVel.z), true);
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
    this.mesh.quaternion.slerpQuaternions(_prevQuat, _currQuat, alpha);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    (this.mesh as THREE.Mesh).geometry?.dispose();
    ((this.mesh as THREE.Mesh).material as THREE.Material)?.dispose();
    this.physicsWorld.removeBody(this.body);
  }
}
