import { STATE } from "@core/types";
import { describe, expect, it, vi } from "vitest";
import type { CharacterMode, PlayerContext } from "./CharacterMode";
import { RopeMode } from "./RopeMode";

function makeContext(stableGrounded: boolean) {
  const requestState = vi.fn();
  const ctx = {
    stableGrounded,
    fsm: { requestState },
  } as unknown as PlayerContext;
  return { ctx, requestState };
}

describe("RopeMode.exit", () => {
  it("releases the rope FSM state to air while detached above ground", () => {
    const mode: CharacterMode = new RopeMode();
    const { ctx, requestState } = makeContext(false);

    mode.exit?.(ctx);

    expect(requestState).toHaveBeenCalledWith(STATE.air);
  });

  it("releases the rope FSM state to idle when already stably grounded", () => {
    const mode: CharacterMode = new RopeMode();
    const { ctx, requestState } = makeContext(true);

    mode.exit?.(ctx);

    expect(requestState).toHaveBeenCalledWith(STATE.idle);
  });
});

describe("RopeMode.enter", () => {
  it("clears stable ground carried over from a platform attach", () => {
    const ctx = {
      jumpBufferRemaining: 0,
      onLadder: false,
      isCrouched: false,
      crouchReleaseGraceRemaining: 0,
      floatingDistance: 0,
      currentCapsuleHalfHeight: 0.5,
      standingCapsuleHalfHeight: 0.5,
      remainingAirJumps: 0,
      isGrounded: true,
      stableGrounded: true,
      canJump: true,
      config: { maxAirJumps: 1, capsuleRadius: 0.35, floatHeight: 0.15 },
      motor: { setGravityScale: vi.fn(), clearGroundedGrace: vi.fn() },
      fsm: { current: STATE.idle, requestState: vi.fn() },
      eventBus: { emit: vi.fn() },
    } as unknown as PlayerContext;

    new RopeMode().enter(ctx);

    expect(ctx.stableGrounded).toBe(false);
  });
});
