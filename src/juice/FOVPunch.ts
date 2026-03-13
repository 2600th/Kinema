/**
 * FOV spring for speed/impact feedback.
 * Uses a critically-damped spring to smoothly return the punch offset to zero.
 */
export class FOVPunch {
  private currentPunch = 0;
  private velocity = 0;
  private stiffness = 150;
  private damping = 12;

  /** Add an impulse in degrees. Typical values: 3–8. */
  punch(amount: number): void {
    this.velocity += amount * 30; // scale impulse into velocity space
  }

  /**
   * Advance the spring simulation.
   * Returns the current FOV offset in degrees (add to base FOV).
   */
  update(dt: number): number {
    // Critically-damped spring: F = -stiffness * x - damping * v
    const force = -this.stiffness * this.currentPunch - this.damping * this.velocity;
    this.velocity += force * dt;
    this.currentPunch += this.velocity * dt;

    // Snap to zero when settled
    if (Math.abs(this.currentPunch) < 0.001 && Math.abs(this.velocity) < 0.01) {
      this.currentPunch = 0;
      this.velocity = 0;
    }

    return this.currentPunch;
  }

  /** Immediately reset to zero with no spring animation. */
  reset(): void {
    this.currentPunch = 0;
    this.velocity = 0;
  }
}
