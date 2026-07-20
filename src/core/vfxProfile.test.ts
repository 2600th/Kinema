import { describe, expect, it } from "vitest";
import { getAmbientVfxCounts, getVfxDensity, scaleVfxCount } from "./vfxProfile";

describe("VFX profile density", () => {
  it("maps graphics profiles to the authored density contract", () => {
    expect(getVfxDensity("performance")).toBe(0.35);
    expect(getVfxDensity("balanced")).toBe(0.65);
    expect(getVfxDensity("cinematic")).toBe(1);
  });

  it.each([
    ["performance", 400, 140],
    ["balanced", 400, 260],
    ["cinematic", 400, 400],
    ["performance", 7, 2],
    ["balanced", 7, 5],
  ] as const)("scales %s authored count %i to %i deterministically", (profile, authored, expected) => {
    expect(scaleVfxCount(authored, profile)).toBe(expected);
  });

  it("preserves zero while retaining at least one item for an enabled effect", () => {
    expect(scaleVfxCount(0, "performance")).toBe(0);
    expect(scaleVfxCount(1, "performance")).toBe(1);
    expect(scaleVfxCount(2, "performance")).toBe(1);
  });

  it.each([
    ["performance", { sparkles: 140, motes: 21, grassPerStrip: 140, rain: 70, embers: 14, orbit: 35 }],
    ["balanced", { sparkles: 260, motes: 39, grassPerStrip: 260, rain: 130, embers: 26, orbit: 65 }],
    ["cinematic", { sparkles: 400, motes: 60, grassPerStrip: 400, rain: 200, embers: 40, orbit: 100 }],
  ] as const)("returns every %s ambient build count from one source", (profile, expected) => {
    expect(getAmbientVfxCounts(profile)).toEqual(expected);
  });
});
