import type { Hitstop } from "@juice/Hitstop";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type { RendererManager } from "@renderer/RendererManager";
import { MAX_FRAME_TIME, MAX_PHYSICS_STEPS, PHYSICS_TIMESTEP } from "./constants";
import type { FixedUpdatable, PostPhysicsUpdatable, Updatable } from "./types";

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

    // Advance hitstop timer BEFORE accumulating dt.
    // When frozen, discard sim time so it doesn't replay as catch-up steps.
    const frozen = this.hitstop?.update(dt) ?? false;

    if (frozen) {
      this.accumulator = 0;
    } else {
      this.accumulator += dt;
    }

    // Poll input once per frame before fixed steps
    for (const obj of this.updatables) {
      (obj as { beginFrame?: (dt: number) => void }).beginFrame?.(dt);
    }

    // Fixed physics steps
    if (this.simulationEnabled && !frozen) {
      // Cap accumulator to prevent excessive catch-up
      this.accumulator = Math.min(this.accumulator, PHYSICS_TIMESTEP * MAX_PHYSICS_STEPS);

      let steps = 0;
      while (this.accumulator >= PHYSICS_TIMESTEP) {
        if (++steps > MAX_PHYSICS_STEPS) {
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
    }
    // When frozen: accumulator was zeroed above — no catch-up steps after freeze ends
    // When !simulationEnabled: accumulator was already zeroed in setSimulationEnabled()

    // Interpolation alpha — clamped to [0, 1]
    const alpha = Math.min(1, this.accumulator / PHYSICS_TIMESTEP);

    // Variable render step — pass dt=0 when frozen to freeze presentation
    const renderDt = frozen ? 0 : dt;
    for (const obj of this.updatables) {
      obj.update(renderDt, alpha);
    }

    this.renderer.render();
  }

  private isPostPhysicsUpdatable(obj: unknown): obj is PostPhysicsUpdatable {
    return (
      typeof obj === "object" &&
      obj !== null &&
      typeof (obj as { postPhysicsUpdate?: unknown }).postPhysicsUpdate === "function"
    );
  }
}
