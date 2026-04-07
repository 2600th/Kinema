import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import type { GameParticles } from "@juice/GameParticles";
import type { RendererManager } from "@renderer/RendererManager";
import type { VehicleManager } from "@vehicle/VehicleManager";

export class ParticleSystem implements RuntimeSystem {
  readonly id = "particles";

  private gameParticles: GameParticles | null = null;
  private unsubs: (() => void)[] = [];

  constructor(
    private renderer: RendererManager,
    private eventBus: EventBus,
    private playerController: PlayerController,
    private vehicleManager: VehicleManager,
  ) {
    this.unsubs.push(
      this.eventBus.on("level:loaded", () => {
        void this.ensureGameParticles();
      }),
    );
    this.unsubs.push(
      this.eventBus.on("player:jumped", ({ airJump, groundPosition, position }) => {
        if (airJump) {
          if (this.gameParticles) {
            this.gameParticles.airJumpBurst(position);
          } else {
            void this.ensureGameParticles().then((p) => p.airJumpBurst(position));
          }
        } else {
          if (this.gameParticles) {
            this.gameParticles.jumpPuff(groundPosition);
          } else {
            void this.ensureGameParticles().then((p) => p.jumpPuff(groundPosition));
          }
        }
      }),
      this.eventBus.on("player:landed", ({ impactSpeed }) => {
        if (this.gameParticles) {
          this.gameParticles.landingImpact(this.playerController.groundPosition, impactSpeed);
        } else {
          void this.ensureGameParticles().then((p) =>
            p.landingImpact(this.playerController.groundPosition, impactSpeed),
          );
        }
      }),
    );
    this.unsubs.push(
      this.eventBus.on("player:respawned", () => {
        if (this.gameParticles) {
          this.gameParticles.landingImpact(this.playerController.groundPosition, 8);
        }
      }),
    );
    // Animation-driven footstep dust
    this.unsubs.push(
      this.eventBus.on("animation:footstep", () => {
        if (this.vehicleManager.isActive() || !this.playerController.body) return;
        if (!this.playerController.isGrounded) return;
        const vel = this.playerController.body.linvel();
        const planarSpeed = Math.hypot(vel.x, vel.z);
        if (planarSpeed <= 0.8) return;
        if (this.gameParticles) {
          this.gameParticles.footstepDust(this.playerController.groundPosition, planarSpeed);
        } else {
          void this.ensureGameParticles().then((p) =>
            p.footstepDust(this.playerController.groundPosition, planarSpeed),
          );
        }
      }),
    );

    this.unsubs.push(
      this.eventBus.on("collectible:collected", ({ position }) => {
        const emitBurst = (particles: GameParticles): void => {
          particles.coinBurst(position);
        };
        if (this.gameParticles) {
          emitBurst(this.gameParticles);
        } else {
          void this.ensureGameParticles().then((p) => {
            emitBurst(p);
          });
        }
      }),
    );
  }

  fixedUpdate(_dt: number): void {
    // Footsteps now driven by animation:footstep events
  }

  update(dt: number, _alpha: number): void {
    this.gameParticles?.update(dt, this.renderer.camera);
  }

  private async ensureGameParticles(): Promise<GameParticles> {
    if (!this.gameParticles) {
      const { GameParticles } = await import("@juice/GameParticles");
      this.gameParticles = new GameParticles(this.renderer.scene);
    }
    return this.gameParticles;
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.gameParticles?.dispose();
  }
}
