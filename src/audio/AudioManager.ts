import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import { type Disposable, type FixedUpdatable, STATE } from "@core/types";
import type { UserSettingsStore } from "@core/UserSettings";
import type { InputManager } from "@input/InputManager";
import type { VehicleHandlingFeelState } from "@vehicle/VehicleController";
import * as Tone from "tone";
import { createSafeDynamicsStage } from "./createSafeDynamicsStage";
import { MusicEngine } from "./MusicEngine";
import { SFXEngine } from "./SFXEngine";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface AudioController extends FixedUpdatable, Disposable {
  playMusic(fadeInSec?: number): void;
  stopMusic(fadeOutSec?: number): void;
  setMasterVolume(value: number): void;
  setMusicVolume(value: number): void;
  setSfxVolume(value: number): void;
}

class SilentAudioController implements AudioController {
  fixedUpdate(): void {}
  playMusic(): void {}
  stopMusic(): void {}
  setMasterVolume(): void {}
  setMusicVolume(): void {}
  setSfxVolume(): void {}
  dispose(): void {}
}

export function createSilentAudioController(): AudioController {
  return new SilentAudioController();
}

/**
 * Audio manager delegating to Tone.js-based SFX and Music engines.
 * Master bus: sfx/music → gains → compressor → limiter → destination.
 */
export class AudioManager implements AudioController {
  private sfxEngine: SFXEngine;
  private musicEngine: MusicEngine;
  private masterGain: Tone.Gain;
  private sfxGain: Tone.Gain;
  private musicGain: Tone.Gain;
  private masterCompressor: Tone.Compressor | Tone.Gain;
  private masterLimiter: Tone.Limiter | Tone.Gain;
  private unsubscribers: Array<() => void> = [];
  private transientDucks = new Map<ReturnType<typeof setTimeout>, number>();
  private toneStarted = false;
  private toneStartPromise: Promise<boolean> | null = null;
  private pendingMusicFadeIn: number | null = null;
  private userSfxVolume = 1;
  private pauseMenuOpen = false;
  private editorOpen = false;
  private disposed = false;
  private visibilityTransition: Promise<void> = Promise.resolve();
  private lastLandedImpact = 0;
  private lastLandedFrame = -1;
  private frameCounter = 0;

  // State tracking for audio triggers
  private inVehicle = false;
  private vehicleType: "car" | "drone" | null = null;
  private vehicleSpeedNorm = 0;
  private vehicleDriftAmount = 0;
  private vehicleHandbrake = false;
  private holdLastThreshold = -1;
  private slopeSlideActive = false;

  constructor(
    private eventBus: EventBus,
    private player: PlayerController,
    private inputManager: InputManager,
    private settings: UserSettingsStore,
  ) {
    // Master bus: gains → compressor → limiter → destination
    const dynamicsStage = createSafeDynamicsStage(
      "Master bus",
      {
        threshold: -24,
        ratio: 3,
        attack: 0.003,
        release: 0.12,
      },
      { threshold: -1 },
    );
    this.masterCompressor = dynamicsStage.compressor;
    this.masterLimiter = dynamicsStage.limiter;
    if (dynamicsStage.degraded) {
      console.warn("[AudioManager] Master dynamics processing disabled on this device for compatibility.");
    }
    this.masterGain = new Tone.Gain(1);
    this.masterGain.chain(this.masterCompressor, this.masterLimiter, Tone.getDestination());

    // SFX at -2dB relative, Music at -6dB relative
    this.sfxGain = new Tone.Gain(0.79).connect(this.masterGain); // ~-2dB
    this.musicGain = new Tone.Gain(0.5).connect(this.masterGain); // ~-6dB

    this.sfxEngine = new SFXEngine();
    this.sfxEngine.output.connect(this.sfxGain);

    this.musicEngine = new MusicEngine();
    this.musicEngine.output.connect(this.musicGain);

    this.setMasterVolume(this.settings.value.masterVolume);
    this.setMusicVolume(this.settings.value.musicVolume);
    this.setSfxVolume(this.settings.value.sfxVolume);

    this.bindEvents();
    this.listenForUserGesture();
    this.listenForDocumentVisibility();
  }

  private ensureToneStarted(): Promise<boolean> {
    if (this.disposed || document.hidden) return Promise.resolve(false);
    if (Tone.getContext().state === "running") {
      this.markToneStarted();
      return Promise.resolve(true);
    }
    if (this.toneStartPromise) return this.toneStartPromise;

    const request = (async (): Promise<boolean> => {
      while (!this.disposed) {
        if (document.hidden) {
          await this.suspendToneContext();
          if (this.disposed || document.hidden) return false;
        }
        try {
          if (Tone.getContext().state !== "running") await Tone.start();
        } catch {
          // Browser gesture policy can reject visibility restoration. Persistent
          // gesture listeners retry this path on the next user action.
          return false;
        }
        if (document.hidden) continue;
        if (Tone.getContext().state !== "running") return false;
        this.markToneStarted();
        return true;
      }
      return false;
    })();
    this.toneStartPromise = request;
    void request.then(() => {
      if (this.toneStartPromise === request) this.toneStartPromise = null;
    });
    return request;
  }

  private markToneStarted(): void {
    if (this.toneStarted || this.disposed) return;
    this.toneStarted = true;
    if (this.pendingMusicFadeIn !== null) {
      const fade = this.pendingMusicFadeIn;
      this.pendingMusicFadeIn = null;
      this.musicEngine.start(fade);
    }
  }

  fixedUpdate(_dt: number): void {
    this.frameCounter++;
    // Resume audio context on first pointer lock (user gesture)
    if (!this.toneStarted && this.inputManager.isLocked) {
      void this.ensureToneStarted();
    }
    if (!this.toneStarted) return;
    if (!this.player.body) return;

    const velocity = this.player.body.linvel();
    const planarSpeed = Math.hypot(velocity.x, velocity.z);

    // ── Music intensity ─────────────────────────────────
    let intensity = 0;
    // Speed contributes 0-0.5
    intensity += clamp(planarSpeed / 12, 0, 0.5);
    // Vehicle active
    if (this.inVehicle) intensity += 0.3;
    // In air
    if (!this.player.isGrounded) intensity += 0.1;
    this.musicEngine.setIntensity(clamp(intensity, 0, 1));

    // Footsteps are driven by animation:footstep event (see subscribeEvents)
    if (this.slopeSlideActive) {
      if (this.inVehicle || !this.player.isGrounded) {
        this.sfxEngine.slopeSlideStop();
        this.slopeSlideActive = false;
      } else {
        this.sfxEngine.slopeSlideUpdate(clamp(planarSpeed / 8, 0, 1));
      }
    }
  }

  playMusic(fadeInSec = 2.0): void {
    if (!this.toneStarted) {
      this.pendingMusicFadeIn = fadeInSec;
      void this.ensureToneStarted();
      return;
    }
    this.musicEngine.start(fadeInSec);
  }

  stopMusic(fadeOutSec = 1.5): void {
    this.musicEngine.stop(fadeOutSec);
  }

  setMasterVolume(value: number): void {
    this.masterGain.gain.rampTo(clamp(value, 0, 1), 0.05);
  }

  setMusicVolume(value: number): void {
    // Route through MusicEngine so duck()/unduck() restores to the user's
    // volume (targetVolume * duckedVolume) instead of ramping back to full.
    // The musicGain bus keeps only the fixed -6dB base offset.
    this.musicEngine.setVolume(clamp(value, 0, 1));
  }

  setSfxVolume(value: number): void {
    this.userSfxVolume = clamp(value, 0, 1);
    this.applySfxContextGain();
  }

  startEngine(): void {
    if (!this.toneStarted) return;
    if (this.vehicleType === "drone") {
      this.sfxEngine.droneRotorStart();
    } else {
      this.sfxEngine.startEngine();
      this.sfxEngine.updateEngine(this.vehicleSpeedNorm, this.vehicleDriftAmount, this.vehicleHandbrake);
    }
  }

  updateEngine(speedNorm: number): void {
    this.vehicleSpeedNorm = speedNorm;
    if (!this.toneStarted) return;
    if (this.vehicleType === "drone") {
      this.sfxEngine.droneRotorUpdate(speedNorm);
    } else {
      this.sfxEngine.updateEngine(speedNorm, this.vehicleDriftAmount, this.vehicleHandbrake);
    }
  }

  stopEngine(): void {
    this.vehicleSpeedNorm = 0;
    this.vehicleDriftAmount = 0;
    this.vehicleHandbrake = false;
    if (!this.toneStarted) return;
    if (this.vehicleType === "drone") {
      this.sfxEngine.droneRotorStop();
    } else {
      this.sfxEngine.stopEngine();
    }
  }

  private updateVehicleHandlingFeel(state: VehicleHandlingFeelState | null): void {
    this.vehicleDriftAmount = state?.driftAmount ?? 0;
    this.vehicleHandbrake = state?.handbrake ?? false;
    if (!this.toneStarted || this.vehicleType === "drone") return;
    this.sfxEngine.updateEngine(this.vehicleSpeedNorm, this.vehicleDriftAmount, this.vehicleHandbrake);
  }

  /** Add a temporary duck that composes with every active application context. */
  private duckFor(amount: number, durationMs: number): void {
    const id = setTimeout(() => {
      this.transientDucks.delete(id);
      this.applyMusicContextDuck();
    }, durationMs);
    this.transientDucks.set(id, clamp(amount, 0, 1));
    this.applyMusicContextDuck();
  }

  dispose(): void {
    this.disposed = true;
    this.pendingMusicFadeIn = null;
    for (const id of this.transientDucks.keys()) {
      clearTimeout(id);
    }
    this.transientDucks.clear();
    this.stopEngine();
    this.sfxEngine.slopeSlideStop();
    this.slopeSlideActive = false;
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.musicEngine.dispose();
    this.sfxEngine.dispose();
    this.musicGain.dispose();
    this.sfxGain.dispose();
    this.masterCompressor.dispose();
    this.masterLimiter.dispose();
    this.masterGain.dispose();
  }

  private listenForUserGesture(): void {
    const gestureEvents = ["click", "keydown", "touchstart", "pointerdown"] as const;
    const handler = (): void => {
      void this.ensureToneStarted();
    };
    for (const evt of gestureEvents) {
      document.addEventListener(evt, handler, { capture: true, once: false });
    }
    this.unsubscribers.push(() => {
      for (const evt of gestureEvents) {
        document.removeEventListener(evt, handler, true);
      }
    });
  }

  private listenForDocumentVisibility(): void {
    const handler = (): void => {
      this.visibilityTransition = this.visibilityTransition
        .then(async () => {
          if (this.disposed) return;
          if (document.hidden) {
            await this.suspendToneContext();
            if (!this.disposed && document.hidden) this.toneStarted = false;
            return;
          }
          await this.ensureToneStarted();
        })
        .catch(() => {
          // A later visibility event or user gesture retries restoration.
        });
    };
    document.addEventListener("visibilitychange", handler);
    this.unsubscribers.push(() => document.removeEventListener("visibilitychange", handler));
  }

  private async suspendToneContext(): Promise<void> {
    const rawContext = Tone.getContext().rawContext as BaseAudioContext & { suspend?: () => Promise<void> };
    if (rawContext.state === "running" && typeof rawContext.suspend === "function") {
      await rawContext.suspend();
    }
  }

  private applySfxContextGain(): void {
    const contextMultiplier = this.pauseMenuOpen ? 0.1 : 1;
    this.sfxGain.gain.rampTo(this.userSfxVolume * 0.79 * contextMultiplier, 0.05);
  }

  private applyMusicContextDuck(): void {
    let amount = 1;
    if (this.pauseMenuOpen) amount = Math.min(amount, 0.3);
    if (this.editorOpen) amount = Math.min(amount, 0.15);
    for (const transientAmount of this.transientDucks.values()) {
      amount = Math.min(amount, transientAmount);
    }
    if (amount < 1) {
      this.musicEngine.duck(amount);
    } else {
      this.musicEngine.unduck();
    }
  }

  private bindEvents(): void {
    // ── Animation-driven footsteps ─────────────────────
    this.unsubscribers.push(
      this.eventBus.on("animation:footstep", () => {
        if (!this.toneStarted || !this.player.body) return;
        if (!this.player.isGrounded) return;
        const vel = this.player.body.linvel();
        const planarSpeed = Math.hypot(vel.x, vel.z);
        if (planarSpeed > 0.8) {
          this.sfxEngine.footstep(planarSpeed);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("animation:event", ({ event }) => {
        if (!this.toneStarted) return;
        if (event === "slopeSlideStart") {
          if (this.inVehicle) return;
          this.slopeSlideActive = true;
          this.sfxEngine.slopeSlideStart();
          return;
        }
        if (event === "slopeSlideStop") {
          this.slopeSlideActive = false;
          this.sfxEngine.slopeSlideStop();
        }
      }),
    );

    // ── Player Movement ────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on("player:stateChanged", ({ previous, current }) => {
        if (!this.toneStarted) return;
        if (current === STATE.jump) {
          this.sfxEngine.jump();
        }
        if (current === STATE.airJump) {
          this.sfxEngine.airJump();
        }
        // Crouch transitions
        if (current === STATE.crouch && previous !== STATE.crouch) {
          this.sfxEngine.crouchDown();
        }
        if (previous === STATE.crouch && current !== STATE.crouch) {
          this.sfxEngine.crouchUp();
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("player:grounded", (grounded) => {
        if (!this.toneStarted) return;
        if (grounded) {
          // Defer: if player:landed fires on the same frame with a hard impact,
          // skip landSoft to avoid doubling with landHard.
          const frame = this.frameCounter;
          queueMicrotask(() => {
            if (this.lastLandedFrame === frame && this.lastLandedImpact >= 3) return;
            this.sfxEngine.landSoft();
          });
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("player:landed", ({ impactSpeed }) => {
        this.lastLandedImpact = impactSpeed;
        this.lastLandedFrame = this.frameCounter;
        if (!this.toneStarted || impactSpeed < 3) return;
        this.sfxEngine.landHard(impactSpeed);
      }),
    );

    // ── Interaction ────────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on("interaction:triggered", ({ outcome }) => {
        if (!this.toneStarted) return;
        if (outcome) return;
        this.sfxEngine.interact();
      }),
      this.eventBus.on("interaction:doorToggled", ({ open }) => {
        if (!this.toneStarted) return;
        this.sfxEngine.doorToggle(open);
      }),
      this.eventBus.on("objective:beaconActivated", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.beaconActivate();
        this.duckFor(0.6, 600);
      }),
      this.eventBus.on("interaction:ropeAttached", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.ropeAttach();
      }),
      this.eventBus.on("interaction:ropeReleased", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.ropeRelease();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("interaction:grabStart", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.grab();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("interaction:pickUp", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.interact();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("interaction:throw", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.throw();
      }),
    );

    // New interaction SFX
    this.unsubscribers.push(
      this.eventBus.on("interaction:focusChanged", ({ id }) => {
        if (!this.toneStarted) return;
        if (id != null) {
          this.sfxEngine.focusTick();
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("interaction:holdProgress", (payload) => {
        if (!payload) {
          this.holdLastThreshold = -1;
          return;
        }
        if (!this.toneStarted) return;
        // Fire on 10% thresholds
        const threshold = Math.floor(payload.progress * 10);
        if (threshold > this.holdLastThreshold) {
          this.holdLastThreshold = threshold;
          this.sfxEngine.holdCharge(payload.progress);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("interaction:blocked", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.interactBlocked();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("interaction:drop", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.drop();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("interaction:grabEnd", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.grabRelease();
      }),
    );

    // ── Progression ────────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on("checkpoint:activated", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.checkpoint();
        // Brief music duck to let chime shine
        this.duckFor(0.6, 500);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("objective:completed", ({ id }) => {
        if (!this.toneStarted) return;
        if (id === "activate-beacon") return;
        this.sfxEngine.objectiveComplete();
        // Brief music duck
        this.duckFor(0.6, 500);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("collectible:collected", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.coinCollect();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("collectible:allCollected", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.objectiveComplete();
        this.duckFor(0.6, 700);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("player:damaged", ({ reason }) => {
        if (!this.toneStarted) return;
        if (reason === "spike") {
          this.sfxEngine.damageHit();
        }
      }),
    );

    // ── Death / Respawn ────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on("player:dying", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.deathDescend();
        // Duck music for death sequence
        this.duckFor(0.5, 1500);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("player:deathMidpoint", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.deathMidpoint();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("player:respawned", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.respawnChime();
      }),
    );

    // ── Vehicle ────────────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on("vehicle:enter", ({ vehicle }) => {
        this.inVehicle = true;
        this.vehicleType = vehicle.type;
        this.vehicleSpeedNorm = 0;
        this.vehicleDriftAmount = 0;
        this.vehicleHandbrake = false;
        if (this.slopeSlideActive) {
          this.sfxEngine.slopeSlideStop();
          this.slopeSlideActive = false;
        }
        if (this.toneStarted) this.sfxEngine.vehicleEnter();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("vehicle:exit", () => {
        if (this.toneStarted) this.sfxEngine.vehicleExit();
        this.inVehicle = false;
        this.vehicleType = null;
        this.vehicleSpeedNorm = 0;
        this.vehicleDriftAmount = 0;
        this.vehicleHandbrake = false;
      }),
    );

    this.unsubscribers.push(this.eventBus.on("vehicle:engineStart", () => this.startEngine()));
    this.unsubscribers.push(this.eventBus.on("vehicle:engineStop", () => this.stopEngine()));
    this.unsubscribers.push(this.eventBus.on("vehicle:speedUpdate", ({ speedNorm }) => this.updateEngine(speedNorm)));
    this.unsubscribers.push(
      this.eventBus.on("vehicle:handlingUpdate", (state) => this.updateVehicleHandlingFeel(state)),
    );

    // ── Menu / UI ──────────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on("menu:opened", ({ screen }) => {
        if (screen === "pause") {
          this.pauseMenuOpen = true;
          this.applySfxContextGain();
          this.sfxEngine.setSustainedPaused(true);
          this.applyMusicContextDuck();
          if (this.toneStarted) this.sfxEngine.menuOpen();
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("menu:closed", () => {
        if (this.toneStarted) this.sfxEngine.menuClose();
        if (!this.pauseMenuOpen) return;
        this.pauseMenuOpen = false;
        this.applySfxContextGain();
        this.sfxEngine.setSustainedPaused(false);
        this.applyMusicContextDuck();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("editor:opened", () => {
        this.editorOpen = true;
        this.applyMusicContextDuck();
      }),
      this.eventBus.on("editor:closed", () => {
        this.editorOpen = false;
        this.applyMusicContextDuck();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("ui:click", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.uiClick();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("ui:hover", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.uiHover();
      }),
    );

    // ── Volume Controls ────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on("audio:masterVolume", (value) => {
        this.setMasterVolume(value);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("audio:musicVolume", (value) => {
        this.setMusicVolume(value);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("audio:sfxVolume", (value) => {
        this.setSfxVolume(value);
      }),
    );

    // ── Loading ────────────────────────────────────────
    let lastTickThreshold = 0;

    this.unsubscribers.push(
      this.eventBus.on("loading:progress", ({ progress }) => {
        if (!this.toneStarted) return;
        if (progress <= 0.15) {
          this.sfxEngine.loadingAmbientStart();
          lastTickThreshold = 0;
        }
        const threshold = Math.floor(progress * 10);
        if (threshold > lastTickThreshold) {
          lastTickThreshold = threshold;
          this.sfxEngine.loadingTick(progress);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("level:loaded", () => {
        if (!this.toneStarted) return;
        this.sfxEngine.loadingAmbientStop();
        this.sfxEngine.loadingWhoosh();
      }),
    );
  }
}
