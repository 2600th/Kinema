import type { PlayerController } from '@character/PlayerController';
import type { EventBus } from '@core/EventBus';
import type { Disposable, FixedUpdatable } from '@core/types';
import type { InputManager } from '@input/InputManager';
import type { UserSettingsStore } from '@core/UserSettings';

/**
 * WebAudio manager for music and procedural SFX.
 */
export class AudioManager implements FixedUpdatable, Disposable {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private currentTrack: AudioBufferSourceNode | null = null;
  private currentTrackGain: GainNode | null = null;
  private musicCache = new Map<string, AudioBuffer>();
  private fallbackBuffer: AudioBuffer | null = null;
  private unsubscribers: Array<() => void> = [];
  private footstepTimer = 0;
  private ducked = false;

  constructor(
    private eventBus: EventBus,
    private player: PlayerController,
    private inputManager: InputManager,
    private settings: UserSettingsStore,
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
    this.musicGain = this.context.createGain();
    this.sfxGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);
    this.musicGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);

    this.setMasterVolume(this.settings.value.masterVolume);
    this.setMusicVolume(this.settings.value.musicVolume);
    this.setSfxVolume(this.settings.value.sfxVolume);

    this.bindEvents();
  }

  fixedUpdate(dt: number): void {
    if (!this.context || !this.sfxGain) return;
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

  playMusic(url: string, fadeInSec = 2.0): void {
    void this.startTrack(url, fadeInSec, true);
  }

  stopMusic(fadeOutSec = 1.5): void {
    if (!this.context || !this.currentTrack || !this.currentTrackGain) return;
    const now = this.context.currentTime;
    this.currentTrackGain.gain.cancelScheduledValues(now);
    this.currentTrackGain.gain.setValueAtTime(this.currentTrackGain.gain.value, now);
    this.currentTrackGain.gain.linearRampToValueAtTime(0, now + fadeOutSec);
    const track = this.currentTrack;
    window.setTimeout(() => {
      try {
        track.stop();
      } catch {
        // ignore
      }
      track.disconnect();
    }, fadeOutSec * 1000 + 40);
    this.currentTrack = null;
    this.currentTrackGain = null;
  }

  crossfadeTo(url: string, durationSec = 2.0): void {
    void this.startTrack(url, durationSec, false);
  }

  setMasterVolume(value: number): void {
    if (!this.masterGain) return;
    this.masterGain.gain.value = clamp(value, 0, 1);
  }

  setMusicVolume(value: number): void {
    if (!this.musicGain) return;
    this.musicGain.gain.value = clamp(value, 0, 1);
  }

  setSfxVolume(value: number): void {
    if (!this.sfxGain) return;
    this.sfxGain.gain.value = clamp(value, 0, 1);
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.currentTrack?.stop();
    this.currentTrack?.disconnect();
    this.currentTrack = null;
    this.currentTrackGain?.disconnect();
    this.currentTrackGain = null;
    this.musicGain?.disconnect();
    this.musicGain = null;
    this.sfxGain?.disconnect();
    this.sfxGain = null;
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
      this.eventBus.on('menu:opened', ({ screen }) => {
        if (screen !== 'pause') return;
        if (this.ducked) return;
        this.ducked = true;
        if (this.musicGain) {
          this.musicGain.gain.value *= 0.3;
        }
      }),
    );
    this.unsubscribers.push(
      this.eventBus.on('menu:closed', () => {
        if (!this.ducked) return;
        this.ducked = false;
        this.setMusicVolume(this.settings.value.musicVolume);
      }),
    );
  }

  private async startTrack(url: string, fadeSec: number, stopPrevious: boolean): Promise<void> {
    if (!this.context || !this.musicGain) return;
    if (this.context.state !== 'running') {
      try {
        await this.context.resume();
      } catch {
        // ignore
      }
    }
    const buffer = await this.loadBuffer(url);
    if (!buffer) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gainNode = this.context.createGain();
    gainNode.gain.value = 0;
    source.connect(gainNode);
    gainNode.connect(this.musicGain);

    const now = this.context.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + Math.max(0.1, fadeSec));
    source.start();

    if (stopPrevious && this.currentTrack && this.currentTrackGain) {
      this.stopMusic(fadeSec);
    } else if (this.currentTrack && this.currentTrackGain) {
      this.currentTrackGain.gain.cancelScheduledValues(now);
      this.currentTrackGain.gain.setValueAtTime(this.currentTrackGain.gain.value, now);
      this.currentTrackGain.gain.linearRampToValueAtTime(0, now + Math.max(0.1, fadeSec));
      const old = this.currentTrack;
      window.setTimeout(() => {
        try {
          old.stop();
        } catch {
          // ignore
        }
        old.disconnect();
      }, fadeSec * 1000 + 40);
    }

    this.currentTrack = source;
    this.currentTrackGain = gainNode;
  }

  private async loadBuffer(url: string): Promise<AudioBuffer | null> {
    if (!this.context) return null;
    const cached = this.musicCache.get(url);
    if (cached) return cached;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
      const data = await res.arrayBuffer();
      const buffer = await this.context.decodeAudioData(data);
      this.musicCache.set(url, buffer);
      return buffer;
    } catch {
      const fallback = this.createFallbackAmbientBuffer();
      if (fallback) {
        this.musicCache.set(url, fallback);
        return fallback;
      }
      return null;
    }
  }

  private createFallbackAmbientBuffer(): AudioBuffer | null {
    if (!this.context) return null;
    if (this.fallbackBuffer) return this.fallbackBuffer;
    const sampleRate = this.context.sampleRate;
    const duration = 4;
    const length = Math.floor(sampleRate * duration);
    const buffer = this.context.createBuffer(2, length, sampleRate);
    const fadeSamples = Math.max(1, Math.floor(sampleRate * 0.08));
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / sampleRate;
        const lfo = 0.5 + 0.5 * Math.sin(t * Math.PI * 0.5);
        const tone = Math.sin(2 * Math.PI * 110 * t) * 0.03 + Math.sin(2 * Math.PI * 220 * t) * 0.015;
        const noise = (Math.random() * 2 - 1) * 0.01;
        let value = (tone + noise) * lfo;
        if (i < fadeSamples) {
          value *= i / fadeSamples;
        } else if (i > length - fadeSamples) {
          value *= (length - i) / fadeSamples;
        }
        data[i] = value;
      }
    }
    this.fallbackBuffer = buffer;
    return buffer;
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
    if (!this.context || !this.sfxGain || this.context.state !== 'running') return;
    const when = this.context.currentTime + delay;
    const osc = this.context.createOscillator();
    const amp = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, when);
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(gain, when + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(amp);
    amp.connect(this.sfxGain);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
