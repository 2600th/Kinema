import type { PlayerController } from "@character/PlayerController";
import { COLLISION_GROUP_INTERACTABLE } from "@core/constants";
import type { InputState } from "@core/types";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import * as THREE from "three";
import type { IInteractable, InteractionAccess, InteractionSpec } from "../Interactable";

const _anchorPos = new THREE.Vector3();
const _tailPos = new THREE.Vector3();
const _segmentPos = new THREE.Vector3();
const _playerPos = new THREE.Vector3();
const _pivotToPlayer = new THREE.Vector3();
const _swingTangent = new THREE.Vector3();
const _swingDesired = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _tempRopeImpulse = new RAPIER.Vector3(0, 0, 0);
const _rv3RopeA = new RAPIER.Vector3(0, 0, 0);
const _rv3RopeB = new RAPIER.Vector3(0, 0, 0);
const COLLISION_GROUP_ROPE = (1 << 16) | 1; // world membership, collide with world only.
const ROPE_SEGMENT_MASS = 9.5;
const ROPE_TAIL_MASS = 14.5;
const ROPE_SOLVER_ITERS = 8;
const PLAYER_SOLVER_ITERS_WHILE_ATTACHED = 10;
const ROPE_IDLE_LINEAR_DAMPING = 0.55;
const ROPE_IDLE_ANGULAR_DAMPING = 0.78;
const ROPE_ATTACHED_LINEAR_DAMPING = 0.24;
const ROPE_ATTACHED_ANGULAR_DAMPING = 0.36;

/**
 * Chain of dynamic rigid bodies linked by spherical joints.
 * Lara-style rope traversal:
 * - press E near rope to grab,
 * - W/S climb up/down,
 * - A/D pump swing,
 * - Space to jump off, C to drop.
 */
export class PhysicsRope implements IInteractable {
  readonly id: string;
  readonly position: THREE.Vector3;
  readonly collider: RAPIER.Collider;

  private readonly scene: THREE.Scene;
  private readonly physicsWorld: PhysicsWorld;
  private readonly root = new THREE.Group();
  private readonly anchorBody: RAPIER.RigidBody;
  private readonly sensorBody: RAPIER.RigidBody;
  private readonly segmentBodies: RAPIER.RigidBody[] = [];
  private readonly segmentColliders: RAPIER.Collider[] = [];
  private readonly segmentMeshes: THREE.Mesh[] = [];
  private readonly prevSegmentPos: THREE.Vector3[] = [];
  private readonly currSegmentPos: THREE.Vector3[] = [];
  private hasPose = false;
  private readonly joints: RAPIER.ImpulseJoint[] = [];
  private readonly jointBallMaterial: THREE.MeshStandardMaterial;
  private readonly ropeTopY: number;
  private readonly segmentLength = 0.52;
  private readonly segmentCount = 7;
  private attachJoint: RAPIER.ImpulseJoint | null = null;
  private attachedPlayer: PlayerController | null = null;
  private attachedSegmentIndex = -1;
  private climbStepCooldown = 0;
  private readonly climbStepInterval = 0.14;
  private readonly player: PlayerController;
  private readonly playerBaseSolverIters: number;

  get label(): string {
    return "Grab Rope";
  }

  constructor(
    id: string,
    anchorPosition: THREE.Vector3,
    scene: THREE.Scene,
    physicsWorld: PhysicsWorld,
    player: PlayerController,
  ) {
    this.id = id;
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.player = player;
    this.playerBaseSolverIters = this.player.body.additionalSolverIterations();
    this.position = anchorPosition.clone().add(new THREE.Vector3(0, -this.segmentLength * this.segmentCount, 0));
    this.ropeTopY = anchorPosition.y;
    this.jointBallMaterial = new THREE.MeshStandardMaterial({
      color: 0xc8d6e5,
      roughness: 0.7,
      metalness: 0.2,
    });

    this.root.name = `PhysicsRope_${id}`;
    this.scene.add(this.root);

    // Fixed anchor body.
    this.anchorBody = physicsWorld.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(anchorPosition.x, anchorPosition.y, anchorPosition.z),
    );
    const anchorCollider = physicsWorld.world.createCollider(
      RAPIER.ColliderDesc.ball(0.18).setCollisionGroups(COLLISION_GROUP_ROPE),
      this.anchorBody,
    );
    this.segmentColliders.push(anchorCollider);
    const anchorMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x5d6d7e, roughness: 0.6 }),
    );
    anchorMesh.castShadow = true;
    anchorMesh.receiveShadow = true;
    anchorMesh.position.copy(anchorPosition);
    this.root.add(anchorMesh);
    this.segmentMeshes.push(anchorMesh);
    this.prevSegmentPos.push(anchorPosition.clone());
    this.currSegmentPos.push(anchorPosition.clone());

    let prevBody: RAPIER.RigidBody = this.anchorBody;
    for (let i = 0; i < this.segmentCount; i++) {
      const y = anchorPosition.y - this.segmentLength * (i + 1);
      const body = physicsWorld.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(anchorPosition.x, y, anchorPosition.z),
      );
      body.enableCcd(true);
      body.setAdditionalSolverIterations(ROPE_SOLVER_ITERS);
      body.setLinearDamping(ROPE_IDLE_LINEAR_DAMPING);
      body.setAngularDamping(ROPE_IDLE_ANGULAR_DAMPING);
      const collider = physicsWorld.world.createCollider(
        RAPIER.ColliderDesc.ball(i === this.segmentCount - 1 ? 0.19 : 0.15)
          .setDensity(1.0)
          .setCollisionGroups(COLLISION_GROUP_ROPE),
        body,
      );
      body.setAdditionalMass(i === this.segmentCount - 1 ? ROPE_TAIL_MASS : ROPE_SEGMENT_MASS, true);
      this.segmentBodies.push(body);
      this.segmentColliders.push(collider);

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(i === this.segmentCount - 1 ? 0.19 : 0.15, 14, 10),
        this.jointBallMaterial,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(anchorPosition.x, y, anchorPosition.z);
      this.root.add(mesh);
      this.segmentMeshes.push(mesh);
      this.prevSegmentPos.push(mesh.position.clone());
      this.currSegmentPos.push(mesh.position.clone());

      const joint = physicsWorld.world.createImpulseJoint(
        RAPIER.JointData.spherical(
          { x: 0, y: -this.segmentLength * 0.5, z: 0 } as RAPIER.Vector3,
          { x: 0, y: this.segmentLength * 0.5, z: 0 } as RAPIER.Vector3,
        ),
        prevBody,
        body,
        true,
      );
      // Prevent jointed neighbors from generating contact impulses against each other.
      // This is a major source of rope jitter/explosions with ball segments.
      joint.setContactsEnabled(false);
      this.joints.push(joint);
      prevBody = body;
    }

    // Interaction sensor centered on rope mid-point.
    this.sensorBody = physicsWorld.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.position.x, this.position.y, this.position.z),
    );
    this.collider = physicsWorld.world.createCollider(
      RAPIER.ColliderDesc.cuboid(1.65, 2.3, 1.65).setSensor(true).setCollisionGroups(COLLISION_GROUP_INTERACTABLE),
      this.sensorBody,
    );
  }

  getInteractionSpec(): InteractionSpec {
    return { mode: "press" };
  }

  canInteract(player: PlayerController): InteractionAccess {
    if (this.attachedPlayer === player) {
      return { allowed: false, reason: "WSAD swing, Shift+W/S climb, Space release" };
    }
    return { allowed: true };
  }

  getIgnoredColliderHandles(): number[] {
    return [this.collider.handle, ...this.segmentColliders.map((c) => c.handle)];
  }

  update(_dt: number): void {
    const tailBody = this.segmentBodies[this.segmentBodies.length - 1];
    if (tailBody) {
      const tail = tailBody.translation();
      _tailPos.set(tail.x, tail.y, tail.z);
      const anchor = this.anchorBody.translation();
      _anchorPos.set(anchor.x, anchor.y, anchor.z);
      _rv3RopeA.x = (_anchorPos.x + _tailPos.x) * 0.5;
      _rv3RopeA.y = (_anchorPos.y + _tailPos.y) * 0.5;
      _rv3RopeA.z = (_anchorPos.z + _tailPos.z) * 0.5;
      this.sensorBody.setNextKinematicTranslation(_rv3RopeA);
    }

    // Segment meshes are updated with render interpolation in renderUpdate(alpha).

    this.climbStepCooldown = Math.max(0, this.climbStepCooldown - _dt);

    if (!this.attachedPlayer) {
      this.updateInteractionPositionFromClosestSegment();
      this.dampWhenFar();
      return;
    }

    this.updateInteractionPositionFromAttachedSegment();
    this.handleAttachedInput(this.attachedPlayer.lastInputSnapshot);
  }

  postPhysicsUpdate(): void {
    // Capture physics poses for smooth render interpolation.
    // Mesh snapping at fixed-step (60Hz) produces jitter when the camera/player are interpolated each frame.
    const a = this.anchorBody.translation();
    if (!this.hasPose) {
      this.prevSegmentPos[0].set(a.x, a.y, a.z);
      this.currSegmentPos[0].set(a.x, a.y, a.z);
      for (let i = 0; i < this.segmentBodies.length; i++) {
        const p = this.segmentBodies[i].translation();
        this.prevSegmentPos[i + 1].set(p.x, p.y, p.z);
        this.currSegmentPos[i + 1].set(p.x, p.y, p.z);
      }
      this.hasPose = true;
      return;
    }
    this.prevSegmentPos[0].copy(this.currSegmentPos[0]);
    this.currSegmentPos[0].set(a.x, a.y, a.z);
    for (let i = 0; i < this.segmentBodies.length; i++) {
      const p = this.segmentBodies[i].translation();
      this.prevSegmentPos[i + 1].copy(this.currSegmentPos[i + 1]);
      this.currSegmentPos[i + 1].set(p.x, p.y, p.z);
    }
  }

  renderUpdate(alpha: number): void {
    if (!this.hasPose) return;
    for (let i = 0; i < this.segmentMeshes.length; i++) {
      this.segmentMeshes[i].position.lerpVectors(this.prevSegmentPos[i], this.currSegmentPos[i], alpha);
    }
  }

  onFocus(): void {
    this.jointBallMaterial.emissive.setHex(0x1f4a60);
    this.jointBallMaterial.emissiveIntensity = 0.45;
  }

  onBlur(): void {
    this.jointBallMaterial.emissive.setHex(0x000000);
    this.jointBallMaterial.emissiveIntensity = 0;
  }

  interact(player: PlayerController): void {
    if (this.attachedPlayer === player) return;
    this.attachPlayer(player);
  }

  dispose(): void {
    this.detachPlayer(false);
    this.scene.remove(this.root);
    const disposedMaterials = new Set<THREE.Material>();
    for (const mesh of this.segmentMeshes) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) {
          if (!disposedMaterials.has(material)) {
            disposedMaterials.add(material);
            material.dispose();
          }
        }
      } else {
        if (!disposedMaterials.has(mesh.material)) {
          disposedMaterials.add(mesh.material);
          mesh.material.dispose();
        }
      }
    }
    for (const joint of this.joints) {
      this.physicsWorld.world.removeImpulseJoint(joint, true);
    }
    this.physicsWorld.removeBody(this.sensorBody);
    for (const body of this.segmentBodies) {
      this.physicsWorld.removeBody(body);
    }
    this.physicsWorld.removeBody(this.anchorBody);
  }

  private attachPlayer(player: PlayerController): void {
    if (this.segmentBodies.length === 0) return;
    this.detachPlayer(false);
    player.attachToRope();
    const carryVel = player.body.linvel();

    const nearestIndex = this.findClosestSegmentIndex(player.position);
    this.attachedPlayer = player;
    this.attachToSegment(nearestIndex, false);
    player.body.setAdditionalSolverIterations(Math.max(this.playerBaseSolverIters, PLAYER_SOLVER_ITERS_WHILE_ATTACHED));
    _rv3RopeA.x = carryVel.x * 0.28;
    _rv3RopeA.y = carryVel.y * 0.12;
    _rv3RopeA.z = carryVel.z * 0.28;
    player.body.setLinvel(_rv3RopeA, true);
    _rv3RopeB.x = 0;
    _rv3RopeB.y = 0;
    _rv3RopeB.z = 0;
    player.body.setAngvel(_rv3RopeB, true);
    for (const body of this.segmentBodies) {
      body.setLinearDamping(ROPE_ATTACHED_LINEAR_DAMPING);
      body.setAngularDamping(ROPE_ATTACHED_ANGULAR_DAMPING);
      body.wakeUp();
    }
    this.jointBallMaterial.emissive.setHex(0x1f4a60);
    this.jointBallMaterial.emissiveIntensity = 0.7;
  }

  private detachPlayer(jumpOff: boolean): void {
    const player = this.attachedPlayer;
    if (!player) return;
    if (this.attachJoint) {
      this.physicsWorld.world.removeImpulseJoint(this.attachJoint, true);
      this.attachJoint = null;
    }
    player.detachFromRope();
    player.body.setAdditionalSolverIterations(this.playerBaseSolverIters);
    for (const body of this.segmentBodies) {
      body.setLinearDamping(ROPE_IDLE_LINEAR_DAMPING);
      body.setAngularDamping(ROPE_IDLE_ANGULAR_DAMPING);
    }
    if (jumpOff) {
      const forward = player.getCameraForward().clone().setY(0).normalize();
      if (forward.lengthSq() < 0.001) {
        forward.set(0, 0, -1);
      }
      const boostY = 3.2 + Math.max(0, this.ropeTopY - player.position.y) * 0.18;
      _rv3RopeA.x = forward.x * 3.6;
      _rv3RopeA.y = boostY;
      _rv3RopeA.z = forward.z * 3.6;
      player.body.applyImpulse(_rv3RopeA, true);
    }
    this.attachedSegmentIndex = -1;
    this.climbStepCooldown = 0;
    this.attachedPlayer = null;
    this.jointBallMaterial.emissive.setHex(0x000000);
    this.jointBallMaterial.emissiveIntensity = 0;
  }

  private handleAttachedInput(input: InputState | null): void {
    const player = this.attachedPlayer;
    if (!player) return;
    if (!input) return;

    if (input.jumpPressed) {
      this.detachPlayer(true);
      return;
    }
    if (input.crouchPressed) {
      this.detachPlayer(false);
      return;
    }

    const climbAxis = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const wantsClimb = input.sprint && climbAxis !== 0;
    if (wantsClimb) {
      if (this.climbStepCooldown <= 0) {
        // Forward climbs up (toward anchor), backward climbs down.
        this.attachToSegment(this.attachedSegmentIndex + (climbAxis > 0 ? -1 : 1), true);
        this.climbStepCooldown = this.climbStepInterval;
      }
      return;
    }

    this.applySwingInput(input);
  }

  private applySwingInput(input: InputState): void {
    const player = this.attachedPlayer;
    if (!player) return;
    const segment = this.segmentBodies[this.attachedSegmentIndex];
    if (!segment) return;

    _swingDesired.copy(player.computeMovementDirection(input)).setY(0);
    if (_swingDesired.lengthSq() < 0.0001) return;
    _swingDesired.normalize();

    const segmentT = segment.translation();
    const playerT = player.body.translation();
    _segmentPos.set(segmentT.x, segmentT.y, segmentT.z);
    _playerPos.set(playerT.x, playerT.y, playerT.z);
    _pivotToPlayer.subVectors(_playerPos, _segmentPos);
    if (_pivotToPlayer.lengthSq() < 0.0001) return;
    _pivotToPlayer.normalize();

    // Tangential impulse around pivot based on camera-relative desired move direction.
    _swingTangent.copy(_swingDesired).addScaledVector(_pivotToPlayer, -_swingDesired.dot(_pivotToPlayer));
    if (_swingTangent.lengthSq() < 0.0001) return;
    _swingTangent.normalize();
    if (_swingTangent.dot(_worldUp) > 0.9) {
      return;
    }
    const pump = input.sprint ? 2.8 : 2.1;
    _swingTangent.multiplyScalar(pump);

    _tempRopeImpulse.x = _swingTangent.x;
    _tempRopeImpulse.y = _swingTangent.y * 0.08;
    _tempRopeImpulse.z = _swingTangent.z;
    player.body.applyImpulse(_tempRopeImpulse, true);
    segment.wakeUp();
  }

  private updateInteractionPositionFromClosestSegment(): void {
    const idx = this.findClosestSegmentIndex(this.player.position);
    const body = this.segmentBodies[idx];
    if (!body) return;
    const t = body.translation();
    this.position.set(t.x, t.y, t.z);
  }

  private updateInteractionPositionFromAttachedSegment(): void {
    const body = this.segmentBodies[this.attachedSegmentIndex];
    if (!body) return;
    const t = body.translation();
    this.position.set(t.x, t.y, t.z);
  }

  private findClosestSegmentIndex(point: THREE.Vector3): number {
    if (this.segmentBodies.length === 0) return 0;
    let closest = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.segmentBodies.length; i++) {
      const t = this.segmentBodies[i].translation();
      const dx = point.x - t.x;
      const dy = point.y - t.y;
      const dz = point.z - t.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        closest = i;
      }
    }
    return closest;
  }

  private attachToSegment(index: number, preserveVelocity: boolean): void {
    const player = this.attachedPlayer;
    if (!player) return;
    if (this.segmentBodies.length === 0) return;
    const clamped = Math.max(0, Math.min(this.segmentBodies.length - 1, index));
    const segment = this.segmentBodies[clamped];
    if (!segment) return;

    if (this.attachJoint) {
      this.physicsWorld.world.removeImpulseJoint(this.attachJoint, true);
      this.attachJoint = null;
    }

    const t = segment.translation();
    const playerTopAnchor = this.getPlayerTopAnchor(player);
    _rv3RopeA.x = t.x;
    _rv3RopeA.y = t.y - (playerTopAnchor + 0.08);
    _rv3RopeA.z = t.z;
    player.body.setTranslation(_rv3RopeA, true);
    if (!preserveVelocity) {
      _rv3RopeB.x = 0;
      _rv3RopeB.y = 0;
      _rv3RopeB.z = 0;
      player.body.setLinvel(_rv3RopeB, true);
    } else {
      const lv = player.body.linvel();
      _rv3RopeB.x = lv.x * 0.85;
      _rv3RopeB.y = lv.y * 0.2;
      _rv3RopeB.z = lv.z * 0.85;
      player.body.setLinvel(_rv3RopeB, true);
    }
    player.body.wakeUp();
    segment.wakeUp();

    this.attachJoint = this.physicsWorld.world.createImpulseJoint(
      RAPIER.JointData.spherical(
        { x: 0, y: -0.08, z: 0 } as RAPIER.Vector3,
        { x: 0, y: playerTopAnchor, z: 0 } as RAPIER.Vector3,
      ),
      segment,
      player.body,
      true,
    );
    this.attachJoint.setContactsEnabled(false);
    this.attachedSegmentIndex = clamped;
  }

  private getPlayerTopAnchor(player: PlayerController): number {
    return player.config.capsuleHalfHeight + player.config.capsuleRadius - 0.05;
  }

  private dampWhenFar(): void {
    const distanceToPlayer = this.player.position.distanceTo(this.position);
    if (distanceToPlayer < 12) return;
    const linKeep = distanceToPlayer > 20 ? 0.86 : 0.92;
    const angKeep = distanceToPlayer > 20 ? 0.84 : 0.9;
    for (const body of this.segmentBodies) {
      const lv = body.linvel();
      const av = body.angvel();
      _rv3RopeA.x = lv.x * linKeep;
      _rv3RopeA.y = lv.y * linKeep;
      _rv3RopeA.z = lv.z * linKeep;
      body.setLinvel(_rv3RopeA, true);
      _rv3RopeB.x = av.x * angKeep;
      _rv3RopeB.y = av.y * angKeep;
      _rv3RopeB.z = av.z * angKeep;
      body.setAngvel(_rv3RopeB, true);
    }
  }
}
