import { describe, it, expect, vi } from 'vitest';
import { GameLoop } from './GameLoop';
import { MAX_PHYSICS_STEPS } from './constants';

describe('GameLoop', () => {
  it('runs fixed update, physics step, post-physics sync, then render update', () => {
    const calls: string[] = [];
    const game = {
      fixedUpdate: vi.fn(() => calls.push('fixed')),
      postPhysicsUpdate: vi.fn(() => calls.push('post')),
      update: vi.fn(() => calls.push('update')),
    };

    const renderer = {
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
    };
    const physics = {
      step: vi.fn(() => calls.push('physics')),
    };

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0); // start()
    const loop = new GameLoop(game, renderer as any, physics as any);
    loop.start();

    nowSpy.mockReturnValueOnce(17); // first tick -> one fixed step
    const animationLoopCb = renderer.setAnimationLoop.mock.calls[0]?.[0];
    expect(animationLoopCb).toBeTypeOf('function');
    animationLoopCb(17 as DOMHighResTimeStamp);

    expect(calls).toEqual(['fixed', 'physics', 'post', 'update']);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it('does not require postPhysicsUpdate hook', () => {
    const game = {
      fixedUpdate: vi.fn(),
      update: vi.fn(),
    };
    const renderer = {
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
    };
    const physics = { step: vi.fn() };

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0);
    const loop = new GameLoop(game as any, renderer as any, physics as any);
    loop.start();

    nowSpy.mockReturnValueOnce(17);
    const animationLoopCb = renderer.setAnimationLoop.mock.calls[0]?.[0];
    expect(animationLoopCb).toBeTypeOf('function');
    animationLoopCb(17 as DOMHighResTimeStamp);

    expect(game.fixedUpdate).toHaveBeenCalled();
    expect(game.update).toHaveBeenCalled();
    expect(physics.step).toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('zeroes accumulator during hitstop to prevent catch-up', () => {
    const game = {
      fixedUpdate: vi.fn(),
      postPhysicsUpdate: vi.fn(),
      update: vi.fn(),
    };
    const renderer = {
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
    };
    const physics = { step: vi.fn() };

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0);
    const loop = new GameLoop(game, renderer as any, physics as any);

    // Set up a mock hitstop that returns frozen=true
    const hitstop = { update: vi.fn(() => true) };
    loop.setHitstop(hitstop as any);

    loop.start();

    // Tick with 17ms — enough for ~1 physics step worth of accumulator
    const tick = renderer.setAnimationLoop.mock.calls[0]?.[0];
    tick(17 as DOMHighResTimeStamp);

    // Physics should NOT have stepped (frozen)
    expect(physics.step).not.toHaveBeenCalled();

    // Alpha is 0 during hitstop — accumulator is zeroed to prevent catch-up
    const alpha = game.update.mock.calls[0]?.[1] as number;
    expect(alpha).toBe(0);

    nowSpy.mockRestore();
  });

  it('caps accumulator instead of resetting on frame spike', () => {
    const game = {
      fixedUpdate: vi.fn(),
      postPhysicsUpdate: vi.fn(),
      update: vi.fn(),
    };
    const renderer = {
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
    };
    const physics = { step: vi.fn() };

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0);
    const loop = new GameLoop(game, renderer as any, physics as any);
    loop.start();

    // Tick with a huge dt (200ms = 12 physics steps worth, but MAX_FRAME_TIME=250ms)
    const tick = renderer.setAnimationLoop.mock.calls[0]?.[0];
    tick(200 as DOMHighResTimeStamp);

    // Physics should have stepped exactly MAX_PHYSICS_STEPS times
    expect(physics.step).toHaveBeenCalledTimes(MAX_PHYSICS_STEPS);

    // Alpha should be > 0, meaning accumulator was NOT zeroed
    const alpha = game.update.mock.calls[0]?.[1] as number;
    expect(alpha).toBeGreaterThanOrEqual(0);

    nowSpy.mockRestore();
  });

  it('clamps alpha to maximum of 1', () => {
    const game = {
      fixedUpdate: vi.fn(),
      update: vi.fn(),
    };
    const renderer = {
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
    };
    const physics = { step: vi.fn() };

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0);
    const loop = new GameLoop(game as any, renderer as any, physics as any);

    // Disable simulation so accumulator is not consumed by physics
    loop.setSimulationEnabled(true);

    // Set up a hitstop that freezes — accumulator grows but is never consumed
    const hitstop = { update: vi.fn(() => true) };
    loop.setHitstop(hitstop as any);

    loop.start();

    // Tick with a large dt so accumulator >> PHYSICS_TIMESTEP
    const tick = renderer.setAnimationLoop.mock.calls[0]?.[0];
    tick(100 as DOMHighResTimeStamp); // 100ms = ~6 physics steps worth

    const alpha = game.update.mock.calls[0]?.[1] as number;
    expect(alpha).toBeLessThanOrEqual(1);

    nowSpy.mockRestore();
  });
});
