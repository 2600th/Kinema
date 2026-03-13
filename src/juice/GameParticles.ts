import * as THREE from 'three';
import { ParticlePool } from './ParticlePool';

const _emitPos = new THREE.Vector3();
const _dustVelMin = new THREE.Vector3();
const _dustVelMax = new THREE.Vector3();
const _sparkVelMin = new THREE.Vector3();
const _sparkVelMax = new THREE.Vector3();

/**
 * Higher-level wrapper providing pre-configured particle presets
 * for common game-feel effects: footsteps, landings, jumps.
 *
 * Uses billboard soft-circle particles with proper size/lifetime curves.
 */
export class GameParticles {
  private dustPool: ParticlePool;
  private sparkPool: ParticlePool;

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
      maxParticles: 80,
      size: 0.07,
      sizeVariation: 0.5,
      color: new THREE.Color(0xffcc66),
      gravity: 3,
      drag: 1.5,
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
    const intensity = Math.min(impactSpeed / 10, 1);

    _emitPos.copy(position);

    // Expanding dust ring
    const count = Math.ceil(8 + intensity * 14);
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
  }

  dispose(): void {
    this.dustPool.dispose();
    this.sparkPool.dispose();
  }
}
