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
    const ownedGLTF = { scene: new THREE.Group(), animations: [] };
    const loadTransient = vi.fn().mockResolvedValue(gltf);
    const disposeTransient = vi.fn();
    const adopt = vi.fn().mockReturnValue(ownedGLTF);
    const onImported = vi.fn();
    const { revoke } = installObjectURLMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tool = new GLBPlacementTool({
      levelManager: { getAssetLoader: () => ({ loadTransient, disposeTransient, adopt }) } as unknown as LevelManager,
      onFinished: vi.fn(),
      onImported,
    });

    await tool.importFile(makeContext(), { name: "Test.glb" } as File);

    expect(loadTransient).toHaveBeenCalledWith("blob:kinema-test");
    expect(adopt).toHaveBeenCalledWith("/assets/models/Test.glb", gltf);
    expect(tool.isPlacing()).toBe(true);
    expect(onImported).toHaveBeenCalledOnce();
    expect(onImported).toHaveBeenCalledWith("/assets/models/Test.glb");
    expect(revoke).toHaveBeenCalledWith("blob:kinema-test");
    expect(disposeTransient).not.toHaveBeenCalled();
  });

  it("cancels an accepted preview without disposing canonical cache geometry or materials", async () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geometry, material));
    const gltf = { scene, animations: [] };
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const loadTransient = vi.fn().mockResolvedValue(gltf);
    const instanceGeometry = geometry.clone();
    const instanceMaterial = material.clone();
    const instanceScene = new THREE.Group();
    instanceScene.add(new THREE.Mesh(instanceGeometry, instanceMaterial));
    const assetLoader = {
      loadTransient,
      adopt: vi.fn().mockReturnValue({ scene: instanceScene, animations: [] }),
      disposeTransient: vi.fn(),
      disposeObject: vi.fn((root: THREE.Object3D) => {
        root.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const entry of materials) entry.dispose();
          }
        });
      }),
    };
    installObjectURLMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tool = new GLBPlacementTool({
      levelManager: { getAssetLoader: () => assetLoader } as unknown as LevelManager,
      onFinished: vi.fn(),
      onImported: vi.fn(),
    });
    const ctx = makeContext();

    await tool.importFile(ctx, { name: "Owned.glb" } as File);
    tool.cancelPlacement(ctx);

    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
  });

  it("does not announce or cache a rejected import", async () => {
    const loadTransient = vi.fn().mockRejectedValue(new Error("invalid GLB"));
    const disposeTransient = vi.fn();
    const adopt = vi.fn();
    const onImported = vi.fn();
    const { revoke } = installObjectURLMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tool = new GLBPlacementTool({
      levelManager: { getAssetLoader: () => ({ loadTransient, disposeTransient, adopt }) } as unknown as LevelManager,
      onFinished: vi.fn(),
      onImported,
    });

    await tool.importFile(makeContext(), { name: "Broken.glb" } as File);

    expect(adopt).not.toHaveBeenCalled();
    expect(tool.isPlacing()).toBe(false);
    expect(onImported).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:kinema-test");
  });

  it("drops a completed import when a newer editor lifecycle supersedes it", async () => {
    let resolveLoad!: (value: { scene: THREE.Group; animations: never[] }) => void;
    const loadTransient = vi.fn(
      () =>
        new Promise<{ scene: THREE.Group; animations: never[] }>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const adopt = vi.fn();
    const disposeTransient = vi.fn();
    const onImported = vi.fn();
    let lifecycleGeneration = 4;
    installObjectURLMocks();
    const tool = new GLBPlacementTool({
      levelManager: { getAssetLoader: () => ({ loadTransient, disposeTransient, adopt }) } as unknown as LevelManager,
      onFinished: vi.fn(),
      onImported,
      getLifecycleGeneration: () => lifecycleGeneration,
    });

    const pending = tool.importFile(makeContext(), { name: "Stale.glb" } as File);
    lifecycleGeneration++;
    resolveLoad({ scene: new THREE.Group(), animations: [] });
    await pending;

    expect(adopt).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(tool.isPlacing()).toBe(false);
    expect(disposeTransient).toHaveBeenCalledOnce();
  });

  it("drops a completed import after explicit tool cancellation", async () => {
    let resolveLoad!: (value: { scene: THREE.Group; animations: never[] }) => void;
    const loadTransient = vi.fn(
      () =>
        new Promise<{ scene: THREE.Group; animations: never[] }>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const adopt = vi.fn();
    const disposeTransient = vi.fn();
    const onImported = vi.fn();
    installObjectURLMocks();
    const tool = new GLBPlacementTool({
      levelManager: { getAssetLoader: () => ({ loadTransient, disposeTransient, adopt }) } as unknown as LevelManager,
      onFinished: vi.fn(),
      onImported,
      getLifecycleGeneration: () => 9,
    });

    const pending = tool.importFile(makeContext(), { name: "Cancelled.glb" } as File);
    tool.cancelPendingImport(makeContext());
    resolveLoad({ scene: new THREE.Group(), animations: [] });
    await pending;

    expect(adopt).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(tool.isPlacing()).toBe(false);
    expect(disposeTransient).toHaveBeenCalledOnce();
  });

  it("removes a newly created body and leaves history untouched when collider creation fails", () => {
    const body = { id: "new-body" };
    const removeBody = vi.fn();
    const historyPush = vi.fn();
    const scene = new THREE.Scene();
    const preview = new THREE.Group();
    preview.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    scene.add(preview);
    const context = {
      scene,
      physicsWorld: {
        world: {
          createRigidBody: vi.fn(() => body),
          createCollider: vi.fn(() => {
            throw new Error("forced GLB collider failure");
          }),
        },
        removeBody,
      },
      history: { push: historyPush },
    } as unknown as EditorToolContext;
    const tool = new GLBPlacementTool({
      levelManager: { getAssetLoader: () => ({ disposeObject: vi.fn() }) } as unknown as LevelManager,
      onFinished: vi.fn(),
      onImported: vi.fn(),
    });
    const internals = tool as unknown as {
      glbPreview: THREE.Group | null;
      pendingGLBAsset: string | null;
      placementPhase: "idle" | "position";
    };
    internals.glbPreview = preview;
    internals.pendingGLBAsset = "/assets/models/failure.glb";
    internals.placementPhase = "position";

    expect(() => tool.onPointerDown(context, { button: 0 } as MouseEvent)).toThrow("forced GLB collider failure");

    expect(removeBody).toHaveBeenCalledOnce();
    expect(removeBody).toHaveBeenCalledWith(body);
    expect(historyPush).not.toHaveBeenCalled();
  });
});
