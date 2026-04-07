import * as Tone from 'tone';
import type { PlayerController } from '@character/PlayerController';
import type { EventBus } from '@core/EventBus';
import { STATE, type Disposable, type FixedUpdatable } from '@core/types';
import type { InputManager } from '@input/InputManager';
import type { UserSettingsStore } from '@core/UserSettings';
import { SFXEngine } from './SFXEngine';
import { MusicEngine } from './MusicEngine';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Audio manager delegating to Tone.js-based SFX and Music engines.
 * Master bus: sfx/music → gains → compressor → limiter → destination.
 */
export class AudioManager implements FixedUpdatable, Disposable {
  private sfxEngine: SFXEngine;
  private musicEngine: MusicEngine;
  private masterGain: Tone.Gain;
  private sfxGain: Tone.Gain;
  private musicGain: Tone.Gain;
  private masterCompressor: Tone.Compressor;
  private masterLimiter: Tone.Limiter;
  private unsubscribers: Array<() => void> = [];
  private toneStarted = false;
  private pendingMusicFadeIn: number | null = null;
  private lastLandedImpact = 0;
  private lastLandedFrame = -1;
  private frameCounter = 0;

  // State tracking for audio triggers
  private inVehicle = false;
  private vehicleType: 'car' | 'drone' | null = null;
  private holdLastThreshold = -1;
  private slopeSlideActive = false;

  constructor(
    private eventBus: EventBus,
    private player: PlayerController,
    private inputManager: InputManager,
    private settings: UserSettingsStore,
  ) {
    // Master bus: gains → compressor → limiter → destination
    this.masterCompressor = new Tone.Compressor({
      threshold: -24,
      ratio: 3,
      attack: 0.003,
      release: 0.12,
    });
    this.masterLimiter = new Tone.Limiter(-1);
    this.masterGain = new Tone.Gain(1);
    this.masterGain.chain(this.masterCompressor, this.masterLimiter, Tone.getDestination());

    // SFX at -2dB relative, Music at -6dB relative
    this.sfxGain = new Tone.Gain(0.79).connect(this.masterGain); // ~-2dB
    this.musicGain = new Tone.Gain(0.5).connect(this.masterGain);  // ~-6dB

    this.sfxEngine = new SFXEngine();
    this.sfxEngine.output.connect(this.sfxGain);

    this.musicEngine = new MusicEngine();
    this.musicEngine.output.connect(this.musicGain);

    this.setMasterVolume(this.settings.value.masterVolume);
    this.setMusicVolume(this.settings.value.musicVolume);
    this.setSfxVolume(this.settings.value.sfxVolume);

    this.bindEvents();
    this.listenForUserGesture();
  }

  private async ensureToneStarted(): Promise<void> {
    if (this.toneStarted) return;
    try {
      if (Tone.getContext().state !== 'running') {
        await Tone.start();
      }
      this.toneStarted = true;
      // Fulfil any pending music request that was queued before Tone started
      if (this.pendingMusicFadeIn !== null) {
        const fade = this.pendingMusicFadeIn;
        this.pendingMusicFadeIn = null;
        this.musicEngine.start(fade);
      }
    } catch {
      // Tone.start() rejected — will retry on next user gesture
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
    // Scale on top of the -6dB base offset
    this.musicGain.gain.rampTo(clamp(value, 0, 1) * 0.5, 0.05);
  }

  setSfxVolume(value: number): void {
    // Scale on top of the -2dB base offset
    this.sfxGain.gain.rampTo(clamp(value, 0, 1) * 0.79, 0.05);
  }

  startEngine(): void {
    if (!this.toneStarted) return;
    if (this.vehicleType === 'drone') {
      this.sfxEngine.droneRotorStart();
    } else {
      this.sfxEngine.startEngine();
    }
  }

  updateEngine(speedNorm: number): void {
    if (!this.toneStarted) return;
    if (this.vehicleType === 'drone') {
      this.sfxEngine.droneRotorUpdate(speedNorm);
    } else {
      this.sfxEngine.updateEngine(speedNorm);
    }
  }

  stopEngine(): void {
    if (!this.toneStarted) return;
    if (this.vehicleType === 'drone') {
      this.sfxEngine.droneRotorStop();
    } else {
      this.sfxEngine.stopEngine();
    }
  }

  dispose(): void {
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
    const gestureEvents = ['click', 'keydown', 'touchstart', 'pointerdown'] as const;
    const handler = (): void => {
      for (const evt of gestureEvents) {
        document.removeEventListener(evt, handler, true);
      }
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

  private bindEvents(): void {
    // ── Animation-driven footsteps ─────────────────────
    this.unsubscribers.push(
      this.eventBus.on('animation:footstep', () => {
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
      this.eventBus.on('animation:event', ({ event }) => {
        if (event === 'slopeSlideStart') {
          if (this.inVehicle) return;
          this.slopeSlideActive = true;
          this.sfxEngine.slopeSlideStart();
          return;
        }
        if (event === 'slopeSlideStop') {
          this.slopeSlideActive = false;
          this.sfxEngine.slopeSlideStop();
        }
      }),
    );

    // ── Player Movement ────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on('player:stateChanged', ({ previous, current }) => {
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
      this.eventBus.on('player:grounded', (grounded) => {
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
      this.eventBus.on('player:landed', ({ impactSpeed }) => {
        this.lastLandedImpact = impactSpeed;
        this.lastLandedFrame = this.frameCounter;
        if (impactSpeed < 3) return;
        this.sfxEngine.landHard(impactSpeed);
      }),
    );

    // ── Interaction ────────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on('interaction:triggered', () => {
        this.sfxEngine.interact();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('interaction:grabStart', () => {
        this.sfxEngine.grab();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('interaction:pickUp', () => {
        this.sfxEngine.interact();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('interaction:throw', () => {
        this.sfxEngine.throw();
      }),
    );

    // New interaction SFX
    this.unsubscribers.push(
      this.eventBus.on('interaction:focusChanged', ({ id }) => {
        if (id != null) {
          this.sfxEngine.focusTick();
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('interaction:holdProgress', (payload) => {
        if (!payload) {
          this.holdLastThreshold = -1;
          return;
        }
        // Fire on 10% thresholds
        const threshold = Math.floor(payload.progress * 10);
        if (threshold > this.holdLastThreshold) {
          this.holdLastThreshold = threshold;
          this.sfxEngine.holdCharge(payload.progress);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('interaction:blocked', () => {
        this.sfxEngine.interactBlocked();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('interaction:drop', () => {
        this.sfxEngine.drop();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('interaction:grabEnd', () => {
        this.sfxEngine.grabRelease();
      }),
    );

    // ── Progression ────────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on('checkpoint:activated', () => {
        this.sfxEngine.checkpoint();
        // Brief music duck to let chime shine
        this.musicEngine.duck(0.6);
        setTimeout(() => this.musicEngine.unduck(), 500);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('objective:completed', () => {
        this.sfxEngine.objectiveComplete();
        // Brief music duck
        this.musicEngine.duck(0.6);
        setTimeout(() => this.musicEngine.unduck(), 500);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('collectible:collected', () => {
        this.sfxEngine.coinCollect();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('player:damaged', ({ reason }) => {
        if (reason === 'spike') {
          this.sfxEngine.damageHit();
        }
      }),
    );

    // ── Death / Respawn ────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on('player:dying', () => {
        this.sfxEngine.deathDescend();
        // Duck music for death sequence
        this.musicEngine.duck(0.5);
        setTimeout(() => this.musicEngine.unduck(), 1500);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('player:deathMidpoint', () => {
        this.sfxEngine.deathMidpoint();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('player:respawned', () => {
        this.sfxEngine.respawnChime();
      }),
    );

    // ── Vehicle ────────────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on('vehicle:enter', ({ vehicle }) => {
        this.inVehicle = true;
        this.vehicleType = vehicle.type;
        if (this.slopeSlideActive) {
          this.sfxEngine.slopeSlideStop();
          this.slopeSlideActive = false;
        }
        this.sfxEngine.vehicleEnter();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('vehicle:exit', () => {
        this.sfxEngine.vehicleExit();
        this.inVehicle = false;
        this.vehicleType = null;
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('vehicle:engineStart', () => this.startEngine()),
    );
    this.unsubscribers.push(
      this.eventBus.on('vehicle:engineStop', () => this.stopEngine()),
    );
    this.unsubscribers.push(
      this.eventBus.on('vehicle:speedUpdate', ({ speedNorm }) => this.updateEngine(speedNorm)),
    );

    // ── Menu / UI ──────────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on('menu:opened', ({ screen }) => {
        if (screen === 'pause') {
          this.sfxEngine.menuOpen();
          this.musicEngine.duck(0.3);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('menu:closed', () => {
        this.sfxEngine.menuClose();
        this.musicEngine.unduck();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('ui:click', () => {
        this.sfxEngine.uiClick();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('ui:hover', () => {
        this.sfxEngine.uiHover();
      }),
    );

    // ── Volume Controls ────────────────────────────────
    this.unsubscribers.push(
      this.eventBus.on('audio:masterVolume', (value) => {
        this.setMasterVolume(value);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('audio:musicVolume', (value) => {
        this.setMusicVolume(value);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('audio:sfxVolume', (value) => {
        this.setSfxVolume(value);
      }),
    );

    // ── Loading ────────────────────────────────────────
    let lastTickThreshold = 0;

    this.unsubscribers.push(
      this.eventBus.on('loading:progress', ({ progress }) => {
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
      this.eventBus.on('level:loaded', () => {
        this.sfxEngine.loadingAmbientStop();
        this.sfxEngine.loadingWhoosh();
      }),
    );
  }
}
