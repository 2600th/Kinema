import type { Disposable } from '@core/types';

export interface JoystickOptions {
  size?: number;        // diameter in px (default 140)
  baseColor?: string;   // outer ring color
  thumbColor?: string;  // inner thumb color
  deadzone?: number;    // 0-1 (default 0.1)
  fixed?: boolean;      // true=fixed position, false=dynamic origin (default false)
}

export interface JoystickState {
  x: number;  // -1 to 1
  y: number;  // -1 to 1
  active: boolean;
}

const DEFAULT_SIZE = 140;
const DEFAULT_BASE_COLOR = 'rgba(255, 255, 255, 0.15)';
const DEFAULT_THUMB_COLOR = 'rgba(255, 255, 255, 0.6)';
const DEFAULT_DEADZONE = 0.1;

/**
 * Canvas-rendered virtual joystick for touch input.
 * Tracks a single touch by identifier and computes normalized x/y axes.
 */
export class VirtualJoystick implements Disposable {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private radius: number;
  private thumbRadius: number;
  private baseColor: string;
  private thumbColor: string;
  private deadzone: number;
  private fixed: boolean;

  private trackingId: number | null = null;
  private originX = 0;
  private originY = 0;
  private thumbX = 0;
  private thumbY = 0;
  private active = false;

  private _onTouchStart = this.handleTouchStart.bind(this);
  private _onTouchMove = this.handleTouchMove.bind(this);
  private _onTouchEnd = this.handleTouchEnd.bind(this);

  constructor(
    private container: HTMLElement,
    options: JoystickOptions = {},
  ) {
    this.size = options.size ?? DEFAULT_SIZE;
    this.radius = this.size / 2;
    this.thumbRadius = this.radius * 0.35;
    this.baseColor = options.baseColor ?? DEFAULT_BASE_COLOR;
    this.thumbColor = options.thumbColor ?? DEFAULT_THUMB_COLOR;
    this.deadzone = options.deadzone ?? DEFAULT_DEADZONE;
    this.fixed = options.fixed ?? false;

    // Use devicePixelRatio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.canvas.style.touchAction = 'none';
    this.canvas.style.pointerEvents = 'auto';
    this.canvas.classList.add('touch-joystick');

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('[VirtualJoystick] Failed to get 2d context');
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);

    this.container.appendChild(this.canvas);

    this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    window.addEventListener('touchmove', this._onTouchMove, { passive: false });
    window.addEventListener('touchend', this._onTouchEnd);
    window.addEventListener('touchcancel', this._onTouchEnd);

    this.draw();
  }

  getState(): JoystickState {
    if (!this.active) return { x: 0, y: 0, active: false };

    const dx = this.thumbX - this.originX;
    const dy = this.thumbY - this.originY;
    const dist = Math.hypot(dx, dy);
    const maxDist = this.radius - this.thumbRadius;

    if (maxDist <= 0) return { x: 0, y: 0, active: true };

    const normalized = Math.min(dist / maxDist, 1);
    if (normalized < this.deadzone) return { x: 0, y: 0, active: true };

    // Remap past deadzone to 0-1 range
    const remapped = (normalized - this.deadzone) / (1 - this.deadzone);
    const angle = Math.atan2(dy, dx);

    return {
      x: Math.cos(angle) * remapped,
      y: Math.sin(angle) * remapped,
      active: true,
    };
  }

  show(): void {
    this.canvas.style.display = '';
  }

  hide(): void {
    this.canvas.style.display = 'none';
    this.resetTouch();
  }

  dispose(): void {
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('touchmove', this._onTouchMove);
    window.removeEventListener('touchend', this._onTouchEnd);
    window.removeEventListener('touchcancel', this._onTouchEnd);
    this.canvas.remove();
  }

  private handleTouchStart(e: TouchEvent): void {
    e.preventDefault();
    if (this.trackingId !== null) return; // Already tracking a finger

    const touch = e.changedTouches[0];
    if (!touch) return;

    this.trackingId = touch.identifier;
    this.active = true;

    const rect = this.canvas.getBoundingClientRect();
    const localX = touch.clientX - rect.left;
    const localY = touch.clientY - rect.top;

    if (this.fixed) {
      this.originX = this.radius;
      this.originY = this.radius;
    } else {
      this.originX = localX;
      this.originY = localY;
    }

    this.thumbX = localX;
    this.thumbY = localY;
    this.draw();
  }

  private handleTouchMove(e: TouchEvent): void {
    if (this.trackingId === null) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier !== this.trackingId) continue;

      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const localX = touch.clientX - rect.left;
      const localY = touch.clientY - rect.top;

      // Clamp thumb to within joystick radius
      const dx = localX - this.originX;
      const dy = localY - this.originY;
      const dist = Math.hypot(dx, dy);
      const maxDist = this.radius - this.thumbRadius;

      if (dist > maxDist && maxDist > 0) {
        const scale = maxDist / dist;
        this.thumbX = this.originX + dx * scale;
        this.thumbY = this.originY + dy * scale;
      } else {
        this.thumbX = localX;
        this.thumbY = localY;
      }

      this.draw();
      break;
    }
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
    this.active = false;
    this.thumbX = this.radius;
    this.thumbY = this.radius;
    this.originX = this.radius;
    this.originY = this.radius;
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const r = this.radius;

    ctx.clearRect(0, 0, this.size, this.size);

    // Outer ring
    ctx.beginPath();
    ctx.arc(this.originX, this.originY, r - 2, 0, Math.PI * 2);
    ctx.strokeStyle = this.baseColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Base fill
    ctx.beginPath();
    ctx.arc(this.originX, this.originY, r - 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fill();

    // Thumb
    ctx.beginPath();
    ctx.arc(this.thumbX, this.thumbY, this.thumbRadius, 0, Math.PI * 2);
    ctx.fillStyle = this.thumbColor;
    ctx.fill();
  }
}
