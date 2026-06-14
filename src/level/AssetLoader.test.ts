import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetLoader } from "./AssetLoader";

const loaderMocks = vi.hoisted(() => ({
  loadAsync: vi.fn(),
}));

vi.mock("three/addons/loaders/DRACOLoader.js", () => ({
  DRACOLoader: class {
    setDecoderPath = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("three/addons/loaders/KTX2Loader.js", () => ({
  KTX2Loader: class {
    setTranscoderPath = vi.fn();
    detectSupport = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setDRACOLoader = vi.fn();
    setKTX2Loader = vi.fn();
    loadAsync = loaderMocks.loadAsync;
  },
}));

describe("AssetLoader", () => {
  beforeEach(() => {
    loaderMocks.loadAsync.mockReset();
  });

  it("deduplicates concurrent requests for the same GLB", async () => {
    let resolveLoad: (value: any) => void = () => {};
    loaderMocks.loadAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const loader = new AssetLoader();
    const sourceScene = new THREE.Group();

    const first = loader.load("/assets/models/npc.glb");
    const second = loader.load("/assets/models/npc.glb");
    resolveLoad({ scene: sourceScene, animations: [] });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(loaderMocks.loadAsync).toHaveBeenCalledTimes(1);
    expect(firstResult.scene).not.toBe(sourceScene);
    expect(secondResult.scene).not.toBe(sourceScene);
    expect(firstResult.scene).not.toBe(secondResult.scene);
  });
});
