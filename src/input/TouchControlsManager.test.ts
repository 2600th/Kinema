import { EventBus } from "@core/EventBus";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InputManager } from "./InputManager";
import type { TouchButton } from "./TouchButton";
import { TouchControlsManager } from "./TouchControlsManager";
import type { VirtualJoystick } from "./VirtualJoystick";

class FakeElement {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
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
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

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

function gamepadSnapshot(pressedButtons: number[]): Gamepad {
  return {
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: pressedButtons.includes(index),
      touched: pressedButtons.includes(index),
      value: pressedButtons.includes(index) ? 1 : 0,
    })),
  } as unknown as Gamepad;
}

describe("TouchControlsManager runtime preferences", () => {
  let windowTarget: FakeElement;
  let documentTarget: FakeElement & { createElement: () => FakeElement; pointerLockElement: unknown };

  beforeEach(() => {
    windowTarget = Object.assign(new FakeElement(), { devicePixelRatio: 1 });
    documentTarget = Object.assign(new FakeElement(), {
      createElement: vi.fn(() => new FakeElement()),
      pointerLockElement: null,
    });
    Object.defineProperty(globalThis, "window", {
      value: windowTarget,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: documentTarget,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: vi.fn(() => []), maxTouchPoints: 1 },
      configurable: true,
    });
    Object.defineProperty(globalThis, "matchMedia", {
      value: vi.fn(() => ({ matches: false })),
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

  it("keeps consumable crouch and sprint button pulses separate from physical hold", () => {
    const container = new FakeElement();
    const manager = new TouchControlsManager(container as unknown as HTMLElement);
    const root = container.children[0];
    const sprintButton = root.children[1].children[0];
    const crouchButton = root.children[3].children[2];

    sprintButton.dispatch("click", { detail: 0 });
    crouchButton.dispatch("click", { detail: 0 });

    expect(manager.getInputState()).toMatchObject({
      crouch: false,
      crouchPressed: true,
      sprint: false,
      sprintPressed: true,
    });
    manager.dispose();
  });

  it("toggles adjacent assistive crouch and sprint clicks through the real touch snapshot", () => {
    const container = new FakeElement();
    const touchControls = new TouchControlsManager(container as unknown as HTMLElement);
    const inputManager = new InputManager(new EventBus(), new FakeElement() as unknown as HTMLCanvasElement);
    const inputInternals = inputManager as unknown as {
      touchActive: boolean;
      touchControls: TouchControlsManager;
    };
    inputInternals.touchActive = true;
    inputInternals.touchControls = touchControls;
    inputManager.setCrouchMode("toggle");
    inputManager.setSprintMode("toggle");
    const root = container.children[0];
    const sprintButton = root.children[1].children[0];
    const crouchButton = root.children[3].children[2];

    sprintButton.dispatch("click", { detail: 0 });
    crouchButton.dispatch("click", { detail: 0 });
    expect(inputManager.poll()).toMatchObject({ crouch: true, crouchPressed: true, sprint: true });
    sprintButton.dispatch("click", { detail: 0 });
    crouchButton.dispatch("click", { detail: 0 });
    expect(inputManager.poll()).toMatchObject({ crouch: false, crouchPressed: false, sprint: false });
    inputManager.dispose();
  });

  it.each([
    ["crouch", 3, 2],
    ["sprint", 1, 0],
  ] as const)("toggles two physical %s taps when release is not polled", (action, zoneIndex, buttonIndex) => {
    const container = new FakeElement();
    const touchControls = new TouchControlsManager(container as unknown as HTMLElement);
    const inputManager = new InputManager(new EventBus(), new FakeElement() as unknown as HTMLCanvasElement);
    const inputInternals = inputManager as unknown as {
      touchActive: boolean;
      touchControls: TouchControlsManager;
    };
    inputInternals.touchActive = true;
    inputInternals.touchControls = touchControls;
    if (action === "crouch") inputManager.setCrouchMode("toggle");
    if (action === "sprint") inputManager.setSprintMode("toggle");
    const button = container.children[0].children[zoneIndex].children[buttonIndex];

    button.dispatch("touchstart", { preventDefault: vi.fn(), changedTouches: [{ identifier: 1 }] });
    expect(inputManager.poll()[action]).toBe(true);
    windowTarget.dispatch("touchend", { changedTouches: [{ identifier: 1 }] });
    button.dispatch("touchstart", { preventDefault: vi.fn(), changedTouches: [{ identifier: 2 }] });

    expect(inputManager.poll()[action]).toBe(false);
    inputManager.dispose();
  });

  it("does not double-toggle a physical touch pulse while gamepad crouch remains held", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: vi.fn(() => [gamepadSnapshot([1])]), maxTouchPoints: 1 },
      configurable: true,
    });
    const container = new FakeElement();
    const touchControls = new TouchControlsManager(container as unknown as HTMLElement);
    const inputManager = new InputManager(new EventBus(), new FakeElement() as unknown as HTMLCanvasElement);
    const inputInternals = inputManager as unknown as {
      touchActive: boolean;
      touchControls: TouchControlsManager;
    };
    inputInternals.touchActive = true;
    inputInternals.touchControls = touchControls;
    inputManager.setCrouchMode("toggle");
    expect(inputManager.poll().crouch).toBe(true);
    const crouchButton = container.children[0].children[3].children[2];

    crouchButton.dispatch("touchstart", { preventDefault: vi.fn(), changedTouches: [{ identifier: 1 }] });

    expect(inputManager.poll().crouch).toBe(true);
    inputManager.dispose();
  });
});
