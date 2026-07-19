import type { LevelManager } from "@level/LevelManager";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorToolContext } from "./EditorTool";
import { GLBPlacementTool } from "./GLBPlacementTool";

function makeContext(): EditorToolContext {
  return {
    scene: new THREE.Scene(),
  } as unknown as EditorToolContext;
}

function installObjectURLMocks(): { create: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> } {
  const create = vi.fn(() => "blob:kinema-test");
  const revoke = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: create,
    revokeObjectURL: revoke,
  });
  return { create, revoke };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GLBPlacementTool import boundaries", () => {
  it("announces a successful import after caching and starting placement", async () => {
    const gltf = { scene: new THREE.Group(), animations: [] };
    const load = vi.fn().mockResolvedValue(gltf);
    const put = vi.fn();
    const onImported = vi.fn();
    const { revoke } = installObjectURLMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tool = new GLBPlacementTool({
      levelManager: { getAssetLoader: () => ({ load, put }) } as unknown as LevelManager,
      onFinished: vi.fn(),
      onImported,
    });

    await tool.importFile(makeContext(), { name: "Test.glb" } as File);

    expect(load).toHaveBeenCalledWith("blob:kinema-test");
    expect(put).toHaveBeenCalledWith("/assets/models/Test.glb", gltf);
    expect(tool.isPlacing()).toBe(true);
    expect(onImported).toHaveBeenCalledOnce();
    expect(onImported).toHaveBeenCalledWith("/assets/models/Test.glb");
    expect(revoke).toHaveBeenCalledWith("blob:kinema-test");
  });

  it("does not announce or cache a rejected import", async () => {
    const load = vi.fn().mockRejectedValue(new Error("invalid GLB"));
    const put = vi.fn();
    const onImported = vi.fn();
    const { revoke } = installObjectURLMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tool = new GLBPlacementTool({
      levelManager: { getAssetLoader: () => ({ load, put }) } as unknown as LevelManager,
      onFinished: vi.fn(),
      onImported,
    });

    await tool.importFile(makeContext(), { name: "Broken.glb" } as File);

    expect(put).not.toHaveBeenCalled();
    expect(tool.isPlacing()).toBe(false);
    expect(onImported).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:kinema-test");
  });
});
