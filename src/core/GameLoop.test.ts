import { describe, it, expect, vi } from 'vitest';
import { GameLoop } from './GameLoop';

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
});
