import type { Disposable } from "@core/types";
import { DEFAULT_USER_SETTINGS, USER_SETTINGS_RANGES } from "@core/UserSettings";
import { TouchButton } from "./TouchButton";
import { VirtualJoystick } from "./VirtualJoystick";
import "./touch-controls.css";

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
  sprintPressed: boolean;
  active: boolean;
}

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
  private prevSprint = false;
  private lookSensitivity = DEFAULT_USER_SETTINGS.touchLookSensitivity;

  constructor(container: HTMLElement) {
    // Create a fixed overlay container for all touch controls
    this.root = document.createElement("div");
    this.root.className = "touch-controls-container";
    this.root.setAttribute("aria-hidden", "true");
    this.root.inert = true;
    container.appendChild(this.root);

    // -- Left side: movement joystick --
    const leftZone = document.createElement("div");
    leftZone.className = "touch-zone touch-zone--left";
    leftZone.setAttribute("role", "group");
    leftZone.setAttribute("aria-label", "Movement joystick");
    this.root.appendChild(leftZone);

    this.moveJoystick = new VirtualJoystick(leftZone, {
      size: 140,
      fixed: false,
      deadzone: 0.1,
    });

    // Sprint button near left joystick
    const sprintZone = document.createElement("div");
    sprintZone.className = "touch-zone touch-zone--sprint";
    this.root.appendChild(sprintZone);

    this.sprintButton = new TouchButton(sprintZone, {
      icon: "\u21e7", // ⇧
      size: 48,
      ariaLabel: "Sprint",
      className: "touch-btn--sprint",
      hold: true,
    });

    // -- Right side: look joystick --
    const rightZone = document.createElement("div");
    rightZone.className = "touch-zone touch-zone--right";
    rightZone.setAttribute("role", "group");
    rightZone.setAttribute("aria-label", "Camera joystick");
    this.root.appendChild(rightZone);

    this.lookJoystick = new VirtualJoystick(rightZone, {
      size: 140,
      fixed: false,
      deadzone: 0.08,
    });

    // -- Right side: action buttons --
    const btnZone = document.createElement("div");
    btnZone.className = "touch-zone touch-zone--buttons";
    this.root.appendChild(btnZone);

    this.jumpButton = new TouchButton(btnZone, {
      icon: "\u2191", // ↑
      size: 64,
      ariaLabel: "Jump",
      className: "touch-btn--jump",
    });

    this.interactButton = new TouchButton(btnZone, {
      icon: "\u270B", // ✋
      size: 48,
      ariaLabel: "Interact",
      className: "touch-btn--interact",
    });

    this.crouchButton = new TouchButton(btnZone, {
      icon: "\u2193", // ↓
      size: 48,
      ariaLabel: "Crouch",
      className: "touch-btn--crouch",
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
    const crouchHeld = crouch.held;
    const sprintHeld = sprint.held;

    const jumpPressed = jumpHeld && !this.prevJump;
    const interactPressed = interactHeld && !this.prevInteract;
    const crouchPressed = crouch.pressed || (crouchHeld && !this.prevCrouch);
    const sprintPressed = sprint.pressed || (sprintHeld && !this.prevSprint);

    this.prevJump = jumpHeld;
    this.prevInteract = interactHeld;
    this.prevCrouch = crouchHeld;
    this.prevSprint = sprintHeld;

    const active =
      move.active ||
      look.active ||
      jumpHeld ||
      interactHeld ||
      crouchHeld ||
      crouchPressed ||
      sprintHeld ||
      sprintPressed;

    return {
      // Invert Y: joystick down (positive y) = backward (negative moveY)
      moveX: move.x,
      moveY: -move.y,
      lookDX: look.x * this.lookSensitivity,
      lookDY: look.y * this.lookSensitivity,
      vehicleVertical: -look.y,
      jump: jumpHeld,
      jumpPressed,
      interact: interactHeld,
      interactPressed,
      crouch: crouchHeld,
      crouchPressed,
      sprint: sprintHeld,
      sprintPressed,
      active,
    };
  }

  setLookSensitivity(value: number): void {
    this.lookSensitivity = Number.isFinite(value)
      ? Math.max(
          USER_SETTINGS_RANGES.touchLookSensitivity.min,
          Math.min(USER_SETTINGS_RANGES.touchLookSensitivity.max, value),
        )
      : DEFAULT_USER_SETTINGS.touchLookSensitivity;
  }

  /** Show all touch controls. */
  show(): void {
    this.root.style.display = "";
    this.root.setAttribute("aria-hidden", "false");
    this.root.inert = false;
  }

  /** Hide all touch controls. */
  hide(): void {
    this.root.style.display = "none";
    this.root.setAttribute("aria-hidden", "true");
    this.root.inert = true;
  }

  get visible(): boolean {
    return this.root.style.display !== "none";
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
