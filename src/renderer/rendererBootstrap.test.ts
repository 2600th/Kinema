import { describe, expect, it } from "vitest";
import { resolveCompatibilityPostEnabled } from "./rendererBootstrap";

describe("compatibility renderer bootstrap options", () => {
  it("enables compatibility AA and future post-processing by default", () => {
    expect(resolveCompatibilityPostEnabled(new URLSearchParams())).toBe(true);
  });

  it("restores the bare compatibility path only for the exact compatPost=0 escape hatch", () => {
    expect(resolveCompatibilityPostEnabled(new URLSearchParams("compatPost=0"))).toBe(false);
    expect(resolveCompatibilityPostEnabled(new URLSearchParams("compatPost=false"))).toBe(true);
    expect(resolveCompatibilityPostEnabled(new URLSearchParams("compatPost=00"))).toBe(true);
    expect(resolveCompatibilityPostEnabled(new URLSearchParams("compatPost="))).toBe(true);
  });
});
