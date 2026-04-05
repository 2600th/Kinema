import type { Disposable } from '@core/types';
import { VirtualJoystick } from './VirtualJoystick';
import { TouchButton } from './TouchButton';
import './touch-controls.css';

/** Touch input state compatible with InputManager merging. */
export interface TouchInputState {
  moveX: number;
  moveY: number;
  lookDX: number;
  lookDY: number;
  vehicleVertical: number;
  jump: boolean;
  jumpPressed: boolean;
  interact: boolean;
  interactPressed: boolean;
  crouch: boolean;
  crouchPressed: boolean;
  sprint: boolean;
  active: boolean;
}

const TOUCH_LOOK_SENSITIVITY = 4;

/**
 * Orchestrator that creates and manages all touch widgets.
 * Lays out movement joystick (left), look joystick (right),
 * and action buttons (right side).
 */
export class TouchControlsManager implements Disposable {
  private root: HTMLDivElement;
  private moveJoystick: VirtualJoystick;
  private lookJoystick: VirtualJoystick;
  private jumpButton: TouchButton;
  private interactButton: TouchButton;
  private crouchButton: TouchButton;
  private sprintButton: TouchButton;

  private prevJump = false;
  private prevInteract = false;
  private prevCrouch = false;

  constructor(container: HTMLElement) {
    // Create a fixed overlay container for all touch controls
    this.root = document.createElement('div');
    this.root.className = 'touch-controls-container';
    container.appendChild(this.root);

    // -- Left side: movement joystick --
    const leftZone = document.createElement('div');
    leftZone.className = 'touch-zone touch-zone--left';
    this.root.appendChild(leftZone);

    this.moveJoystick = new VirtualJoystick(leftZone, {
      size: 140,
      fixed: false,
      deadzone: 0.1,
    });

    // Sprint button near left joystick
    const sprintZone = document.createElement('div');
    sprintZone.className = 'touch-zone touch-zone--sprint';
    this.root.appendChild(sprintZone);

    this.sprintButton = new TouchButton(sprintZone, {
      icon: '\u21e7', // ⇧
      size: 48,
      className: 'touch-btn--sprint',
      hold: true,
    });

    // -- Right side: look joystick --
    const rightZone = document.createElement('div');
    rightZone.className = 'touch-zone touch-zone--right';
    this.root.appendChild(rightZone);

    this.lookJoystick = new VirtualJoystick(rightZone, {
      size: 140,
      fixed: false,
      deadzone: 0.08,
    });

    // -- Right side: action buttons --
    const btnZone = document.createElement('div');
    btnZone.className = 'touch-zone touch-zone--buttons';
    this.root.appendChild(btnZone);

    this.jumpButton = new TouchButton(btnZone, {
      icon: '\u2191', // ↑
      size: 64,
      className: 'touch-btn--jump',
    });

    this.interactButton = new TouchButton(btnZone, {
      icon: '\u270B', // ✋
      size: 48,
      className: 'touch-btn--interact',
    });

    this.crouchButton = new TouchButton(btnZone, {
      icon: '\u2193', // ↓
      size: 48,
      className: 'touch-btn--crouch',
    });
  }

  /** Get merged touch input state compatible with InputManager. */
  getInputState(): TouchInputState {
    const move = this.moveJoystick.getState();
    const look = this.lookJoystick.getState();
    const jump = this.jumpButton.getState();
    const interact = this.interactButton.getState();
    const crouch = this.crouchButton.getState();
    const sprint = this.sprintButton.getState();

    const jumpHeld = jump.held || jump.pressed;
    const interactHeld = interact.held || interact.pressed;
    const crouchHeld = crouch.held || crouch.pressed;

    const jumpPressed = jumpHeld && !this.prevJump;
    const interactPressed = interactHeld && !this.prevInteract;
    const crouchPressed = crouchHeld && !this.prevCrouch;

    this.prevJump = jumpHeld;
    this.prevInteract = interactHeld;
    this.prevCrouch = crouchHeld;

    const active = move.active || look.active || jumpHeld || interactHeld || crouchHeld || sprint.held;

    return {
      // Invert Y: joystick down (positive y) = backward (negative moveY)
      moveX: move.x,
      moveY: -move.y,
      lookDX: look.x * TOUCH_LOOK_SENSITIVITY,
      lookDY: look.y * TOUCH_LOOK_SENSITIVITY,
      vehicleVertical: -look.y,
      jump: jumpHeld,
      jumpPressed,
      interact: interactHeld,
      interactPressed,
      crouch: crouchHeld,
      crouchPressed,
      sprint: sprint.held,
      active,
    };
  }

  /** Show all touch controls. */
  show(): void {
    this.root.style.display = '';
  }

  /** Hide all touch controls. */
  hide(): void {
    this.root.style.display = 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  dispose(): void {
    this.moveJoystick.dispose();
    this.lookJoystick.dispose();
    this.jumpButton.dispose();
    this.interactButton.dispose();
    this.crouchButton.dispose();
    this.sprintButton.dispose();
    this.root.remove();
  }
}
