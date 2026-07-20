import { describe, expect, it } from "vitest";
import { resolveShaderWarmupEnabled } from "./shaderWarmup";

describe("resolveShaderWarmupEnabled", () => {
  it("warms by default and accepts unrelated query parameters", () => {
    expect(resolveShaderWarmupEnabled(new URLSearchParams())).toBe(true);
    expect(resolveShaderWarmupEnabled(new URLSearchParams("station=vfx"))).toBe(true);
  });

  it.each(["0", "false", "FALSE"])("disables warmup for warmup=%s", (value) => {
    expect(resolveShaderWarmupEnabled(new URLSearchParams({ warmup: value }))).toBe(false);
  });

  it.each(["1", "true", "yes"])("keeps warmup enabled for warmup=%s", (value) => {
    expect(resolveShaderWarmupEnabled(new URLSearchParams({ warmup: value }))).toBe(true);
  });
});
