import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { AnimationController } from './AnimationController';
import type { AnimationProfile } from './AnimationProfile';
import type { CharacterModel } from './CharacterModel';

/** Create a minimal clip with a track that binds to 'bone' child of root. */
function makeClip(name: string, duration = 1.0): THREE.AnimationClip {
  const times = [0, duration];
  const values = [0, 0, 0, 0, 0, 0];
  const track = new THREE.VectorKeyframeTrack('bone.position', times, values);
  return new THREE.AnimationClip(name, duration, [track]);
}

/** Build a minimal CharacterModel stub with a bone child so tracks bind. */
function makeModel(clipNames: string[]): CharacterModel {
  const root = new THREE.Object3D();
  // Add a child named 'bone' so PropertyBinding can resolve tracks
  const bone = new THREE.Object3D();
  bone.name = 'bone';
  root.add(bone);
  const clips = new Map<string, THREE.AnimationClip>();
  for (const name of clipNames) {
    clips.set(name, makeClip(name));
  }
  return { root, clips, handBone: null } as unknown as CharacterModel;
}

/** Build a minimal profile matching the test clips. */
function makeProfile(overrides?: Partial<AnimationProfile>): AnimationProfile {
  return {
    id: 'test',
    modelUrl: '',
    animationUrls: [],
    stateMap: {
      idle: { clip: 'Idle_Loop', loop: true },
      jump: { clip: 'Jump_Start', loop: false },
      land: { clip: 'Jump_Land', loop: false },
    },
    locomotion: {
      walk: 'Walk_Loop',
      jog: 'Jog_Fwd_Loop',
      sprint: 'Sprint_Loop',
      thresholds: [2.0, 4.0] as [number, number],
    },
    deathClip: 'Death01',
    throwClip: 'OverhandThrow',
    ...overrides,
  };
}

const ALL_CLIPS = [
  'Idle_Loop', 'Jump_Start', 'Jump_Land',
  'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Death01', 'OverhandThrow',
];

describe('AnimationController', () => {
  it('resolves all profile clip names from model', () => {
    const model = makeModel(ALL_CLIPS);
    const profile = makeProfile();

    // Should not throw or warn
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctrl = new AnimationController(model, profile);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    ctrl.dispose();
  });

  it('warns on missing clip', () => {
    const model = makeModel(['Idle_Loop']); // missing most clips
    const profile = makeProfile();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctrl = new AnimationController(model, profile);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    ctrl.dispose();
  });

  it('does not grow mixer action cache on repeated one-shots', () => {
    const model = makeModel(ALL_CLIPS);
    const profile = makeProfile();
    const ctrl = new AnimationController(model, profile);

    // Play the same one-shot 10 times
    for (let i = 0; i < 10; i++) {
      ctrl.playOneShot('OverhandThrow', 0);
      ctrl.update(0.5); // advance half the clip
    }

    // Access mixer stats — actions.inUse should be bounded
    const mixer = (ctrl as any).mixer as THREE.AnimationMixer;
    // One-shot creates exactly 1 cached action for 'OverhandThrow'
    // Total should be: stateMap (3) + loco (3) + oneShot (1) = 7
    // Some may be inactive but total cached should not exceed expected
    const totalActions = mixer.stats.actions.total;
    expect(totalActions).toBeLessThanOrEqual(10);

    ctrl.dispose();
  });

  it('fires finished event and sets clipFinished', () => {
    const model = makeModel(ALL_CLIPS);
    const profile = makeProfile();
    const ctrl = new AnimationController(model, profile);

    ctrl.playOneShot('OverhandThrow', 0);
    expect(ctrl.isClipFinished()).toBe(false);

    // Advance past clip duration to trigger finished event
    ctrl.update(1.1);

    expect(ctrl.isClipFinished()).toBe(true);

    ctrl.dispose();
  });

  it('cycles through states without errors', () => {
    const model = makeModel(ALL_CLIPS);
    const profile = makeProfile();
    const ctrl = new AnimationController(model, profile);

    const states = ['idle', 'move', 'jump', 'air', 'land', 'idle'] as const;
    for (const state of states) {
      ctrl.setState(state);
      ctrl.update(0.016);
    }

    ctrl.dispose();
  });

  it('additive one-shot survives state transitions', () => {
    const model = makeModel(ALL_CLIPS);
    const profile = makeProfile({
      additiveOneShots: ['OverhandThrow'],
    });
    const ctrl = new AnimationController(model, profile);

    ctrl.setState('move' as any);
    ctrl.setSpeed(3.0);
    ctrl.update(0.016);

    // Play additive one-shot
    ctrl.playOneShot('OverhandThrow', 0);

    const additiveAction = (ctrl as any).additiveAction as THREE.AnimationAction;
    expect(additiveAction).not.toBeNull();

    // setState should NOT be blocked AND should NOT fade out the additive overlay
    ctrl.setState('idle' as any);
    expect((ctrl as any).currentState).toBe('idle');
    // additiveAction should still be alive (not nulled by setState)
    expect((ctrl as any).additiveAction).toBe(additiveAction);
    expect(additiveAction.getEffectiveWeight()).toBeGreaterThan(0);

    ctrl.dispose();
  });

  it('fires animation event markers at correct time', () => {
    const model = makeModel(ALL_CLIPS);
    const profile = makeProfile({
      animationEvents: {
        OverhandThrow: [{ time: 0.35, event: 'release' }],
      },
    });
    const ctrl = new AnimationController(model, profile);

    const events: string[] = [];
    ctrl.setEventListener({
      onActionEvent: (_clip, event) => events.push(event),
    });

    ctrl.playOneShot('OverhandThrow', 0);
    ctrl.update(0.2); // before marker
    expect(events).toHaveLength(0);

    ctrl.update(0.2); // past 0.35
    expect(events).toEqual(['release']);

    // Should not fire again
    ctrl.update(0.2);
    expect(events).toEqual(['release']);

    ctrl.dispose();
  });

  it('fires animation event markers on additive one-shots', () => {
    const model = makeModel(ALL_CLIPS);
    const profile = makeProfile({
      additiveOneShots: ['OverhandThrow'],
      animationEvents: {
        OverhandThrow: [{ time: 0.35, event: 'release' }],
      },
    });
    const ctrl = new AnimationController(model, profile);

    const events: string[] = [];
    ctrl.setEventListener({
      onActionEvent: (_clip, event) => events.push(event),
    });

    ctrl.playOneShot('OverhandThrow', 0);
    ctrl.update(0.2);
    expect(events).toHaveLength(0);

    ctrl.update(0.2); // past 0.35
    expect(events).toEqual(['release']);

    ctrl.dispose();
  });

  it('forward alignment scales locomotion timeScale', () => {
    const model = makeModel(ALL_CLIPS);
    const profile = makeProfile();
    const ctrl = new AnimationController(model, profile);

    ctrl.setState('move' as any);
    ctrl.setForwardAlignment(0.5);
    ctrl.setSpeed(3.0); // setSpeed applies alignment factor to timeScale
    ctrl.update(0.016);

    const locoWalk = (ctrl as any).locoWalk as THREE.AnimationAction;
    // timeScale should be reduced by alignment factor
    expect(locoWalk.timeScale).toBeLessThan(3.0 / 1.5); // would be 2.0 without alignment
    expect(locoWalk.timeScale).toBeCloseTo(0.5 * 3.0 / 1.5, 1); // ~1.0

    ctrl.dispose();
  });

  it('setGrabSpeed drives timeScale: positive=push, negative=pull, zero=brace', () => {
    const model = makeModel(ALL_CLIPS);
    const profile = makeProfile();
    const ctrl = new AnimationController(model, profile);

    // Enter grab state
    ctrl.setState('grab' as any);
    ctrl.update(0.016);

    // Push: positive speed → positive timeScale
    ctrl.setGrabSpeed(2.0);
    const action = (ctrl as any).currentAction as THREE.AnimationAction;
    expect(action.timeScale).toBeGreaterThan(0);

    // Pull: negative speed → negative timeScale (reverse playback)
    ctrl.setGrabSpeed(-2.0);
    expect(action.timeScale).toBeLessThan(0);

    // Brace: near-zero speed → frozen
    ctrl.setGrabSpeed(0.05);
    expect(action.timeScale).toBe(0);

    ctrl.dispose();
  });

  it('spawn resets FSM to idle (regression: die while grab/carry)', () => {
    const model = makeModel(ALL_CLIPS);
    const profile = makeProfile();
    const ctrl = new AnimationController(model, profile);

    ctrl.setState('grab' as any);
    ctrl.update(0.016);
    expect((ctrl as any).currentState).toBe('grab');

    // Simulate what spawn() does: resetOneShot + setState(idle)
    ctrl.resetOneShot();
    ctrl.setState('idle' as any);
    expect((ctrl as any).currentState).toBe('idle');

    ctrl.dispose();
  });
});
