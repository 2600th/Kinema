import * as Tone from 'tone';

// C major pentatonic scale notes across octaves
const SCALE = ['C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4'];
const MELODY_SCALE = ['C5', 'D5', 'E5', 'G5', 'A5'];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generative ambient music engine.
 * Produces an evolving, Astro Bot hub-world-style ambient soundscape
 * using Tone.js — no audio files needed.
 */
export class MusicEngine {
  readonly output: Tone.Gain;

  private padSynth: Tone.PolySynth;
  private melodySynth: Tone.Synth;
  private autoFilter: Tone.AutoFilter;
  private feedbackDelay: Tone.FeedbackDelay;
  private reverb: Tone.Reverb;
  private compressor: Tone.Compressor;
  private limiter: Tone.Limiter;

  private chordLoop: Tone.Loop | null = null;
  private melodyLoop: Tone.Loop | null = null;
  private running = false;
  private duckedVolume = 1;
  private targetVolume = 1;
  private stopGeneration = 0;

  constructor() {
    this.output = new Tone.Gain(0); // starts silent for fade-in

    // Effects chain
    this.autoFilter = new Tone.AutoFilter({ frequency: 0.08, baseFrequency: 200, octaves: 3, wet: 0.4 }).start();
    this.feedbackDelay = new Tone.FeedbackDelay({ delayTime: '4n', feedback: 0.4, wet: 0.35 });
    this.reverb = new Tone.Reverb({ decay: 8, wet: 0.6 });
    this.compressor = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.1, release: 0.25 });
    this.limiter = new Tone.Limiter(-1);

    // Pad synth — warm sine pads with long envelopes
    this.padSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 2, decay: 3, sustain: 0.4, release: 4 },
      volume: -14,
    });

    // Melody synth — gentle high register
    this.melodySynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.3, decay: 1.5, sustain: 0, release: 2 },
      volume: -18,
    });

    // Routing: synths -> autoFilter -> delay -> reverb -> compressor -> limiter -> output
    this.padSynth.chain(this.autoFilter, this.feedbackDelay, this.reverb, this.compressor, this.limiter, this.output);
    this.melodySynth.connect(this.autoFilter);
  }

  start(fadeInSec = 2): void {
    if (this.running) return;
    this.running = true;
    // Invalidate any pending stop teardown from a previous session
    this.stopGeneration++;

    Tone.getTransport().bpm.value = 55;

    // Chord loop — every half note, play 2-3 random pentatonic notes
    this.chordLoop = new Tone.Loop((time) => {
      const count = Math.random() > 0.5 ? 3 : 2;
      const notes: string[] = [];
      while (notes.length < count) {
        const n = pick(SCALE);
        if (!notes.includes(n)) notes.push(n);
      }
      this.padSynth.triggerAttackRelease(notes, '2n', time);
    }, '2n');
    this.chordLoop.start(0);

    // Melody loop — occasional solo note one octave up, with some probability of rest
    this.melodyLoop = new Tone.Loop((time) => {
      if (Math.random() > 0.4) return; // 60% chance of rest
      const note = pick(MELODY_SCALE);
      this.melodySynth.triggerAttackRelease(note, '2n', time);
    }, '2n');
    this.melodyLoop.start('1m'); // start after first measure

    Tone.getTransport().start();

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
      // If start() was called since this stop, don't tear down the new session
      if (this.stopGeneration !== gen) return;
      this.chordLoop?.stop();
      this.melodyLoop?.stop();
      this.chordLoop?.dispose();
      this.melodyLoop?.dispose();
      this.chordLoop = null;
      this.melodyLoop = null;
      Tone.getTransport().stop();
    }, fadeOutSec * 1000 + 100);
  }

  setVolume(v: number): void {
    this.targetVolume = Math.max(0, Math.min(1, v));
    if (this.running) {
      this.output.gain.rampTo(this.targetVolume * this.duckedVolume, 0.1);
    }
  }

  duck(): void {
    this.duckedVolume = 0.3;
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
    this.stop(0);
    this.chordLoop?.dispose();
    this.melodyLoop?.dispose();
    this.padSynth.dispose();
    this.melodySynth.dispose();
    this.autoFilter.dispose();
    this.feedbackDelay.dispose();
    this.reverb.dispose();
    this.compressor.dispose();
    this.limiter.dispose();
    this.output.dispose();
  }
}
