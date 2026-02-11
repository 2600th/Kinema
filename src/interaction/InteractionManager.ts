import type { EventBus } from '@core/EventBus';
import type { FixedUpdatable, Disposable } from '@core/types';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  INTERACTION_SENSOR_RADIUS,
  INTERACTION_SENSOR_HALF_HEIGHT,
} from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { PlayerController } from '@character/PlayerController';
import { ColliderFactory } from '@physics/ColliderFactory';
import type { IInteractable } from './Interactable';

/**
 * Manages proximity-based interaction detection.
 * Creates a sensor on the player and tracks nearby interactables.
 */
export class InteractionManager implements FixedUpdatable, Disposable {
  private interactables = new Map<string, IInteractable>();
  private focusedId: string | null = null;
  private insideIds = new Set<string>();

  // Map collider handles to interactable IDs for fast lookup
  private colliderToId = new Map<number, string>();
  private playerSensor: RAPIER.Collider;

  constructor(
    private physicsWorld: PhysicsWorld,
    private player: PlayerController,
    private eventBus: EventBus,
  ) {
    const colliderFactory = new ColliderFactory(this.physicsWorld);

    // Create sensor cylinder on player body
    this.playerSensor = colliderFactory.createCylinderSensor(
      this.player.body,
      INTERACTION_SENSOR_HALF_HEIGHT,
      INTERACTION_SENSOR_RADIUS,
    );
  }

  /** Register an interactable object. */
  register(interactable: IInteractable): void {
    this.interactables.set(interactable.id, interactable);
    this.colliderToId.set(interactable.collider.handle, interactable.id);
  }

  /** Unregister an interactable object. */
  unregister(id: string): void {
    const interactable = this.interactables.get(id);
    if (interactable) {
      this.colliderToId.delete(interactable.collider.handle);
      this.interactables.delete(id);

      if (this.focusedId === id) {
        interactable.onBlur();
        this.focusedId = null;
        this.eventBus.emit('interaction:focusChanged', { id: null, label: null });
      }
    }
  }

  /** Check sensor overlaps, sort in-range targets by distance, and update focus. */
  fixedUpdate(dt: number): void {
    for (const interactable of this.interactables.values()) {
      interactable.update(dt);
    }

    const playerPos = this.player.position;
    const sortedByDistance = Array.from(this.interactables.entries())
      .map(([id, interactable]) => ({
        id,
        distance: playerPos.distanceTo(interactable.position),
        position: interactable.position,
      }))
      .filter((e) => Number.isFinite(e.distance) && e.position != null)
      .sort((a, b) => a.distance - b.distance);

    const closestId =
      sortedByDistance.length > 0 &&
      sortedByDistance[0].distance <= INTERACTION_SENSOR_RADIUS + 0.1
        ? sortedByDistance[0].id
        : null;

    // Update focus
    if (closestId !== this.focusedId) {
      if (this.focusedId) {
        const prev = this.interactables.get(this.focusedId);
        prev?.onBlur();
      }
      if (closestId) {
        const next = this.interactables.get(closestId);
        next?.onFocus();
      }
      this.focusedId = closestId;

      const label = closestId ? this.interactables.get(closestId)?.label ?? null : null;
      this.eventBus.emit('interaction:focusChanged', { id: closestId, label });
    }
  }

  /**
   * Refresh focus from a position (e.g. after player moved).
   * Fixes 1-frame lag when entering range and pressing E in the same tick.
   * Filters out occluded interactables (blocked by world geometry).
   */
  refreshFocusFromPosition(position: { x: number; y: number; z: number }): void {
    const sorted = Array.from(this.interactables.entries())
      .map(([id, ia]) => ({
        id,
        distance: Math.sqrt(
          (position.x - ia.position.x) ** 2 +
            (position.y - ia.position.y) ** 2 +
            (position.z - ia.position.z) ** 2,
        ),
        position: ia.position,
      }))
      .filter((e) => e.distance <= INTERACTION_SENSOR_RADIUS + 0.1)
      .sort((a, b) => a.distance - b.distance);

    const closestId = sorted.length > 0 ? sorted[0].id : null;
    if (closestId === this.focusedId) return;

    if (this.focusedId) {
      this.interactables.get(this.focusedId)?.onBlur();
    }
    if (closestId) {
      this.interactables.get(closestId)?.onFocus();
    }
    this.focusedId = closestId;
    const label = closestId ? this.interactables.get(closestId)?.label ?? null : null;
    this.eventBus.emit('interaction:focusChanged', { id: closestId, label });
  }

  /** Trigger interaction on the focused interactable. */
  triggerInteraction(): void {
    if (!this.focusedId) return;

    const target = this.interactables.get(this.focusedId);
    if (target) {
      target.interact(this.player);
      this.eventBus.emit('interaction:triggered', { id: this.focusedId });
    }
  }

  dispose(): void {
    if (this.focusedId) {
      this.interactables.get(this.focusedId)?.onBlur();
      this.eventBus.emit('interaction:focusChanged', { id: null, label: null });
      this.focusedId = null;
    }

    this.physicsWorld.removeCollider(this.playerSensor);

    for (const interactable of this.interactables.values()) {
      interactable.dispose();
    }
    this.insideIds.clear();
    this.interactables.clear();
    this.colliderToId.clear();
  }
}
