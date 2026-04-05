import { describe, expect, it } from 'vitest';
import {
  PROCEDURAL_REVIEW_SPAWN_ORDER,
  getShowcaseStationZ,
  resolveProceduralReviewSpawn,
} from './ShowcaseLayout';

describe('resolveProceduralReviewSpawn', () => {
  it('resolves station review spawns with world-space offsets', () => {
    const spawn = resolveProceduralReviewSpawn('throw');
    expect(spawn).not.toBeNull();
    expect(spawn?.spawn.position.z).toBeCloseTo(getShowcaseStationZ('throw') + 8.9);
    expect(spawn?.cameraYaw).toBeCloseTo(0);
  });

  it('exposes the review spawn order for screenshot automation', () => {
    expect(PROCEDURAL_REVIEW_SPAWN_ORDER[0]).toBe('entrance');
    expect(PROCEDURAL_REVIEW_SPAWN_ORDER).toContain('platformsPhysics');
    expect(PROCEDURAL_REVIEW_SPAWN_ORDER.at(-1)).toBe('overviewEnd');
  });

  it('returns null for unknown review spawn ids', () => {
    expect(resolveProceduralReviewSpawn('missing')).toBeNull();
  });
});
