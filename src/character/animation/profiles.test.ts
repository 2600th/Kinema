import { describe, expect, it } from 'vitest';
import { PLAYER_PROFILE } from './profiles';

describe('PLAYER_PROFILE', () => {
  it('uses additive hit clips for spike damage reactions', () => {
    expect(PLAYER_PROFILE.spikeDamageClipCandidates).toEqual(['Hit_Chest', 'Hit_Head']);
    expect(PLAYER_PROFILE.additiveOneShots).toEqual(
      expect.arrayContaining(PLAYER_PROFILE.spikeDamageClipCandidates ?? []),
    );
  });
});
