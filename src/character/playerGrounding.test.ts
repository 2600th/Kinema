import { describe, expect, it } from 'vitest';
import { resolveStableGroundedState } from './playerGrounding';

describe('playerGrounding helpers', () => {
  it('resets stable grounded grace when actual ground contact exists', () => {
    const result = resolveStableGroundedState(
      { isGrounded: true, closeToGround: true, standingSlopeAllowed: true },
      0,
      0,
      1 / 60,
    );

    expect(result.stableGrounded).toBe(true);
    expect(result.graceRemaining).toBeGreaterThan(0.05);
  });

  it('holds stable grounded through a brief ramp probe miss', () => {
    const result = resolveStableGroundedState(
      { isGrounded: false, closeToGround: true, standingSlopeAllowed: true },
      -0.35,
      0.08,
      1 / 60,
    );

    expect(result.stableGrounded).toBe(true);
    expect(result.graceRemaining).toBeLessThan(0.08);
    expect(result.graceRemaining).toBeGreaterThan(0);
  });

  it('drops stable grounded when the player is truly leaving the ground', () => {
    const farFromGround = resolveStableGroundedState(
      { isGrounded: false, closeToGround: false, standingSlopeAllowed: true },
      -0.2,
      0.08,
      1 / 60,
    );
    const steepLoss = resolveStableGroundedState(
      { isGrounded: false, closeToGround: true, standingSlopeAllowed: false },
      -0.2,
      0.08,
      1 / 60,
    );
    const fastFall = resolveStableGroundedState(
      { isGrounded: false, closeToGround: true, standingSlopeAllowed: true },
      -2.4,
      0.08,
      1 / 60,
    );

    expect(farFromGround.stableGrounded).toBe(false);
    expect(steepLoss.stableGrounded).toBe(false);
    expect(fastFall.stableGrounded).toBe(false);
  });
});
