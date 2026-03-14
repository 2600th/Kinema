import type { EventBus } from '@core/EventBus';
import type { InputState, Disposable } from '@core/types';
import { NULL_INPUT } from '@core/types';

const GAMEPAD_MOVE_THRESHOLD = 0.25;
const GAMEPAD_LOOK_SPEED = 18;

/** Look deltas consumed per render frame for high-refresh-rate responsiveness. */
export interface LookState {
  readonly lookDX: number;
  readonly lookDY: number;
  readonly wheelDelta: number;
}

type GamepadSnapshot = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  crouch: boolean;
  jump: boolean;
  interact: boolean;
  primary: boolean;
  sprint: boolean;
  lookX: number;
  lookY: number;
  moveX: number;
  moveY: number;
};

/**
 * Captures keyboard + pointer lock input.
 * poll() returns a frozen InputState snapshot and resets deltas.
 */
export class InputManager implements Disposable {
  private keys = new Set<string>();
  /** Latched keys: set on keydown, cleared only after poll() consumes them.
   *  Ensures short keypresses (down+up between two polls) aren't missed. */
  private latchedKeys = new Set<string>();
  private prevInteract = false;
  private prevJump = false;
  private prevCrouch = false;
  private prevPrimary = false;
  private mouseDX = 0;
  private mouseDY = 0;
  private mouseWheel = 0;
  private mouseDown = false;
  private mousePrimary = false;
  private locked = false;
  private rawMouseInput = true;
  private gamepadDeadzone = 0.12;
  private gamepadCurve = 1.4;
  private inputSuppressed = false;
  private editorActive = false;
  private unsubs: (() => void)[] = [];

  private _onKeyDown = this.handleKeyDown.bind(this);
  private _onKeyUp = this.handleKeyUp.bind(this);
  private _onMouseMove = this.handleMouseMove.bind(this);
  private _onMouseDown = this.handleMouseDown.bind(this);
  private _onMouseUp = this.handleMouseUp.bind(this);
  private _onWheel = this.handleWheel.bind(this);
  private _onClick = this.handleClick.bind(this);
  private _onPointerLockChange = this.handlePointerLockChange.bind(this);

  constructor(
    private eventBus: EventBus,
    private canvas: HTMLCanvasElement,
  ) {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('click', this._onClick);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    this.unsubs.push(
      this.eventBus.on('menu:opened', () => {
        this.inputSuppressed = true;
      }),
      this.eventBus.on('menu:closed', () => {
        this.inputSuppressed = false;
      }),
      this.eventBus.on('editor:opened', () => {
        this.editorActive = true;
      }),
      this.eventBus.on('editor:closed', () => {
        this.editorActive = false;
      }),
    );
  }

  /** Snapshot current input state, reset deltas, emit event. */
  poll(): InputState {
    if (this.inputSuppressed) {
      // Reset edge-trigger state so a key released while suppressed doesn't
      // cause a ghost "pressed" event on the first poll after resuming.
      this.prevJump = false;
      this.prevInteract = false;
      this.prevCrouch = false;
      this.prevPrimary = false;
      this.latchedKeys.clear();
      this.eventBus.emit('input:state', NULL_INPUT);
      return NULL_INPUT;
    }
    const gamepad = this.readGamepadState();

    // Use latchedKeys for edge detection so short keypresses (down+up between
    // two polls) aren't missed. Held state still comes from live keys set.
    const crouch = (this.locked && (this.keys.has('KeyC') || this.keys.has('ControlLeft'))) || gamepad.crouch;
    const crouchPressed = (crouch || (this.locked && (this.latchedKeys.has('KeyC') || this.latchedKeys.has('ControlLeft')))) && !this.prevCrouch;
    const jump = (this.locked && (this.keys.has('Space') || this.latchedKeys.has('Space'))) || gamepad.jump;
    const interact = (this.locked && (this.keys.has('KeyF') || this.latchedKeys.has('KeyF'))) || gamepad.interact;
    const primary = (this.locked && this.mousePrimary) || gamepad.primary;
    const altitudeUp = this.locked && this.keys.has('KeyE');
    const altitudeDown = this.locked && this.keys.has('KeyQ');
    this.prevCrouch = crouch;
    const jumpPressed = jump && !this.prevJump;
    const interactPressed = interact && !this.prevInteract;
    const primaryPressed = primary && !this.prevPrimary;
    this.prevJump = jump;
    this.prevInteract = interact;
    this.prevPrimary = primary;
    // Clear latched keys after consumption — they've served their purpose.
    this.latchedKeys.clear();

    // Compute analog move axes
    const kbX = (this.locked && (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ? 1 : 0)
              - (this.locked && (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ? 1 : 0);
    const kbY = (this.locked && (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ? 1 : 0)
              - (this.locked && (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ? 1 : 0);
    const rawMoveX = gamepad.moveX !== 0 ? gamepad.moveX : kbX;
    const rawMoveY = gamepad.moveY !== 0 ? gamepad.moveY : kbY;
    const moveMag = Math.hypot(rawMoveX, rawMoveY);
    const moveX = moveMag > 1 ? rawMoveX / moveMag : rawMoveX;
    const moveY = moveMag > 1 ? rawMoveY / moveMag : rawMoveY;

    const state: InputState = Object.freeze({
      forward: (this.locked && (this.keys.has('KeyW') || this.keys.has('ArrowUp'))) || gamepad.forward,
      backward: (this.locked && (this.keys.has('KeyS') || this.keys.has('ArrowDown'))) || gamepad.backward,
      left: (this.locked && (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))) || gamepad.left,
      right: (this.locked && (this.keys.has('KeyD') || this.keys.has('ArrowRight'))) || gamepad.right,
      crouch,
      crouchPressed,
      jump,
      jumpPressed,
      interact,
      interactPressed,
      primary,
      primaryPressed,
      altitudeUp,
      altitudeDown,
      moveX,
      moveY,
      sprint: (this.locked && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'))) || gamepad.sprint,
      // Look deltas are now consumed via pollLook() in the render loop.
      // Kept at 0 here for backward compatibility with InputState consumers.
      mouseDeltaX: 0,
      mouseDeltaY: 0,
      mouseWheelDelta: 0,
    });

    this.eventBus.emit('input:state', state);
    return state;
  }

  /**
   * Consume accumulated look deltas — call once per render frame for
   * high-refresh-rate responsiveness. Gamepad look is time-scaled by dt.
   */
  pollLook(dt: number): LookState {
    if (this.inputSuppressed) {
      this.mouseDX = 0;
      this.mouseDY = 0;
      this.mouseWheel = 0;
      return { lookDX: 0, lookDY: 0, wheelDelta: 0 };
    }

    const gamepad = this.readGamepadState();
    const lookDX = this.mouseDX + gamepad.lookX * GAMEPAD_LOOK_SPEED * dt;
    const lookDY = this.mouseDY + gamepad.lookY * GAMEPAD_LOOK_SPEED * dt;
    const wheelDelta = this.mouseWheel;

    // Reset accumulated deltas after consumption
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseWheel = 0;

    return { lookDX, lookDY, wheelDelta };
  }

  get isLocked(): boolean {
    return this.locked;
  }

  setRawMouseInput(enabled: boolean): void {
    this.rawMouseInput = enabled;
  }

  setGamepadTuning(deadzone: number, curve: number): void {
    if (Number.isFinite(deadzone)) {
      this.gamepadDeadzone = Math.max(0.02, Math.min(0.4, deadzone));
    }
    if (Number.isFinite(curve)) {
      this.gamepadCurve = Math.max(0.6, Math.min(3.0, curve));
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Don't capture game keys while typing in text fields (editor inspector, settings, etc.)
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    this.keys.add(e.code);
    this.latchedKeys.add(e.code);

    // Prevent default for game keys
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyQ', 'KeyC', 'ControlLeft'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'Escape') {
      this.eventBus.emit('menu:toggle', undefined);
    }
    if (e.code === 'F1' && !this.inputSuppressed) {
      this.eventBus.emit('editor:toggle', undefined);
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.locked && !this.mouseDown) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.locked && !this.mouseDown) return;
    e.preventDefault();
    this.mouseWheel += e.deltaY;
  }

  private handleMouseDown(e: MouseEvent): void {
    this.mouseDown = true;
    if (e.button === 0) {
      this.mousePrimary = true;
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    this.mouseDown = false;
    if (e.button === 0) {
      this.mousePrimary = false;
    }
  }

  private handleClick(): void {
    if (this.editorActive) return;
    if (!this.locked) {
      if (this.rawMouseInput) {
        const request = this.canvas.requestPointerLock.bind(this.canvas) as unknown as (
          options?: unknown,
        ) => Promise<void> | void;
        try {
          void request({ unadjustedMovement: true });
          return;
        } catch {
          // Fallback for browsers that don't support unadjusted movement.
        }
      }
      this.canvas.requestPointerLock();
    }
  }

  private handlePointerLockChange(): void {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) {
      this.keys.clear();
      this.latchedKeys.clear();
      this.prevInteract = false;
      this.prevJump = false;
      this.prevCrouch = false;
      this.prevPrimary = false;
      this.mousePrimary = false;
      this.mouseDown = false;
      // Reset accumulated deltas to prevent camera snap on next lock
      this.mouseDX = 0;
      this.mouseDY = 0;
      this.mouseWheel = 0;
    }
  }

  private readGamepadState(): GamepadSnapshot {
    const nullSnap: GamepadSnapshot = {
      forward: false, backward: false, left: false, right: false,
      crouch: false, jump: false, interact: false, primary: false, sprint: false,
      lookX: 0, lookY: 0, moveX: 0, moveY: 0,
    };
    const api = navigator.getGamepads?.bind(navigator);
    if (!api) return nullSnap;

    const pads = api();
    const pad = Array.from(pads).find((entry) => !!entry && entry.connected) ?? null;
    if (!pad) return nullSnap;

    const gpMoveX = this.applyDeadzoneCurve(pad.axes[0] ?? 0);
    const gpMoveY = this.applyDeadzoneCurve(pad.axes[1] ?? 0);
    const lookX = this.applyDeadzoneCurve(pad.axes[2] ?? 0);
    const lookY = this.applyDeadzoneCurve(pad.axes[3] ?? 0);

    const pressed = (index: number): boolean => {
      const button = pad.buttons[index];
      return !!button && (button.pressed || button.value > 0.5);
    };

    return {
      forward: gpMoveY < -GAMEPAD_MOVE_THRESHOLD,
      backward: gpMoveY > GAMEPAD_MOVE_THRESHOLD,
      left: gpMoveX < -GAMEPAD_MOVE_THRESHOLD,
      right: gpMoveX > GAMEPAD_MOVE_THRESHOLD,
      crouch: pressed(1), // B / Circle
      jump: pressed(0), // A / Cross
      interact: pressed(2), // X / Square
      primary: pressed(7), // RT / R2
      sprint: pressed(10) || pressed(4), // Left stick press or LB
      lookX,
      lookY,
      moveX: gpMoveX,
      moveY: -gpMoveY, // invert: stick up (negative) = forward (positive moveY)
    };
  }

  private applyDeadzoneCurve(value: number): number {
    const sign = Math.sign(value);
    const magnitude = Math.abs(value);
    if (magnitude <= this.gamepadDeadzone) return 0;
    const normalized = (magnitude - this.gamepadDeadzone) / (1 - this.gamepadDeadzone);
    const curved = normalized ** this.gamepadCurve;
    return sign * curved;
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }
}
