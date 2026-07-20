import { describe, expect, it } from "vitest";
import { getVfxStationLabel } from "./vfxStationPresentation";

describe("VFX station presentation", () => {
  it("advertises the advanced GPU effects only on the advanced renderer", () => {
    expect(getVfxStationLabel(true)).toBe("Visual Effects\nDissolve • Fire & Smoke • Lightning & Rain • Glowing Ring");
  });

  it("describes the effects that remain visible on the compatibility renderer", () => {
    expect(getVfxStationLabel(false)).toBe("Compatibility VFX\nTornado • Fire • Lasers • Lightning Ribbons • Scanner");
  });
});
