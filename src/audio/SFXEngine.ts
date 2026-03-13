import * as Tone from 'tone';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function randRange(base: number, variance: number): number {
  return base + (Math.random() * 2 - 1) * variance;
}

/**
 * Procedural SFX engine using Tone.js.
 * Reuses a small pool of synths to avoid GC pops / leaks.
 */
export class SFXEngine {
  readonly output: Tone.Gain;

  // Shared effects
  private reverb: Tone.Reverb;
  private delay: Tone.FeedbackDelay;
  private effectsBus: Tone.Gain;

  // Reusable synths
  private toneSynth: Tone.Synth;
  private noiseSynth: Tone.NoiseSynth;
  private polySynth: Tone.PolySynth;

  // Pre-allocated synths for high-frequency SFX (avoid GC pops)
  private footstepNoise: Tone.NoiseSynth;
  private footstepFilter: Tone.Filter;
  private sparkleSynth: Tone.Synth;
  private subSynth: Tone.Synth;

  // Engine sustained sound
  private engineOsc: Tone.Oscillator | null = null;
  private engineSub: Tone.Oscillator | null = null;
  private engineGain: Tone.Gain | null = null;

  constructor() {
    this.output = new Tone.Gain(1);

    // Shared effects bus
    this.reverb = new Tone.Reverb({ decay: 1.5, wet: 0.2 });
    this.delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.25, wet: 0 });

    this.effectsBus = new Tone.Gain(1);
    this.effectsBus.chain(this.delay, this.reverb, this.output);

    // Tone synth for general one-shot tones
    this.toneSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.05 },
      volume: -12,
    }).connect(this.effectsBus);

    // Noise synth for impacts, whooshes
    this.noiseSynth = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.01 },
      volume: -18,
    }).connect(this.effectsBus);

    // PolySynth for chords, arpeggios
    this.polySynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.4 },
      volume: -14,
    }).connect(this.effectsBus);

    // Pre-allocated footstep synth + filter (avoids per-call allocation at ~5/sec)
    this.footstepFilter = new Tone.Filter({ frequency: 3000, type: 'bandpass', Q: 8 }).connect(this.output);
    this.footstepNoise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.005 },
      volume: -20,
    }).connect(this.footstepFilter);

    // Pre-allocated sparkle synth for airJump
    this.sparkleSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.05 },
      volume: -18,
    }).connect(this.output);

    // Pre-allocated sub synth for landHard
    this.subSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.15, sustain: 0, release: 0.05 },
      volume: -18,
    }).connect(this.output);
  }

  // ── Gameplay SFX ────────────────────────────────────────────

  jump(): void {
    // Sine sweep 250 -> 700Hz over 100ms + noise pop
    const now = Tone.now();
    const pitchVar = randRange(1.0, 0.1);
    this.toneSynth.oscillator.type = 'sine';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.1;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = -10;
    this.toneSynth.triggerAttackRelease('C4', 0.1, now);
    this.toneSynth.frequency.setValueAtTime(250 * pitchVar, now);
    this.toneSynth.frequency.exponentialRampToValueAtTime(700 * pitchVar, now + 0.1);

    this.noiseSynth.noise.type = 'white';
    this.noiseSynth.envelope.attack = 0.002;
    this.noiseSynth.envelope.decay = 0.04;
    this.noiseSynth.envelope.sustain = 0;
    this.noiseSynth.envelope.release = 0.01;
    this.noiseSynth.volume.value = -22;
    this.noiseSynth.triggerAttackRelease('32n', now);
  }

  airJump(): void {
    // Higher sweep 400 -> 1200Hz + sparkle overtone
    const now = Tone.now();
    const pitchVar = randRange(1.0, 0.1);
    this.toneSynth.oscillator.type = 'sine';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.1;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = -10;
    this.toneSynth.triggerAttackRelease('C5', 0.08, now);
    this.toneSynth.frequency.setValueAtTime(400 * pitchVar, now);
    this.toneSynth.frequency.exponentialRampToValueAtTime(1200 * pitchVar, now + 0.08);

    // Sparkle — reuse pre-allocated synth
    this.sparkleSynth.volume.value = -18;
    this.sparkleSynth.triggerAttackRelease(2400 * pitchVar, 0.08, now + 0.02);
  }

  landSoft(): void {
    // Brown noise burst 50ms + sub sine 60Hz
    const now = Tone.now();
    const pitchVar = randRange(1.0, 0.1);
    this.noiseSynth.noise.type = 'brown';
    this.noiseSynth.envelope.attack = 0.002;
    this.noiseSynth.envelope.decay = 0.05;
    this.noiseSynth.envelope.sustain = 0;
    this.noiseSynth.envelope.release = 0.01;
    this.noiseSynth.volume.value = -16;
    this.noiseSynth.triggerAttackRelease('32n', now);

    this.toneSynth.oscillator.type = 'sine';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.08;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = -14;
    this.toneSynth.triggerAttackRelease(60 * pitchVar, 0.08, now);

    // Reset noise type
    this.noiseSynth.noise.type = 'white';
  }

  landHard(impactSpeed: number): void {
    // Bigger noise 120ms + sub 40Hz + distortion intensity scaled by impact
    const now = Tone.now();
    const vol = clamp(-14 + impactSpeed * 0.5, -14, -6);
    const pitchVar = randRange(1.0, 0.1);

    this.noiseSynth.noise.type = 'brown';
    this.noiseSynth.envelope.attack = 0.002;
    this.noiseSynth.envelope.decay = 0.12;
    this.noiseSynth.envelope.sustain = 0;
    this.noiseSynth.envelope.release = 0.01;
    this.noiseSynth.volume.value = vol;
    this.noiseSynth.triggerAttackRelease('16n', now);

    this.toneSynth.oscillator.type = 'sine';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.15;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = vol - 2;
    this.toneSynth.triggerAttackRelease(40 * pitchVar, 0.15, now);

    // Second sub layer — reuse pre-allocated synth
    this.subSynth.volume.value = vol - 4;
    this.subSynth.triggerAttackRelease(30 * pitchVar, 0.12, now + 0.02);

    this.noiseSynth.noise.type = 'white';
  }

  footstep(planarSpeed: number): void {
    // Bandpass noise click 2-4kHz, 30ms, pitch varies — reuse pre-allocated synth
    const now = Tone.now();
    const freqBase = randRange(3000, 1000);
    this.footstepFilter.frequency.setValueAtTime(freqBase, now);
    this.footstepNoise.volume.value = -20 + clamp(planarSpeed * 0.5, 0, 4);
    this.footstepNoise.triggerAttackRelease('64n', now);
  }

  interact(): void {
    // Rising sine arpeggio C5 -> E5 -> G5 with slight pitch variation
    const now = Tone.now();
    const detune = randRange(0, 100); // ±100 cents (~±1 semitone)
    this.delay.wet.value = 0.15;
    this.polySynth.set({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.4 },
      detune,
    });
    this.polySynth.volume.value = -12;
    this.polySynth.triggerAttackRelease('C5', 0.08, now);
    this.polySynth.triggerAttackRelease('E5', 0.08, now + 0.06);
    this.polySynth.triggerAttackRelease('G5', 0.08, now + 0.12);
    setTimeout(() => { this.delay.wet.value = 0; this.polySynth.set({ detune: 0 }); }, 600);
  }

  checkpoint(): void {
    // Full arpeggio C5 -> E5 -> G5 -> C6 with delay tail
    const now = Tone.now();
    this.delay.wet.value = 0.3;
    this.polySynth.set({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.4 },
    });
    this.polySynth.volume.value = -10;
    this.polySynth.triggerAttackRelease('C5', 0.1, now);
    this.polySynth.triggerAttackRelease('E5', 0.1, now + 0.08);
    this.polySynth.triggerAttackRelease('G5', 0.1, now + 0.16);
    this.polySynth.triggerAttackRelease('C6', 0.15, now + 0.24);
    setTimeout(() => { this.delay.wet.value = 0; }, 1200);
  }

  objectiveComplete(): void {
    // Sustained major chord C-E-G with shimmer
    const now = Tone.now();
    this.delay.wet.value = 0.25;
    this.polySynth.set({
      envelope: { attack: 0.05, decay: 0.6, sustain: 0.2, release: 0.8 },
    });
    this.polySynth.volume.value = -8;
    this.polySynth.triggerAttackRelease(['C5', 'E5', 'G5'], 0.6, now);

    // Shimmer overtone
    const shimmer = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.1, decay: 0.8, sustain: 0, release: 0.3 },
      volume: -16,
    }).connect(this.output);
    shimmer.triggerAttackRelease('C7', 0.5, now + 0.1);
    setTimeout(() => {
      shimmer.dispose();
      this.delay.wet.value = 0;
      this.polySynth.set({
        envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.4 },
      });
    }, 2000);
  }

  respawn(): void {
    // Descending tones A4 -> D4 -> A3, gentle
    const now = Tone.now();
    this.polySynth.set({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.4 },
    });
    this.polySynth.volume.value = -12;
    this.polySynth.triggerAttackRelease('A4', 0.12, now);
    this.polySynth.triggerAttackRelease('D4', 0.12, now + 0.1);
    this.polySynth.triggerAttackRelease('A3', 0.18, now + 0.2);
  }

  grab(): void {
    // Short sine 800Hz + noise click
    const now = Tone.now();
    const pitchVar = randRange(1.0, 0.1);
    this.toneSynth.oscillator.type = 'sine';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.04;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = -14;
    this.toneSynth.triggerAttackRelease(800 * pitchVar, 0.04, now);

    this.noiseSynth.noise.type = 'white';
    this.noiseSynth.envelope.attack = 0.002;
    this.noiseSynth.envelope.decay = 0.02;
    this.noiseSynth.envelope.sustain = 0;
    this.noiseSynth.envelope.release = 0.01;
    this.noiseSynth.volume.value = -22;
    this.noiseSynth.triggerAttackRelease('64n', now);
  }

  throw(): void {
    // Sawtooth sweep down 800 -> 200Hz over 150ms
    const now = Tone.now();
    const pitchVar = randRange(1.0, 0.1);
    this.toneSynth.oscillator.type = 'sawtooth';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.15;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = -14;
    this.toneSynth.triggerAttackRelease(800 * pitchVar, 0.15, now);
    this.toneSynth.frequency.setValueAtTime(800 * pitchVar, now);
    this.toneSynth.frequency.exponentialRampToValueAtTime(200 * pitchVar, now + 0.15);
  }

  // ── Menu / UI SFX ──────────────────────────────────────────

  menuOpen(): void {
    if (Tone.getContext().state !== 'running') return;
    // Noise sweep up 200 -> 2kHz over 200ms
    const now = Tone.now();
    const filter = new Tone.Filter({ frequency: 200, type: 'bandpass', Q: 2 }).connect(this.output);
    const noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.05 },
      volume: -18,
    }).connect(filter);
    filter.frequency.setValueAtTime(200, now);
    filter.frequency.exponentialRampToValueAtTime(2000, now + 0.2);
    noise.triggerAttackRelease('8n', now);
    setTimeout(() => { noise.dispose(); filter.dispose(); }, 500);
  }

  menuClose(): void {
    if (Tone.getContext().state !== 'running') return;
    // Noise sweep down 2k -> 200Hz over 200ms
    const now = Tone.now();
    const filter = new Tone.Filter({ frequency: 2000, type: 'bandpass', Q: 2 }).connect(this.output);
    const noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.05 },
      volume: -18,
    }).connect(filter);
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.2);
    noise.triggerAttackRelease('8n', now);
    setTimeout(() => { noise.dispose(); filter.dispose(); }, 500);
  }

  uiClick(): void {
    if (Tone.getContext().state !== 'running') return;
    // Sine pop 1kHz 20ms
    const now = Tone.now();
    const s = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.02, sustain: 0, release: 0.01 },
      volume: -16,
    }).connect(this.output);
    s.triggerAttackRelease(1000, 0.02, now);
    setTimeout(() => s.dispose(), 150);
  }

  uiHover(): void {
    if (Tone.getContext().state !== 'running') return;
    // High sine tick 3kHz 10ms, quiet
    const now = Tone.now();
    const s = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.01, sustain: 0, release: 0.005 },
      volume: -24,
    }).connect(this.output);
    s.triggerAttackRelease(3000, 0.01, now);
    setTimeout(() => s.dispose(), 100);
  }

  // ── Engine (sustained) ────────────────────────────────────

  startEngine(): void {
    if (this.engineOsc) return;
    this.engineGain = new Tone.Gain(0).connect(this.output);
    this.engineOsc = new Tone.Oscillator({ type: 'sawtooth', frequency: 80, volume: -12 }).connect(this.engineGain);
    this.engineSub = new Tone.Oscillator({ type: 'square', frequency: 40, volume: -18 }).connect(this.engineGain);
    this.engineOsc.start();
    this.engineSub.start();
  }

  updateEngine(speedNorm: number): void {
    if (!this.engineOsc || !this.engineSub || !this.engineGain) return;
    this.engineOsc.frequency.value = 80 + speedNorm * 140;
    this.engineSub.frequency.value = 40 + speedNorm * 60;
    this.engineGain.gain.rampTo(0.02 + speedNorm * 0.08, 0.05);
  }

  stopEngine(): void {
    this.engineOsc?.stop();
    this.engineOsc?.dispose();
    this.engineSub?.stop();
    this.engineSub?.dispose();
    this.engineGain?.dispose();
    this.engineOsc = null;
    this.engineSub = null;
    this.engineGain = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  dispose(): void {
    this.stopEngine();
    this.toneSynth.dispose();
    this.noiseSynth.dispose();
    this.polySynth.dispose();
    this.footstepNoise.dispose();
    this.footstepFilter.dispose();
    this.sparkleSynth.dispose();
    this.subSynth.dispose();
    this.reverb.dispose();
    this.delay.dispose();
    this.effectsBus.dispose();
    this.output.dispose();
  }
}
