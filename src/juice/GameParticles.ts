import * as THREE from "three";
import { ParticlePool } from "./ParticlePool";

const _emitPos = new THREE.Vector3();
const _dustVelMin = new THREE.Vector3();
const _dustVelMax = new THREE.Vector3();
const _sparkVelMin = new THREE.Vector3();
const _sparkVelMax = new THREE.Vector3();
const _glowVelMin = new THREE.Vector3();
const _glowVelMax = new THREE.Vector3();

/**
 * Higher-level wrapper providing pre-configured particle presets
 * for common game-feel effects: footsteps, landings, jumps.
 *
 * Uses billboard soft-circle particles with proper size/lifetime curves.
 */
export class GameParticles {
  private dustPool: ParticlePool;
  private sparkPool: ParticlePool;
  private coinGlowPool: ParticlePool;
  private hurtSparkPool: ParticlePool;
  private hurtGlowPool: ParticlePool;
  private beaconSparkPool: ParticlePool;
  private beaconGlowPool: ParticlePool;

  constructor(scene: THREE.Scene) {
    // Dust: earthy brown, normal blending, soft and floaty
    this.dustPool = new ParticlePool(scene, {
      maxParticles: 120,
      size: 0.12,
      sizeVariation: 0.4,
      color: new THREE.Color(0x9e8b6e),
      gravity: 0.3,
      drag: 3.5,
      additive: false,
    });

    // Sparks: bright additive glow, fast and snappy
    this.sparkPool = new ParticlePool(scene, {
      maxParticles: 120,
      size: 0.07,
      sizeVariation: 0.5,
      color: new THREE.Color(0xffcc66),
      gravity: 3,
      drag: 1.5,
      additive: true,
    });

    // Coin glow: larger, softer additive billboards for reward flashes and glitter.
    this.coinGlowPool = new ParticlePool(scene, {
      maxParticles: 96,
      size: 0.16,
      sizeVariation: 0.65,
      color: new THREE.Color(0xfff0a8),
      gravity: 0.45,
      drag: 2.2,
      additive: true,
    });

    this.hurtSparkPool = new ParticlePool(scene, {
      maxParticles: 96,
      size: 0.08,
      sizeVariation: 0.55,
      color: new THREE.Color(0xff4fb0),
      gravity: 2.2,
      drag: 1.3,
      additive: true,
    });

    this.hurtGlowPool = new ParticlePool(scene, {
      maxParticles: 96,
      size: 0.18,
      sizeVariation: 0.55,
      color: new THREE.Color(0x66ecff),
      gravity: 0.7,
      drag: 2,
      additive: true,
    });

    this.beaconSparkPool = new ParticlePool(scene, {
      maxParticles: 128,
      size: 0.09,
      sizeVariation: 0.5,
      color: new THREE.Color(0xb784ff),
      gravity: 1.1,
      drag: 1.15,
      additive: true,
    });

    this.beaconGlowPool = new ParticlePool(scene, {
      maxParticles: 128,
      size: 0.2,
      sizeVariation: 0.7,
      color: new THREE.Color(0x8dffd5),
      gravity: 0.18,
      drag: 1.9,
      additive: true,
    });
  }

  /**
   * Small dust puff at the player's feet while running.
   * Scales particle count and spread with movement speed.
   */
  footstepDust(position: THREE.Vector3, speed: number): void {
    const intensity = Math.min(speed / 8, 1);
    const count = Math.ceil(3 + intensity * 4);

    _emitPos.copy(position);

    _dustVelMin.set(-0.4 * intensity, 0.05, -0.4 * intensity);
    _dustVelMax.set(0.4 * intensity, 0.35 * intensity, 0.4 * intensity);

    this.dustPool.emit(_emitPos, count, {
      velocityMin: _dustVelMin,
      velocityMax: _dustVelMax,
      lifetime: 0.35 + intensity * 0.2,
      spread: 0.15,
    });
  }

  /**
   * Impact dust burst when landing from a fall.
   * Creates an expanding ring of dust with sparks on hard impacts.
   */
  landingImpact(position: THREE.Vector3, impactSpeed: number): void {
    if (impactSpeed < 1.25) return;

    const intensity = Math.min((impactSpeed - 1.25) / 8.75, 1);

    _emitPos.copy(position);

    // Expanding dust ring
    const count = Math.ceil(4 + intensity * 18);
    const hSpread = 0.8 + intensity * 1.0;
    _dustVelMin.set(-hSpread, 0.15, -hSpread);
    _dustVelMax.set(hSpread, 0.6 + intensity * 0.6, hSpread);

    this.dustPool.emit(_emitPos, count, {
      velocityMin: _dustVelMin,
      velocityMax: _dustVelMax,
      lifetime: 0.5 + intensity * 0.3,
      spread: 0.2,
    });

    // Additive sparks on hard landings
    if (impactSpeed > 3) {
      const sparkCount = Math.ceil(4 + intensity * 8);
      _sparkVelMin.set(-1.8, 0.8, -1.8);
      _sparkVelMax.set(1.8, 2.5 * intensity, 1.8);

      this.sparkPool.emit(_emitPos, sparkCount, {
        velocityMin: _sparkVelMin,
        velocityMax: _sparkVelMax,
        lifetime: 0.3 + intensity * 0.15,
        spread: 0.12,
      });
    }
  }

  /**
   * Radial spark burst for air jumps (double-jump / multi-jump).
   * Uses the additive spark pool for a distinct glowing visual.
   */
  airJumpBurst(position: THREE.Vector3): void {
    _emitPos.copy(position);

    _sparkVelMin.set(-1.2, -0.1, -1.2);
    _sparkVelMax.set(1.2, 1.4, 1.2);

    this.sparkPool.emit(_emitPos, 10, {
      velocityMin: _sparkVelMin,
      velocityMax: _sparkVelMax,
      lifetime: 0.22,
      spread: 0.08,
    });
  }

  /**
   * Gold pickup burst with layered sparkle and lingering glow.
   * Designed to read as a small reward moment rather than a single weak puff.
   */
  coinBurst(position: THREE.Vector3): void {
    _emitPos.copy(position);
    _emitPos.y += 0.12;

    // Core flash: warm, soft burst that blooms around the pickup point.
    _glowVelMin.set(-0.45, 0.55, -0.45);
    _glowVelMax.set(0.45, 1.5, 0.45);
    this.coinGlowPool.emit(_emitPos, 16, {
      velocityMin: _glowVelMin,
      velocityMax: _glowVelMax,
      lifetime: 0.38,
      spread: 0.18,
    });

    // Sharp burst: fast radial shards that give the pickup its punch.
    _sparkVelMin.set(-2.1, 0.65, -2.1);
    _sparkVelMax.set(2.1, 2.2, 2.1);
    this.sparkPool.emit(_emitPos, 20, {
      velocityMin: _sparkVelMin,
      velocityMax: _sparkVelMax,
      lifetime: 0.34,
      spread: 0.1,
    });

    // Trailing glitter: slower upward shimmer that lingers just after the pickup.
    _glowVelMin.set(-0.18, 0.9, -0.18);
    _glowVelMax.set(0.18, 1.9, 0.18);
    this.coinGlowPool.emit(_emitPos, 10, {
      velocityMin: _glowVelMin,
      velocityMax: _glowVelMax,
      lifetime: 0.56,
      spread: 0.26,
    });
  }

  damageBurst(position: THREE.Vector3): void {
    _emitPos.copy(position);
    _emitPos.y += 0.18;

    _glowVelMin.set(-0.7, 0.5, -0.7);
    _glowVelMax.set(0.7, 1.55, 0.7);
    this.hurtGlowPool.emit(_emitPos, 12, {
      velocityMin: _glowVelMin,
      velocityMax: _glowVelMax,
      lifetime: 0.24,
      spread: 0.12,
    });

    _sparkVelMin.set(-1.75, 0.35, -1.75);
    _sparkVelMax.set(1.75, 1.95, 1.75);
    this.hurtSparkPool.emit(_emitPos, 16, {
      velocityMin: _sparkVelMin,
      velocityMax: _sparkVelMax,
      lifetime: 0.26,
      spread: 0.08,
    });
  }

  beaconChargePulse(position: THREE.Vector3, progress: number): void {
    const charge = THREE.MathUtils.clamp(progress, 0, 1);
    _emitPos.copy(position);
    _emitPos.y += 0.15;

    const glowCount = 3 + Math.round(charge * 4);
    _glowVelMin.set(-0.22 - charge * 0.18, 0.4, -0.22 - charge * 0.18);
    _glowVelMax.set(0.22 + charge * 0.18, 1.0 + charge * 0.45, 0.22 + charge * 0.18);
    this.beaconGlowPool.emit(_emitPos, glowCount, {
      velocityMin: _glowVelMin,
      velocityMax: _glowVelMax,
      lifetime: 0.3 + charge * 0.18,
      spread: 0.09 + charge * 0.09,
    });

    const sparkCount = 2 + Math.round(charge * 3);
    _sparkVelMin.set(-0.95 - charge * 0.75, 0.35, -0.95 - charge * 0.75);
    _sparkVelMax.set(0.95 + charge * 0.75, 1.1 + charge * 0.65, 0.95 + charge * 0.75);
    this.beaconSparkPool.emit(_emitPos, sparkCount, {
      velocityMin: _sparkVelMin,
      velocityMax: _sparkVelMax,
      lifetime: 0.2 + charge * 0.12,
      spread: 0.04 + charge * 0.05,
    });
  }

  beaconComplete(position: THREE.Vector3): void {
    _emitPos.copy(position);
    _emitPos.y += 0.18;

    _glowVelMin.set(-0.55, 0.7, -0.55);
    _glowVelMax.set(0.55, 1.8, 0.55);
    this.beaconGlowPool.emit(_emitPos, 20, {
      velocityMin: _glowVelMin,
      velocityMax: _glowVelMax,
      lifetime: 0.48,
      spread: 0.18,
    });

    _sparkVelMin.set(-2.2, 0.6, -2.2);
    _sparkVelMax.set(2.2, 2.2, 2.2);
    this.beaconSparkPool.emit(_emitPos, 18, {
      velocityMin: _sparkVelMin,
      velocityMax: _sparkVelMax,
      lifetime: 0.36,
      spread: 0.12,
    });
  }

  /**
   * Small outward puff at the player's feet when jumping.
   */
  jumpPuff(position: THREE.Vector3): void {
    _emitPos.copy(position);

    // Radial outward burst at ground level
    _dustVelMin.set(-0.5, 0.0, -0.5);
    _dustVelMax.set(0.5, 0.2, 0.5);

    this.dustPool.emit(_emitPos, 6, {
      velocityMin: _dustVelMin,
      velocityMax: _dustVelMax,
      lifetime: 0.35,
      spread: 0.15,
    });
  }

  update(dt: number, camera?: THREE.Camera): void {
    this.dustPool.update(dt, camera);
    this.sparkPool.update(dt, camera);
    this.coinGlowPool.update(dt, camera);
    this.hurtSparkPool.update(dt, camera);
    this.hurtGlowPool.update(dt, camera);
    this.beaconSparkPool.update(dt, camera);
    this.beaconGlowPool.update(dt, camera);
  }

  dispose(): void {
    this.dustPool.dispose();
    this.sparkPool.dispose();
    this.coinGlowPool.dispose();
    this.hurtSparkPool.dispose();
    this.hurtGlowPool.dispose();
    this.beaconSparkPool.dispose();
    this.beaconGlowPool.dispose();
  }
}
