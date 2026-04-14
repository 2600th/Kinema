import type { Hitstop } from "@juice/Hitstop";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type { RendererManager } from "@renderer/RendererManager";
import { describe, expect, it, vi } from "vitest";
import { MAX_PHYSICS_STEPS } from "./constants";
import { GameLoop } from "./GameLoop";
import type { FixedUpdatable, PostPhysicsUpdatable, Updatable } from "./types";

type MockFn = ReturnType<typeof vi.fn>;
type RuntimeGame = FixedUpdatable & Updatable & Partial<PostPhysicsUpdatable>;
type TestGame = {
  fixedUpdate: MockFn;
  update: MockFn;
  postPhysicsUpdate?: MockFn;
};
type TestRenderer = {
  setAnimationLoop: MockFn;
  render: MockFn;
};
type TestPhysics = {
  step: MockFn;
};
type TestHitstop = {
  update: MockFn;
};

function asRuntimeGame(game: TestGame): RuntimeGame {
  return game as unknown as RuntimeGame;
}

function asRendererManager(renderer: TestRenderer): RendererManager {
  return renderer as unknown as RendererManager;
}

function asPhysicsWorld(physics: TestPhysics): PhysicsWorld {
  return physics as unknown as PhysicsWorld;
}

function asHitstop(hitstop: TestHitstop): Hitstop {
  return hitstop as unknown as Hitstop;
}

function getAnimationLoopCallback(renderer: TestRenderer): (time: DOMHighResTimeStamp) => void {
  const callback = renderer.setAnimationLoop.mock.calls[0]?.[0];
  expect(callback).toBeTypeOf("function");
  if (typeof callback !== "function") {
    throw new Error("Expected animation loop callback to be registered.");
  }
  return callback as (time: DOMHighResTimeStamp) => void;
}

function getRenderedAlpha(game: TestGame): number {
  const alpha = game.update.mock.calls[0]?.[1];
  expect(alpha).toBeTypeOf("number");
  if (typeof alpha !== "number") {
    throw new Error("Expected update to receive an alpha interpolation value.");
  }
  return alpha;
}

describe("GameLoop", () => {
  it("runs fixed update, physics step, post-physics sync, then render update", () => {
    const calls: string[] = [];
    const game: TestGame = {
      fixedUpdate: vi.fn(() => calls.push("fixed")),
      postPhysicsUpdate: vi.fn(() => calls.push("post")),
      update: vi.fn(() => calls.push("update")),
    };
    const renderer: TestRenderer = {
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
    };
    const physics: TestPhysics = {
      step: vi.fn(() => calls.push("physics")),
    };

    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(0);
    const loop = new GameLoop(asRuntimeGame(game), asRendererManager(renderer), asPhysicsWorld(physics));
    loop.start();

    nowSpy.mockReturnValueOnce(17);
    getAnimationLoopCallback(renderer)(17 as DOMHighResTimeStamp);

    expect(calls).toEqual(["fixed", "physics", "post", "update"]);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it("does not require postPhysicsUpdate hook", () => {
    const game: TestGame = {
      fixedUpdate: vi.fn(),
      update: vi.fn(),
    };
    const renderer: TestRenderer = {
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
    };
    const physics: TestPhysics = {
      step: vi.fn(),
    };

    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(0);
    const loop = new GameLoop(asRuntimeGame(game), asRendererManager(renderer), asPhysicsWorld(physics));
    loop.start();

    nowSpy.mockReturnValueOnce(17);
    getAnimationLoopCallback(renderer)(17 as DOMHighResTimeStamp);

    expect(game.fixedUpdate).toHaveBeenCalled();
    expect(game.update).toHaveBeenCalled();
    expect(physics.step).toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it("zeroes accumulator during hitstop to prevent catch-up", () => {
    const game: TestGame = {
      fixedUpdate: vi.fn(),
      postPhysicsUpdate: vi.fn(),
      update: vi.fn(),
    };
    const renderer: TestRenderer = {
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
    };
    const physics: TestPhysics = {
      step: vi.fn(),
    };
    const hitstop: TestHitstop = {
      update: vi.fn(() => true),
    };

    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(0);
    const loop = new GameLoop(asRuntimeGame(game), asRendererManager(renderer), asPhysicsWorld(physics));
    loop.setHitstop(asHitstop(hitstop));
    loop.start();

    getAnimationLoopCallback(renderer)(17 as DOMHighResTimeStamp);

    expect(physics.step).not.toHaveBeenCalled();
    expect(getRenderedAlpha(game)).toBe(0);
    nowSpy.mockRestore();
  });

  it("caps accumulator instead of resetting on frame spike", () => {
    const game: TestGame = {
      fixedUpdate: vi.fn(),
      postPhysicsUpdate: vi.fn(),
      update: vi.fn(),
    };
    const renderer: TestRenderer = {
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
    };
    const physics: TestPhysics = {
      step: vi.fn(),
    };

    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(0);
    const loop = new GameLoop(asRuntimeGame(game), asRendererManager(renderer), asPhysicsWorld(physics));
    loop.start();

    getAnimationLoopCallback(renderer)(200 as DOMHighResTimeStamp);

    expect(physics.step).toHaveBeenCalledTimes(MAX_PHYSICS_STEPS);
    expect(getRenderedAlpha(game)).toBeGreaterThanOrEqual(0);
    nowSpy.mockRestore();
  });

  it("clamps alpha to maximum of 1", () => {
    const game: TestGame = {
      fixedUpdate: vi.fn(),
      update: vi.fn(),
    };
    const renderer: TestRenderer = {
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
    };
    const physics: TestPhysics = {
      step: vi.fn(),
    };
    const hitstop: TestHitstop = {
      update: vi.fn(() => true),
    };

    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(0);
    const loop = new GameLoop(asRuntimeGame(game), asRendererManager(renderer), asPhysicsWorld(physics));
    loop.setSimulationEnabled(true);
    loop.setHitstop(asHitstop(hitstop));
    loop.start();

    getAnimationLoopCallback(renderer)(100 as DOMHighResTimeStamp);

    expect(getRenderedAlpha(game)).toBeLessThanOrEqual(1);
    nowSpy.mockRestore();
  });
});
