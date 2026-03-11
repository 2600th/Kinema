import * as Tone from 'tone';
import type { PlayerController } from '@character/PlayerController';
import type { EventBus } from '@core/EventBus';
import type { Disposable, FixedUpdatable } from '@core/types';
import type { InputManager } from '@input/InputManager';
import type { UserSettingsStore } from '@core/UserSettings';
import { SFXEngine } from './SFXEngine';
import { MusicEngine } from './MusicEngine';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Audio manager delegating to Tone.js-based SFX and Music engines.
 */
export class AudioManager implements FixedUpdatable, Disposable {
  private sfxEngine: SFXEngine;
  private musicEngine: MusicEngine;
  private masterGain: Tone.Gain;
  private sfxGain: Tone.Gain;
  private musicGain: Tone.Gain;
  private unsubscribers: Array<() => void> = [];
  private footstepTimer = 0;
  private toneStarted = false;
  private pendingMusicFadeIn: number | null = null;
  private lastLandedImpact = 0;
  private lastLandedFrame = -1;
  private frameCounter = 0;

  constructor(
    private eventBus: EventBus,
    private player: PlayerController,
    private inputManager: InputManager,
    private settings: UserSettingsStore,
  ) {
    this.masterGain = new Tone.Gain(1).toDestination();
    this.sfxGain = new Tone.Gain(1).connect(this.masterGain);
    this.musicGain = new Tone.Gain(1).connect(this.masterGain);

    this.sfxEngine = new SFXEngine();
    this.sfxEngine.output.connect(this.sfxGain);

    this.musicEngine = new MusicEngine();
    this.musicEngine.output.connect(this.musicGain);

    this.setMasterVolume(this.settings.value.masterVolume);
    this.setMusicVolume(this.settings.value.musicVolume);
    this.setSfxVolume(this.settings.value.sfxVolume);

    this.bindEvents();
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

  fixedUpdate(dt: number): void {
    this.frameCounter++;
    // Resume audio context on first pointer lock (user gesture)
    if (!this.toneStarted && this.inputManager.isLocked) {
      void this.ensureToneStarted();
    }
    if (!this.toneStarted) return;

    const velocity = this.player.body.linvel();
    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    const movingOnGround = this.player.isGrounded && planarSpeed > 1.15;

    if (!movingOnGround) {
      this.footstepTimer = 0;
      return;
    }

    this.footstepTimer -= dt;
    if (this.footstepTimer > 0) return;

    this.sfxEngine.footstep(planarSpeed);
    const speedN = clamp((planarSpeed - 1.15) / 6.5, 0, 1);
    this.footstepTimer = 0.42 - speedN * 0.2;
  }

  playMusic(fadeInSec = 2.0): void {
    if (!this.toneStarted) {
      // Queue the request — it will be fulfilled once Tone starts
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
    this.musicGain.gain.rampTo(clamp(value, 0, 1), 0.05);
  }

  setSfxVolume(value: number): void {
    this.sfxGain.gain.rampTo(clamp(value, 0, 1), 0.05);
  }

  startEngine(): void {
    this.sfxEngine.startEngine();
  }

  updateEngine(speedNorm: number): void {
    this.sfxEngine.updateEngine(speedNorm);
  }

  stopEngine(): void {
    this.sfxEngine.stopEngine();
  }

  dispose(): void {
    this.stopEngine();
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.musicEngine.dispose();
    this.sfxEngine.dispose();
    this.musicGain.dispose();
    this.sfxGain.dispose();
    this.masterGain.dispose();
  }

  private bindEvents(): void {
    this.unsubscribers.push(
      this.eventBus.on('player:stateChanged', ({ current }) => {
        if (current === 'jump') {
          this.sfxEngine.jump();
        }
        if (current === 'airJump') {
          this.sfxEngine.airJump();
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
      this.eventBus.on('interaction:triggered', () => {
        this.sfxEngine.interact();
      }),
    );
    this.unsubscribers.push(
      this.eventBus.on('checkpoint:activated', () => {
        this.sfxEngine.checkpoint();
      }),
    );
    this.unsubscribers.push(
      this.eventBus.on('objective:completed', () => {
        this.sfxEngine.objectiveComplete();
      }),
    );
    this.unsubscribers.push(
      this.eventBus.on('player:respawned', () => {
        this.sfxEngine.respawn();
      }),
    );
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
    this.unsubscribers.push(
      this.eventBus.on('player:landed', ({ impactSpeed }) => {
        this.lastLandedImpact = impactSpeed;
        this.lastLandedFrame = this.frameCounter;
        if (impactSpeed < 3) return;
        this.sfxEngine.landHard(impactSpeed);
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
    this.unsubscribers.push(
      this.eventBus.on('menu:opened', ({ screen }) => {
        if (screen === 'pause') {
          this.sfxEngine.menuOpen();
          this.musicEngine.duck();
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
  }
}
