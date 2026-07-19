import { describe, expect, it } from "vitest";
import { ScreenShake, type ShakeOffsets } from "./ScreenShake";

const ZERO_OFFSETS: ShakeOffsets = {
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
};

function noise(seed: number, time: number, frequency: number): number {
  return Math.sin(seed * 100 + time * frequency) * Math.sin(seed * 50 + time * frequency * 0.7);
}

describe("ScreenShake", () => {
  it("preserves the exact legacy trauma-squared output at intensity one", () => {
    const defaultIntensity = new ScreenShake();
    const explicitOne = new ScreenShake();
    defaultIntensity.addTrauma(0.5);
    explicitOne.addTrauma(0.5);

    const defaultOutput = defaultIntensity.update(0.01);
    const explicitOutput = explicitOne.update(0.01, 1);
    const traumaAfterDecay = 0.5 - 3.2 * 0.01;
    const shake = traumaAfterDecay * traumaAfterDecay;

    expect(explicitOutput).toEqual(defaultOutput);
    expect(explicitOutput).toEqual({
      offsetX: 0.035 * shake * noise(1, 0.01, 18),
      offsetY: 0.05 * shake * noise(2.3, 0.01, 18),
      offsetZ: 0.015 * shake * noise(3.7, 0.01, 18),
      rotX: 0.012 * shake * noise(5.1, 0.01, 18),
      rotY: 0.018 * shake * noise(7.9, 0.01, 18),
      rotZ: 0.01 * shake * noise(11.3, 0.01, 18),
    });
  });

  it("scales each returned offset linearly", () => {
    const full = new ScreenShake();
    const half = new ScreenShake();
    full.addTrauma(0.8);
    half.addTrauma(0.8);

    const fullOutput = full.update(0.02, 1);
    const halfOutput = half.update(0.02, 0.5);

    for (const key of Object.keys(fullOutput) as (keyof ShakeOffsets)[]) {
      expect(halfOutput[key]).toBe(fullOutput[key] * 0.5);
    }
  });

  it("returns zero while trauma decay and noise time continue advancing", () => {
    const muted = new ScreenShake();
    const audible = new ScreenShake();
    muted.addTrauma(0.8);
    audible.addTrauma(0.8);

    expect(muted.update(0.05, 0)).toEqual(ZERO_OFFSETS);
    audible.update(0.05, 1);
    expect(muted.getTrauma()).toBeCloseTo(0.64, 12);
    expect(muted.getTrauma()).toBe(audible.getTrauma());

    expect(muted.update(0.01, 1)).toEqual(audible.update(0.01, 1));
  });
});
