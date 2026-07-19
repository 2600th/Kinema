import { EventBus } from "@core/EventBus";
import type { GamepadMenuAction } from "@core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InputManager } from "./InputManager";
import type { TouchControlsManager } from "./TouchControlsManager";

type Listener = (event?: unknown) => void;
type TestCanvas = FakeTarget & { requestPointerLock?: ReturnType<typeof vi.fn> };
type TestDocument = FakeTarget & { pointerLockElement: unknown };
type InputManagerInternals = {
  touchActive: boolean;
  touchControls: Pick<TouchControlsManager, "dispose" | "getInputState" | "hide" | "show"> | null;
};

function gamepadSnapshot(axes: number[], pressedButtons: number[] = []): Gamepad {
  return {
    connected: true,
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({
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
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextAnimationFrameId: number;

  const runAnimationFrame = (timestamp: number): void => {
    const entry = animationFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) throw new Error("No animation frame was scheduled");
    animationFrames.delete(entry[0]);
    entry[1](timestamp);
  };

  beforeEach(() => {
    windowTarget = new FakeTarget();
    animationFrames = new Map();
    nextAnimationFrameId = 1;
    Object.assign(windowTarget, {
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        const id = nextAnimationFrameId++;
        animationFrames.set(id, callback);
        return id;
      }),
      cancelAnimationFrame: vi.fn((id: number) => {
        animationFrames.delete(id);
      }),
    });
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

  it("maps menu directions with a 400ms initial delay and 150ms repeat", () => {
    let pads: Gamepad[] = [gamepadSnapshot([0, 0.49, 0, 0])];
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: vi.fn(() => pads), maxTouchPoints: 0 },
      configurable: true,
    });
    const eventBus = new EventBus();
    const actions: GamepadMenuAction[] = [];
    eventBus.on("menu:gamepadInput", ({ action }) => actions.push(action));
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));

    eventBus.emit("menu:opened", { screen: "main" });
    runAnimationFrame(0);
    expect(actions).toEqual([]);
    pads = [gamepadSnapshot([0, 0.7, 0, 0])];
    runAnimationFrame(1);
    expect(actions).toEqual(["down"]);

    runAnimationFrame(400);
    expect(actions).toEqual(["down"]);
    runAnimationFrame(401);
    expect(actions).toEqual(["down", "down"]);
    runAnimationFrame(550);
    expect(actions).toEqual(["down", "down"]);
    runAnimationFrame(551);
    expect(actions).toEqual(["down", "down", "down"]);

    pads = [gamepadSnapshot([0, 0, 0, 0])];
    runAnimationFrame(552);
    pads = [gamepadSnapshot([0, 0, 0, 0], [12])];
    runAnimationFrame(553);
    expect(actions.at(-1)).toBe("up");
    pads = [gamepadSnapshot([0, 0, 0, 0])];
    runAnimationFrame(554);
    pads = [gamepadSnapshot([0, 0, 0, 0], [14])];
    runAnimationFrame(555);
    expect(actions.at(-1)).toBe("left");
    pads = [gamepadSnapshot([0, 0, 0, 0])];
    runAnimationFrame(556);
    pads = [gamepadSnapshot([0, 0, 0, 0], [15])];
    runAnimationFrame(557);
    expect(actions.at(-1)).toBe("right");
    manager.dispose();
  });

  it("emits menu activation and back only on fresh gamepad button edges", () => {
    let pads: Gamepad[] = [gamepadSnapshot([0, 0, 0, 0])];
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: vi.fn(() => pads), maxTouchPoints: 0 },
      configurable: true,
    });
    const eventBus = new EventBus();
    const actions: GamepadMenuAction[] = [];
    eventBus.on("menu:gamepadInput", ({ action }) => actions.push(action));
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));

    eventBus.emit("menu:opened", { screen: "settings" });
    runAnimationFrame(0);
    pads = [gamepadSnapshot([0, 0, 0, 0], [0])];
    runAnimationFrame(16);
    runAnimationFrame(32);
    expect(actions).toEqual(["activate"]);

    pads = [gamepadSnapshot([0, 0, 0, 0])];
    runAnimationFrame(48);
    pads = [gamepadSnapshot([0, 0, 0, 0], [1])];
    runAnimationFrame(64);
    runAnimationFrame(80);
    expect(actions).toEqual(["activate", "back"]);
    manager.dispose();
  });

  it("maps fresh Start edges to menu toggle during gameplay and menus", () => {
    let pads: Gamepad[] = [gamepadSnapshot([0, 0, 0, 0])];
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: vi.fn(() => pads), maxTouchPoints: 0 },
      configurable: true,
    });
    const eventBus = new EventBus();
    const toggles = vi.fn();
    eventBus.on("menu:toggle", toggles);
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));

    manager.poll();
    pads = [gamepadSnapshot([0, 0, 0, 0], [9])];
    manager.poll();
    manager.poll();
    expect(toggles).toHaveBeenCalledTimes(1);

    pads = [gamepadSnapshot([0, 0, 0, 0])];
    manager.poll();
    eventBus.emit("menu:opened", { screen: "pause" });
    runAnimationFrame(0);
    pads = [gamepadSnapshot([0, 0, 0, 0], [9])];
    runAnimationFrame(16);
    runAnimationFrame(32);
    expect(toggles).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it("routes the DEV simulation seam through the same semantic menu actions", () => {
    const eventBus = new EventBus();
    const actions: GamepadMenuAction[] = [];
    const toggles = vi.fn();
    eventBus.on("menu:gamepadInput", ({ action }) => actions.push(action));
    eventBus.on("menu:toggle", toggles);
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));

    eventBus.emit("menu:opened", { screen: "main" });
    manager.simulateGamepadMenuInput("down");
    manager.simulateGamepadMenuInput("activate");
    manager.simulateGamepadMenuInput("start");

    expect(actions).toEqual(["down", "activate"]);
    expect(toggles).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("keeps menu-used controls neutral in gameplay until the controller is released", () => {
    let pads: Gamepad[] = [gamepadSnapshot([0, 0, 0, 0], [0])];
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: vi.fn(() => pads), maxTouchPoints: 0 },
      configurable: true,
    });
    const eventBus = new EventBus();
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));

    eventBus.emit("menu:opened", { screen: "pause" });
    runAnimationFrame(0);
    eventBus.emit("menu:closed", undefined);
    expect(manager.poll().jump).toBe(false);
    expect(manager.poll().jumpPressed).toBe(false);

    pads = [gamepadSnapshot([0, 0, 0, 0])];
    expect(manager.poll().jump).toBe(false);
    pads = [gamepadSnapshot([0, 0, 0, 0], [0])];
    const freshPress = manager.poll();
    expect(freshPress.jump).toBe(true);
    expect(freshPress.jumpPressed).toBe(true);
    manager.dispose();
  });

  it("keeps a menu-used stick gated below the menu threshold until it reaches the gameplay deadzone", () => {
    let pads: Gamepad[] = [gamepadSnapshot([0, 0.7, 0, 0])];
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: vi.fn(() => pads), maxTouchPoints: 0 },
      configurable: true,
    });
    const eventBus = new EventBus();
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));

    eventBus.emit("menu:opened", { screen: "pause" });
    runAnimationFrame(0);
    eventBus.emit("menu:closed", undefined);
    pads = [gamepadSnapshot([0, 0.45, 0, 0])];
    expect(manager.poll().moveY).toBe(0);

    pads = [gamepadSnapshot([0, 0.1, 0, 0])];
    expect(manager.poll().moveY).toBe(0);
    pads = [gamepadSnapshot([0, 0.45, 0, 0])];
    expect(manager.poll().moveY).toBeLessThan(0);
    manager.dispose();
  });

  it("cancels menu gamepad polling when disposed", () => {
    const eventBus = new EventBus();
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));

    eventBus.emit("menu:opened", { screen: "pause" });
    eventBus.emit("menu:opened", { screen: "settings" });
    expect(animationFrames.size).toBe(1);
    manager.dispose();

    expect(animationFrames.size).toBe(0);
  });

  it("does not reschedule menu polling when an action synchronously closes the menu", () => {
    const pad = gamepadSnapshot([0, 0, 0, 0], [0]);
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: vi.fn(() => [pad]), maxTouchPoints: 0 },
      configurable: true,
    });
    const eventBus = new EventBus();
    eventBus.on("menu:gamepadInput", ({ action }) => {
      if (action === "activate") eventBus.emit("menu:closed", undefined);
    });
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));

    eventBus.emit("menu:opened", { screen: "pause" });
    runAnimationFrame(0);

    expect(animationFrames.size).toBe(0);
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
      hide: vi.fn(),
      show: vi.fn(),
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

  it("hides touch controls behind menus and restores the requested state on close", () => {
    const eventBus = new EventBus();
    const manager = new InputManager(eventBus, asCanvas(canvasTarget));
    const show = vi.fn();
    const hide = vi.fn();
    asManagerInternals(manager).touchControls = {
      dispose: vi.fn(),
      getInputState: vi.fn(),
      hide,
      show,
    };

    manager.setTouchControlsEnabled(true);
    show.mockClear();
    eventBus.emit("menu:opened", { screen: "pause" });

    expect(hide).toHaveBeenCalledTimes(1);
    expect(manager.isTouchActive).toBe(false);

    eventBus.emit("menu:closed", undefined);

    expect(show).toHaveBeenCalledTimes(1);
    expect(manager.isTouchActive).toBe(true);
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
