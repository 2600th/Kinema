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

  // Per-synth last-trigger tracking to avoid "start time must be strictly greater" errors
  private lastToneSynthTime = 0;
  private lastNoiseSynthTime = 0;
  private lastSparkleSynthTime = 0;
  private lastSubSynthTime = 0;
  private lastFootstepTime = 0;

  // Loading ambient sound
  private loadingOsc: Tone.Oscillator | null = null;
  private loadingLfo: Tone.LFO | null = null;

  // Engine sustained sound (car)
  private engineOsc: Tone.Oscillator | null = null;
  private engineSub: Tone.Oscillator | null = null;
  private engineGain: Tone.Gain | null = null;
  private engineFilter: Tone.Filter | null = null;
  private engineAirNoise: Tone.Noise | null = null;
  private engineAirFilter: Tone.Filter | null = null;
  private engineAirGain: Tone.Gain | null = null;

  // Drone rotor sustained sound
  private droneOsc: Tone.Oscillator | null = null;
  private droneNoiseGain: Tone.Gain | null = null;
  private droneNoise: Tone.Noise | null = null;
  private droneNoiseFilter: Tone.Filter | null = null;
  private droneGain: Tone.Gain | null = null;

  // Slope slide sustained sound
  private slideNoise: Tone.Noise | null = null;
  private slideFilter: Tone.Filter | null = null;
  private slideGain: Tone.Gain | null = null;

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
    this.polySynth = new Tone.PolySynth({
      voice: Tone.Synth,
      options: {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.4 },
        volume: -14,
      },
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

  // ── Helpers ────────────────────────────────────────────────

  /** Ensure strictly increasing start times for a reused synth. */
  private safeToneTime(): number {
    const now = Math.max(Tone.now(), this.lastToneSynthTime + 0.02);
    this.lastToneSynthTime = now;
    return now;
  }

  private safeNoiseTime(): number {
    const now = Math.max(Tone.now(), this.lastNoiseSynthTime + 0.02);
    this.lastNoiseSynthTime = now;
    return now;
  }

  private safeSparkleSynthTime(): number {
    const now = Math.max(Tone.now(), this.lastSparkleSynthTime + 0.02);
    this.lastSparkleSynthTime = now;
    return now;
  }

  private safeSubSynthTime(): number {
    const now = Math.max(Tone.now(), this.lastSubSynthTime + 0.02);
    this.lastSubSynthTime = now;
    return now;
  }

  private safeFootstepTime(): number {
    const now = Math.max(Tone.now(), this.lastFootstepTime + 0.02);
    this.lastFootstepTime = now;
    return now;
  }

  // ── Gameplay SFX ────────────────────────────────────────────

  jump(): void {
    // Triangle sweep 300 -> 900Hz over 100ms + noise pop (brighter, bouncier)
    const toneNow = this.safeToneTime();
    const noiseNow = this.safeNoiseTime();
    const pitchVar = randRange(1.0, 0.1);
    this.toneSynth.oscillator.type = 'triangle';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.1;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = -8;
    this.toneSynth.triggerAttackRelease('C4', 0.1, toneNow);
    this.toneSynth.frequency.setValueAtTime(300 * pitchVar, toneNow);
    this.toneSynth.frequency.exponentialRampToValueAtTime(900 * pitchVar, toneNow + 0.1);

    this.noiseSynth.noise.type = 'white';
    this.noiseSynth.envelope.attack = 0.002;
    this.noiseSynth.envelope.decay = 0.04;
    this.noiseSynth.envelope.sustain = 0;
    this.noiseSynth.envelope.release = 0.01;
    this.noiseSynth.volume.value = -18;
    this.noiseSynth.triggerAttackRelease('32n', noiseNow);
  }

  airJump(): void {
    // Higher triangle sweep 400 -> 1200Hz + sparkle overtone
    const toneNow = this.safeToneTime();
    const sparkleNow = this.safeSparkleSynthTime();
    const pitchVar = randRange(1.0, 0.1);
    this.toneSynth.oscillator.type = 'triangle';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.1;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = -8;
    this.toneSynth.triggerAttackRelease('C5', 0.08, toneNow);
    this.toneSynth.frequency.setValueAtTime(400 * pitchVar, toneNow);
    this.toneSynth.frequency.exponentialRampToValueAtTime(1200 * pitchVar, toneNow + 0.08);

    // Sparkle — reuse pre-allocated synth
    this.sparkleSynth.volume.value = -14;
    this.sparkleSynth.triggerAttackRelease(2400 * pitchVar, 0.08, sparkleNow + 0.02);
  }

  landSoft(): void {
    // Brown noise burst 50ms + sub sine 60Hz
    const toneNow = this.safeToneTime();
    const noiseNow = this.safeNoiseTime();
    const pitchVar = randRange(1.0, 0.1);
    this.noiseSynth.noise.type = 'brown';
    this.noiseSynth.envelope.attack = 0.002;
    this.noiseSynth.envelope.decay = 0.05;
    this.noiseSynth.envelope.sustain = 0;
    this.noiseSynth.envelope.release = 0.01;
    this.noiseSynth.volume.value = -14;
    this.noiseSynth.triggerAttackRelease('32n', noiseNow);

    this.toneSynth.oscillator.type = 'sine';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.08;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = -12;
    this.toneSynth.triggerAttackRelease(60 * pitchVar, 0.08, toneNow);

    // Reset noise type
    this.noiseSynth.noise.type = 'white';
  }

  landHard(impactSpeed: number): void {
    // Bigger noise 120ms + sub 40Hz + distortion intensity scaled by impact
    const toneNow = this.safeToneTime();
    const noiseNow = this.safeNoiseTime();
    const subNow = this.safeSubSynthTime();
    const vol = clamp(-12 + impactSpeed * 0.5, -12, -4);
    const pitchVar = randRange(1.0, 0.1);

    this.noiseSynth.noise.type = 'brown';
    this.noiseSynth.envelope.attack = 0.002;
    this.noiseSynth.envelope.decay = 0.12;
    this.noiseSynth.envelope.sustain = 0;
    this.noiseSynth.envelope.release = 0.01;
    this.noiseSynth.volume.value = vol;
    this.noiseSynth.triggerAttackRelease('16n', noiseNow);

    this.toneSynth.oscillator.type = 'sine';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.15;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = vol - 2;
    this.toneSynth.triggerAttackRelease(40 * pitchVar, 0.15, toneNow);

    // Second sub layer — reuse pre-allocated synth
    this.subSynth.volume.value = vol - 4;
    this.subSynth.triggerAttackRelease(30 * pitchVar, 0.12, subNow + 0.02);

    this.noiseSynth.noise.type = 'white';
  }

  footstep(planarSpeed: number): void {
    // Bandpass noise click 2-4kHz, 30ms, pitch varies — reuse pre-allocated synth
    const now = this.safeFootstepTime();
    const freqBase = randRange(3000, 1000);
    this.footstepFilter.frequency.setValueAtTime(freqBase, now);
    this.footstepNoise.volume.value = -18 + clamp(planarSpeed * 0.5, 0, 4);
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
    this.polySynth.volume.value = -10;
    this.polySynth.triggerAttackRelease('C5', 0.08, now);
    this.polySynth.triggerAttackRelease('E5', 0.08, now + 0.06);
    this.polySynth.triggerAttackRelease('G5', 0.08, now + 0.12);
    setTimeout(() => { this.delay.wet.value = 0; this.polySynth.set({ detune: 0 }); }, 600);
  }

  checkpoint(): void {
    // Warm FMSynth arpeggio C5 -> E5 -> G5 -> C6 with chorus + delay
    if (Tone.getContext().state !== 'running') return;
    const now = Tone.now();
    this.delay.wet.value = 0.3;
    const chorus = new Tone.Chorus({ frequency: 2.5, delayTime: 3.5, depth: 0.6, wet: 0.4 }).connect(this.effectsBus);
    const fm = new Tone.FMSynth({
      harmonicity: 3,
      modulationIndex: 1.5,
      oscillator: { type: 'sine' },
      modulation: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.15, release: 0.5 },
      modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.3 },
      volume: -8,
    }).connect(chorus);
    fm.triggerAttackRelease('C5', 0.1, now);
    fm.triggerAttackRelease('E5', 0.1, now + 0.08);
    fm.triggerAttackRelease('G5', 0.1, now + 0.16);
    fm.triggerAttackRelease('C6', 0.15, now + 0.24);
    setTimeout(() => { fm.dispose(); chorus.dispose(); this.delay.wet.value = 0; }, 1500);
  }

  coinCollect(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = this.safeToneTime();
    const sparkleNow = this.safeSparkleSynthTime();
    const baseFreq = randRange(540, 20);
    const sweepTarget = baseFreq * 1.35;

    this.delay.wet.value = 0.15;
    this.toneSynth.oscillator.type = 'triangle';
    this.toneSynth.envelope.attack = 0.002;
    this.toneSynth.envelope.decay = 0.12;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.08;
    this.toneSynth.volume.value = -10;
    this.toneSynth.triggerAttackRelease(baseFreq, 0.14, now);
    this.toneSynth.frequency.setValueAtTime(baseFreq, now);
    this.toneSynth.frequency.exponentialRampToValueAtTime(sweepTarget, now + 0.12);

    this.sparkleSynth.volume.value = -12;
    this.sparkleSynth.triggerAttackRelease(baseFreq * 2.4, 0.16, sparkleNow + 0.02);
    setTimeout(() => { this.delay.wet.value = 0; }, 250);
  }

  damageHit(): void {
    if (Tone.getContext().state !== 'running') return;
    const toneNow = this.safeToneTime();
    const noiseNow = this.safeNoiseTime();
    const pitchVar = randRange(1.0, 0.08);

    this.noiseSynth.noise.type = 'pink';
    this.noiseSynth.envelope.attack = 0.001;
    this.noiseSynth.envelope.decay = 0.08;
    this.noiseSynth.envelope.sustain = 0;
    this.noiseSynth.envelope.release = 0.02;
    this.noiseSynth.volume.value = -14;
    this.noiseSynth.triggerAttackRelease('32n', noiseNow);

    this.toneSynth.oscillator.type = 'sawtooth';
    this.toneSynth.envelope.attack = 0.002;
    this.toneSynth.envelope.decay = 0.12;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.04;
    this.toneSynth.volume.value = -10;
    this.toneSynth.triggerAttackRelease(520 * pitchVar, 0.12, toneNow);
    this.toneSynth.frequency.setValueAtTime(520 * pitchVar, toneNow);
    this.toneSynth.frequency.exponentialRampToValueAtTime(240 * pitchVar, toneNow + 0.12);

    this.noiseSynth.noise.type = 'white';
  }

  objectiveComplete(): void {
    // Sustained major chord C-E-G with shimmer
    const now = Tone.now();
    this.delay.wet.value = 0.25;
    this.polySynth.set({
      envelope: { attack: 0.05, decay: 0.6, sustain: 0.2, release: 0.8 },
    });
    this.polySynth.volume.value = -6;
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
    // Ascending hopeful arpeggio C5 -> E5 -> G5 -> C6
    const now = Tone.now();
    this.delay.wet.value = 0.2;
    this.polySynth.set({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.4 },
    });
    this.polySynth.volume.value = -10;
    this.polySynth.triggerAttackRelease('C5', 0.12, now);
    this.polySynth.triggerAttackRelease('E5', 0.12, now + 0.08);
    this.polySynth.triggerAttackRelease('G5', 0.12, now + 0.16);
    this.polySynth.triggerAttackRelease('C6', 0.18, now + 0.24);
    setTimeout(() => { this.delay.wet.value = 0; }, 800);
  }

  grab(): void {
    // Short sine 800Hz + noise click
    const toneNow = this.safeToneTime();
    const noiseNow = this.safeNoiseTime();
    const pitchVar = randRange(1.0, 0.1);
    this.toneSynth.oscillator.type = 'sine';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.04;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = -12;
    this.toneSynth.triggerAttackRelease(800 * pitchVar, 0.04, toneNow);

    this.noiseSynth.noise.type = 'white';
    this.noiseSynth.envelope.attack = 0.002;
    this.noiseSynth.envelope.decay = 0.02;
    this.noiseSynth.envelope.sustain = 0;
    this.noiseSynth.envelope.release = 0.01;
    this.noiseSynth.volume.value = -18;
    this.noiseSynth.triggerAttackRelease('64n', noiseNow);
  }

  throw(): void {
    // Sawtooth sweep down 800 -> 200Hz over 150ms
    const toneNow = this.safeToneTime();
    const pitchVar = randRange(1.0, 0.1);
    this.toneSynth.oscillator.type = 'sawtooth';
    this.toneSynth.envelope.attack = 0.005;
    this.toneSynth.envelope.decay = 0.15;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.05;
    this.toneSynth.volume.value = -12;
    this.toneSynth.triggerAttackRelease(800 * pitchVar, 0.15, toneNow);
    this.toneSynth.frequency.setValueAtTime(800 * pitchVar, toneNow);
    this.toneSynth.frequency.exponentialRampToValueAtTime(200 * pitchVar, toneNow + 0.15);
  }

  // ── Interaction Polish SFX ─────────────────────────────────

  /** Subtle tick when interaction focus changes to a new target */
  focusTick(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = this.safeSparkleSynthTime();
    this.sparkleSynth.oscillator.type = 'triangle';
    this.sparkleSynth.envelope.attack = 0.001;
    this.sparkleSynth.envelope.decay = 0.015;
    this.sparkleSynth.envelope.sustain = 0;
    this.sparkleSynth.envelope.release = 0.01;
    this.sparkleSynth.volume.value = -26;
    this.sparkleSynth.triggerAttackRelease('C7', 0.015, now);
  }

  /** Rising pitch charge sound for hold interactions */
  holdCharge(progress: number): void {
    if (Tone.getContext().state !== 'running') return;
    const toneNow = this.safeToneTime();
    const freq = 200 + progress * 600;
    const vol = -20 + progress * 6;
    this.toneSynth.oscillator.type = 'sine';
    this.toneSynth.envelope.attack = 0.01;
    this.toneSynth.envelope.decay = 0.1;
    this.toneSynth.envelope.sustain = 0.8;
    this.toneSynth.envelope.release = 0.1;
    this.toneSynth.volume.value = vol;
    this.toneSynth.triggerAttackRelease(freq, 0.1, toneNow);
  }

  /** Two-note descending "blocked" sound (E4→C4) */
  interactBlocked(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = Tone.now();
    const s = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.005, decay: 0.08, sustain: 0, release: 0.05 },
      volume: -16,
    }).connect(this.effectsBus);
    s.triggerAttackRelease('E4', 0.06, now);
    s.triggerAttackRelease('C4', 0.06, now + 0.06);
    setTimeout(() => s.dispose(), 300);
  }

  /** Percussive thud for dropping objects */
  drop(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = Tone.now();
    const mem = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 4,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
      volume: -14,
    }).connect(this.output);
    mem.triggerAttackRelease('C2', 0.06, now);
    setTimeout(() => mem.dispose(), 200);
  }

  /** Descending sine for releasing a grab (A5→F5) */
  grabRelease(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = this.safeToneTime();
    this.toneSynth.oscillator.type = 'sine';
    this.toneSynth.envelope.attack = 0.001;
    this.toneSynth.envelope.decay = 0.03;
    this.toneSynth.envelope.sustain = 0;
    this.toneSynth.envelope.release = 0.02;
    this.toneSynth.volume.value = -18;
    this.toneSynth.triggerAttackRelease('A5', 0.04, now);
    this.toneSynth.frequency.setValueAtTime(880, now);
    this.toneSynth.frequency.exponentialRampToValueAtTime(698, now + 0.04);
  }

  // ── Vehicle SFX ───────────────────────────────────────────

  /** Noise sweep up + chime for entering a vehicle */
  vehicleEnter(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = Tone.now();
    // Noise sweep 500→3kHz
    const filter = new Tone.Filter({ frequency: 500, type: 'bandpass', Q: 2 }).connect(this.output);
    const noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0, release: 0.03 },
      volume: -14,
    }).connect(filter);
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(3000, now + 0.15);
    noise.triggerAttackRelease('8n', now);
    // C6 chime after sweep
    const chime = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.05, sustain: 0, release: 0.03 },
      volume: -14,
    }).connect(this.output);
    chime.triggerAttackRelease('C6', 0.05, now + 0.12);
    setTimeout(() => { noise.dispose(); filter.dispose(); chime.dispose(); }, 500);
  }

  /** Noise sweep down + thud for exiting a vehicle */
  vehicleExit(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = Tone.now();
    // Noise sweep 2kHz→300Hz
    const filter = new Tone.Filter({ frequency: 2000, type: 'bandpass', Q: 2 }).connect(this.output);
    const noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.03 },
      volume: -14,
    }).connect(filter);
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.2);
    noise.triggerAttackRelease('8n', now);
    // G3 thud after sweep
    const thud = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 3,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.03 },
      volume: -14,
    }).connect(this.output);
    thud.triggerAttackRelease('G3', 0.08, now + 0.15);
    setTimeout(() => { noise.dispose(); filter.dispose(); thud.dispose(); }, 600);
  }

  /** Start continuous drone rotor sound — triangle osc + filtered white noise */
  droneRotorStart(): void {
    if (this.droneOsc) return;
    this.droneGain = new Tone.Gain(0).connect(this.output);
    // Triangle oscillator for rotor whine
    this.droneOsc = new Tone.Oscillator({ type: 'triangle', frequency: 220, volume: -16 }).connect(this.droneGain);
    // Filtered white noise for air
    this.droneNoiseFilter = new Tone.Filter({ frequency: 2000, type: 'lowpass', Q: 1 }).connect(this.droneGain);
    this.droneNoise = new Tone.Noise('white');
    this.droneNoiseGain = new Tone.Gain(0.01).connect(this.droneNoiseFilter);
    this.droneNoise.connect(this.droneNoiseGain);
    this.droneOsc.start();
    this.droneNoise.start();
    this.droneGain.gain.rampTo(1, 0.1);
  }

  /** Update drone rotor speed — modulates pitch and noise level */
  droneRotorUpdate(speed: number): void {
    if (!this.droneOsc || !this.droneNoiseGain || !this.droneGain) return;
    this.droneOsc.frequency.value = 180 + speed * 220;
    this.droneNoiseGain.gain.value = 0.01 + speed * 0.04;
    this.droneGain.gain.rampTo(0.5 + speed * 0.5, 0.05);
  }

  /** Fade out and stop drone rotor */
  droneRotorStop(): void {
    if (!this.droneGain) return;
    this.droneGain.gain.rampTo(0, 0.3);
    const osc = this.droneOsc;
    const noise = this.droneNoise;
    const noiseGain = this.droneNoiseGain;
    const noiseFilter = this.droneNoiseFilter;
    const gain = this.droneGain;
    this.droneOsc = null;
    this.droneNoise = null;
    this.droneNoiseGain = null;
    this.droneNoiseFilter = null;
    this.droneGain = null;
    setTimeout(() => {
      osc?.stop(); osc?.dispose();
      noise?.stop(); noise?.dispose();
      noiseGain?.dispose();
      noiseFilter?.dispose();
      gain?.dispose();
    }, 400);
  }

  // ── Movement Polish SFX ──────────────────────────────────

  /** Short brown noise burst for crouching down */
  crouchDown(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = Tone.now();
    const filter = new Tone.Filter({ frequency: 800, type: 'bandpass', Q: 4 }).connect(this.output);
    const noise = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.002, decay: 0.03, sustain: 0, release: 0.005 },
      volume: -22,
    }).connect(filter);
    noise.triggerAttackRelease('64n', now);
    setTimeout(() => { noise.dispose(); filter.dispose(); }, 150);
  }

  /** Short brown noise burst for standing up from crouch */
  crouchUp(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = Tone.now();
    const filter = new Tone.Filter({ frequency: 1200, type: 'bandpass', Q: 4 }).connect(this.output);
    const noise = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.002, decay: 0.025, sustain: 0, release: 0.005 },
      volume: -22,
    }).connect(filter);
    noise.triggerAttackRelease('64n', now);
    setTimeout(() => { noise.dispose(); filter.dispose(); }, 150);
  }

  /** Start continuous slope slide sound */
  slopeSlideStart(): void {
    if (this.slideNoise) return;
    this.slideGain = new Tone.Gain(0).connect(this.output);
    this.slideFilter = new Tone.Filter({ frequency: 1000, type: 'bandpass', Q: 2 }).connect(this.slideGain);
    this.slideNoise = new Tone.Noise('white');
    this.slideNoise.connect(this.slideFilter);
    this.slideNoise.start();
  }

  /** Update slope slide — speed drives filter cutoff and volume */
  slopeSlideUpdate(speed: number): void {
    if (!this.slideFilter || !this.slideGain) return;
    this.slideFilter.frequency.value = 600 + speed * 2000;
    this.slideGain.gain.rampTo(clamp(speed * 0.08, 0, 0.06), 0.05);
  }

  /** Stop slope slide sound */
  slopeSlideStop(): void {
    if (!this.slideNoise) return;
    this.slideGain?.gain.rampTo(0, 0.1);
    const noise = this.slideNoise;
    const filter = this.slideFilter;
    const gain = this.slideGain;
    this.slideNoise = null;
    this.slideFilter = null;
    this.slideGain = null;
    setTimeout(() => {
      noise?.stop(); noise?.dispose();
      filter?.dispose();
      gain?.dispose();
    }, 200);
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
      volume: -16,
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
      volume: -16,
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
      volume: -18,
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
      volume: -26,
    }).connect(this.output);
    s.triggerAttackRelease(3000, 0.01, now);
    setTimeout(() => s.dispose(), 100);
  }

  // ── Death / Respawn SFX ──────────────────────────────────

  /** Dramatic chromatic descent G4→C3, square wave, 50ms per note */
  deathDescend(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = Tone.now();
    // Chromatic run from G4 (392Hz) down to C3 (131Hz) — 8 semitones worth
    const notes = ['G4', 'F#4', 'F4', 'E4', 'Eb4', 'D4', 'Db4', 'C4', 'B3', 'Bb3', 'A3', 'Ab3', 'G3', 'F#3', 'F3', 'E3', 'Eb3', 'D3', 'Db3', 'C3'];
    const s = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.002, decay: 0.04, sustain: 0.3, release: 0.02 },
      volume: -10,
    }).connect(this.effectsBus);
    const step = 0.05; // 50ms per note
    for (let i = 0; i < notes.length; i++) {
      // Only play subset to fit ~400ms total — every other note for speed
      if (i % 2 === 1 && i < notes.length - 1) continue;
      const idx = Math.floor(i / 2);
      s.triggerAttackRelease(notes[i], step * 0.8, now + idx * step);
    }
    setTimeout(() => s.dispose(), 800);
  }

  /** Filtered noise burst with long reverb tail for death midpoint */
  deathMidpoint(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = Tone.now();
    const rev = new Tone.Reverb({ decay: 1.5, wet: 0.8 }).connect(this.output);
    const noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.05 },
      volume: -16,
    }).connect(rev);
    noise.triggerAttackRelease('16n', now);
    setTimeout(() => { noise.dispose(); rev.dispose(); }, 1500);
  }

  /** Quick ascending respawn chime — bright and hopeful */
  respawnChime(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = Tone.now();
    this.delay.wet.value = 0.15;
    this.polySynth.set({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.3 },
    });
    this.polySynth.volume.value = -12;
    this.polySynth.triggerAttackRelease('C5', 0.1, now);
    this.polySynth.triggerAttackRelease('E5', 0.1, now + 0.06);
    this.polySynth.triggerAttackRelease('G5', 0.1, now + 0.12);
    this.polySynth.triggerAttackRelease('C6', 0.15, now + 0.18);
    setTimeout(() => { this.delay.wet.value = 0; }, 600);
  }

  // ── Loading Screen SFX ──────────────────────────────────

  /** Subtle sparkle tick for loading progress */
  loadingTick(progress: number): void {
    if (Tone.getContext().state !== 'running') return;
    const freq = 800 + progress * 600;
    const now = this.safeSparkleSynthTime();
    this.sparkleSynth.triggerAttackRelease(freq, '64n', now, 0.15);
  }

  /** Start ambient loading hum */
  loadingAmbientStart(): void {
    if (Tone.getContext().state !== 'running' || this.loadingOsc) return;
    this.loadingOsc = new Tone.Oscillator({ frequency: 80, type: 'sine' });
    this.loadingLfo = new Tone.LFO({ frequency: 0.3, min: 60, max: 100 });
    this.loadingLfo.connect(this.loadingOsc.frequency);
    this.loadingLfo.start();
    this.loadingOsc.connect(this.effectsBus);
    this.loadingOsc.volume.value = -30;
    this.loadingOsc.start();
    this.loadingOsc.volume.rampTo(-20, 1);
  }

  /** Stop ambient loading hum */
  loadingAmbientStop(): void {
    if (!this.loadingOsc) return;
    this.loadingOsc.volume.rampTo(-60, 0.3);
    const osc = this.loadingOsc;
    const lfo = this.loadingLfo;
    this.loadingOsc = null;
    this.loadingLfo = null;
    setTimeout(() => { osc.stop(); osc.dispose(); lfo?.stop(); lfo?.dispose(); }, 400);
  }

  /** Quick noise sweep for loading exit */
  loadingWhoosh(): void {
    if (Tone.getContext().state !== 'running') return;
    const now = this.safeNoiseTime();
    this.noiseSynth.triggerAttackRelease('8n', now);
  }

  // ── Engine (sustained) ────────────────────────────────────

  startEngine(): void {
    if (this.engineOsc) return;
    this.engineGain = new Tone.Gain(0).connect(this.output);
    this.engineFilter = new Tone.Filter({ type: 'lowpass', frequency: 260, rolloff: -24, Q: 0.7 }).connect(this.engineGain);
    this.engineOsc = new Tone.Oscillator({ type: 'triangle', frequency: 68, volume: -15 }).connect(this.engineFilter);
    this.engineSub = new Tone.Oscillator({ type: 'sine', frequency: 34, volume: -17 }).connect(this.engineFilter);
    this.engineAirGain = new Tone.Gain(0.01).connect(this.engineGain);
    this.engineAirFilter = new Tone.Filter({ type: 'bandpass', frequency: 1100, Q: 0.9 }).connect(this.engineAirGain);
    this.engineAirNoise = new Tone.Noise('pink').connect(this.engineAirFilter);
    this.engineOsc.start();
    this.engineSub.start();
    this.engineAirNoise.start();
    this.engineGain.gain.rampTo(0.03, 0.2);
  }

  updateEngine(speedNorm: number): void {
    if (!this.engineOsc || !this.engineSub || !this.engineGain || !this.engineFilter || !this.engineAirFilter || !this.engineAirGain) return;
    const speed = clamp(speedNorm, 0, 1);
    this.engineOsc.frequency.rampTo(68 + speed * 88, 0.08);
    this.engineSub.frequency.rampTo(34 + speed * 46, 0.08);
    this.engineFilter.frequency.rampTo(240 + speed * 1050, 0.08);
    this.engineAirFilter.frequency.rampTo(900 + speed * 2300, 0.08);
    this.engineAirGain.gain.rampTo(0.006 + speed * 0.03, 0.08);
    this.engineGain.gain.rampTo(0.022 + speed * 0.05, 0.08);
  }

  stopEngine(): void {
    const osc = this.engineOsc;
    const sub = this.engineSub;
    const gain = this.engineGain;
    const filter = this.engineFilter;
    const airNoise = this.engineAirNoise;
    const airFilter = this.engineAirFilter;
    const airGain = this.engineAirGain;
    gain?.gain.rampTo(0, 0.18);
    this.engineOsc = null;
    this.engineSub = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.engineAirNoise = null;
    this.engineAirFilter = null;
    this.engineAirGain = null;
    setTimeout(() => {
      osc?.stop();
      osc?.dispose();
      sub?.stop();
      sub?.dispose();
      airNoise?.stop();
      airNoise?.dispose();
      filter?.dispose();
      airFilter?.dispose();
      airGain?.dispose();
      gain?.dispose();
    }, 220);
  }

  // ── Lifecycle ─────────────────────────────────────────────

  dispose(): void {
    this.loadingAmbientStop();
    this.stopEngine();
    this.droneRotorStop();
    this.slopeSlideStop();
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
