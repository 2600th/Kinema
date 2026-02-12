import type { PlayerController } from '@character/PlayerController';
import type { EventBus } from '@core/EventBus';
import type { Disposable, FixedUpdatable } from '@core/types';
import type { InputManager } from '@input/InputManager';

/**
 * Lightweight procedural audio layer.
 * Uses WebAudio tones/noise so gameplay feedback works without external assets.
 */
export class AudioManager implements FixedUpdatable, Disposable {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientOsc: OscillatorNode | null = null;
  private unsubscribers: Array<() => void> = [];
  private footstepTimer = 0;

  constructor(
    private eventBus: EventBus,
    private player: PlayerController,
    private inputManager: InputManager,
  ) {
    if (typeof window === 'undefined') return;

    const withWebkit = globalThis as typeof globalThis & {
      webkitAudioContext?: (new (contextOptions?: AudioContextOptions) => AudioContext) & typeof AudioContext;
    };
    const AudioCtx = withWebkit.AudioContext ?? withWebkit.webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.context = new AudioCtx();
    } catch {
      this.context = null;
      return;
    }

    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.28;
    this.masterGain.connect(this.context.destination);
    this.createAmbientBed();
    this.bindEvents();
  }

  fixedUpdate(dt: number): void {
    if (!this.context || !this.masterGain) return;
    if (this.context.state !== 'running') {
      if (this.inputManager.isLocked) {
        void this.context.resume();
      }
      return;
    }

    const velocity = this.player.body.linvel();
    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    const movingOnGround = this.player.isGrounded && planarSpeed > 1.15;

    if (!movingOnGround) {
      this.footstepTimer = 0;
      return;
    }

    this.footstepTimer -= dt;
    if (this.footstepTimer > 0) return;

    this.playFootstep(planarSpeed);
    const speedN = clamp((planarSpeed - 1.15) / 6.5, 0, 1);
    this.footstepTimer = 0.42 - speedN * 0.2;
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    if (this.ambientOsc) {
      this.ambientOsc.stop();
      this.ambientOsc.disconnect();
      this.ambientOsc = null;
    }
    this.ambientGain?.disconnect();
    this.ambientGain = null;
    this.masterGain?.disconnect();
    this.masterGain = null;
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }

  private bindEvents(): void {
    this.unsubscribers.push(
      this.eventBus.on('player:stateChanged', ({ current }) => {
        if (current === 'jump') {
          this.playTone(320, 0.08, 'triangle', 0.06);
        }
      }),
    );
    this.unsubscribers.push(
      this.eventBus.on('player:grounded', (grounded) => {
        if (grounded) {
          this.playTone(110, 0.1, 'triangle', 0.05);
        }
      }),
    );
    this.unsubscribers.push(
      this.eventBus.on('interaction:triggered', () => {
        this.playTone(520, 0.06, 'square', 0.045);
      }),
    );
    this.unsubscribers.push(
      this.eventBus.on('checkpoint:activated', () => {
        this.playTone(520, 0.08, 'sine', 0.05);
        this.playTone(780, 0.12, 'sine', 0.045, 0.09);
      }),
    );
    this.unsubscribers.push(
      this.eventBus.on('objective:completed', () => {
        this.playTone(660, 0.08, 'triangle', 0.04);
      }),
    );
    this.unsubscribers.push(
      this.eventBus.on('player:respawned', () => {
        this.playTone(240, 0.08, 'sawtooth', 0.06);
        this.playTone(170, 0.12, 'sawtooth', 0.05, 0.08);
      }),
    );
  }

  private createAmbientBed(): void {
    if (!this.context || !this.masterGain) return;
    this.ambientGain = this.context.createGain();
    this.ambientGain.gain.value = 0.015;
    this.ambientGain.connect(this.masterGain);
    this.ambientOsc = this.context.createOscillator();
    this.ambientOsc.type = 'sine';
    this.ambientOsc.frequency.value = 48;
    this.ambientOsc.connect(this.ambientGain);
    this.ambientOsc.start();
  }

  private playFootstep(planarSpeed: number): void {
    const freq = 120 + Math.random() * 50 + Math.min(planarSpeed * 8, 55);
    this.playTone(freq, 0.05, 'triangle', 0.03);
  }

  private playTone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
  ): void {
    if (!this.context || !this.masterGain || this.context.state !== 'running') return;
    const when = this.context.currentTime + delay;
    const osc = this.context.createOscillator();
    const amp = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, when);
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(gain, when + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(amp);
    amp.connect(this.masterGain);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
