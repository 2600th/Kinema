/**
 * Trauma-based screen shake system.
 *
 * Uses trauma accumulation (0-1) with quadratic intensity mapping
 * and multi-axis sin-product noise for smooth, natural camera shake.
 */

export interface ShakeOffsets {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

const ZERO_OFFSETS: ShakeOffsets = { offsetX: 0, offsetY: 0, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0 };

/**
 * Sin-product noise — two sin waves with incommensurate frequencies
 * produce a pseudo-random, smooth signal without needing a Perlin library.
 * Each axis uses a unique seed so they don't correlate.
 */
function noise(seed: number, t: number, frequency: number): number {
  return Math.sin(seed * 100 + t * frequency) * Math.sin(seed * 50 + t * frequency * 0.7);
}

// Unique seeds per axis (arbitrary primes)
const SEED_X = 1.0;
const SEED_Y = 2.3;
const SEED_Z = 3.7;
const SEED_RX = 5.1;
const SEED_RY = 7.9;
const SEED_RZ = 11.3;

export class ScreenShake {
  private trauma = 0;
  // Per-axis translation amplitudes (meters) — Y heavier for impact feel, Z minimal
  private maxOffsetX = 0.035;
  private maxOffsetY = 0.05;
  private maxOffsetZ = 0.015;
  // Per-axis rotation amplitudes (radians) — Y heavier for yaw snap feel
  private maxRotX = 0.012;
  private maxRotY = 0.018;
  private maxRotZ = 0.01;
  private decayRate = 3.2; // trauma decay per second (faster = snappier)
  private frequency = 18; // noise frequency (shake speed)
  private time = 0; // accumulated time for noise sampling

  /** Add trauma (clamped to 0-1). */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, Math.max(0, this.trauma + amount));
  }

  /** Get current raw trauma value. */
  getTrauma(): number {
    return this.trauma;
  }

  /**
   * Advance time and decay trauma. Returns camera offsets to apply.
   * Uses trauma^2 for a nonlinear curve: small hits are subtle, big hits are intense.
   */
  update(dt: number): ShakeOffsets {
    if (this.trauma <= 0) {
      return ZERO_OFFSETS;
    }

    this.time += dt;

    // Decay trauma
    this.trauma = Math.max(0, this.trauma - this.decayRate * dt);

    // Quadratic intensity
    const shake = this.trauma * this.trauma;

    const t = this.time;
    const f = this.frequency;

    return {
      offsetX: this.maxOffsetX * shake * noise(SEED_X, t, f),
      offsetY: this.maxOffsetY * shake * noise(SEED_Y, t, f),
      offsetZ: this.maxOffsetZ * shake * noise(SEED_Z, t, f),
      rotX: this.maxRotX * shake * noise(SEED_RX, t, f),
      rotY: this.maxRotY * shake * noise(SEED_RY, t, f),
      rotZ: this.maxRotZ * shake * noise(SEED_RZ, t, f),
    };
  }

  /** Reset all shake state. */
  reset(): void {
    this.trauma = 0;
    this.time = 0;
  }
}
