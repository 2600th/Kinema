import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import { getVfxDensity } from "@core/vfxProfile";
import type { GameParticles } from "@juice/GameParticles";
import type { RendererManager } from "@renderer/RendererManager";
import type { VehicleHandlingFeelState } from "@vehicle/VehicleController";
import type { VehicleManager } from "@vehicle/VehicleManager";
import type * as THREE from "three";

export class ParticleSystem implements RuntimeSystem {
  readonly id = "particles";

  private gameParticles: GameParticles | null = null;
  private gameParticlesPromise: Promise<GameParticles | null> | null = null;
  private unsubs: (() => void)[] = [];
  private beaconChargeState: { position: THREE.Vector3; progress: number } | null = null;
  private beaconChargeTimer = 0;
  private disposed = false;
  private generation = 0;
  private captureFrozen = false;
  private vehicleHandlingState: VehicleHandlingFeelState | null = null;
  private vehicleBoostActive = false;

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
          this.withGameParticles((particles) => particles.airJumpBurst(position));
        } else {
          this.withGameParticles((particles) => particles.jumpPuff(groundPosition));
        }
      }),
      this.eventBus.on("player:landed", ({ impactSpeed }) => {
        this.withGameParticles((particles) =>
          particles.landingImpact(this.playerController.groundPosition, impactSpeed),
        );
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
        this.withGameParticles((particles) =>
          particles.footstepDust(this.playerController.groundPosition, planarSpeed),
        );
      }),
    );

    this.unsubs.push(
      this.eventBus.on("collectible:collected", ({ position }) => {
        this.withGameParticles((particles) => particles.coinBurst(position));
      }),
      this.eventBus.on("collectible:allCollected", ({ position }) => {
        this.withGameParticles((particles) => particles.coinCelebration(position));
      }),
      this.eventBus.on("objective:completed", ({ position }) => {
        if (!position) return;
        this.withGameParticles((particles) => particles.beaconComplete(position));
      }),
    );
    this.unsubs.push(
      this.eventBus.on("vehicle:enter", ({ vehicle, position }) => {
        this.withGameParticles((particles) => particles.vehicleTransitionDust(position ?? vehicle.mesh.position));
      }),
      this.eventBus.on("vehicle:exit", ({ position }) => {
        this.withGameParticles((particles) => particles.vehicleTransitionDust(position));
      }),
    );
    this.unsubs.push(
      this.eventBus.on("vehicle:handlingUpdate", (state) => {
        this.vehicleHandlingState = state;
      }),
      this.eventBus.on("vehicle:boostChanged", ({ active }) => {
        this.vehicleBoostActive = active;
      }),
    );
    this.unsubs.push(
      this.eventBus.on("player:damaged", ({ position, reason }) => {
        if (reason !== "spike") {
          return;
        }
        this.withGameParticles((particles) => particles.damageBurst(position));
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
      this.eventBus.on("objective:beaconActivated", ({ id }) => {
        if (id !== "beacon1" || !this.beaconChargeState) {
          return;
        }
        const position = this.beaconChargeState.position.clone();
        this.withGameParticles((particles) => particles.beaconComplete(position));
        this.beaconChargeState = null;
        this.beaconChargeTimer = 0;
      }),
    );
  }

  teardownLevel(): void {
    // Flush in-flight particles so effects from the previous run don't
    // render into the next level while they fade out.
    this.generation++;
    this.gameParticles?.clear();
    this.beaconChargeState = null;
    this.beaconChargeTimer = 0;
    this.vehicleHandlingState = null;
    this.vehicleBoostActive = false;
  }

  fixedUpdate(_dt: number): void {
    // Footsteps now driven by animation:footstep events
  }

  update(dt: number, _alpha: number): void {
    if (this.captureFrozen) return;
    if (this.beaconChargeState) {
      const interval = 0.2 - this.beaconChargeState.progress * 0.13;
      this.beaconChargeTimer += dt;
      while (this.beaconChargeTimer >= interval) {
        this.beaconChargeTimer -= interval;
        const position = this.beaconChargeState.position.clone();
        const progress = this.beaconChargeState.progress;
        this.withGameParticles((particles) => particles.beaconChargePulse(position, progress));
      }
    }
    this.gameParticles?.updateVehicleMotion(
      this.vehicleHandlingState,
      this.vehicleBoostActive,
      dt,
      getVfxDensity(this.renderer.getGraphicsProfile()),
    );
    this.gameParticles?.update(dt, this.renderer.camera);
  }

  getDebugState() {
    return (
      this.gameParticles?.getDebugState() ?? {
        gameplayActive: 0,
        vehicle: {
          active: { dust: 0, skid: 0, boost: 0 },
          emitted: { dust: 0, skid: 0, boost: 0 },
        },
      }
    );
  }

  private withGameParticles(emit: (particles: GameParticles) => void): void {
    if (this.captureFrozen) return;
    if (this.gameParticles) {
      emit(this.gameParticles);
      return;
    }
    void this.ensureGameParticles().then((particles) => {
      if (particles) emit(particles);
    });
  }

  private async ensureGameParticles(): Promise<GameParticles | null> {
    if (this.disposed) return null;
    if (this.gameParticles) return this.gameParticles;
    if (this.gameParticlesPromise) return this.gameParticlesPromise;

    const generation = this.generation;
    this.gameParticlesPromise = import("@juice/GameParticles")
      .then(({ GameParticles }) => {
        const particles = new GameParticles(this.renderer.scene);
        if (this.disposed || generation !== this.generation) {
          particles.dispose();
          return null;
        }
        this.gameParticles = particles;
        if (this.captureFrozen) {
          particles.clear();
          particles.setVisible(false);
        }
        return particles;
      })
      .finally(() => {
        this.gameParticlesPromise = null;
      });
    return this.gameParticlesPromise;
  }

  async freezeForCapture(): Promise<void> {
    this.captureFrozen = true;
    this.beaconChargeState = null;
    this.beaconChargeTimer = 0;
    this.vehicleHandlingState = null;
    this.vehicleBoostActive = false;
    const particles = this.gameParticles ?? (this.gameParticlesPromise ? await this.gameParticlesPromise : null);
    particles?.clear();
    particles?.setVisible(false);
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.gameParticles?.dispose();
    this.gameParticles = null;
  }
}
