import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '@core/EventBus';
import { InputManager } from './InputManager';

type Listener = (event?: unknown) => void;

class FakeTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event?: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

describe('InputManager', () => {
  let windowTarget: FakeTarget;
  let documentTarget: FakeTarget & { pointerLockElement: unknown };
  let canvasTarget: FakeTarget & { requestPointerLock: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    windowTarget = new FakeTarget();
    documentTarget = Object.assign(new FakeTarget(), { pointerLockElement: null });
    canvasTarget = Object.assign(new FakeTarget(), { requestPointerLock: vi.fn() });

    Object.defineProperty(globalThis, 'window', {
      value: windowTarget,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: documentTarget,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads: vi.fn(() => []) },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'Element', {
      value: class {
        closest(): Element | null {
          return null;
        }
      },
      configurable: true,
      writable: true,
    });
  });

  it('requests pointer lock with unadjusted movement when raw mouse is enabled', () => {
    const manager = new InputManager(new EventBus(), canvasTarget as any);
    manager.setRawMouseInput(true);

    documentTarget.dispatch('click', { target: canvasTarget });

    expect(canvasTarget.requestPointerLock).toHaveBeenCalledWith({ unadjustedMovement: true });
    manager.dispose();
  });

  it('falls back to a normal pointer lock request when raw input is rejected', async () => {
    canvasTarget.requestPointerLock = vi.fn((options?: unknown) => {
      if (options) {
        return Promise.reject(new Error('raw input denied'));
      }
      return undefined;
    });

    const manager = new InputManager(new EventBus(), canvasTarget as any);
    manager.setRawMouseInput(true);

    documentTarget.dispatch('click', { target: canvasTarget });
    await Promise.resolve();
    await Promise.resolve();

    expect(canvasTarget.requestPointerLock).toHaveBeenNthCalledWith(1, { unadjustedMovement: true });
    expect(canvasTarget.requestPointerLock).toHaveBeenNthCalledWith(2);
    manager.dispose();
  });

  it('can request a plain pointer lock for menu-driven resume clicks', async () => {
    const manager = new InputManager(new EventBus(), canvasTarget as any);
    manager.setRawMouseInput(true);

    await manager.requestPointerLock({ preferRaw: false });

    expect(canvasTarget.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(canvasTarget.requestPointerLock).toHaveBeenCalledWith();
    manager.dispose();
  });

  it('ignores document clicks from interactive UI controls', () => {
    const manager = new InputManager(new EventBus(), canvasTarget as any);
    const button = new (globalThis as typeof globalThis & { Element: new () => Element }).Element();
    button.closest = vi.fn(() => button);

    documentTarget.dispatch('click', { target: button });

    expect(canvasTarget.requestPointerLock).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('maps connected gamepad input into movement/actions/look deltas', () => {
    Object.defineProperty(globalThis, 'navigator', {
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

    const manager = new InputManager(new EventBus(), canvasTarget as any);
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

  it('maps keyboard vehicle vertical input from E and Q', () => {
    const manager = new InputManager(new EventBus(), canvasTarget as any);
    documentTarget.pointerLockElement = canvasTarget;
    documentTarget.dispatch('pointerlockchange');

    windowTarget.dispatch('keydown', { code: 'KeyE', preventDefault: vi.fn() });
    expect(manager.poll().vehicleVertical).toBe(1);

    windowTarget.dispatch('keyup', { code: 'KeyE' });
    windowTarget.dispatch('keydown', { code: 'KeyQ', preventDefault: vi.fn() });
    expect(manager.poll().vehicleVertical).toBe(-1);

    manager.dispose();
  });

  it('maps keyboard A and D into left/right moveX values while pointer lock is active', () => {
    const manager = new InputManager(new EventBus(), canvasTarget as any);
    documentTarget.pointerLockElement = canvasTarget;
    documentTarget.dispatch('pointerlockchange');

    windowTarget.dispatch('keydown', { code: 'KeyA', preventDefault: vi.fn() });
    const left = manager.poll();
    expect(left.left).toBe(true);
    expect(left.right).toBe(false);
    expect(left.moveX).toBe(-1);

    windowTarget.dispatch('keyup', { code: 'KeyA' });
    windowTarget.dispatch('keydown', { code: 'KeyD', preventDefault: vi.fn() });
    const right = manager.poll();
    expect(right.left).toBe(false);
    expect(right.right).toBe(true);
    expect(right.moveX).toBe(1);

    manager.dispose();
  });
});
