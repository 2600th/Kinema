import { type InputState, NULL_INPUT, STATE } from "@core/types";
import { describe, expect, it, vi } from "vitest";
import type { PlayerController } from "../PlayerController";
import { LandState } from "./LandState";

function input(overrides: Partial<InputState> = {}): InputState {
  return { ...NULL_INPUT, ...overrides };
}

function makeState(animationFinished = false): LandState {
  return new LandState({ isAnimationFinished: vi.fn(() => animationFinished) } as unknown as PlayerController);
}

describe("LandState", () => {
  it("accepts crouch and interact immediately with idle-state priority", () => {
    const state = makeState();
    state.enter();

    expect(state.handleInput(input({ crouch: true, interactPressed: true, jumpPressed: true }), true)).toBe(
      STATE.crouch,
    );
    expect(state.handleInput(input({ interactPressed: true, jumpPressed: true }), true)).toBe(STATE.interact);
  });

  it("preserves airborne and jump exits", () => {
    const state = makeState();
    state.enter();

    expect(state.handleInput(input({ crouch: true, jumpPressed: true }), false)).toBe(STATE.air);
    expect(state.handleInput(input({ jumpPressed: true }), true)).toBe(STATE.jump);
  });

  it("holds for at most 0.25 seconds when the clip is still playing", () => {
    const state = makeState();
    state.enter();

    state.update(0.249);
    expect(state.handleInput(NULL_INPUT, true)).toBeNull();
    state.update(0.001);
    expect(state.handleInput(NULL_INPUT, true)).toBe(STATE.idle);
  });

  it("still exits early when the animation finishes", () => {
    const state = makeState(true);
    state.enter();

    expect(state.handleInput(NULL_INPUT, true)).toBe(STATE.idle);
    expect(state.handleInput(input({ forward: true }), true)).toBe(STATE.move);
  });
});
