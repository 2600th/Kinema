import { describe, expect, it } from 'vitest';
import { shouldApplyGroundReaction } from './CharacterMotor';

describe('shouldApplyGroundReaction', () => {
  it('allows floating platforms to react to the player', () => {
    expect(shouldApplyGroundReaction({ userData: { kind: 'floating-platform' } } as any)).toBe(true);
  });

  it('still ignores throwables', () => {
    expect(shouldApplyGroundReaction({ userData: { kind: 'throwable' } } as any)).toBe(false);
  });
});
