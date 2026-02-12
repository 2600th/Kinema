import { describe, it, expect } from 'vitest';
import { NULL_INPUT } from './types';

describe('InputState', () => {
  it('NULL_INPUT has correct shape', () => {
    expect(NULL_INPUT.forward).toBe(false);
    expect(NULL_INPUT.backward).toBe(false);
    expect(NULL_INPUT.crouch).toBe(false);
    expect(NULL_INPUT.crouchPressed).toBe(false);
    expect(NULL_INPUT.jump).toBe(false);
    expect(NULL_INPUT.jumpPressed).toBe(false);
    expect(NULL_INPUT.interact).toBe(false);
    expect(NULL_INPUT.interactPressed).toBe(false);
    expect(NULL_INPUT.mouseDeltaX).toBe(0);
    expect(NULL_INPUT.mouseDeltaY).toBe(0);
    expect(NULL_INPUT.mouseWheelDelta).toBe(0);
  });
});
