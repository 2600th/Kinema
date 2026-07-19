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
  it("disposes an adopted clone and resets the tool when preview material preparation fails", async () => {
    const transient = { scene: new THREE.Group(), animations: [] };
    const adoptedScene = new THREE.Group();
    const adoptedMaterial = new THREE.MeshStandardMaterial();
    Object.defineProperty(adoptedMaterial, "transparent", {
      configurable: true,
      set: () => {
        throw new Error("preview material preparation failed");
      },
    });
    adoptedScene.add(new THREE.Mesh(new THREE.BoxGeometry(), adoptedMaterial));
    const disposeObject = vi.fn();
    const assetLoader = {
      loadTransient: vi.fn().mockResolvedValue(transient),
      disposeTransient: vi.fn(),
      adopt: vi.fn().mockReturnValue({ scene: adoptedScene, animations: [] }),
      disposeObject,
    };
    installObjectURLMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onFinished = vi.fn();
    const onImported = vi.fn();
    const onError = vi.fn();
    const tool = new GLBPlacementTool({
      levelManager: { getAssetLoader: () => assetLoader } as unknown as LevelManager,
      onFinished,
      onImported,
      onError,
    });
    const context = makeContext();

    await tool.importFile(context, { name: "BrokenPreview.glb" } as File);

    expect(disposeObject).toHaveBeenCalledOnce();
    expect(disposeObject).toHaveBeenCalledWith(adoptedScene);
    expect(context.scene.children).not.toContain(adoptedScene);
    expect(tool.isPlacing()).toBe(false);
    expect(onImported).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/could not be prepared/i));
    expect(onFinished).toHaveBeenCalledOnce();
  });

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

  it.each([
    "descriptor",
    "body",
    "collider",
    "material",
    "publication",
  ] as const)("aborts and disposes the owned preview without publishing when %s finalization fails", (failure) => {
    const body = { id: "new-body" };
    const removeBody = vi.fn();
    const historyPush = vi.fn((command: { execute(): void }) => {
      if (failure === "publication") command.execute();
    });
    const disposeObject = vi.fn();
    const rollbackEditorObject = vi.fn();
    const onFinished = vi.fn();
    const onError = vi.fn();
    const scene = new THREE.Scene();
    const preview = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    if (failure === "material") {
      Object.defineProperty(material, "transparent", {
        configurable: true,
        set: () => {
          throw new Error("forced GLB material failure");
        },
      });
    }
    preview.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    if (failure === "descriptor") {
      preview.updateWorldMatrix = () => {
        throw new Error("forced GLB descriptor failure");
      };
    }
    scene.add(preview);
    const context = {
      scene,
      physicsWorld: {
        world: {
          createRigidBody: vi.fn(() => {
            if (failure === "body") throw new Error("forced GLB body failure");
            return body;
          }),
          createCollider: vi.fn(() => {
            if (failure === "collider") throw new Error("forced GLB collider failure");
            return { id: "collider" };
          }),
        },
        removeBody,
      },
      history: { push: historyPush },
      addEditorObject: vi.fn(() => {
        if (failure === "publication") throw new Error("forced GLB publication failure");
      }),
      rollbackEditorObject,
    } as unknown as EditorToolContext;
    const tool = new GLBPlacementTool({
      levelManager: { getAssetLoader: () => ({ disposeObject }) } as unknown as LevelManager,
      onFinished,
      onImported: vi.fn(),
      onError,
    });
    const internals = tool as unknown as {
      glbPreview: THREE.Group | null;
      pendingGLBAsset: string | null;
      placementPhase: "idle" | "position";
    };
    internals.glbPreview = preview;
    internals.pendingGLBAsset = "/assets/models/failure.glb";
    internals.placementPhase = "position";

    expect(() => tool.onPointerDown(context, { button: 0 } as MouseEvent)).not.toThrow();

    if (failure === "collider" || failure === "material") expect(removeBody).toHaveBeenCalledWith(body);
    else expect(removeBody).not.toHaveBeenCalled();
    if (failure === "publication") {
      expect(historyPush).toHaveBeenCalledOnce();
      expect(rollbackEditorObject).toHaveBeenCalledOnce();
    } else {
      expect(historyPush).not.toHaveBeenCalled();
      expect(rollbackEditorObject).not.toHaveBeenCalled();
    }
    expect(scene.children).not.toContain(preview);
    expect(disposeObject).toHaveBeenCalledWith(preview);
    expect(tool.isPlacing()).toBe(false);
    expect(internals.pendingGLBAsset).toBeNull();
    expect(onFinished).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/could not be placed/i));
  });
});
