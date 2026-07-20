import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tone = vi.hoisted(() => {
  class Param {
    value = 0;
    cancelScheduledValues = vi.fn();
    setValueAtTime = vi.fn((value: number) => {
      this.value = value;
    });
    linearRampToValueAtTime = vi.fn();
    rampTo = vi.fn();
  }

  class Node {
    gain = new Param();
    frequency = new Param();
    connect = vi.fn(() => this);
    chain = vi.fn(() => this);
    dispose = vi.fn();
  }

  class AutoFilter extends Node {
    start = vi.fn(() => this);
  }

  class Synth extends Node {
    triggerAttack = vi.fn();
    triggerAttackRelease = vi.fn();
  }

  class Loop {
    start = vi.fn(() => this);
    stop = vi.fn(() => this);
    dispose = vi.fn();

    constructor(
      readonly callback: (time: number) => void,
      readonly interval: string,
    ) {
      state.loops.push(this);
    }
  }

  const transport = {
    bpm: { value: 0 },
    cancel: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const state = { loops: [] as Loop[] };

  return { AutoFilter, Loop, Node, Param, Synth, state, transport };
});

vi.mock("tone", () => ({
  AMSynth: tone.Synth,
  AutoFilter: tone.AutoFilter,
  Compressor: tone.Node,
  FMSynth: tone.Synth,
  FeedbackDelay: tone.Node,
  Gain: tone.Node,
  Limiter: tone.Node,
  Loop: tone.Loop,
  MetalSynth: tone.Synth,
  PluckSynth: tone.Synth,
  PolySynth: tone.Synth,
  Reverb: tone.Node,
  Time: () => ({ toSeconds: () => 0.5 }),
  getTransport: () => tone.transport,
  now: () => 10,
}));

describe("MusicEngine restart lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tone.state.loops.length = 0;
    tone.transport.start.mockClear();
    tone.transport.stop.mockClear();
    tone.transport.cancel.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("disposes fading loops before a restart and keeps the new generation alive", async () => {
    const { MusicEngine } = await import("./MusicEngine");
    const engine = new MusicEngine();

    engine.start(0);
    const firstGeneration = [...tone.state.loops];
    engine.stop(1.5);
    engine.start(0);
    const secondGeneration = tone.state.loops.slice(firstGeneration.length);

    expect(firstGeneration).toHaveLength(4);
    expect(firstGeneration.every((loop) => loop.stop.mock.calls.length === 1)).toBe(true);
    expect(firstGeneration.every((loop) => loop.dispose.mock.calls.length === 1)).toBe(true);
    expect(secondGeneration).toHaveLength(4);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(secondGeneration.every((loop) => loop.dispose.mock.calls.length === 0)).toBe(true);
    expect(tone.transport.start).toHaveBeenCalledTimes(2);
    expect(tone.transport.stop).toHaveBeenCalledTimes(1);
    expect(tone.transport.cancel).toHaveBeenCalledWith(0);
  });

  it("disposes the active generation after an uninterrupted fade", async () => {
    const { MusicEngine } = await import("./MusicEngine");
    const engine = new MusicEngine();

    engine.start(0);
    const loops = [...tone.state.loops];
    engine.stop(1.5);

    expect(engine.output.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 11.5);
    await vi.advanceTimersByTimeAsync(1_599);
    expect(loops.every((loop) => loop.dispose.mock.calls.length === 0)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);

    expect(loops.every((loop) => loop.stop.mock.calls.length === 1)).toBe(true);
    expect(loops.every((loop) => loop.dispose.mock.calls.length === 1)).toBe(true);
    expect(tone.transport.stop).toHaveBeenCalledTimes(1);
    expect(tone.transport.cancel).toHaveBeenCalledWith(0);
  });

  it("binds deferred cleanup to the loop generation captured by stop", async () => {
    const { MusicEngine } = await import("./MusicEngine");
    const engine = new MusicEngine();
    engine.start(0);
    const stoppedGeneration = [...tone.state.loops];
    engine.stop(1.5);

    const replacementSlots = [
      new tone.Loop(() => {}, "2n"),
      new tone.Loop(() => {}, "4n"),
      new tone.Loop(() => {}, "4n"),
      new tone.Loop(() => {}, "8n"),
    ];
    const internals = engine as unknown as {
      padLoop: InstanceType<typeof tone.Loop>;
      bassLoop: InstanceType<typeof tone.Loop>;
      melodyLoop: InstanceType<typeof tone.Loop>;
      percLoop: InstanceType<typeof tone.Loop>;
    };
    [internals.padLoop, internals.bassLoop, internals.melodyLoop, internals.percLoop] = replacementSlots;

    await vi.advanceTimersByTimeAsync(1_600);

    expect(stoppedGeneration.every((loop) => loop.dispose.mock.calls.length === 1)).toBe(true);
    expect(replacementSlots.every((loop) => loop.dispose.mock.calls.length === 0)).toBe(true);
  });
});
