import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { InputState, SpawnPointData } from '@core/types';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { toRapierQuat } from '@physics/PhysicsHelpers';
import type { VehicleController } from './VehicleController';

const _forward = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _prevPos = new THREE.Vector3();
const _currPos = new THREE.Vector3();
const _prevQuat = new THREE.Quaternion();
const _currQuat = new THREE.Quaternion();

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
  private frontWheels: THREE.Mesh[] = [];
  private rearWheels: THREE.Mesh[] = [];

  private readonly maxSpeed = 12;
  private readonly acceleration = 22;
  private readonly drag = 6;
  private readonly maxSteerAngle = Math.PI / 6;
  private readonly steerSpeed = 8;
  private readonly wheelRadius = 0.28;

  constructor(
    id: string,
    position: THREE.Vector3,
    private physicsWorld: PhysicsWorld,
    private scene: THREE.Scene,
  ) {
    this.id = id;

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z);
    this.body = this.physicsWorld.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(1, 0.4, 2.0);
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

    const accelInput = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const targetSpeed = accelInput * this.maxSpeed;
    if (accelInput !== 0) {
      this.speed = THREE.MathUtils.damp(this.speed, targetSpeed, this.acceleration, dt);
    } else {
      this.speed = THREE.MathUtils.damp(this.speed, 0, this.drag, dt);
    }

    if (input.jump) {
      this.speed *= Math.max(0.1, 1 - dt * 6);
    }

    const steerInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const targetSteer = steerInput * this.maxSteerAngle;
    this.steerAngle = THREE.MathUtils.damp(this.steerAngle, targetSteer, this.steerSpeed, dt);

    // Forward is -Z in the rest of the project; turn right on D (steerInput=+1).
    this.yaw -= this.steerAngle * (this.speed / this.maxSpeed) * dt * 2.2;
    _forward.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    const pos = this.body.translation();
    const nextPos = new THREE.Vector3(pos.x, pos.y, pos.z).addScaledVector(_forward, this.speed * dt);
    this.body.setNextKinematicTranslation(new RAPIER.Vector3(nextPos.x, nextPos.y, nextPos.z));

    _quat.setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    this.body.setNextKinematicRotation(toRapierQuat(_quat));

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
    this.mesh.quaternion.slerpQuaternions(_prevQuat, _currQuat, alpha);
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
    const bodyGeom = new THREE.BoxGeometry(2.2, 0.6, 4);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff4f4f, metalness: 0.1, roughness: 0.5 });
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    bodyMesh.position.y = 0.4;
    group.add(bodyMesh);

    const wheelGeom = new THREE.CylinderGeometry(this.wheelRadius, this.wheelRadius, 0.2, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.2, roughness: 0.8 });

    const wheelOffsets = [
      new THREE.Vector3(0.9, 0.2, 1.4),
      new THREE.Vector3(-0.9, 0.2, 1.4),
      new THREE.Vector3(0.9, 0.2, -1.4),
      new THREE.Vector3(-0.9, 0.2, -1.4),
    ];

    wheelOffsets.forEach((offset, i) => {
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.copy(offset);
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      group.add(wheel);
      if (i < 2) {
        this.frontWheels.push(wheel);
      } else {
        this.rearWheels.push(wheel);
      }
    });

    return group;
  }

  private updateWheelVisuals(dt: number): void {
    const roll = (this.speed * dt) / this.wheelRadius;
    for (const wheel of this.frontWheels) {
      wheel.rotation.y = this.steerAngle;
      wheel.rotation.x += roll;
    }
    for (const wheel of this.rearWheels) {
      wheel.rotation.x += roll;
    }
  }
}
