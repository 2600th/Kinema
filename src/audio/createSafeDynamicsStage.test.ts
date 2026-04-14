import { beforeEach, describe, expect, it, vi } from "vitest";

const gainInstances: Array<{ value: number }> = [];
const compressorInstances: Array<Record<string, unknown>> = [];
const limiterInstances: Array<Record<string, unknown>> = [];
let throwCompressor = false;
let throwLimiter = false;

function MockCompressor(options: unknown) {
  if (throwCompressor) {
    throw new Error("compressor unsupported");
  }
  const node = { kind: "compressor", options, dispose: vi.fn() };
  compressorInstances.push(node);
  return node;
}

function MockLimiter(options: unknown) {
  if (throwLimiter) {
    throw new Error("limiter unsupported");
  }
  const node = { kind: "limiter", options, dispose: vi.fn() };
  limiterInstances.push(node);
  return node;
}

function MockGain(value: number) {
  const node = { kind: "gain", value, dispose: vi.fn() };
  gainInstances.push(node);
  return node;
}

vi.mock("tone", () => ({
  Compressor: MockCompressor,
  Gain: MockGain,
  Limiter: MockLimiter,
}));

describe("createSafeDynamicsStage", () => {
  beforeEach(() => {
    compressorInstances.length = 0;
    limiterInstances.length = 0;
    gainInstances.length = 0;
    throwCompressor = false;
    throwLimiter = false;
  });

  it("creates compressor and limiter when both constructors succeed", async () => {
    const { createSafeDynamicsStage } = await import("./createSafeDynamicsStage");

    const stage = createSafeDynamicsStage("Master bus", { threshold: -24 }, { threshold: -1 });

    expect(stage.degraded).toBe(false);
    expect(stage.compressor).toBe(compressorInstances[0]);
    expect(stage.limiter).toBe(limiterInstances[0]);
    expect(gainInstances).toHaveLength(0);
  });

  it("falls back to pass-through gain nodes when compressor construction fails", async () => {
    throwCompressor = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { createSafeDynamicsStage } = await import("./createSafeDynamicsStage");

    const stage = createSafeDynamicsStage("Master bus", { threshold: -24 }, { threshold: -1 });

    expect(stage.degraded).toBe(true);
    expect(gainInstances).toHaveLength(2);
    expect(stage.compressor).toBe(gainInstances[0]);
    expect(stage.limiter).toBe(gainInstances[1]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("keeps the compressor and bypasses only the limiter when limiter construction fails", async () => {
    throwLimiter = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { createSafeDynamicsStage } = await import("./createSafeDynamicsStage");

    const stage = createSafeDynamicsStage("Music bus", { threshold: -18 }, { threshold: -1 });

    expect(stage.degraded).toBe(true);
    expect(stage.compressor).toBe(compressorInstances[0]);
    expect(gainInstances).toHaveLength(1);
    expect(stage.limiter).toBe(gainInstances[0]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
