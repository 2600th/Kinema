/**
 * Freeze-frame system for impactful moments.
 * When triggered, the game loop should skip physics steps for the duration.
 */
export class Hitstop {
  private remainingTime = 0;

  /** Trigger a freeze-frame. Typical values: 0.05–0.1 seconds. */
  trigger(durationSeconds: number): void {
    // Use the longer of the current remaining time or the new duration
    this.remainingTime = Math.max(this.remainingTime, durationSeconds);
  }

  /**
   * Advance the hitstop timer.
   * Returns true if the game is currently frozen (caller should skip physics).
   */
  update(dt: number): boolean {
    if (this.remainingTime <= 0) return false;
    this.remainingTime -= dt;
    if (this.remainingTime < 0) this.remainingTime = 0;
    return true;
  }

  get isFrozen(): boolean {
    return this.remainingTime > 0;
  }
}
