import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tone = vi.hoisted(() => {
  class Param {
    value = 0;
    cancelScheduledValues = vi.fn();
    exponentialRampToValueAtTime = vi.fn();
    linearRampToValueAtTime = vi.fn();
    rampTo = vi.fn((value: number) => {
      this.value = value;
    });
    setValueAtTime = vi.fn((value: number) => {
      this.value = value;
    });
  }

  class Node {
    static instances: Node[] = [];
    connect = vi.fn((_destination?: unknown) => this);
    chain = vi.fn(() => this);
    dispose = vi.fn();
    frequency = new Param();
    gain = new Param();
    volume = new Param();

    constructor(readonly options?: unknown) {
      Node.instances.push(this);
    }
  }

  class Gain extends Node {
    static instances: Gain[] = [];

    constructor(value?: number) {
      super(value);
      this.gain.value = value ?? 0;
      Gain.instances.push(this);
    }
  }

  class Instrument extends Node {
    envelope = { attack: 0, decay: 0, sustain: 0, release: 0 };
    oscillator = { type: "sine" };
    triggerAttackRelease = vi.fn();

    constructor(options?: {
      envelope?: Partial<Instrument["envelope"]>;
      oscillator?: Partial<Instrument["oscillator"]>;
      volume?: number;
    }) {
      super(options);
      Object.assign(this.envelope, options?.envelope);
      Object.assign(this.oscillator, options?.oscillator);
      this.volume.value = options?.volume ?? 0;
    }
  }

  class Synth extends Instrument {
    static instances: Synth[] = [];

    constructor(options?: ConstructorParameters<typeof Instrument>[0]) {
      super(options);
      Synth.instances.push(this);
    }
  }

  class FMSynth extends Instrument {
    static instances: FMSynth[] = [];

    constructor(options?: ConstructorParameters<typeof Instrument>[0]) {
      super(options);
      FMSynth.instances.push(this);
    }
  }

  class NoiseSynth extends Instrument {
    static instances: NoiseSynth[] = [];
    noise = { type: "white" };

    constructor(options?: ConstructorParameters<typeof Instrument>[0] & { noise?: { type?: string } }) {
      super(options);
      this.noise.type = options?.noise?.type ?? "white";
      NoiseSynth.instances.push(this);
    }
  }

  class PolySynth extends Instrument {
    set = vi.fn();
  }

  class Chorus extends Node {
    static instances: Chorus[] = [];
    start = vi.fn(() => this);

    constructor(options?: unknown) {
      super(options);
      Chorus.instances.push(this);
    }
  }

  class Reverb extends Node {
    static instances: Reverb[] = [];
    wet = new Param();

    constructor(options?: unknown) {
      super(options);
      Reverb.instances.push(this);
    }
  }

  class FeedbackDelay extends Node {
    wet = new Param();
  }

  class Filter extends Node {}

  class Source extends Node {
    start = vi.fn(() => this);
    stop = vi.fn(() => this);
  }

  class Oscillator extends Source {
    static instances: Oscillator[] = [];

    constructor(options?: unknown) {
      super(options);
      Oscillator.instances.push(this);
    }
  }

  class Noise extends Source {
    static instances: Noise[] = [];

    constructor(options?: unknown) {
      super(options);
      Noise.instances.push(this);
    }
  }

  class LFO extends Source {}
  class MembraneSynth extends Instrument {}

  const context = { state: "running" };
  const state = { now: 10 };
  const tracked = [Node, Gain, Synth, FMSynth, NoiseSynth, Chorus, Reverb, Oscillator, Noise];

  return {
    Chorus,
    context,
    FeedbackDelay,
    Filter,
    FMSynth,
    Gain,
    LFO,
    MembraneSynth,
    Node,
    Noise,
    NoiseSynth,
    Oscillator,
    PolySynth,
    Reverb,
    state,
    Synth,
    tracked,
  };
});

vi.mock("tone", () => ({
  Chorus: tone.Chorus,
  FeedbackDelay: tone.FeedbackDelay,
  Filter: tone.Filter,
  FMSynth: tone.FMSynth,
  Gain: tone.Gain,
  getContext: () => tone.context,
  LFO: tone.LFO,
  MembraneSynth: tone.MembraneSynth,
  Noise: tone.Noise,
  NoiseSynth: tone.NoiseSynth,
  now: () => tone.state.now,
  Oscillator: tone.Oscillator,
  PolySynth: tone.PolySynth,
  Reverb: tone.Reverb,
  Synth: tone.Synth,
}));

describe("SFXEngine pooled audio graphs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tone.context.state = "running";
    tone.state.now = 10;
    for (const nodeType of tone.tracked) nodeType.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses one UI synth, drops hover bursts inside 60ms, and never drops clicks", async () => {
    const { SFXEngine } = await import("./SFXEngine");
    const engine = new SFXEngine();

    expect(tone.Synth.instances).toHaveLength(4);
    const uiSynth = tone.Synth.instances[3];

    for (let i = 0; i < 10; i++) engine.uiHover();
    expect(tone.Synth.instances).toHaveLength(4);
    expect(uiSynth.triggerAttackRelease).toHaveBeenCalledTimes(1);

    engine.uiClick();
    expect(tone.Synth.instances).toHaveLength(4);
    expect(uiSynth.triggerAttackRelease).toHaveBeenCalledTimes(2);

    tone.state.now += 0.061;
    engine.uiHover();
    expect(uiSynth.triggerAttackRelease).toHaveBeenCalledTimes(3);

    engine.dispose();
  });

  it("constructs checkpoint and death graphs once and reuses them for repeated calls", async () => {
    const { SFXEngine } = await import("./SFXEngine");
    const engine = new SFXEngine();

    expect(tone.FMSynth.instances).toHaveLength(1);
    expect(tone.Chorus.instances).toHaveLength(1);
    expect(tone.Chorus.instances[0].start).toHaveBeenCalledTimes(1);
    expect(tone.Reverb.instances).toHaveLength(2);
    expect(tone.NoiseSynth.instances).toHaveLength(3);

    engine.checkpoint();
    engine.checkpoint();
    engine.deathMidpoint();
    engine.deathMidpoint();

    expect(tone.FMSynth.instances).toHaveLength(1);
    expect(tone.Chorus.instances).toHaveLength(1);
    expect(tone.Reverb.instances).toHaveLength(2);
    expect(tone.NoiseSynth.instances).toHaveLength(3);
    expect(tone.FMSynth.instances[0].triggerAttackRelease).toHaveBeenCalledTimes(8);
    expect(tone.NoiseSynth.instances[2].triggerAttackRelease).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    engine.dispose();
  });

  it("mutes and resumes every sustained graph without reallocating sources", async () => {
    const { SFXEngine } = await import("./SFXEngine");
    const engine = new SFXEngine();

    expect(tone.Gain.instances).toHaveLength(3);
    const sustainedBus = tone.Gain.instances[2];
    engine.startEngine();
    engine.droneRotorStart();
    engine.slopeSlideStart();

    const connectedParents = tone.Gain.instances.filter((gain) =>
      gain.connect.mock.calls.some(([destination]) => destination === sustainedBus),
    );
    expect(connectedParents).toHaveLength(3);
    const oscillatorCount = tone.Oscillator.instances.length;
    const noiseCount = tone.Noise.instances.length;

    engine.setSustainedPaused(true);
    engine.setSustainedPaused(true);
    engine.setSustainedPaused(false);
    engine.setSustainedPaused(false);

    expect(sustainedBus.gain.rampTo.mock.calls).toEqual([
      [0, 0.05],
      [1, 0.05],
    ]);
    expect(tone.Oscillator.instances).toHaveLength(oscillatorCount);
    expect(tone.Noise.instances).toHaveLength(noiseCount);

    engine.dispose();
  });

  it("disposes every owned node exactly once across repeated disposal", async () => {
    const { SFXEngine } = await import("./SFXEngine");
    const engine = new SFXEngine();
    engine.startEngine();
    engine.droneRotorStart();
    engine.slopeSlideStart();
    const ownedNodes = [...tone.Node.instances];

    engine.dispose();
    engine.dispose();

    expect(ownedNodes.length).toBeGreaterThan(0);
    expect(ownedNodes.every((node) => node.dispose.mock.calls.length === 1)).toBe(true);
  });
});
