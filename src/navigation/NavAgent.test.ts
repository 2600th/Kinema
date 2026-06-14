import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavAgent } from "./NavAgent";

let resolveCharacter: (value: { model: any; animator: any }) => void;

vi.mock("@character/animation/CharacterFactory", () => ({
  createAnimatedCharacter: vi.fn(
    () =>
      new Promise((resolve) => {
        resolveCharacter = resolve;
      }),
  ),
}));

describe("NavAgent", () => {
  beforeEach(() => {
    resolveCharacter = () => {};
  });

  it("disposes a model that finishes loading after the agent was disposed", async () => {
    const scene = new THREE.Scene();
    const agent = new NavAgent(scene, new THREE.Vector3(0, 0, 0));
    const model = {
      root: new THREE.Group(),
      dispose: vi.fn(),
    };
    const animator = {
      dispose: vi.fn(),
      update: vi.fn(),
      setState: vi.fn(),
      setSpeed: vi.fn(),
    };

    const initPromise = agent.init({} as any);
    agent.dispose(scene);
    resolveCharacter({ model, animator });
    await initPromise;

    expect(model.dispose).toHaveBeenCalledTimes(1);
    expect(animator.dispose).toHaveBeenCalledTimes(1);
    expect((agent as any).characterModel).toBeNull();
    expect((agent as any).animator).toBeNull();
  });
});
