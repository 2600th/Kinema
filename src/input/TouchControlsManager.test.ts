import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TouchButton } from "./TouchButton";
import { TouchControlsManager } from "./TouchControlsManager";
import type { VirtualJoystick } from "./VirtualJoystick";

class FakeElement {
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly classList = { add: vi.fn(), remove: vi.fn() };
  className = "";
  textContent = "";
  inert = false;

  appendChild(child: FakeElement): void {
    this.children.push(child);
  }

  setAttribute(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  remove(): void {}

  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, width: 400, height: 400 } as DOMRect;
  }

  getContext(): CanvasRenderingContext2D {
    return {
      scale: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    } as unknown as CanvasRenderingContext2D;
  }
}

type TouchControlsInternals = {
  lookJoystick: Pick<VirtualJoystick, "getState">;
  moveJoystick: Pick<VirtualJoystick, "getState">;
  jumpButton: Pick<TouchButton, "getState">;
  interactButton: Pick<TouchButton, "getState">;
  crouchButton: Pick<TouchButton, "getState">;
  sprintButton: Pick<TouchButton, "getState">;
};

type RuntimeTouchControls = TouchControlsManager & {
  setLookSensitivity(value: number): void;
};

describe("TouchControlsManager runtime preferences", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: { devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: { createElement: vi.fn(() => new FakeElement()) },
      configurable: true,
      writable: true,
    });
  });

  it.each([
    [undefined, 4],
    [1, 1],
    [8, 8],
  ] as const)("scales the real touch snapshot at sensitivity %s", (sensitivity, expected) => {
    const manager = new TouchControlsManager(new FakeElement() as unknown as HTMLElement);
    const internals = manager as unknown as TouchControlsInternals;
    internals.moveJoystick.getState = vi.fn(() => ({ x: 0, y: 0, active: false }));
    internals.lookJoystick.getState = vi.fn(() => ({ x: 1, y: -0.5, active: true }));
    for (const button of [
      internals.jumpButton,
      internals.interactButton,
      internals.crouchButton,
      internals.sprintButton,
    ]) {
      button.getState = vi.fn(() => ({ held: false, pressed: false }));
    }
    const runtime = manager as RuntimeTouchControls;
    if (sensitivity !== undefined) {
      expect(runtime.setLookSensitivity).toBeTypeOf("function");
      runtime.setLookSensitivity?.(sensitivity);
    }

    expect(manager.getInputState()).toMatchObject({ lookDX: expected, lookDY: -expected / 2 });
    manager.dispose();
  });

  it("clamps out-of-range and non-finite touch sensitivity", () => {
    const manager = new TouchControlsManager(new FakeElement() as unknown as HTMLElement);
    const internals = manager as unknown as TouchControlsInternals;
    internals.moveJoystick.getState = vi.fn(() => ({ x: 0, y: 0, active: false }));
    internals.lookJoystick.getState = vi.fn(() => ({ x: 1, y: 0, active: true }));
    for (const button of [
      internals.jumpButton,
      internals.interactButton,
      internals.crouchButton,
      internals.sprintButton,
    ]) {
      button.getState = vi.fn(() => ({ held: false, pressed: false }));
    }
    const runtime = manager as RuntimeTouchControls;
    expect(runtime.setLookSensitivity).toBeTypeOf("function");
    runtime.setLookSensitivity?.(-100);
    expect(manager.getInputState().lookDX).toBe(1);
    runtime.setLookSensitivity?.(Number.POSITIVE_INFINITY);
    expect(manager.getInputState().lookDX).toBe(4);
    manager.dispose();
  });
});
