import type { EventBus } from "@core/EventBus";
import type { Disposable, GamepadMenuAction, InputSource, InputState } from "@core/types";
import { NULL_INPUT } from "@core/types";
import { DEFAULT_USER_SETTINGS, type InputActivationMode, USER_SETTINGS_RANGES } from "@core/UserSettings";
import {
  createDefaultKeyboardBindings,
  type KeyboardBindingAction,
  type KeyboardBindings,
  sanitizeKeyboardBindings,
} from "./InputBindings";
import { getPointerLockRequest } from "./pointerLock";
import type { TouchControlsManager } from "./TouchControlsManager";

const GAMEPAD_MOVE_THRESHOLD = 0.25;
const GAMEPAD_SOURCE_HYSTERESIS = 0.08;
const GAMEPAD_MENU_STICK_THRESHOLD = 0.5;
const GAMEPAD_MENU_INITIAL_REPEAT_MS = 400;
const GAMEPAD_MENU_REPEAT_MS = 150;

type GamepadMenuDirection = Extract<GamepadMenuAction, "up" | "down" | "left" | "right">;
type TraversalAction = Extract<KeyboardBindingAction, "crouch" | "sprint">;

const TRAVERSAL_ACTIONS: readonly TraversalAction[] = ["crouch", "sprint"];

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
  vehicleVertical: number;
  moveX: number;
  moveY: number;
};

const NULL_GAMEPAD_SNAPSHOT: GamepadSnapshot = Object.freeze({
  forward: false,
  backward: false,
  left: false,
  right: false,
  crouch: false,
  jump: false,
  interact: false,
  primary: false,
  sprint: false,
  lookX: 0,
  lookY: 0,
  vehicleVertical: 0,
  moveX: 0,
  moveY: 0,
});

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
  private gamepadLookSensitivity = DEFAULT_USER_SETTINGS.gamepadLookSensitivity;
  private touchLookSensitivity = DEFAULT_USER_SETTINGS.touchLookSensitivity;
  private keyboardBindings = createDefaultKeyboardBindings();
  private traversalModes: Record<TraversalAction, InputActivationMode> = {
    crouch: DEFAULT_USER_SETTINGS.crouchMode,
    sprint: DEFAULT_USER_SETTINGS.sprintMode,
  };
  private traversalLatches: Record<TraversalAction, boolean> = { crouch: false, sprint: false };
  private traversalRawActive: Record<TraversalAction, boolean> = { crouch: false, sprint: false };
  private vehicleContext = false;
  private inputEnabled = true;
  private inputSuppressed = false;
  private editorActive = false;
  private touchControls: TouchControlsManager | null = null;
  private touchActive = false;
  private touchInputActive = false;
  private desiredTouchEnabled = false;
  private menuOpen = false;
  private menuGamepadFrame: number | null = null;
  private menuGamepadDirection: GamepadMenuDirection | null = null;
  private menuGamepadRepeatAt = 0;
  private previousMenuActivate = false;
  private previousMenuBack = false;
  private previousMenuStart = false;
  private gamepadGameplayReleaseGate = false;
  private touchControlsLoad: Promise<void> | null = null;
  private rawPointerLockAvailable = true;
  private _lastInputSource: InputSource = "keyboard";
  private gamepadSourceAxisActive = false;
  private gamepadSourceButtonActive = false;
  private unsubs: (() => void)[] = [];

  private _onKeyDown = this.handleKeyDown.bind(this);
  private _onKeyUp = this.handleKeyUp.bind(this);
  private _onMouseMove = this.handleMouseMove.bind(this);
  private _onMouseDown = this.handleMouseDown.bind(this);
  private _onMouseUp = this.handleMouseUp.bind(this);
  private _onWheel = this.handleWheel.bind(this);
  private _onClick = this.handleClick.bind(this);
  private _onPointerLockChange = this.handlePointerLockChange.bind(this);
  private _onTouchStart = this.handleTouchStart.bind(this);
  private _onMenuGamepadFrame = this.handleMenuGamepadFrame.bind(this);

  constructor(
    private eventBus: EventBus,
    private canvas: HTMLCanvasElement,
  ) {
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    document.addEventListener("mousemove", this._onMouseMove);
    canvas.addEventListener("mousedown", this._onMouseDown);
    window.addEventListener("mouseup", this._onMouseUp);
    canvas.addEventListener("wheel", this._onWheel, { passive: false });
    document.addEventListener("click", this._onClick);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    document.addEventListener("touchstart", this._onTouchStart, { passive: true });

    this.unsubs.push(
      this.eventBus.on("menu:opened", () => {
        this.menuOpen = true;
        this.inputSuppressed = true;
        this.resetTraversalActions();
        this.applyTouchControlsVisibility(false);
        this.startMenuGamepadLoop();
      }),
      this.eventBus.on("menu:closed", () => {
        this.menuOpen = false;
        this.inputSuppressed = !this.inputEnabled;
        this.gamepadGameplayReleaseGate = true;
        this.stopMenuGamepadLoop();
        this.resetMenuDirectionRepeat();
        this.applyTouchControlsVisibility(this.desiredTouchEnabled);
      }),
      this.eventBus.on("editor:opened", () => {
        this.editorActive = true;
        this.resetTraversalActions();
      }),
      this.eventBus.on("editor:closed", () => {
        this.editorActive = false;
      }),
      this.eventBus.on("player:respawned", () => this.resetTraversalActions()),
      this.eventBus.on("run:restartRequested", () => this.resetTraversalActions()),
      this.eventBus.on("vehicle:enter", () => {
        this.vehicleContext = true;
        this.resetTraversalActions();
      }),
      this.eventBus.on("vehicle:exit", () => {
        this.vehicleContext = false;
        this.resetTraversalActions();
      }),
    );
  }

  /** Snapshot current input state, reset deltas, emit event. */
  poll(): InputState {
    this.pollGamepadMenuControls(performance.now());
    if (this.inputSuppressed) {
      // Reset edge-trigger state so a key released while suppressed doesn't
      // cause a ghost "pressed" event on the first poll after resuming.
      this.prevJump = false;
      this.prevInteract = false;
      this.prevPrimary = false;
      this.resetTraversalActions();
      this.latchedKeys.clear();
      this.eventBus.emit("input:state", NULL_INPUT);
      return NULL_INPUT;
    }
    const touch = this.touchActive ? (this.touchControls?.getInputState() ?? null) : null;
    this.touchInputActive = touch?.active ?? false;
    if (this.touchInputActive) this.setLastInputSource("touch");
    const gamepad = this.readGamepadState();

    // Use latchedKeys for edge detection so short keypresses (down+up between
    // two polls) aren't missed. Held state still comes from live keys set.
    const rawCrouch =
      (this.locked && this.isKeyboardActionHeld("crouch")) || gamepad.crouch || (touch?.crouch ?? false);
    const crouchInput = this.resolveTraversalAction(
      "crouch",
      rawCrouch,
      rawCrouch || (this.locked && this.isKeyboardActionLatched("crouch")),
    );
    const rawSprint =
      (this.locked && this.isKeyboardActionHeld("sprint")) || gamepad.sprint || (touch?.sprint ?? false);
    const sprintInput = this.resolveTraversalAction(
      "sprint",
      rawSprint,
      rawSprint || (this.locked && this.isKeyboardActionLatched("sprint")),
    );
    const jump =
      (this.locked && (this.isKeyboardActionHeld("jump") || this.isKeyboardActionLatched("jump"))) ||
      gamepad.jump ||
      (touch?.jump ?? false);
    const interact =
      (this.locked && (this.isKeyboardActionHeld("interact") || this.isKeyboardActionLatched("interact"))) ||
      gamepad.interact ||
      (touch?.interact ?? false);
    const primary = (this.locked && this.mousePrimary) || gamepad.primary;
    const altitudeUp = this.locked && this.keys.has("KeyE");
    const altitudeDown = this.locked && this.keys.has("KeyQ");
    const keyboardVehicleVertical = (altitudeUp ? 1 : 0) - (altitudeDown ? 1 : 0);
    const vehicleVertical =
      touch != null
        ? touch.vehicleVertical
        : gamepad.vehicleVertical !== 0
          ? gamepad.vehicleVertical
          : keyboardVehicleVertical;
    const jumpPressed = (jump && !this.prevJump) || (touch?.jumpPressed ?? false);
    const interactPressed = (interact && !this.prevInteract) || (touch?.interactPressed ?? false);
    const primaryPressed = primary && !this.prevPrimary;
    this.prevJump = jump;
    this.prevInteract = interact;
    this.prevPrimary = primary;
    // Clear latched keys after consumption — they've served their purpose.
    this.latchedKeys.clear();

    // Compute analog move axes — touch overrides if active
    const kbX =
      (this.locked && this.isKeyboardActionHeld("moveRight") ? 1 : 0) -
      (this.locked && this.isKeyboardActionHeld("moveLeft") ? 1 : 0);
    const kbY =
      (this.locked && this.isKeyboardActionHeld("moveForward") ? 1 : 0) -
      (this.locked && this.isKeyboardActionHeld("moveBackward") ? 1 : 0);
    const touchMoveX = touch?.moveX ?? 0;
    const touchMoveY = touch?.moveY ?? 0;
    const rawMoveX = touchMoveX !== 0 ? touchMoveX : gamepad.moveX !== 0 ? gamepad.moveX : kbX;
    const rawMoveY = touchMoveY !== 0 ? touchMoveY : gamepad.moveY !== 0 ? gamepad.moveY : kbY;
    const moveMag = Math.hypot(rawMoveX, rawMoveY);
    const moveX = moveMag > 1 ? rawMoveX / moveMag : rawMoveX;
    const moveY = moveMag > 1 ? rawMoveY / moveMag : rawMoveY;

    // Accumulate touch look deltas into mouse deltas so they flow through pollLook()
    if (touch) {
      this.mouseDX += touch.lookDX;
      this.mouseDY += touch.lookDY;
    }

    const state: InputState = Object.freeze({
      forward: (this.locked && this.isKeyboardActionHeld("moveForward")) || gamepad.forward || moveY > 0.25,
      backward: (this.locked && this.isKeyboardActionHeld("moveBackward")) || gamepad.backward || moveY < -0.25,
      left: (this.locked && this.isKeyboardActionHeld("moveLeft")) || gamepad.left || moveX < -0.25,
      right: (this.locked && this.isKeyboardActionHeld("moveRight")) || gamepad.right || moveX > 0.25,
      crouch: crouchInput.active,
      crouchPressed: crouchInput.pressed,
      jump,
      jumpPressed,
      interact,
      interactPressed,
      primary,
      primaryPressed,
      altitudeUp,
      altitudeDown,
      vehicleVertical,
      moveX,
      moveY,
      sprint: sprintInput.active,
      // Look deltas are now consumed via pollLook() in the render loop.
      // Kept at 0 here for backward compatibility with InputState consumers.
      mouseDeltaX: 0,
      mouseDeltaY: 0,
      mouseWheelDelta: 0,
    });

    this.eventBus.emit("input:state", state);
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
    const lookDX = this.mouseDX + gamepad.lookX * this.gamepadLookSensitivity * dt;
    const lookDY = this.mouseDY + gamepad.lookY * this.gamepadLookSensitivity * dt;
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

  get lastInputSource(): InputSource {
    return this._lastInputSource;
  }

  /** Sample device activity while gameplay polling is paused (for example, in Help). */
  pollInputSource(): InputSource {
    if (!this.menuOpen) this.updateGamepadInputSource(this.getConnectedGamepad());
    return this._lastInputSource;
  }

  /** Development automation seam that shares the real controller action dispatcher. */
  simulateGamepadMenuInput(action: GamepadMenuAction): void {
    this.dispatchGamepadMenuAction(action);
  }

  /** Initialize touch controls when a touch-capable device is detected. */
  initTouchControls(): void {
    if (!this.detectTouchSupport()) return;
    this.desiredTouchEnabled = true;
    this.ensureTouchControls();
  }

  /** Toggle touch controls visibility. */
  setTouchControlsEnabled(enabled: boolean): void {
    this.desiredTouchEnabled = enabled;
    if (enabled && !this.touchControls) {
      if (this.detectTouchSupport()) {
        this.ensureTouchControls();
      }
      return;
    }
    this.applyTouchControlsVisibility(enabled && !this.menuOpen);
  }

  get isTouchActive(): boolean {
    return this.touchActive;
  }

  get hasTouchControls(): boolean {
    return this.touchControls !== null;
  }

  get supportsTouchControls(): boolean {
    return this.detectTouchSupport();
  }

  setRawMouseInput(enabled: boolean): void {
    this.rawMouseInput = enabled;
    this.rawPointerLockAvailable = true;
  }

  setGamepadTuning(deadzone: number, curve: number): void {
    if (Number.isFinite(deadzone)) {
      this.gamepadDeadzone = Math.max(0.02, Math.min(0.4, deadzone));
    }
    if (Number.isFinite(curve)) {
      this.gamepadCurve = Math.max(0.6, Math.min(3.0, curve));
    }
  }

  setKeyboardBindings(bindings: KeyboardBindings): void {
    this.keyboardBindings = sanitizeKeyboardBindings(bindings);
  }

  setGamepadLookSensitivity(value: number): void {
    this.gamepadLookSensitivity = this.sanitizeRangeValue(
      value,
      USER_SETTINGS_RANGES.gamepadLookSensitivity,
      DEFAULT_USER_SETTINGS.gamepadLookSensitivity,
    );
  }

  setTouchLookSensitivity(value: number): void {
    this.touchLookSensitivity = this.sanitizeRangeValue(
      value,
      USER_SETTINGS_RANGES.touchLookSensitivity,
      DEFAULT_USER_SETTINGS.touchLookSensitivity,
    );
    this.touchControls?.setLookSensitivity(this.touchLookSensitivity);
  }

  setSprintMode(mode: InputActivationMode): void {
    this.setTraversalMode("sprint", mode);
  }

  setCrouchMode(mode: InputActivationMode): void {
    this.setTraversalMode("crouch", mode);
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    this.inputSuppressed = this.menuOpen || !enabled;
    if (!enabled) this.resetTraversalActions();
  }

  async requestPointerLock(options?: { preferRaw?: boolean }): Promise<void> {
    if (this.editorActive || this.locked || this.touchActive) return;

    const request = getPointerLockRequest(this.canvas);
    if (!request) return;
    const preferRaw = options?.preferRaw ?? true;

    if (preferRaw && this.rawMouseInput && this.rawPointerLockAvailable) {
      try {
        await request({ unadjustedMovement: true });
        return;
      } catch {
        this.rawPointerLockAvailable = false;
        // Some embeds reject raw input when re-entering pointer lock.
        // Fall back to a normal lock request so gameplay can resume.
      }
    }

    await request();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Don't capture game keys while typing in text fields (editor inspector, settings, etc.)
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    this.setLastInputSource("keyboard");

    this.keys.add(e.code);
    this.latchedKeys.add(e.code);

    // Prevent default for game keys
    if (this.isKeyboardBoundCode(e.code) || e.code === "KeyE" || e.code === "KeyQ") {
      e.preventDefault();
    }
    if (e.code === "Escape") {
      this.eventBus.emit("menu:toggle", undefined);
    }
    if (e.code === "F1" && !this.inputSuppressed) {
      this.eventBus.emit("editor:toggle", undefined);
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
    this.setLastInputSource("keyboard");
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

  private handleClick(event: MouseEvent): void {
    if (this.inputSuppressed || this.editorActive || this.locked || this.touchActive) return;
    const target = event.target;
    if (
      typeof Element !== "undefined" &&
      target instanceof Element &&
      target.closest(
        'button, input, select, textarea, label, a, [role="button"], .touch-controls-container, .touch-zone, .touch-joystick, .touch-btn',
      )
    ) {
      return;
    }
    void this.requestPointerLock().catch(() => {
      // Pointer lock can be unavailable on touch/mobile and in some embeds.
    });
  }

  private handlePointerLockChange(): void {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) {
      this.keys.clear();
      this.latchedKeys.clear();
      this.prevInteract = false;
      this.prevJump = false;
      this.prevPrimary = false;
      this.resetTraversalActions();
      this.mousePrimary = false;
      this.mouseDown = false;
      // Reset accumulated deltas to prevent camera snap on next lock
      this.mouseDX = 0;
      this.mouseDY = 0;
      this.mouseWheel = 0;
    }
  }

  private handleTouchStart(): void {
    this.setLastInputSource("touch");
  }

  private readGamepadState(): GamepadSnapshot {
    const pad = this.getConnectedGamepad();
    this.updateGamepadInputSource(pad);
    if (!pad) return NULL_GAMEPAD_SNAPSHOT;
    if (this.gamepadGameplayReleaseGate) {
      if (!this.areMenuControlsNeutral(pad)) return NULL_GAMEPAD_SNAPSHOT;
      this.gamepadGameplayReleaseGate = false;
    }

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
      vehicleVertical: -lookY,
      moveX: gpMoveX,
      moveY: -gpMoveY, // invert: stick up (negative) = forward (positive moveY)
    };
  }

  private getConnectedGamepad(): Gamepad | null {
    const api = navigator.getGamepads;
    if (!api) return null;
    const pads = api.call(navigator);
    for (let index = 0; index < pads.length; index++) {
      const pad = pads[index];
      if (pad?.connected) return pad;
    }
    return null;
  }

  private handleMenuGamepadFrame(timestamp: number): void {
    this.menuGamepadFrame = null;
    if (!this.menuOpen) return;
    this.pollGamepadMenuControls(timestamp);
    if (this.menuOpen) this.startMenuGamepadLoop();
  }

  private startMenuGamepadLoop(): void {
    if (this.menuGamepadFrame !== null) return;
    this.menuGamepadFrame = window.requestAnimationFrame(this._onMenuGamepadFrame);
  }

  private stopMenuGamepadLoop(): void {
    if (this.menuGamepadFrame === null) return;
    window.cancelAnimationFrame(this.menuGamepadFrame);
    this.menuGamepadFrame = null;
  }

  private pollGamepadMenuControls(timestamp: number): void {
    const pad = this.getConnectedGamepad();
    this.updateGamepadInputSource(pad);
    const activate = this.isGamepadButtonPressed(pad, 0);
    const back = this.isGamepadButtonPressed(pad, 1);
    const start = this.isGamepadButtonPressed(pad, 9);
    const menuWasOpen = this.menuOpen;

    if (start && !this.previousMenuStart) {
      this.dispatchGamepadMenuAction("start");
    } else if (menuWasOpen) {
      if (activate && !this.previousMenuActivate) {
        this.dispatchGamepadMenuAction("activate");
      } else if (back && !this.previousMenuBack) {
        this.dispatchGamepadMenuAction("back");
      }
      if (this.menuOpen) this.processMenuDirection(this.readMenuDirection(pad), timestamp);
    } else {
      this.resetMenuDirectionRepeat();
    }

    this.previousMenuActivate = activate;
    this.previousMenuBack = back;
    this.previousMenuStart = start;
  }

  private processMenuDirection(direction: GamepadMenuDirection | null, timestamp: number): void {
    if (!direction) {
      this.resetMenuDirectionRepeat();
      return;
    }
    if (direction !== this.menuGamepadDirection) {
      this.menuGamepadDirection = direction;
      this.menuGamepadRepeatAt = timestamp + GAMEPAD_MENU_INITIAL_REPEAT_MS;
      this.dispatchGamepadMenuAction(direction);
      return;
    }
    if (timestamp < this.menuGamepadRepeatAt) return;
    this.menuGamepadRepeatAt = timestamp + GAMEPAD_MENU_REPEAT_MS;
    this.dispatchGamepadMenuAction(direction);
  }

  private readMenuDirection(pad: Gamepad | null): GamepadMenuDirection | null {
    if (this.isGamepadButtonPressed(pad, 12)) return "up";
    if (this.isGamepadButtonPressed(pad, 13)) return "down";
    if (this.isGamepadButtonPressed(pad, 14)) return "left";
    if (this.isGamepadButtonPressed(pad, 15)) return "right";
    const stickY = pad?.axes[1] ?? 0;
    if (stickY < -GAMEPAD_MENU_STICK_THRESHOLD) return "up";
    if (stickY > GAMEPAD_MENU_STICK_THRESHOLD) return "down";
    return null;
  }

  private dispatchGamepadMenuAction(action: GamepadMenuAction): void {
    this.setLastInputSource("gamepad");
    if (action === "start") {
      this.eventBus.emit("menu:toggle", undefined);
      return;
    }
    if (this.menuOpen) this.eventBus.emit("menu:gamepadInput", { action });
  }

  private isGamepadButtonPressed(pad: Gamepad | null, index: number): boolean {
    const button = pad?.buttons[index];
    return !!button && (button.pressed || button.value > 0.5);
  }

  private areMenuControlsNeutral(pad: Gamepad): boolean {
    return (
      !this.isGamepadButtonPressed(pad, 0) &&
      !this.isGamepadButtonPressed(pad, 1) &&
      !this.isGamepadButtonPressed(pad, 9) &&
      !this.isGamepadButtonPressed(pad, 12) &&
      !this.isGamepadButtonPressed(pad, 13) &&
      !this.isGamepadButtonPressed(pad, 14) &&
      !this.isGamepadButtonPressed(pad, 15) &&
      Math.abs(pad.axes[1] ?? 0) <= this.gamepadDeadzone
    );
  }

  private resetMenuDirectionRepeat(): void {
    this.menuGamepadDirection = null;
    this.menuGamepadRepeatAt = 0;
  }

  private updateGamepadInputSource(pad: Gamepad | null): void {
    if (!pad) {
      this.gamepadSourceAxisActive = false;
      this.gamepadSourceButtonActive = false;
      return;
    }

    const sourceAxisEnterThreshold = Math.min(1, this.gamepadDeadzone + GAMEPAD_SOURCE_HYSTERESIS);
    let hasActiveAxis = false;
    let hasReleasedAxis = true;
    for (const axis of pad.axes) {
      const magnitude = Math.abs(axis);
      if (magnitude > sourceAxisEnterThreshold) hasActiveAxis = true;
      if (magnitude > this.gamepadDeadzone) hasReleasedAxis = false;
    }
    let hasActiveButton = false;
    for (const button of pad.buttons) {
      if (button.pressed || button.value > 0.5) {
        hasActiveButton = true;
        break;
      }
    }

    const newlyActiveAxis = hasActiveAxis && !this.gamepadSourceAxisActive;
    const newlyActiveButton = hasActiveButton && !this.gamepadSourceButtonActive;
    if (hasReleasedAxis) this.gamepadSourceAxisActive = false;
    else if (hasActiveAxis) this.gamepadSourceAxisActive = true;
    this.gamepadSourceButtonActive = hasActiveButton;
    if ((newlyActiveAxis || newlyActiveButton) && !this.touchInputActive) {
      this.setLastInputSource("gamepad");
    }
  }

  private applyDeadzoneCurve(value: number): number {
    const sign = Math.sign(value);
    const magnitude = Math.abs(value);
    if (magnitude <= this.gamepadDeadzone) return 0;
    const normalized = (magnitude - this.gamepadDeadzone) / (1 - this.gamepadDeadzone);
    const curved = normalized ** this.gamepadCurve;
    return sign * curved;
  }

  private isKeyboardActionHeld(action: KeyboardBindingAction): boolean {
    return this.keyboardBindings[action].some((code) => this.keys.has(code));
  }

  private isKeyboardActionLatched(action: KeyboardBindingAction): boolean {
    return this.keyboardBindings[action].some((code) => this.latchedKeys.has(code));
  }

  private isKeyboardBoundCode(code: string): boolean {
    return Object.values(this.keyboardBindings).some((codes) => codes.includes(code));
  }

  private resolveTraversalAction(
    action: TraversalAction,
    rawHeld: boolean,
    rawActive: boolean,
  ): { active: boolean; pressed: boolean } {
    const rising = rawActive && !this.traversalRawActive[action];
    this.traversalRawActive[action] = rawHeld;
    if (this.vehicleContext || this.traversalModes[action] === "hold") {
      return { active: rawHeld, pressed: rising };
    }
    if (rising) this.traversalLatches[action] = !this.traversalLatches[action];
    return {
      active: this.traversalLatches[action],
      pressed: rising && this.traversalLatches[action],
    };
  }

  private setTraversalMode(action: TraversalAction, mode: InputActivationMode): void {
    this.traversalModes[action] = mode === "toggle" ? "toggle" : "hold";
    this.traversalLatches[action] = false;
    this.traversalRawActive[action] = false;
  }

  private resetTraversalActions(): void {
    for (const action of TRAVERSAL_ACTIONS) {
      this.traversalLatches[action] = false;
      this.traversalRawActive[action] = false;
    }
  }

  private sanitizeRangeValue(
    value: number,
    range: { readonly min: number; readonly max: number },
    fallback: number,
  ): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(range.min, Math.min(range.max, value));
  }

  private setLastInputSource(source: InputSource): void {
    if (source === this._lastInputSource) return;
    this._lastInputSource = source;
    this.eventBus.emit("input:sourceChanged", { source });
  }

  private ensureTouchControls(): void {
    if (this.touchControls || this.touchControlsLoad) return;
    this.touchControlsLoad = import("./TouchControlsManager")
      .then(({ TouchControlsManager }) => {
        const overlay = document.getElementById("ui-overlay");
        if (!overlay || this.touchControls) return;
        this.touchControls = new TouchControlsManager(overlay);
        this.touchControls.setLookSensitivity(this.touchLookSensitivity);
        this.applyTouchControlsVisibility(this.desiredTouchEnabled && !this.menuOpen);
      })
      .finally(() => {
        this.touchControlsLoad = null;
      });
  }

  private applyTouchControlsVisibility(enabled: boolean): void {
    if (!this.touchControls) {
      this.touchActive = false;
      return;
    }
    this.touchActive = enabled;
    if (enabled) {
      this.touchControls.show();
    } else {
      this.touchControls.hide();
    }
  }

  private isMobileUserAgent(): boolean {
    const userAgentData = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    if (userAgentData.userAgentData?.mobile) {
      return true;
    }

    const userAgent = navigator?.userAgent ?? "";
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
  }

  private detectTouchSupport(): boolean {
    if (typeof window === "undefined") return false;
    const hasTouchEvents = "ontouchstart" in window;
    const maxTouchPoints = typeof navigator?.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
    let hasCoarsePointer = false;
    let hasFinePointer = false;
    if (typeof matchMedia === "function") {
      try {
        hasCoarsePointer = matchMedia("(any-pointer: coarse)").matches;
      } catch {
        hasCoarsePointer = false;
      }
      try {
        hasFinePointer = matchMedia("(any-pointer: fine)").matches;
      } catch {
        hasFinePointer = false;
      }
    }
    if (maxTouchPoints > 0 || hasCoarsePointer || this.isMobileUserAgent()) return true;
    return hasTouchEvents && !hasFinePointer;
  }

  dispose(): void {
    this.stopMenuGamepadLoop();
    this.resetTraversalActions();
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.touchControls?.dispose();
    this.touchControls = null;
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    document.removeEventListener("mousemove", this._onMouseMove);
    this.canvas.removeEventListener("mousedown", this._onMouseDown);
    window.removeEventListener("mouseup", this._onMouseUp);
    this.canvas.removeEventListener("wheel", this._onWheel);
    document.removeEventListener("click", this._onClick);
    document.removeEventListener("pointerlockchange", this._onPointerLockChange);
    document.removeEventListener("touchstart", this._onTouchStart);
  }
}
