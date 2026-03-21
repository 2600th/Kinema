import * as Tone from 'tone';

// C major pentatonic
const C_SCALE = ['C', 'D', 'E', 'G', 'A'] as const;
// G major pentatonic (for key changes)
const G_SCALE = ['G', 'A', 'B', 'D', 'E'] as const;

type ScaleNote = string;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function noteInOctave(note: string, octave: number): string {
  return `${note}${octave}`;
}

/** Build full note set across octaves for a given scale */
function buildScale(scale: readonly string[], lowOctave: number, highOctave: number): ScaleNote[] {
  const notes: ScaleNote[] = [];
  for (let oct = lowOctave; oct <= highOctave; oct++) {
    for (const n of scale) notes.push(noteInOctave(n, oct));
  }
  return notes;
}

// Chord progressions: I → vi → IV → V
const C_CHORDS = [
  ['C3', 'E3', 'G3'],   // C major
  ['A2', 'C3', 'E3'],   // Am
  ['F2', 'A2', 'C3'],   // F major
  ['G2', 'B2', 'D3'],   // G major
] as const;

const G_CHORDS = [
  ['G3', 'B3', 'D4'],   // G major
  ['E3', 'G3', 'B3'],   // Em
  ['C3', 'E3', 'G3'],   // C major
  ['D3', 'F#3', 'A3'],  // D major
] as const;

/**
 * 4-layer dynamic music engine.
 * Layers activate based on intensity:
 *   0.00–0.25: Pad only (idle, menu, editor)
 *   0.25–0.50: Pad + Bass (walking)
 *   0.50–0.75: Pad + Bass + Melody (active gameplay)
 *   0.75–1.00: All 4 layers (action, vehicle, combat)
 */
export class MusicEngine {
  readonly output: Tone.Gain;

  // Synths
  private padSynth: Tone.PolySynth;
  private bassSynth: Tone.PluckSynth;
  private melodySynth: Tone.FMSynth;
  private percSynth: Tone.MetalSynth;

  // Per-layer gain nodes for intensity crossfading
  private padGain: Tone.Gain;
  private bassGain: Tone.Gain;
  private melodyGain: Tone.Gain;
  private percGain: Tone.Gain;

  // Effects chain
  private autoFilter: Tone.AutoFilter;
  private feedbackDelay: Tone.FeedbackDelay;
  private reverb: Tone.Reverb;
  private compressor: Tone.Compressor;
  private limiter: Tone.Limiter;
  private effectsBus: Tone.Gain;

  // Loops
  private padLoop: Tone.Loop | null = null;
  private bassLoop: Tone.Loop | null = null;
  private melodyLoop: Tone.Loop | null = null;
  private percLoop: Tone.Loop | null = null;

  // State
  private running = false;
  private duckedVolume = 1;
  private targetVolume = 1;
  private stopGeneration = 0;
  private intensity = 0.1;
  private currentScale: readonly string[] = C_SCALE;
  private currentChords: readonly (readonly string[])[] = C_CHORDS;
  private chordIndex = 0;
  private barCounter = 0;

  constructor() {
    this.output = new Tone.Gain(0); // starts silent for fade-in

    // Effects chain: AutoFilter → FeedbackDelay → Reverb → Compressor → Limiter → output
    this.autoFilter = new Tone.AutoFilter({ frequency: 0.06, baseFrequency: 300, octaves: 3, wet: 0.3 }).start();
    this.feedbackDelay = new Tone.FeedbackDelay({ delayTime: '4n', feedback: 0.3, wet: 0.25 });
    this.reverb = new Tone.Reverb({ decay: 6, wet: 0.5 });
    this.compressor = new Tone.Compressor({ threshold: -18, ratio: 2.5, attack: 0.05, release: 0.2 });
    this.limiter = new Tone.Limiter(-1);

    this.effectsBus = new Tone.Gain(1);
    this.effectsBus.chain(this.autoFilter, this.feedbackDelay, this.reverb, this.compressor, this.limiter, this.output);

    // Per-layer gains
    this.padGain = new Tone.Gain(1).connect(this.effectsBus);
    this.bassGain = new Tone.Gain(0).connect(this.effectsBus);
    this.melodyGain = new Tone.Gain(0).connect(this.effectsBus);
    this.percGain = new Tone.Gain(0).connect(this.effectsBus);

    // Layer 1: Pad — warm AMSynth pads with long envelopes
    this.padSynth = new Tone.PolySynth({
      voice: Tone.AMSynth,
      options: {
        harmonicity: 2,
        oscillator: { type: 'sine' },
        modulation: { type: 'triangle' },
        envelope: { attack: 2, decay: 3, sustain: 0.4, release: 4 },
        modulationEnvelope: { attack: 0.5, decay: 1, sustain: 0.3, release: 2 },
        volume: -16,
      },
    }).connect(this.padGain);

    // Layer 2: Bass — PluckSynth for pentatonic walking bass
    this.bassSynth = new Tone.PluckSynth({
      attackNoise: 1,
      resonance: 0.8,
      release: 0.6,
      volume: -14,
    }).connect(this.bassGain);

    // Layer 3: Melody — FMSynth lead
    this.melodySynth = new Tone.FMSynth({
      harmonicity: 3,
      modulationIndex: 1,
      oscillator: { type: 'sine' },
      modulation: { type: 'triangle' },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.2, release: 0.8 },
      modulationEnvelope: { attack: 0.1, decay: 0.2, sustain: 0, release: 0.5 },
      volume: -18,
    }).connect(this.melodyGain);

    // Layer 4: Percussion — MetalSynth for marimba-like hits
    this.percSynth = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.1, release: 0.08 },
      harmonicity: 5.1,
      modulationIndex: 16,
      resonance: 2000,
      octaves: 1,
      volume: -20,
    }).connect(this.percGain);
    this.percSynth.frequency.value = 200;
  }

  start(fadeInSec = 2): void {
    if (this.running) return;
    this.running = true;
    this.stopGeneration++;

    Tone.getTransport().bpm.value = 72;
    this.chordIndex = 0;
    this.barCounter = 0;
    this.currentScale = C_SCALE;
    this.currentChords = C_CHORDS;

    // Pad loop — every half note, play chord from progression
    this.padLoop = new Tone.Loop((time) => {
      const chord = this.currentChords[this.chordIndex % this.currentChords.length];
      this.padSynth.triggerAttackRelease([...chord], '2n', time);
      this.chordIndex++;

      // Every 4 bars (8 half-notes), consider key change
      if (this.chordIndex % 8 === 0) {
        this.barCounter += 4;
        if (Math.random() > 0.5) {
          // Toggle between C and G major pentatonic
          if (this.currentScale === C_SCALE) {
            this.currentScale = G_SCALE;
            this.currentChords = G_CHORDS;
          } else {
            this.currentScale = C_SCALE;
            this.currentChords = C_CHORDS;
          }
        }
      }
    }, '2n');
    this.padLoop.start(0);

    // Bass loop — quarter note walking bass
    this.bassLoop = new Tone.Loop((time) => {
      const notes = buildScale(this.currentScale, 2, 3);
      const note = pick(notes);
      this.bassSynth.triggerAttack(note, time);
    }, '4n');
    this.bassLoop.start(0);

    // Melody loop — quarter note with 40% rest
    this.melodyLoop = new Tone.Loop((time) => {
      if (Math.random() < 0.4) return; // 40% rest
      const notes = buildScale(this.currentScale, 4, 5);
      const note = pick(notes);
      this.melodySynth.triggerAttackRelease(note, '4n', time);
    }, '4n');
    this.melodyLoop.start('1m'); // start after first measure

    // Percussion loop — eighth note with 60% rest
    this.percLoop = new Tone.Loop((time) => {
      if (Math.random() < 0.6) return; // 60% rest
      const freqs = [200, 300, 400, 500, 600];
      this.percSynth.frequency.value = pick(freqs);
      this.percSynth.triggerAttackRelease('16n', time);
    }, '8n');
    this.percLoop.start('2m'); // start after two measures

    Tone.getTransport().start();

    // Apply current intensity to layer gains
    this.applyIntensity();

    // Fade in
    this.output.gain.cancelScheduledValues(Tone.now());
    this.output.gain.setValueAtTime(0, Tone.now());
    this.output.gain.linearRampToValueAtTime(this.targetVolume * this.duckedVolume, Tone.now() + fadeInSec);
  }

  stop(fadeOutSec = 1.5): void {
    if (!this.running) return;
    this.running = false;

    const now = Tone.now();
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setValueAtTime(this.output.gain.value, now);
    this.output.gain.linearRampToValueAtTime(0, now + fadeOutSec);

    const gen = this.stopGeneration;
    setTimeout(() => {
      if (this.stopGeneration !== gen) return;
      this.padLoop?.stop(); this.padLoop?.dispose(); this.padLoop = null;
      this.bassLoop?.stop(); this.bassLoop?.dispose(); this.bassLoop = null;
      this.melodyLoop?.stop(); this.melodyLoop?.dispose(); this.melodyLoop = null;
      this.percLoop?.stop(); this.percLoop?.dispose(); this.percLoop = null;
      Tone.getTransport().stop();
    }, fadeOutSec * 1000 + 100);
  }

  /** Set music intensity (0..1) — drives layer crossfading */
  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value));
    if (this.running) this.applyIntensity();
  }

  private applyIntensity(): void {
    const i = this.intensity;
    const ramp = 0.3; // smooth transitions

    // Pad: always on
    this.padGain.gain.rampTo(1, ramp);

    // Bass: fades in at 0.25
    this.bassGain.gain.rampTo(i >= 0.25 ? Math.min((i - 0.25) / 0.15, 1) : 0, ramp);

    // Melody: fades in at 0.5
    this.melodyGain.gain.rampTo(i >= 0.5 ? Math.min((i - 0.5) / 0.15, 1) : 0, ramp);

    // Percussion: fades in at 0.75
    this.percGain.gain.rampTo(i >= 0.75 ? Math.min((i - 0.75) / 0.15, 1) : 0, ramp);
  }

  setVolume(v: number): void {
    this.targetVolume = Math.max(0, Math.min(1, v));
    if (this.running) {
      this.output.gain.rampTo(this.targetVolume * this.duckedVolume, 0.1);
    }
  }

  duck(amount = 0.3): void {
    this.duckedVolume = amount;
    if (this.running) {
      this.output.gain.rampTo(this.targetVolume * this.duckedVolume, 0.3);
    }
  }

  unduck(): void {
    this.duckedVolume = 1;
    if (this.running) {
      this.output.gain.rampTo(this.targetVolume * this.duckedVolume, 0.3);
    }
  }

  dispose(): void {
    this.running = false;
    this.output.gain.cancelScheduledValues(Tone.now());
    this.output.gain.value = 0;

    this.padLoop?.stop(); this.padLoop?.dispose(); this.padLoop = null;
    this.bassLoop?.stop(); this.bassLoop?.dispose(); this.bassLoop = null;
    this.melodyLoop?.stop(); this.melodyLoop?.dispose(); this.melodyLoop = null;
    this.percLoop?.stop(); this.percLoop?.dispose(); this.percLoop = null;
    Tone.getTransport().stop();

    this.padSynth.dispose();
    this.bassSynth.dispose();
    this.melodySynth.dispose();
    this.percSynth.dispose();
    this.padGain.dispose();
    this.bassGain.dispose();
    this.melodyGain.dispose();
    this.percGain.dispose();
    this.autoFilter.dispose();
    this.feedbackDelay.dispose();
    this.reverb.dispose();
    this.compressor.dispose();
    this.limiter.dispose();
    this.effectsBus.dispose();
    this.output.dispose();
  }
}
