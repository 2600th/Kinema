import type { EventBus } from '@core/EventBus';
import type { InputState, Disposable } from '@core/types';

/**
 * Captures keyboard + pointer lock input.
 * poll() returns a frozen InputState snapshot and resets deltas.
 */
export class InputManager implements Disposable {
  private keys = new Set<string>();
  private prevInteract = false;
  private prevJump = false;
  private mouseDX = 0;
  private mouseDY = 0;
  private mouseWheel = 0;
  private mouseDown = false;
  private locked = false;

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
  }

  /** Snapshot current input state, reset deltas, emit event. */
  poll(): InputState {
    const jump = this.locked && this.keys.has('Space');
    const interact = this.locked && this.keys.has('KeyE');
    const jumpPressed = jump && !this.prevJump;
    const interactPressed = interact && !this.prevInteract;
    this.prevJump = jump;
    this.prevInteract = interact;

    const state: InputState = Object.freeze({
      forward: this.locked && (this.keys.has('KeyW') || this.keys.has('ArrowUp')),
      backward: this.locked && (this.keys.has('KeyS') || this.keys.has('ArrowDown')),
      left: this.locked && (this.keys.has('KeyA') || this.keys.has('ArrowLeft')),
      right: this.locked && (this.keys.has('KeyD') || this.keys.has('ArrowRight')),
      jump,
      jumpPressed,
      interact,
      interactPressed,
      sprint: this.locked && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')),
      mouseDeltaX: this.mouseDX,
      mouseDeltaY: this.mouseDY,
      mouseWheelDelta: this.mouseWheel,
    });

    // Reset mouse deltas after snapshot
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseWheel = 0;

    this.eventBus.emit('input:state', state);
    return state;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    this.keys.add(e.code);

    // Prevent default for game keys
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE'].includes(e.code)) {
      e.preventDefault();
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

  private handleMouseDown(): void {
    this.mouseDown = true;
  }

  private handleMouseUp(): void {
    this.mouseDown = false;
  }

  private handleClick(): void {
    if (!this.locked) {
      this.canvas.requestPointerLock();
    }
  }

  private handlePointerLockChange(): void {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) {
      this.keys.clear();
      this.prevInteract = false;
      this.prevJump = false;
      this.mouseDown = false;
    }
  }

  dispose(): void {
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
