import * as THREE from 'three';
import type { AssetLoader } from '@level/AssetLoader';
import type { AnimationController } from '@character/animation/AnimationController';
import type { CharacterModel } from '@character/animation/CharacterModel';
import { createAnimatedCharacter } from '@character/animation/CharacterFactory';
import { NPC_PROFILE } from '@character/animation/profiles';
import { STATE } from '@core/types';

export class NavAgent {
  readonly mesh: THREE.Group;
  readonly id: string;
  private pathLine: THREE.Line | null = null;
  private pathLineMaterial: THREE.LineBasicMaterial | null = null;
  private pathPositions: Float32Array | null = null;
  private pathAttribute: THREE.BufferAttribute | null = null;
  private pathCapacity = 0;

  private capsuleMesh: THREE.Mesh;
  private characterModel: CharacterModel | null = null;
  private animator: AnimationController | null = null;
  private prevPosition = new THREE.Vector3();
  private velocity = 0;

  constructor(scene: THREE.Scene, position: THREE.Vector3, private tintColor?: THREE.Color) {
    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);

    const geometry = new THREE.CapsuleGeometry(0.25, 0.5, 4, 8);
    const material = new THREE.MeshStandardMaterial({
      color: tintColor ?? 0xff6600,
      roughness: 0.5,
    });
    this.capsuleMesh = new THREE.Mesh(geometry, material);
    this.capsuleMesh.castShadow = true;
    this.mesh.add(this.capsuleMesh);

    this.id = THREE.MathUtils.generateUUID();
    scene.add(this.mesh);
    this.prevPosition.copy(position);
  }

  async init(loader: AssetLoader): Promise<void> {
    try {
      const { model, animator } = await createAnimatedCharacter(
        NPC_PROFILE, this.mesh, loader,
        { tint: this.tintColor },
      );
      this.characterModel = model;
      this.animator = animator;
      this.capsuleMesh.visible = false;
    } catch (err) {
      console.warn('[NavAgent] Model load failed, keeping capsule:', err);
    }
  }

  updatePosition(position: { x: number; y: number; z: number }, dt?: number): void {
    const newX = position.x;
    const newY = position.y + 0.5;
    const newZ = position.z;

    // Compute velocity from position delta
    if (dt && dt > 0) {
      const dx = newX - this.prevPosition.x;
      const dy = newY - this.prevPosition.y;
      const dz = newZ - this.prevPosition.z;
      this.velocity = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;

      // Rotate toward movement direction
      if (dx * dx + dz * dz > 0.0001) {
        this.mesh.rotation.y = Math.atan2(dx, dz);
      }
    }

    this.prevPosition.set(newX, newY, newZ);
    this.mesh.position.set(newX, newY, newZ);

    if (this.animator) {
      this.animator.setState(this.velocity > 0.1 ? STATE.move : STATE.idle);
      this.animator.setSpeed(this.velocity);
    }
  }

  update(dt: number): void {
    this.animator?.update(dt);
  }

  updatePathVisualization(
    scene: THREE.Scene,
    points: Array<{ x: number; y: number; z: number }>,
  ): void {
    if (points.length < 2) {
      if (this.pathLine) this.pathLine.visible = false;
      return;
    }

    if (!this.pathLine) {
      this.pathLineMaterial = new THREE.LineBasicMaterial({
        color: 0x00bcd4,
        transparent: true,
        opacity: 0.6,
      });
      const pathGeometry = new THREE.BufferGeometry();
      this.pathLine = new THREE.Line(pathGeometry, this.pathLineMaterial);
      scene.add(this.pathLine);
    }

    // Update geometry buffer in-place — only reallocate when point count grows.
    const neededFloats = points.length * 3;
    if (!this.pathPositions || this.pathCapacity < points.length) {
      this.pathCapacity = points.length;
      this.pathPositions = new Float32Array(neededFloats);
      this.pathAttribute = new THREE.BufferAttribute(this.pathPositions, 3);
      this.pathLine.geometry.setAttribute('position', this.pathAttribute);
    }
    const positions = this.pathPositions;
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i].x;
      positions[i * 3 + 1] = points[i].y + 0.1;
      positions[i * 3 + 2] = points[i].z;
    }
    this.pathAttribute!.needsUpdate = true;
    this.pathLine.geometry.setDrawRange(0, points.length);
    this.pathLine.visible = true;
  }

  highlight(durationMs = 2000): void {
    if (this.characterModel) {
      this.characterModel.root.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const mat = node.material as THREE.MeshStandardMaterial;
          if (mat.isMeshStandardMaterial) {
            const origIntensity = mat.emissiveIntensity;
            const origEmissive = mat.emissive.getHex();
            mat.emissiveIntensity = 0.6;
            mat.emissive.setHex(0x00ff88);
            setTimeout(() => {
              mat.emissiveIntensity = origIntensity;
              mat.emissive.setHex(origEmissive);
            }, durationMs);
          }
        }
      });
    } else {
      const mat = this.capsuleMesh.material as THREE.MeshStandardMaterial;
      const originalColor = mat.color.getHex();
      mat.color.setHex(0x00ff88);
      mat.emissive.setHex(0x00ff88);
      mat.emissiveIntensity = 0.6;
      setTimeout(() => {
        mat.color.setHex(originalColor);
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }, durationMs);
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.capsuleMesh.geometry.dispose();
    (this.capsuleMesh.material as THREE.Material).dispose();
    this.animator?.dispose();
    this.characterModel?.dispose();

    if (this.pathLine) {
      scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
    }
    if (this.pathLineMaterial) {
      this.pathLineMaterial.dispose();
    }
  }
}
