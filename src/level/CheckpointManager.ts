import * as THREE from 'three';
import type { EventBus } from '@core/EventBus';
import type { FixedUpdatable, Disposable, SpawnPointData } from '@core/types';
import type { PlayerController } from '@character/PlayerController';

interface CheckpointEntry {
  id: string;
  radius: number;
  position: THREE.Vector3;
  mesh: THREE.Mesh;
}

/**
 * Handles checkpoint activation and emits checkpoint events.
 */
export class CheckpointManager implements FixedUpdatable, Disposable {
  private checkpoints: CheckpointEntry[] = [];
  private activeCheckpointId: string | null = null;

  constructor(
    private scene: THREE.Scene,
    private player: PlayerController,
    private eventBus: EventBus,
  ) {}

  addCheckpoint(id: string, position: THREE.Vector3, radius = 2.2): void {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.6, 0.1, 10, 24),
      new THREE.MeshStandardMaterial({
        color: 0x66ccff,
        emissive: 0x003344,
        roughness: 0.55,
        metalness: 0.2,
      }),
    );
    mesh.position.copy(position);
    mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = `Checkpoint_${id}`;
    this.scene.add(mesh);

    this.checkpoints.push({
      id,
      radius,
      position: position.clone(),
      mesh,
    });
    this.applyVisualState();
  }

  fixedUpdate(dt: number): void {
    for (const checkpoint of this.checkpoints) {
      checkpoint.mesh.rotation.z += dt * 0.9;
    }

    const playerPos = this.player.position;
    for (const checkpoint of this.checkpoints) {
      if (checkpoint.id === this.activeCheckpointId) continue;
      const distSq = checkpoint.position.distanceToSquared(playerPos);
      if (distSq <= checkpoint.radius * checkpoint.radius) {
        this.activeCheckpointId = checkpoint.id;
        this.applyVisualState();
        this.eventBus.emit('checkpoint:activated', {
          id: checkpoint.id,
          position: {
            x: checkpoint.position.x,
            y: checkpoint.position.y,
            z: checkpoint.position.z,
          },
        });
        return;
      }
    }
  }

  getActiveSpawnPoint(defaultSpawn: SpawnPointData): SpawnPointData {
    const active = this.checkpoints.find((c) => c.id === this.activeCheckpointId);
    if (!active) return defaultSpawn;
    return {
      position: active.position.clone(),
    };
  }

  dispose(): void {
    for (const checkpoint of this.checkpoints) {
      this.scene.remove(checkpoint.mesh);
      checkpoint.mesh.geometry.dispose();
      const mat = checkpoint.mesh.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => m.dispose());
      } else {
        mat.dispose();
      }
    }
    this.checkpoints = [];
    this.activeCheckpointId = null;
  }

  private applyVisualState(): void {
    for (const checkpoint of this.checkpoints) {
      const mat = checkpoint.mesh.material as THREE.MeshStandardMaterial;
      const active = checkpoint.id === this.activeCheckpointId;
      mat.color.set(active ? 0x7cff8f : 0x66ccff);
      mat.emissive.set(active ? 0x0b5520 : 0x003344);
    }
  }
}

