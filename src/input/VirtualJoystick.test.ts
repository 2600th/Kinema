import { describe, expect, it, vi } from "vitest";
import { resolveJoystickPalette } from "./VirtualJoystick";

describe("resolveJoystickPalette", () => {
  it("derives Canvas-safe alpha colors from the shared root tokens", () => {
    const readToken = vi.fn((name: string) =>
      name === "--k-accent" ? " #123456 " : name === "--k-accent-hover" ? "#abcdef" : "",
    );

    expect(resolveJoystickPalette(readToken)).toEqual({
      ringActive: "rgba(18, 52, 86, 0.5)",
      ringInactive: "rgba(18, 52, 86, 0.27)",
      ringShadow: "rgba(18, 52, 86, 0.53)",
      thumbCenter: "#abcdef",
      thumbEdge: "#123456",
    });
    expect(readToken).toHaveBeenCalledWith("--k-accent");
    expect(readToken).toHaveBeenCalledWith("--k-accent-hover");
  });

  it("falls back to the canonical triad when computed tokens are unavailable or invalid", () => {
    const readToken = (name: string) => (name === "--k-accent" ? "not-a-color" : "");

    expect(resolveJoystickPalette(readToken)).toEqual({
      ringActive: "rgba(123, 108, 255, 0.5)",
      ringInactive: "rgba(123, 108, 255, 0.27)",
      ringShadow: "rgba(123, 108, 255, 0.53)",
      thumbCenter: "#ff79ba",
      thumbEdge: "#7b6cff",
    });
  });

  it("uses deterministic fallbacks when constructed outside a browser DOM", () => {
    expect(resolveJoystickPalette()).toEqual({
      ringActive: "rgba(123, 108, 255, 0.5)",
      ringInactive: "rgba(123, 108, 255, 0.27)",
      ringShadow: "rgba(123, 108, 255, 0.53)",
      thumbCenter: "#ff79ba",
      thumbEdge: "#7b6cff",
    });
  });
});
