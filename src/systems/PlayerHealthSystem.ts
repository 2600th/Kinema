import type { EventBus } from "@core/EventBus";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import * as THREE from "three";

export type DamageReason = "spike" | "fall";
export type DeathResolutionMode = "respawn" | "full-reset";

export interface PendingDeathResolution {
  mode: DeathResolutionMode;
  reason: DamageReason;
}

export interface HealthDebugState {
  current: number;
  max: number;
  invulnerable: boolean;
  invulnerabilityRemaining: number;
}

export interface DamageResult {
  accepted: boolean;
  deathTriggered: boolean;
  resolution: PendingDeathResolution | null;
}

const DEFAULT_HEARTS = 3;
const SPIKE_IFRAMES_SECONDS = 2.5;

export class PlayerHealthSystem implements RuntimeSystem {
  readonly id = "player-health";

  private currentHearts = DEFAULT_HEARTS;
  private readonly maxHearts = DEFAULT_HEARTS;
  private invulnerabilityRemaining = 0;
  private invulnerabilityReason: DamageReason | null = null;
  private pendingDeath: PendingDeathResolution | null = null;

  constructor(private readonly eventBus: EventBus) {}

  setupLevel(): void {
    this.resetHearts();
  }

  setupCustomLevel(): void {
    this.resetHearts();
  }

  setupStation(_key?: string): void {
    this.resetHearts();
  }

  teardownLevel(): void {
    this.setInvulnerability(0, null);
    this.pendingDeath = null;
  }

  fixedUpdate(dt: number): void {
    if (this.invulnerabilityRemaining <= 0) {
      return;
    }
    const remaining = Math.max(0, this.invulnerabilityRemaining - dt);
    this.setInvulnerability(remaining, remaining > 0 ? this.invulnerabilityReason : null);
  }

  getHealthState(): HealthDebugState {
    return {
      current: this.currentHearts,
      max: this.maxHearts,
      invulnerable: this.invulnerabilityRemaining > 0,
      invulnerabilityRemaining: this.invulnerabilityRemaining,
    };
  }

  isInvulnerable(): boolean {
    return this.invulnerabilityRemaining > 0;
  }

  applySpikeDamage(position: THREE.Vector3): DamageResult {
    if (this.pendingDeath || this.isInvulnerable()) {
      return { accepted: false, deathTriggered: false, resolution: null };
    }

    return this.applyDamage("spike", position, true);
  }

  applyFallDamage(position: THREE.Vector3): DamageResult {
    if (this.pendingDeath) {
      return { accepted: false, deathTriggered: false, resolution: null };
    }

    return this.applyDamage("fall", position, false);
  }

  consumePendingDeathResolution(): PendingDeathResolution | null {
    const pending = this.pendingDeath;
    this.pendingDeath = null;
    return pending ? { ...pending } : null;
  }

  dispose(): void {
    this.setInvulnerability(0, null);
    this.pendingDeath = null;
  }

  private resetHearts(): void {
    this.currentHearts = this.maxHearts;
    this.setInvulnerability(0, null);
    this.pendingDeath = null;
    this.eventBus.emit("health:changed", { current: this.currentHearts, max: this.maxHearts });
  }

  private applyDamage(reason: DamageReason, position: THREE.Vector3, grantsIFrames: boolean): DamageResult {
    this.currentHearts = Math.max(0, this.currentHearts - 1);
    this.eventBus.emit("health:changed", { current: this.currentHearts, max: this.maxHearts });

    if (this.currentHearts <= 0) {
      this.setInvulnerability(0, null);
      this.pendingDeath = { mode: "full-reset", reason };
      this.eventBus.emit("player:dying", { reason });
      return { accepted: true, deathTriggered: true, resolution: { ...this.pendingDeath } };
    }

    if (grantsIFrames) {
      this.setInvulnerability(SPIKE_IFRAMES_SECONDS, reason);
      this.pendingDeath = null;
    } else {
      this.setInvulnerability(0, null);
      this.pendingDeath = { mode: "respawn", reason };
    }

    this.eventBus.emit("player:damaged", {
      current: this.currentHearts,
      max: this.maxHearts,
      reason,
      position: position.clone(),
    });

    if (!grantsIFrames) {
      this.eventBus.emit("player:dying", { reason });
    }

    return {
      accepted: true,
      deathTriggered: !grantsIFrames,
      resolution: this.pendingDeath ? { ...this.pendingDeath } : null,
    };
  }

  private setInvulnerability(remaining: number, reason: DamageReason | null): void {
    const nextRemaining = Math.max(0, remaining);
    const nextReason = nextRemaining > 0 ? reason : null;
    const prevActive = this.invulnerabilityRemaining > 0;
    const nextActive = nextRemaining > 0;
    const shouldEmit =
      prevActive !== nextActive
      || (nextActive && this.invulnerabilityReason !== nextReason);

    this.invulnerabilityRemaining = nextRemaining;
    this.invulnerabilityReason = nextReason;

    if (!shouldEmit) {
      return;
    }

    this.eventBus.emit("player:invulnerabilityChanged", {
      active: nextActive,
      remaining: this.invulnerabilityRemaining,
      reason: this.invulnerabilityReason,
    });
  }
}
