import type { EventBus } from "@core/EventBus";
import { type InputState, STATE, type StateId } from "@core/types";
import type * as THREE from "three";
import type { PlayerController } from "./PlayerController";
import { AirJumpState } from "./states/AirJumpState";
import { AirState } from "./states/AirState";
import { CarryState } from "./states/CarryState";
import { ClimbState } from "./states/ClimbState";
import { CrouchState } from "./states/CrouchState";
import { GrabState } from "./states/GrabState";
import { IdleState } from "./states/IdleState";
import { InteractState } from "./states/InteractState";
import { JumpState } from "./states/JumpState";
import { LandState } from "./states/LandState";
import { MoveState } from "./states/MoveState";
import { RopeState } from "./states/RopeState";
import type { State } from "./states/State";

/**
 * Finite state machine runner for character states.
 * Adding a new state = 1 file + 1 line in the constructor + 1 StateId literal.
 */
export class CharacterFSM {
  private states = new Map<StateId, State>();
  private currentState: State;

  constructor(
    player: PlayerController,
    private eventBus: EventBus,
  ) {
    // Register all states
    this.registerState(new IdleState(player));
    this.registerState(new MoveState(player));
    this.registerState(new JumpState(player));
    this.registerState(new AirState(player));
    this.registerState(new AirJumpState(player));
    this.registerState(new InteractState(player));
    this.registerState(new CrouchState(player));
    this.registerState(new GrabState(player));
    this.registerState(new CarryState(player));
    this.registerState(new LandState(player));
    this.registerState(new ClimbState(player));
    this.registerState(new RopeState(player));

    // Start in idle
    const idleState = this.states.get(STATE.idle);
    if (!idleState) {
      throw new Error("[CharacterFSM] Missing idle state registration.");
    }
    this.currentState = idleState;
    this.currentState.enter();
  }

  private registerState(state: State): void {
    this.states.set(state.id, state);
  }

  /** Process input and perform state transition if needed. */
  handleInput(input: InputState, isGrounded: boolean): void {
    const nextId = this.currentState.handleInput(input, isGrounded);
    if (nextId !== null && nextId !== this.currentState.id) {
      this.transition(nextId);
    }
  }

  /** Per-tick update of current state. */
  update(dt: number): void {
    this.currentState.update(dt);
  }

  /** Get desired movement from current state. */
  getDesiredMovement(dt: number, input: InputState): THREE.Vector3 {
    return this.currentState.getDesiredMovement(dt, input);
  }

  /** Get current state ID. */
  get current(): StateId {
    return this.currentState.id;
  }

  /** Force a transition (used by buffered actions). */
  requestState(nextId: StateId): void {
    if (nextId !== this.currentState.id) {
      this.transition(nextId);
    }
  }

  private transition(nextId: StateId): void {
    const nextState = this.states.get(nextId);
    if (!nextState) {
      console.warn(`[FSM] Unknown state: ${nextId}`);
      return;
    }

    const prevId = this.currentState.id;
    this.currentState.exit();
    this.currentState = nextState;
    this.currentState.enter();

    this.eventBus.emit("player:stateChanged", { previous: prevId, current: nextId });
  }
}
