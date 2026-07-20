import { EventBus } from "@core/EventBus";
import type { UserSettingsStore } from "@core/UserSettings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class Param {
    value = 0;
    rampTo = vi.fn((value: number, _duration?: number) => {
      this.value = value;
    });
  }

  class Node {
    gain = new Param();
    connect = vi.fn(() => this);
    chain = vi.fn(() => this);
    dispose = vi.fn();
  }

  class SFXEngine {
    output = new Node();
    setSustainedPaused = vi.fn();
    checkpoint = vi.fn();
    deathDescend = vi.fn();
    menuOpen = vi.fn();
    menuClose = vi.fn();
    slopeSlideStop = vi.fn();
    stopEngine = vi.fn();
    droneRotorStop = vi.fn();
    dispose = vi.fn();

    constructor() {
      state.sfx.push(this);
    }
  }

  class MusicEngine {
    output = new Node();
    duck = vi.fn();
    unduck = vi.fn();
    setVolume = vi.fn();
    start = vi.fn();
    stop = vi.fn();
    setIntensity = vi.fn();
    dispose = vi.fn();

    constructor() {
      state.music.push(this);
    }
  }

  const rawContext = {
    state: "running" as AudioContextState,
    suspend: vi.fn(async () => {
      rawContext.state = "suspended";
      context.state = "suspended";
    }),
  };
  const context = { state: "running" as AudioContextState, rawContext };
  const start = vi.fn(async () => {
    rawContext.state = "running";
    context.state = "running";
  });
  const state = {
    music: [] as MusicEngine[],
    sfx: [] as SFXEngine[],
    gains: [] as Node[],
  };

  return { context, MusicEngine, Node, Param, rawContext, SFXEngine, start, state };
});

vi.mock("tone", () => ({
  Gain: class extends mocks.Node {
    constructor(value = 0) {
      super();
      this.gain.value = value;
      mocks.state.gains.push(this);
    }
  },
  getContext: () => mocks.context,
  getDestination: () => new mocks.Node(),
  start: mocks.start,
}));

vi.mock("./createSafeDynamicsStage", () => ({
  createSafeDynamicsStage: () => ({
    compressor: new mocks.Node(),
    limiter: new mocks.Node(),
    degraded: false,
  }),
}));

vi.mock("./MusicEngine", () => ({ MusicEngine: mocks.MusicEngine }));
vi.mock("./SFXEngine", () => ({ SFXEngine: mocks.SFXEngine }));

import type { PlayerController } from "@character/PlayerController";
import type { InputManager } from "@input/InputManager";
import { AudioManager } from "./AudioManager";

class FakeDocument extends EventTarget {
  hidden = false;
}

let fakeDocument: FakeDocument;

function makeManager(): { eventBus: EventBus; manager: AudioManager } {
  const eventBus = new EventBus();
  const player = { body: null, isGrounded: true } as unknown as PlayerController;
  const input = { isLocked: false } as unknown as InputManager;
  const settings = {
    value: { masterVolume: 1, musicVolume: 1, sfxVolume: 1 },
  } as unknown as UserSettingsStore;
  return { eventBus, manager: new AudioManager(eventBus, player, input, settings) };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

describe("AudioManager application context", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeDocument = new FakeDocument();
    vi.stubGlobal("document", fakeDocument);
    mocks.state.music.length = 0;
    mocks.state.sfx.length = 0;
    mocks.state.gains.length = 0;
    mocks.context.state = "running";
    mocks.rawContext.state = "running";
    mocks.rawContext.suspend.mockClear();
    mocks.start.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("applies pause state before unlock and preserves the relative user SFX volume", () => {
    const { eventBus, manager } = makeManager();
    const sfx = mocks.state.sfx[0];
    const music = mocks.state.music[0];
    const sfxGain = mocks.state.gains[1];

    eventBus.emit("menu:opened", { screen: "pause" });

    expect(sfx.setSustainedPaused).toHaveBeenLastCalledWith(true);
    expect(sfxGain.gain.rampTo.mock.lastCall?.[0]).toBeCloseTo(0.079);
    expect(sfxGain.gain.rampTo.mock.lastCall?.[1]).toBe(0.05);
    expect(music.duck).toHaveBeenLastCalledWith(0.3);

    manager.setSfxVolume(0.5);
    expect(sfxGain.gain.rampTo.mock.lastCall?.[0]).toBeCloseTo(0.0395);

    eventBus.emit("menu:closed", undefined);
    expect(sfx.setSustainedPaused).toHaveBeenLastCalledWith(false);
    expect(sfxGain.gain.rampTo.mock.lastCall?.[0]).toBeCloseTo(0.395);
    expect(music.unduck).toHaveBeenCalled();
  });

  it("composes editor, pause, and transient music ducks by their minimum", async () => {
    const { eventBus } = makeManager();
    const music = mocks.state.music[0];
    document.dispatchEvent(new Event("pointerdown"));
    await settle();

    eventBus.emit("editor:opened", undefined);
    expect(music.duck).toHaveBeenLastCalledWith(0.15);

    eventBus.emit("menu:opened", { screen: "pause" });
    expect(music.duck).toHaveBeenLastCalledWith(0.15);

    eventBus.emit("checkpoint:activated", { id: "cp", position: { x: 0, y: 0, z: 0 } });
    expect(music.duck).toHaveBeenLastCalledWith(0.15);

    eventBus.emit("editor:closed", undefined);
    expect(music.duck).toHaveBeenLastCalledWith(0.3);

    eventBus.emit("player:dying", { reason: "test" });
    expect(music.duck).toHaveBeenLastCalledWith(0.3);

    await vi.advanceTimersByTimeAsync(500);
    expect(music.duck).toHaveBeenLastCalledWith(0.3);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(music.duck).toHaveBeenLastCalledWith(0.3);
    expect(music.unduck).not.toHaveBeenCalled();

    eventBus.emit("menu:closed", undefined);
    expect(music.unduck).toHaveBeenCalledTimes(1);
  });

  it("suspends while hidden and retries a rejected visible resume on the next gesture", async () => {
    const { manager } = makeManager();
    document.dispatchEvent(new Event("pointerdown"));
    await settle();

    fakeDocument.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(mocks.rawContext.suspend).toHaveBeenCalledTimes(1);
    expect(mocks.context.state).toBe("suspended");

    mocks.start.mockRejectedValueOnce(new Error("gesture required"));
    fakeDocument.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    const failedResumeCalls = mocks.start.mock.calls.length;
    expect(failedResumeCalls).toBeGreaterThanOrEqual(1);
    expect(mocks.context.state).toBe("suspended");

    document.dispatchEvent(new Event("pointerdown"));
    await settle();
    expect(mocks.start.mock.calls.length).toBeGreaterThan(failedResumeCalls);
    expect(mocks.context.state).toBe("running");

    manager.dispose();
    fakeDocument.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(mocks.rawContext.suspend).toHaveBeenCalledTimes(1);
  });

  it("recognizes an audio context that the browser already resumed on visibility", async () => {
    const { manager } = makeManager();
    document.dispatchEvent(new Event("pointerdown"));
    await settle();

    fakeDocument.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();

    mocks.context.state = "running";
    mocks.rawContext.state = "running";
    fakeDocument.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();

    expect((manager as unknown as { toneStarted: boolean }).toneStarted).toBe(true);
    manager.dispose();
  });

  it("coalesces unlock requests and ignores completion after disposal", async () => {
    mocks.context.state = "suspended";
    mocks.rawContext.state = "suspended";
    let finishStart = (): void => {};
    mocks.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = () => {
            mocks.context.state = "running";
            mocks.rawContext.state = "running";
            resolve();
          };
        }),
    );
    const { manager } = makeManager();
    const music = mocks.state.music[0];

    manager.playMusic(0.5);
    document.dispatchEvent(new Event("pointerdown"));
    expect(mocks.start).toHaveBeenCalledTimes(1);

    manager.dispose();
    finishStart();
    await settle();

    expect(music.start).not.toHaveBeenCalled();
    expect((manager as unknown as { toneStarted: boolean }).toneStarted).toBe(false);
  });

  it("suspends an unlock that finishes after the document becomes hidden", async () => {
    mocks.context.state = "suspended";
    mocks.rawContext.state = "suspended";
    let finishStart = (): void => {};
    mocks.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = () => {
            mocks.context.state = "running";
            mocks.rawContext.state = "running";
            resolve();
          };
        }),
    );
    const { manager } = makeManager();
    const music = mocks.state.music[0];

    manager.playMusic(0.5);
    fakeDocument.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    finishStart();
    await settle();

    expect(mocks.rawContext.suspend).toHaveBeenCalledTimes(1);
    expect(mocks.context.state).toBe("suspended");
    expect((manager as unknown as { toneStarted: boolean }).toneStarted).toBe(false);
    expect(music.start).not.toHaveBeenCalled();
    manager.dispose();
  });
});
