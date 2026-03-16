import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import type { GameParticles } from "@juice/GameParticles";
import type { RendererManager } from "@renderer/RendererManager";
import type { VehicleManager } from "@vehicle/VehicleManager";

export class ParticleSystem implements RuntimeSystem {
  readonly id = "particles";

  private gameParticles: GameParticles | null = null;
  private particleFootstepTimer = 0;
  private unsubs: (() => void)[] = [];

  constructor(
    private renderer: RendererManager,
    private eventBus: EventBus,
    private playerController: PlayerController,
    private vehicleManager: VehicleManager,
  ) {
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
  }

  fixedUpdate(dt: number): void {
    if (!this.vehicleManager.isActive() && this.playerController.body) {
      const vel = this.playerController.body.linvel();
      const planarSpeed = Math.hypot(vel.x, vel.z);
      const movingOnGround = this.playerController.isGrounded && planarSpeed > 1.15;
      if (!movingOnGround) {
        this.particleFootstepTimer = 0;
      } else {
        this.particleFootstepTimer -= dt;
        if (this.particleFootstepTimer <= 0) {
          if (this.gameParticles) {
            this.gameParticles.footstepDust(this.playerController.groundPosition, planarSpeed);
          } else {
            void this.ensureGameParticles().then((p) =>
              p.footstepDust(this.playerController.groundPosition, planarSpeed),
            );
          }
          const speedN = Math.min((planarSpeed - 1.15) / 6.5, 1);
          this.particleFootstepTimer = 0.42 - speedN * 0.2;
        }
      }
    }
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
