import { PHYSICS_TIMESTEP, MAX_FRAME_TIME, MAX_PHYSICS_STEPS } from './constants';
import type { FixedUpdatable, PostPhysicsUpdatable, Updatable } from './types';
import type { RendererManager } from '@renderer/RendererManager';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { Hitstop } from '@juice/Hitstop';

/**
 * Accumulator-pattern game loop.
 * Fixed 60Hz physics, unlocked render with interpolation alpha.
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private fixedUpdatables: FixedUpdatable[] = [];
  private postPhysicsUpdatables: PostPhysicsUpdatable[] = [];
  private updatables: Updatable[] = [];
  private running = false;
  private simulationEnabled = true;
  private hitstop: Hitstop | null = null;

  constructor(
    game: FixedUpdatable & Updatable,
    private renderer: RendererManager,
    private physics: PhysicsWorld,
  ) {
    this.fixedUpdatables.push(game);
    this.updatables.push(game);
    if (this.isPostPhysicsUpdatable(game)) {
      this.postPhysicsUpdatables.push(game);
    }
  }

  start(): void {
    this.lastTime = performance.now() / 1000;
    this.renderer.setAnimationLoop(this.tick.bind(this));
    this.running = true;
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  setSimulationEnabled(enabled: boolean): void {
    this.simulationEnabled = enabled;
    if (!enabled) {
      this.accumulator = 0;
    }
  }

  setHitstop(hitstop: Hitstop): void {
    this.hitstop = hitstop;
  }

  private tick(timestamp: DOMHighResTimeStamp): void {
    const now = timestamp / 1000;
    let dt = now - this.lastTime;
    this.lastTime = now;

    // Spiral-of-death clamp
    if (dt > MAX_FRAME_TIME) {
      dt = MAX_FRAME_TIME;
    }

    this.accumulator += dt;

    // Advance hitstop timer; skip physics when frozen
    const frozen = this.hitstop?.update(dt) ?? false;

    // Fixed physics steps
    if (this.simulationEnabled && !frozen) {
      let steps = 0;
      while (this.accumulator >= PHYSICS_TIMESTEP) {
        if (++steps > MAX_PHYSICS_STEPS) {
          this.accumulator = 0;
          break;
        }
        for (const obj of this.fixedUpdatables) {
          obj.fixedUpdate(PHYSICS_TIMESTEP);
        }
        this.physics.step();
        for (const obj of this.postPhysicsUpdatables) {
          obj.postPhysicsUpdate(PHYSICS_TIMESTEP);
        }
        this.accumulator -= PHYSICS_TIMESTEP;
      }
    } else {
      this.accumulator = 0;
    }

    // Interpolation alpha
    const alpha = this.accumulator / PHYSICS_TIMESTEP;

    // Variable render step
    for (const obj of this.updatables) {
      obj.update(dt, alpha);
    }

    this.renderer.render();
  }

  private isPostPhysicsUpdatable(obj: unknown): obj is PostPhysicsUpdatable {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as { postPhysicsUpdate?: unknown }).postPhysicsUpdate === 'function'
    );
  }
}
