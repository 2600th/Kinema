import { EventBus } from "@core/EventBus";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InputManager } from "./InputManager";
import type { TouchControlsManager } from "./TouchControlsManager";

type Listener = (event?: unknown) => void;
type TestCanvas = FakeTarget & { requestPointerLock?: ReturnType<typeof vi.fn> };
type TestDocument = FakeTarget & { pointerLockElement: unknown };
type InputManagerInternals = {
  touchActive: boolean;
  touchControls: Pick<TouchControlsManager, "dispose" | "getInputState"> | null;
};

function gamepadSnapshot(axes: number[], pressedButtons: number[] = []): Gamepad {
  return {
    connected: true,
    axes,
    buttons: Array.from({ length: 12 }, (_, index) => ({
      pressed: pressedButtons.includes(index),
      touched: pressedButtons.includes(index),
      value: pressedButtons.includes(index) ? 1 : 0,
    })),
  } as unknown as Gamepad;
}

class FakeTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event?: unknown): void {
    this.listeners.get(type)?.forEach((listener) => {
      listener(event);
    });
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function asCanvas(target: TestCanvas): HTMLCanvasElement {
  return target as unknown as HTMLCanvasElement;
}

function asManagerInternals(manager: InputManager): InputManagerInternals {
  return manager as unknown as InputManagerInternals;
}

describe("InputManager", () => {
  let windowTarget: FakeTarget;
  let documentTarget: TestDocument;
  let canvasTarget: TestCanvas;

  beforeEach(() => {
    windowTarget = new FakeTarget();
    documentTarget = Object.assign(new FakeTarget(), { pointerLockElement: null });
    canvasTarget = Object.assign(new FakeTarget(), { requestPointerLock: vi.fn() });

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
      value: { getGamepads: vi.fn(() => []), maxTouchPoints: 0 },
      configurable: true,
    });
    Object.defineProperty(globalThis, "matchMedia", {
      value: vi.fn(() => ({ matches: false })),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "Element", {
      value: class {
        closest(): Element | null {
          return null;
        }
      },
      configurable: true,
      writable: true,
    });
  });

  it("requests pointer lock with unadjusted movement when raw mouse is enabled", () => {
    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));
    manager.setRawMouseInput(true);

    documentTarget.dispatch("click", { target: canvasTarget });

    expect(canvasTarget.requestPointerLock).toHaveBeenCalledWith({ unadjustedMovement: true });
    manager.dispose();
  });

  it("falls back to a normal pointer lock request when raw input is rejected", async () => {
    canvasTarget.requestPointerLock = vi.fn((options?: unknown) => {
      if (options) {
        return Promise.reject(new Error("raw input denied"));
      }
      return undefined;
    });

    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));
    manager.setRawMouseInput(true);

    documentTarget.dispatch("click", { target: canvasTarget });
    await Promise.resolve();
    await Promise.resolve();

    expect(canvasTarget.requestPointerLock).toHaveBeenNthCalledWith(1, { unadjustedMovement: true });
    expect(canvasTarget.requestPointerLock).toHaveBeenNthCalledWith(2);
    manager.dispose();
  });

  it("can request a plain pointer lock for menu-driven resume clicks", async () => {
    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));
    manager.setRawMouseInput(true);

    await manager.requestPointerLock({ preferRaw: false });

    expect(canvasTarget.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(canvasTarget.requestPointerLock).toHaveBeenCalledWith();
    manager.dispose();
  });

  it("treats missing pointer lock support as a no-op", async () => {
    const manager = new InputManager(new EventBus(), asCanvas(new FakeTarget()));

    await expect(manager.requestPointerLock()).resolves.toBeUndefined();

    manager.dispose();
  });

  it("does not request pointer lock while touch controls are active", async () => {
    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));
    asManagerInternals(manager).touchActive = true;

    documentTarget.dispatch("click", { target: canvasTarget });
    await manager.requestPointerLock({ preferRaw: false });

    expect(canvasTarget.requestPointerLock).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("ignores document clicks from interactive UI controls", () => {
    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));
    const button = new (globalThis as typeof globalThis & { Element: new () => Element }).Element();
    button.closest = vi.fn(() => button);

    documentTarget.dispatch("click", { target: button });

    expect(canvasTarget.requestPointerLock).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("maps connected gamepad input into movement/actions/look deltas", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        getGamepads: vi.fn(() => [
          {
            connected: true,
            axes: [0.6, -0.7, 0.4, -0.5],
            buttons: Array.from({ length: 12 }, (_, i) => ({
              pressed: i === 0 || i === 1 || i === 2 || i === 10,
              value: i === 0 || i === 1 || i === 2 || i === 10 ? 1 : 0,
            })),
          },
        ]),
      },
      configurable: true,
    });

    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));
    const state = manager.poll();

    expect(state.forward).toBe(true);
    expect(state.right).toBe(true);
    expect(state.vehicleVertical).toBeGreaterThan(0);
    expect(state.crouchPressed).toBe(true);
    expect(state.jumpPressed).toBe(true);
    expect(state.interactPressed).toBe(true);
    expect(state.sprint).toBe(true);
    // Look deltas are now consumed via pollLook(), not poll()
    expect(state.mouseDeltaX).toBe(0);
    expect(state.mouseDeltaY).toBe(0);
    const look = manager.pollLook(1 / 60);
    expect(look.lookDX).not.toBe(0);
    expect(look.lookDY).not.toBe(0);
    manager.dispose();
  });

  it("tracks active input sources while ignoring gamepad stick noise", () => {
    let pads: Gamepad[] = [gamepadSnapshot([0.13, 0, 0, 0])];
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: vi.fn(() => pads), maxTouchPoints: 0 },
      configurable: true,
    });
    const eventBus = new EventBus();
    const sources: string[] = [];
    eventBus.on("input:sourceChanged", ({ source }) => sources.push(source));
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));

    expect(manager.lastInputSource).toBe("keyboard");
    manager.poll();
    expect(sources).toEqual([]);

    pads = [gamepadSnapshot([0.65, 0, 0, 0])];
    manager.poll();
    manager.poll();
    expect(manager.lastInputSource).toBe("gamepad");
    expect(sources).toEqual(["gamepad"]);

    windowTarget.dispatch("keydown", { code: "KeyW", preventDefault: vi.fn() });
    expect(manager.lastInputSource).toBe("keyboard");
    expect(sources).toEqual(["gamepad", "keyboard"]);

    manager.poll();
    expect(manager.lastInputSource).toBe("keyboard");

    pads = [gamepadSnapshot([0.1, 0, 0, 0])];
    manager.poll();
    pads = [gamepadSnapshot([0.65, 0, 0, 0])];
    manager.pollInputSource();
    expect(manager.lastInputSource).toBe("gamepad");
    expect(sources).toEqual(["gamepad", "keyboard", "gamepad"]);
    manager.dispose();
  });

  it("switches to touch from a touchstart and deduplicates repeated events", () => {
    const eventBus = new EventBus();
    const sources: string[] = [];
    eventBus.on("input:sourceChanged", ({ source }) => sources.push(source));
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));

    documentTarget.dispatch("touchstart");
    documentTarget.dispatch("touchstart");

    expect(manager.lastInputSource).toBe("touch");
    expect(sources).toEqual(["touch"]);
    manager.dispose();
  });

  it("removes its touch source listener when disposed", () => {
    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));

    expect(documentTarget.listenerCount("touchstart")).toBe(1);
    manager.dispose();
    expect(documentTarget.listenerCount("touchstart")).toBe(0);
  });

  it("merges active touch-control state into movement, actions, and look deltas", () => {
    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));
    asManagerInternals(manager).touchControls = {
      dispose: vi.fn(),
      getInputState: vi.fn(() => ({
        moveX: 0.6,
        moveY: 0.8,
        lookDX: 5,
        lookDY: -2,
        vehicleVertical: -0.7,
        jump: true,
        jumpPressed: true,
        interact: true,
        interactPressed: true,
        crouch: true,
        crouchPressed: true,
        sprint: true,
        active: true,
      })),
    };
    asManagerInternals(manager).touchActive = true;

    const state = manager.poll();
    const look = manager.pollLook(1 / 60);

    expect(state.forward).toBe(true);
    expect(state.right).toBe(true);
    expect(state.moveX).toBeCloseTo(0.6);
    expect(state.moveY).toBeCloseTo(0.8);
    expect(state.vehicleVertical).toBeCloseTo(-0.7);
    expect(state.jumpPressed).toBe(true);
    expect(state.interactPressed).toBe(true);
    expect(state.crouchPressed).toBe(true);
    expect(state.sprint).toBe(true);
    expect(look.lookDX).toBe(5);
    expect(look.lookDY).toBe(-2);
    manager.dispose();
  });

  it("maps keyboard vehicle vertical input from E and Q", () => {
    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));
    documentTarget.pointerLockElement = canvasTarget;
    documentTarget.dispatch("pointerlockchange");

    windowTarget.dispatch("keydown", { code: "KeyE", preventDefault: vi.fn() });
    expect(manager.poll().vehicleVertical).toBe(1);

    windowTarget.dispatch("keyup", { code: "KeyE" });
    windowTarget.dispatch("keydown", { code: "KeyQ", preventDefault: vi.fn() });
    expect(manager.poll().vehicleVertical).toBe(-1);

    manager.dispose();
  });

  it("maps keyboard A and D into left/right moveX values while pointer lock is active", () => {
    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));
    documentTarget.pointerLockElement = canvasTarget;
    documentTarget.dispatch("pointerlockchange");

    windowTarget.dispatch("keydown", { code: "KeyA", preventDefault: vi.fn() });
    const left = manager.poll();
    expect(left.left).toBe(true);
    expect(left.right).toBe(false);
    expect(left.moveX).toBe(-1);

    windowTarget.dispatch("keyup", { code: "KeyA" });
    windowTarget.dispatch("keydown", { code: "KeyD", preventDefault: vi.fn() });
    const right = manager.poll();
    expect(right.left).toBe(false);
    expect(right.right).toBe(true);
    expect(right.moveX).toBe(1);

    manager.dispose();
  });

  it("treats mobile user agents as touch-capable even when coarse-pointer APIs are unavailable", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        getGamepads: vi.fn(() => []),
        maxTouchPoints: 0,
        userAgent:
          "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
      },
      configurable: true,
    });

    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));

    expect(manager.supportsTouchControls).toBe(true);

    manager.dispose();
  });

  it("does not enable touch controls on fine-pointer desktops that expose touch event properties", () => {
    Object.defineProperty(windowTarget, "ontouchstart", {
      value: null,
      configurable: true,
    });
    Object.defineProperty(globalThis, "matchMedia", {
      value: vi.fn((query: string) => ({
        matches: query === "(any-pointer: fine)",
      })),
      configurable: true,
      writable: true,
    });

    const manager = new InputManager(new EventBus(), asCanvas(canvasTarget));

    expect(manager.supportsTouchControls).toBe(false);

    manager.dispose();
  });
});
