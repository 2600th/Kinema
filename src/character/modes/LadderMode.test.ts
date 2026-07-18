import { type InputState, NULL_INPUT, STATE } from "@core/types";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { PlayerContext } from "./CharacterMode";
import { LadderMode } from "./LadderMode";

function input(overrides: Partial<InputState> = {}): InputState {
  return { ...NULL_INPUT, ...overrides };
}

function makeContext() {
  const velocities: Array<{ x: number; y: number; z: number }> = [];
  const requestState = vi.fn();
  const setGravityScale = vi.fn();
  const ctx = {
    currentPos: new THREE.Vector3(0, 1, 0),
    currentCapsuleHalfHeight: 0.35,
    ladderZones: [new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))],
    fsm: { update: vi.fn(), requestState },
    body: {
      linvel: () => ({ x: 0.5, y: 0, z: -0.5 }),
      setLinvel: (velocity: { x: number; y: number; z: number }) => velocities.push({ ...velocity }),
    },
    motor: { gravityScale: 1, setGravityScale },
    config: { jumpForce: 4.6, maxAirJumps: 1 },
    onLadder: true,
    jumpBufferRemaining: 0,
    remainingAirJumps: 1,
  } as unknown as PlayerContext;
  return { ctx, requestState, setGravityScale, velocities };
}

describe("LadderMode", () => {
  it.each([
    { moveY: 0.5, sprint: false, expected: 1.3 },
    { moveY: -0.5, sprint: false, expected: -1.3 },
    { moveY: 0.5, sprint: true, expected: 1.8 },
    { moveY: 2, sprint: false, expected: 2.6 },
  ])("scales climb velocity proportionally for moveY=$moveY", ({ moveY, sprint, expected }) => {
    const mode = new LadderMode();
    const { ctx, requestState, velocities } = makeContext();

    mode.fixedUpdate(ctx, input({ moveY, sprint }), 1 / 60);

    expect(requestState).toHaveBeenLastCalledWith(STATE.climb);
    expect(velocities.at(-1)?.y).toBeCloseTo(expected);
  });

  it("treats the inclusive 0.1 deadzone as stationary", () => {
    const mode = new LadderMode();
    const { ctx, requestState, velocities } = makeContext();

    mode.fixedUpdate(ctx, input({ forward: true, moveY: 0.1 }), 1 / 60);

    expect(requestState).toHaveBeenLastCalledWith(STATE.idle);
    expect(velocities.at(-1)?.y).toBe(0);
  });

  it("preserves full-speed keyboard-shaped input", () => {
    const mode = new LadderMode();
    const { ctx, velocities } = makeContext();

    mode.fixedUpdate(ctx, input({ forward: true, moveY: 1 }), 1 / 60);

    expect(velocities.at(-1)?.y).toBeCloseTo(2.6);
  });

  it("keeps jump dismount as the final velocity and restores gravity", () => {
    const mode = new LadderMode();
    const { ctx, setGravityScale, velocities } = makeContext();

    mode.fixedUpdate(ctx, input({ jumpPressed: true, moveY: 0.5 }), 1 / 60);

    expect(ctx.onLadder).toBe(false);
    expect(setGravityScale).toHaveBeenLastCalledWith(ctx.body, 1);
    expect(velocities.at(-1)?.y).toBeGreaterThanOrEqual(4.6 * 0.9);
  });
});
