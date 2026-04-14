import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import type { GameParticles } from "@juice/GameParticles";
import type { RendererManager } from "@renderer/RendererManager";
import type { VehicleManager } from "@vehicle/VehicleManager";
import type * as THREE from "three";

export class ParticleSystem implements RuntimeSystem {
  readonly id = "particles";

  private gameParticles: GameParticles | null = null;
  private unsubs: (() => void)[] = [];
  private beaconChargeState: { position: THREE.Vector3; progress: number } | null = null;
  private beaconChargeTimer = 0;

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
    this.unsubs.push(
      this.eventBus.on("player:damaged", ({ position, reason }) => {
        if (reason !== "spike") {
          return;
        }
        const emitBurst = (particles: GameParticles): void => {
          particles.damageBurst(position);
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
    this.unsubs.push(
      this.eventBus.on("interaction:holdProgress", (payload) => {
        if (!payload || payload.id !== "beacon1") {
          this.beaconChargeState = null;
          this.beaconChargeTimer = 0;
          return;
        }
        this.beaconChargeState = {
          position: payload.position.clone(),
          progress: payload.progress,
        };
      }),
      this.eventBus.on("interaction:triggered", ({ id }) => {
        if (id !== "beacon1" || !this.beaconChargeState) {
          return;
        }
        const position = this.beaconChargeState.position.clone();
        const emitComplete = (particles: GameParticles): void => {
          particles.beaconComplete(position);
        };
        if (this.gameParticles) {
          emitComplete(this.gameParticles);
        } else {
          void this.ensureGameParticles().then((p) => {
            emitComplete(p);
          });
        }
        this.beaconChargeState = null;
        this.beaconChargeTimer = 0;
      }),
    );
  }

  fixedUpdate(_dt: number): void {
    // Footsteps now driven by animation:footstep events
  }

  update(dt: number, _alpha: number): void {
    if (this.beaconChargeState) {
      const interval = 0.2 - this.beaconChargeState.progress * 0.13;
      this.beaconChargeTimer += dt;
      while (this.beaconChargeTimer >= interval) {
        this.beaconChargeTimer -= interval;
        const position = this.beaconChargeState.position.clone();
        const progress = this.beaconChargeState.progress;
        const emitCharge = (particles: GameParticles): void => {
          particles.beaconChargePulse(position, progress);
        };
        if (this.gameParticles) {
          emitCharge(this.gameParticles);
        } else {
          void this.ensureGameParticles().then((p) => {
            emitCharge(p);
          });
        }
      }
    }
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
