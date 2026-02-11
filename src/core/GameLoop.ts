import { PHYSICS_TIMESTEP, MAX_FRAME_TIME } from './constants';
import type { FixedUpdatable, Updatable } from './types';
import type { RendererManager } from '@renderer/RendererManager';
import type { PhysicsWorld } from '@physics/PhysicsWorld';

/**
 * Accumulator-pattern game loop.
 * Fixed 60Hz physics, unlocked render with interpolation alpha.
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private fixedUpdatables: FixedUpdatable[] = [];
  private updatables: Updatable[] = [];

  constructor(
    game: FixedUpdatable & Updatable,
    private renderer: RendererManager,
    private physics: PhysicsWorld,
  ) {
    this.fixedUpdatables.push(game);
    this.updatables.push(game);
  }

  start(): void {
    this.lastTime = performance.now() / 1000;
    this.renderer.setAnimationLoop(this.tick.bind(this));
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  private tick(_timestamp: DOMHighResTimeStamp): void {
    const now = performance.now() / 1000;
    let dt = now - this.lastTime;
    this.lastTime = now;

    // Spiral-of-death clamp
    if (dt > MAX_FRAME_TIME) {
      dt = MAX_FRAME_TIME;
    }

    this.accumulator += dt;

    // Fixed physics steps
    while (this.accumulator >= PHYSICS_TIMESTEP) {
      for (const obj of this.fixedUpdatables) {
        obj.fixedUpdate(PHYSICS_TIMESTEP);
      }
      this.physics.step();
      this.accumulator -= PHYSICS_TIMESTEP;
    }

    // Interpolation alpha
    const alpha = this.accumulator / PHYSICS_TIMESTEP;

    // Variable render step
    for (const obj of this.updatables) {
      obj.update(dt, alpha);
    }

    this.renderer.render();
  }
}
