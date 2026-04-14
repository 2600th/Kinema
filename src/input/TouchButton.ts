import type { Disposable } from "@core/types";

export interface TouchButtonOptions {
  icon: string; // unicode or text label
  size?: number; // diameter in px (default 56)
  className?: string; // extra CSS class
  hold?: boolean; // hint for manager — button supports hold behavior
}

export interface TouchButtonState {
  pressed: boolean; // true on the frame it was pressed (edge trigger)
  held: boolean; // true while finger is down
}

const DEFAULT_SIZE = 56;

/**
 * DOM-based touch button with edge-trigger and hold detection.
 * `pressed` is consumed (reset to false) after one `getState()` read.
 */
export class TouchButton implements Disposable {
  private button: HTMLButtonElement;
  private _pressed = false;
  private _held = false;
  private trackingId: number | null = null;

  private _onTouchStart = this.handleTouchStart.bind(this);
  private _onTouchEnd = this.handleTouchEnd.bind(this);

  constructor(
    private container: HTMLElement,
    options: TouchButtonOptions,
  ) {
    const size = options.size ?? DEFAULT_SIZE;

    this.button = document.createElement("button");
    this.button.textContent = options.icon;
    this.button.style.width = `${size}px`;
    this.button.style.height = `${size}px`;
    this.button.style.touchAction = "none";
    this.button.style.pointerEvents = "auto";
    this.button.setAttribute("type", "button");

    const classes = ["touch-btn"];
    if (options.className) classes.push(options.className);
    this.button.className = classes.join(" ");

    this.container.appendChild(this.button);

    this.button.addEventListener("touchstart", this._onTouchStart, { passive: false });
    window.addEventListener("touchend", this._onTouchEnd);
    window.addEventListener("touchcancel", this._onTouchEnd);
  }

  getState(): TouchButtonState {
    const state: TouchButtonState = {
      pressed: this._pressed,
      held: this._held,
    };
    // Consume pressed (edge trigger) after read
    this._pressed = false;
    return state;
  }

  show(): void {
    this.button.style.display = "";
  }

  hide(): void {
    this.button.style.display = "none";
    this.resetTouch();
  }

  dispose(): void {
    this.button.removeEventListener("touchstart", this._onTouchStart);
    window.removeEventListener("touchend", this._onTouchEnd);
    window.removeEventListener("touchcancel", this._onTouchEnd);
    this.button.remove();
  }

  private handleTouchStart(e: TouchEvent): void {
    e.preventDefault();
    if (this.trackingId !== null) return;

    const touch = e.changedTouches[0];
    if (!touch) return;

    this.trackingId = touch.identifier;
    this._pressed = true;
    this._held = true;
    this.button.classList.add("touch-btn--active");
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (this.trackingId === null) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.trackingId) {
        this.resetTouch();
        break;
      }
    }
  }

  private resetTouch(): void {
    this.trackingId = null;
    this._held = false;
    this.button.classList.remove("touch-btn--active");
  }
}
