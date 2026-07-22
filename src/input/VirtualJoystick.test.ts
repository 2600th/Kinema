import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveJoystickPalette, VirtualJoystick } from "./VirtualJoystick";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("VirtualJoystick initial rendering", () => {
  it("centers the ring and thumb before the first draw", () => {
    const arcs: Array<[number, number, number]> = [];
    const context = {
      scale: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn((x: number, y: number, radius: number) => arcs.push([x, y, radius])),
      stroke: vi.fn(),
      fill: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      classList: { add: vi.fn() },
      setAttribute: vi.fn(),
      getContext: vi.fn(() => context),
      remove: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const container = {
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;
    vi.stubGlobal("window", {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      documentElement: {},
      createElement: vi.fn(() => canvas),
    });
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn(() => ({ getPropertyValue: () => "" })),
    );

    const joystick = new VirtualJoystick(container);

    expect(arcs).toEqual([
      [70, 70, 68],
      [70, 70, 66],
      [70, 70, 24.5],
    ]);
    expect(context.createRadialGradient).toHaveBeenCalledWith(70, 70, 0, 70, 70, 24.5);
    joystick.dispose();
  });
});
