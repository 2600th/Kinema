import { describe, it, expect } from 'vitest';
import {
  PHYSICS_TIMESTEP,
  DEFAULT_PLAYER_CONFIG,
  DEFAULT_CAMERA_CONFIG,
  COLLISION_GROUP_WORLD,
  COLLISION_GROUP_PLAYER,
  COLLISION_GROUP_PLAYER_SENSOR,
  COLLISION_GROUP_INTERACTABLE,
} from './constants';

describe('constants', () => {
  it('PHYSICS_TIMESTEP is 1/60', () => {
    expect(PHYSICS_TIMESTEP).toBeCloseTo(1 / 60);
  });

  it('collision groups have correct format (membership << 16 | filter)', () => {
    const membership = (g: number) => g >>> 16;
    const filter = (g: number) => g & 0xffff;
    expect(membership(COLLISION_GROUP_WORLD)).toBe(1);
    expect(filter(COLLISION_GROUP_WORLD)).toBe(3);
    expect(membership(COLLISION_GROUP_PLAYER)).toBe(2);
    expect(filter(COLLISION_GROUP_PLAYER)).toBe(1);
    expect(membership(COLLISION_GROUP_PLAYER_SENSOR)).toBe(4);
    expect(filter(COLLISION_GROUP_PLAYER_SENSOR)).toBe(8);
    expect(membership(COLLISION_GROUP_INTERACTABLE)).toBe(8);
    expect(filter(COLLISION_GROUP_INTERACTABLE)).toBe(4);
  });

  it('includes movement feel config values for jump buffering and sprint camera feedback', () => {
    expect(DEFAULT_PLAYER_CONFIG.coyoteTime).toBeGreaterThan(0);
    expect(DEFAULT_PLAYER_CONFIG.jumpBufferTime).toBeGreaterThan(0);
    expect(DEFAULT_PLAYER_CONFIG.maxAirJumps).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_PLAYER_CONFIG.crouchHeightOffset).toBeGreaterThan(0);
    expect(DEFAULT_CAMERA_CONFIG.sprintFovBoost).toBeGreaterThan(0);
    expect(DEFAULT_CAMERA_CONFIG.fovDamping).toBeGreaterThan(0);
  });
});
