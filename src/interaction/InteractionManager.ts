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

/** Key displayed in interaction prompts. Change here to rebind the interact key label. */
const INTERACT_KEY_LABEL = 'F';

const _losOrigin = { x: 0, y: 0, z: 0 } as RAPIER.Vector3;
const _losDir = { x: 0, y: 0, z: 0 } as RAPIER.Vector3;

interface HoldInteraction {
  id: string;
  elapsed: number;
  duration: number;
}

/**
 * Manages proximity-based interaction detection.
 * Creates a sensor on the player and tracks nearby interactables.
 */
export class InteractionManager implements FixedUpdatable, Disposable {
  private interactables = new Map<string, IInteractable>();
  private focusedId: string | null = null;
  private focusedLabel: string | null = null;
  private playerSensor: RAPIER.Collider;
  private holdInteraction: HoldInteraction | null = null;
  private enabled = true;

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
  }

  /** Unregister an interactable object. */
  unregister(id: string): void {
    const interactable = this.interactables.get(id);
    if (interactable) {
      this.interactables.delete(id);

      if (this.focusedId === id) {
        interactable.onBlur();
        this.focusedId = null;
        this.focusedLabel = null;
        this.eventBus.emit('interaction:focusChanged', { id: null, label: null });
      }
    }
  }

  /** Update interactables and choose closest visible in-range target. */
  fixedUpdate(dt: number): void {
    if (!this.enabled) return;
    for (const interactable of this.interactables.values()) {
      interactable.update(dt);
    }

    this.updateFocus(this.getClosestVisibleInteractableId(this.player.position));
    this.updateHoldInteraction(dt);
  }

  /**
   * Refresh focus from a position (e.g. after player moved).
   * Fixes 1-frame lag when entering range and pressing E in the same tick.
   * Filters out occluded interactables (blocked by world geometry).
   */
  refreshFocusFromPosition(position: { x: number; y: number; z: number }): void {
    if (!this.enabled) return;
    this.updateFocus(this.getClosestVisibleInteractableId(position));
  }

  private _candidateBuffer: Array<{ id: string; interactable: IInteractable; distance: number }> = [];

  private getClosestVisibleInteractableId(position: { x: number; y: number; z: number }): string | null {
    const maxRange = INTERACTION_SENSOR_RADIUS + 0.1;
    const buf = this._candidateBuffer;
    buf.length = 0;

    for (const [id, ia] of this.interactables) {
      const dx = position.x - ia.position.x;
      const dy = position.y - ia.position.y;
      const dz = position.z - ia.position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance <= maxRange) {
        buf.push({ id, interactable: ia, distance });
      }
    }

    buf.sort((a, b) => a.distance - b.distance);

    for (let i = 0; i < buf.length; i++) {
      if (this.isLineOfSightClear(position, buf[i].interactable)) {
        return buf[i].id;
      }
    }

    return null;
  }

  private isLineOfSightClear(
    position: { x: number; y: number; z: number },
    interactable: IInteractable,
  ): boolean {
    const ignoredHandles = interactable.getIgnoredColliderHandles?.() ?? [];
    const isIgnoredHandle = (handle: number): boolean =>
      handle === interactable.collider.handle || ignoredHandles.includes(handle);
    const originY = position.y + INTERACTION_SENSOR_HALF_HEIGHT * 0.35;
    const dx = interactable.position.x - position.x;
    const dy = interactable.position.y - originY;
    const dz = interactable.position.z - position.z;
    const maxDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!Number.isFinite(maxDistance) || maxDistance <= 0.001) {
      return true;
    }

    const invLength = 1 / maxDistance;
    _losOrigin.x = position.x; _losOrigin.y = originY; _losOrigin.z = position.z;
    _losDir.x = dx * invLength; _losDir.y = dy * invLength; _losDir.z = dz * invLength;
    const rayHit = this.physicsWorld.castRay(
      _losOrigin,
      _losDir,
      maxDistance,
      undefined,
      this.player.body,
      (collider) => !collider.isSensor() && !isIgnoredHandle(collider.handle),
    );
    return !rayHit || rayHit.timeOfImpact >= maxDistance - 0.01;
  }

  private updateFocus(closestId: string | null): void {
    if (closestId === this.focusedId) {
      const nextLabel = this.buildPromptLabel(closestId);
      if (nextLabel !== this.focusedLabel) {
        this.focusedLabel = nextLabel;
        this.eventBus.emit('interaction:focusChanged', { id: closestId, label: nextLabel });
      }
      return;
    }

    if (this.focusedId) {
      this.interactables.get(this.focusedId)?.onBlur();
    }
    if (closestId) {
      this.interactables.get(closestId)?.onFocus();
    }
    this.focusedId = closestId;
    const label = this.buildPromptLabel(closestId);
    this.focusedLabel = label;
    if (!closestId) {
      this.clearHoldInteraction();
    }
    this.eventBus.emit('interaction:focusChanged', { id: closestId, label });
  }

  /** Trigger interaction on the focused interactable. */
  triggerInteraction(): void {
    if (!this.enabled) return;
    if (!this.focusedId) return;

    const target = this.interactables.get(this.focusedId);
    if (!target) return;

    const access = target.canInteract?.(this.player);
    if (access && !access.allowed) {
      this.eventBus.emit('interaction:blocked', {
        id: target.id,
        reason: access.reason ?? 'Cannot interact right now',
      });
      return;
    }

    const spec = target.getInteractionSpec?.();
    if (spec?.mode === 'hold') {
      const duration = Math.max(spec.holdDuration ?? 0.75, 0.05);
      this.holdInteraction = {
        id: target.id,
        elapsed: 0,
        duration,
      };
      target.setHoldProgress?.(0);
      this.eventBus.emit('interaction:holdProgress', {
        id: target.id,
        progress: 0,
        position: target.position.clone(),
      });
      return;
    }

    this.executeInteraction(target);
  }

  private executeInteraction(target: IInteractable): void {
    target.interact(this.player);
    this.eventBus.emit('interaction:triggered', { id: target.id });
  }

  private updateHoldInteraction(dt: number): void {
    if (!this.holdInteraction) return;
    if (!this.focusedId || this.holdInteraction.id !== this.focusedId) {
      this.clearHoldInteraction();
      return;
    }

    const input = this.player.lastInputSnapshot;
    if (!input?.interact) {
      this.clearHoldInteraction();
      return;
    }

    const target = this.interactables.get(this.holdInteraction.id);
    if (!target) {
      this.holdInteraction = null;
      return;
    }

    this.holdInteraction.elapsed += dt;
    const progress = Math.max(0, Math.min(1, this.holdInteraction.elapsed / this.holdInteraction.duration));
    target.setHoldProgress?.(progress);
    this.eventBus.emit('interaction:holdProgress', {
      id: this.holdInteraction.id,
      progress,
      position: target.position.clone(),
    });
    if (this.holdInteraction.elapsed >= this.holdInteraction.duration) {
      this.executeInteraction(target);
      this.clearHoldInteraction();
    }
  }

  private clearHoldInteraction(): void {
    if (this.holdInteraction) {
      this.interactables.get(this.holdInteraction.id)?.setHoldProgress?.(null);
      this.holdInteraction = null;
    }
    this.eventBus.emit('interaction:holdProgress', null);
  }

  private buildPromptLabel(id: string | null): string | null {
    if (!id) return null;
    const target = this.interactables.get(id);
    if (!target) return null;
    const access = target.canInteract?.(this.player);
    if (access && !access.allowed) {
      return access.reason ?? 'Locked';
    }
    const spec = target.getInteractionSpec?.();
    const verb = spec?.mode === 'hold' ? `Hold ${INTERACT_KEY_LABEL} to` : `Press ${INTERACT_KEY_LABEL} to`;
    return `${verb} ${target.label}`;
  }

  dispose(): void {
    if (this.focusedId) {
      this.interactables.get(this.focusedId)?.onBlur();
      this.eventBus.emit('interaction:focusChanged', { id: null, label: null });
      this.focusedId = null;
      this.focusedLabel = null;
    }
    this.clearHoldInteraction();

    this.physicsWorld.removeCollider(this.playerSensor);

    for (const interactable of this.interactables.values()) {
      interactable.dispose();
    }
    this.interactables.clear();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.updateFocus(null);
      this.clearHoldInteraction();
    }
  }
}
