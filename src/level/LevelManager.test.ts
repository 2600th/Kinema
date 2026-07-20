import type { EventBus } from "@core/EventBus";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LevelManager } from "./LevelManager";

describe("LevelManager spawn handling", () => {
  const defaultSpawn = new THREE.Vector3(0, 2, 0);
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("resets spawn to default before loading GLTF levels", async () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    const staleSpawn = new THREE.Vector3(9, 9, 9);
    (manager as any).spawnPoint = { position: staleSpawn };

    vi.spyOn(manager as any, "loadGLTF").mockResolvedValue(undefined);
    await manager.load("custom-level");

    expect(manager.getSpawnPoint().position.equals(defaultSpawn)).toBe(true);
  });

  it("resets spawn to default on unload", () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    (manager as any).spawnPoint = { position: new THREE.Vector3(4, 7, -2) };
    (manager as any).currentLevelName = "custom-level";

    expect(manager.getCurrentLevelName()).toBe("custom-level");

    manager.unload();

    expect(manager.getSpawnPoint().position.equals(defaultSpawn)).toBe(true);
    expect(manager.getCurrentLevelName()).toBeNull();
  });
});

describe("LevelManager editor metadata for JSON GLBs", () => {
  function makeManager(): LevelManager {
    return new LevelManager(
      new THREE.Scene(),
      { world: {}, removeCollider: vi.fn(), removeBody: vi.fn() } as unknown as PhysicsWorld,
      { emit: vi.fn() } as unknown as EventBus,
    );
  }

  const entry = {
    id: "glb-root",
    name: "Imported model",
    parentId: null,
    source: { type: "glb" as const, asset: "/assets/models/Missing.glb" },
    transform: {
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    },
    physics: { type: "static" as const },
  };

  it("restores source metadata on a successful GLB root", async () => {
    const manager = makeManager();
    const internals = manager as unknown as {
      loadGLBObject(assetPath: string): Promise<THREE.Object3D | null>;
      spawnJSONObject(json: typeof entry): Promise<{ obj: THREE.Object3D } | null>;
    };
    vi.spyOn(internals, "loadGLBObject").mockResolvedValue(new THREE.Group());

    const spawned = await internals.spawnJSONObject(entry);

    expect(spawned).not.toBeNull();
    if (!spawned) throw new Error("Expected successful GLB root");
    expect(spawned.obj.userData.editorSource).toEqual(entry.source);
    expect(spawned.obj.userData.editorSource).not.toBe(entry.source);
  });

  it("tags a missing GLB placeholder and restores its source metadata", async () => {
    const manager = makeManager();
    const internals = manager as unknown as {
      spawnJSONObject(json: typeof entry): Promise<{ obj: THREE.Object3D } | null>;
    };
    vi.spyOn(manager.getAssetLoader(), "load").mockRejectedValue(new Error("missing"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const spawned = await internals.spawnJSONObject(entry);

    expect(spawned).not.toBeNull();
    if (!spawned) throw new Error("Expected missing GLB placeholder");
    const placeholder = spawned.obj as THREE.Mesh;
    expect(placeholder.userData.editorMissingAssetPath).toBe("/assets/models/Missing.glb");
    expect(placeholder.userData.editorSource).toEqual(entry.source);
  });

  it("preserves an already-canonical session import across runtime unload for editor restore", async () => {
    const manager = makeManager();
    const assetPath = "/assets/models/SessionOwned.glb";
    manager.getAssetLoader().put(assetPath, { scene: new THREE.Group(), animations: [] } as any);
    const internals = manager as unknown as { loadGLBObject(path: string): Promise<THREE.Object3D | null> };

    await internals.loadGLBObject(assetPath);
    (manager as any).currentLevelName = "playtest";
    manager.unload();

    expect(manager.getAssetLoader().has(assetPath)).toBe(true);
  });
});

describe("LevelManager transactional editor JSON loading", () => {
  const baseLevel = {
    version: 2 as const,
    name: "replacement",
    created: "2026-07-19T00:00:00.000Z",
    modified: "2026-07-19T00:00:00.000Z",
    spawnPoint: { position: [0, 2, 0] as [number, number, number] },
  };

  it("rejects malformed inherited moving-body scale before unloading the current level", async () => {
    const scene = new THREE.Scene();
    const oldRoot = new THREE.Group();
    oldRoot.name = "CurrentRoot";
    scene.add(oldRoot);
    const physicsWorld = { world: {}, removeCollider: vi.fn(), removeBody: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, { emit: vi.fn() } as any);
    (manager as any).currentLevelName = "current";
    (manager as any).currentLevelOrigin = "authored";
    (manager as any).currentLevelKind = "authored";
    (manager as any).levelObjects = [oldRoot];

    await expect(
      manager.loadFromJSON({
        ...baseLevel,
        objects: [
          {
            id: "parent",
            name: "Parent",
            parentId: null,
            source: { type: "primitive", primitive: "group" },
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 0.5] },
            physics: { type: "static" },
          },
          {
            id: "child",
            name: "Child",
            parentId: "parent",
            source: { type: "primitive", primitive: "cube" },
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            physics: { type: "dynamic" },
          },
        ],
      }),
    ).rejects.toThrow(/non-uniform/i);

    expect(manager.getCurrentLevelName()).toBe("current");
    expect(manager.getLevelObjects()).toEqual([oldRoot]);
    expect(scene.children).toContain(oldRoot);
    expect(physicsWorld.removeBody).not.toHaveBeenCalled();
  });

  it("rolls back visuals and a newly created body when collider creation throws", async () => {
    const scene = new THREE.Scene();
    const body = {};
    const physicsWorld = {
      world: {
        createRigidBody: vi.fn(() => body),
        createCollider: vi.fn(() => {
          throw new Error("forced collider failure");
        }),
      },
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const manager = new LevelManager(scene, physicsWorld as any, { emit: vi.fn() } as any);
    vi.spyOn(manager as any, "addLighting").mockImplementation(() => {});

    await expect(
      manager.loadFromJSON({
        ...baseLevel,
        objects: [
          {
            id: "cube",
            name: "Cube",
            parentId: null,
            source: { type: "primitive", primitive: "cube" },
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            physics: { type: "static" },
          },
        ],
      }),
    ).rejects.toThrow("forced collider failure");

    expect(physicsWorld.removeBody).toHaveBeenCalledWith(body);
    expect(manager.getCurrentLevelName()).toBeNull();
    expect(manager.getLevelObjects()).toHaveLength(0);
    expect(scene.getObjectByName("Cube")).toBeUndefined();
  });

  it("computes collider bounds before creating a rigid body", async () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: { createRigidBody: vi.fn(), createCollider: vi.fn() },
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const manager = new LevelManager(scene, physicsWorld as any, { emit: vi.fn() } as any);
    vi.spyOn(manager as any, "addLighting").mockImplementation(() => {});
    vi.spyOn(manager as any, "computeColliderBounds").mockImplementation(() => {
      throw new Error("forced bounds failure");
    });

    await expect(
      manager.loadFromJSON({
        ...baseLevel,
        objects: [
          {
            id: "cube",
            name: "Cube",
            parentId: null,
            source: { type: "primitive", primitive: "cube" },
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            physics: { type: "static" },
          },
        ],
      }),
    ).rejects.toThrow("forced bounds failure");

    expect(physicsWorld.world.createRigidBody).not.toHaveBeenCalled();
    expect(physicsWorld.removeBody).not.toHaveBeenCalled();
    expect(manager.getLevelObjects()).toHaveLength(0);
  });
});

describe("LevelManager non-mesh GLTF physics ownership", () => {
  it.each(["collider", "sensor"] as const)(
    "finishes the non-mesh %s descriptor before allocating or tracking a body",
    async (type) => {
      const scene = new THREE.Scene();
      const physicsWorld = {
        world: { createRigidBody: vi.fn(), createCollider: vi.fn() },
        removeCollider: vi.fn(),
        removeBody: vi.fn(),
      };
      const manager = new LevelManager(scene, physicsWorld as any, { emit: vi.fn() } as any);
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
      vi.spyOn(manager.getAssetLoader(), "load").mockResolvedValue({ scene: new THREE.Group(), animations: [] } as any);
      vi.spyOn((manager as any).meshParser, "parse").mockReturnValue([{ type, object: group, mesh: null }]);
      vi.spyOn((manager as any).levelValidator, "validate").mockImplementation(() => {});
      const descriptorError = new Error(`${type} descriptor failed`);
      const cuboidSpy = vi.spyOn(RAPIER.ColliderDesc, "cuboid");
      if (type === "collider") {
        cuboidSpy.mockImplementation(() => {
          throw descriptorError;
        });
      } else {
        cuboidSpy.mockReturnValue({
          setSensor: vi.fn(() => {
            throw descriptorError;
          }),
        } as unknown as RAPIER.ColliderDesc);
      }

      await expect((manager as any).loadGLTF("descriptor-order-test")).rejects.toThrow(descriptorError);
      cuboidSpy.mockRestore();

      expect(physicsWorld.world.createRigidBody).not.toHaveBeenCalled();
      expect(physicsWorld.world.createCollider).not.toHaveBeenCalled();
      expect((manager as any).levelBodies).toHaveLength(0);
      expect((manager as any).levelColliders).toHaveLength(0);
    },
  );

  it.each(["collider", "sensor"] as const)("removes the %s body when collider creation fails", async (type) => {
    const scene = new THREE.Scene();
    const body = { id: `${type}-body` };
    const physicsWorld = {
      world: {
        createRigidBody: vi.fn(() => body),
        createCollider: vi.fn(() => {
          throw new Error(`${type} collider failed`);
        }),
      },
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const manager = new LevelManager(scene, physicsWorld as any, { emit: vi.fn() } as any);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    vi.spyOn(manager.getAssetLoader(), "load").mockResolvedValue({ scene: new THREE.Group(), animations: [] } as any);
    vi.spyOn((manager as any).meshParser, "parse").mockReturnValue([{ type, object: group, mesh: null }]);
    vi.spyOn((manager as any).levelValidator, "validate").mockImplementation(() => {});

    await expect((manager as any).loadGLTF("ownership-test")).rejects.toThrow(`${type} collider failed`);

    expect(physicsWorld.removeBody).toHaveBeenCalledWith(body);
    expect((manager as any).levelBodies).toHaveLength(0);
    expect((manager as any).levelColliders).toHaveLength(0);
  });

  it("removes both allocations when non-mesh physics tracking throws", async () => {
    const scene = new THREE.Scene();
    const body = { id: "tracked-body" };
    const collider = { id: "tracked-collider" };
    const physicsWorld = {
      world: { createRigidBody: vi.fn(() => body), createCollider: vi.fn(() => collider) },
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const manager = new LevelManager(scene, physicsWorld as any, { emit: vi.fn() } as any);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    vi.spyOn(manager.getAssetLoader(), "load").mockResolvedValue({ scene: new THREE.Group(), animations: [] } as any);
    vi.spyOn((manager as any).meshParser, "parse").mockReturnValue([{ type: "collider", object: group, mesh: null }]);
    vi.spyOn((manager as any).levelValidator, "validate").mockImplementation(() => {});
    const bodies: unknown[] = [];
    vi.spyOn(bodies, "push").mockImplementation(() => {
      throw new Error("tracking failed");
    });
    (manager as any).levelBodies = bodies;

    await expect((manager as any).loadGLTF("tracking-test")).rejects.toThrow("tracking failed");

    expect(physicsWorld.removeCollider).toHaveBeenCalledWith(collider);
    expect(physicsWorld.removeBody).toHaveBeenCalledWith(body);
    expect((manager as any).levelBodies).toHaveLength(0);
    expect((manager as any).levelColliders).toHaveLength(0);
  });
});

describe("LevelManager load timing", () => {
  it.each([
    {
      label: "level",
      expectedName: "procedural",
      invoke: (manager: LevelManager) => manager.load("procedural"),
      internal: "loadInternal",
    },
    {
      label: "station",
      expectedName: "station:vfx",
      invoke: (manager: LevelManager) => manager.loadStation("vfx"),
      internal: "loadStationInternal",
    },
    {
      label: "JSON level",
      expectedName: "saved-level",
      invoke: (manager: LevelManager) =>
        manager.loadFromJSON({
          version: 2,
          name: "saved-level",
          created: "2026-07-17T00:00:00.000Z",
          modified: "2026-07-17T00:00:00.000Z",
          spawnPoint: { position: [0, 2, 0] },
          objects: [],
        }),
      internal: "loadFromJSONInternal",
    },
  ])("records the most recent $label duration", async ({ expectedName, invoke, internal }) => {
    const manager = new LevelManager(
      new THREE.Scene(),
      { world: {}, removeCollider: vi.fn(), removeBody: vi.fn() } as unknown as PhysicsWorld,
      { emit: vi.fn() } as unknown as EventBus,
    );
    const internals = manager as unknown as Record<string, (...args: unknown[]) => Promise<void>>;
    vi.spyOn(internals, internal).mockResolvedValue(undefined);
    const nowSpy = vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(142.5);

    await invoke(manager);

    expect(manager.getLastLoadStats()).toEqual({ name: expectedName, durationMs: 42.5 });
    nowSpy.mockRestore();
  });
});

describe("LevelManager level identity", () => {
  type LevelManagerInternals = {
    buildProcedural(station: "vfx" | null): Promise<void>;
    addLighting(): void;
  };

  it.each([
    {
      label: "built-in procedural level",
      expected: { name: "procedural", origin: "system" as const, kind: "procedural" as const },
      prepare: (manager: LevelManager) =>
        vi.spyOn(manager as unknown as LevelManagerInternals, "buildProcedural").mockResolvedValue(undefined),
      load: (manager: LevelManager) => manager.load("procedural"),
    },
    {
      label: "built-in station",
      expected: { name: "station:vfx", origin: "system" as const, kind: "station" as const },
      prepare: (manager: LevelManager) =>
        vi.spyOn(manager as unknown as LevelManagerInternals, "buildProcedural").mockResolvedValue(undefined),
      load: (manager: LevelManager) => manager.loadStation("vfx"),
    },
    {
      label: "authored procedural collision",
      expected: { name: "procedural", origin: "authored" as const, kind: "authored" as const },
      prepare: () => undefined,
      load: (manager: LevelManager) =>
        manager.loadFromJSON({
          version: 2,
          name: "procedural",
          created: "2026-07-19T00:00:00.000Z",
          modified: "2026-07-19T00:00:00.000Z",
          spawnPoint: { position: [0, 2, 0] },
          objects: [],
        }),
    },
    {
      label: "authored station collision",
      expected: { name: "station:vfx", origin: "authored" as const, kind: "authored" as const },
      prepare: () => undefined,
      load: (manager: LevelManager) =>
        manager.loadFromJSON({
          version: 2,
          name: "station:vfx",
          created: "2026-07-19T00:00:00.000Z",
          modified: "2026-07-19T00:00:00.000Z",
          spawnPoint: { position: [0, 2, 0] },
          objects: [],
        }),
    },
  ])("sets $label identity before level:loaded and clears it on unload", async ({ expected, prepare, load }) => {
    let manager!: LevelManager;
    const identityAtLoaded: unknown[] = [];
    const eventBus = {
      emit: vi.fn((event: string) => {
        if (event === "level:loaded") identityAtLoaded.push(manager.getCurrentLevelIdentity());
      }),
    };
    manager = new LevelManager(
      new THREE.Scene(),
      { world: {}, removeCollider: vi.fn(), removeBody: vi.fn() } as unknown as PhysicsWorld,
      eventBus as unknown as EventBus,
    );
    vi.spyOn(manager as unknown as LevelManagerInternals, "addLighting").mockImplementation(() => {});
    prepare(manager);

    await load(manager);

    expect(manager.getCurrentLevelIdentity()).toEqual(expected);
    expect(identityAtLoaded).toEqual([expected]);

    manager.unload();
    expect(manager.getCurrentLevelIdentity()).toBeNull();
  });
});

describe("LevelManager rotated body creation", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("applies mesh rotation to rigid body when loading a rotated JSON object", async () => {
    const scene = new THREE.Scene();
    const setRotation = vi.fn();
    const setTranslation = vi.fn();
    const bodyDesc = {
      setTranslation,
      setRotation,
    };
    const body = {};
    const collider = {};
    const physicsWorld = {
      world: {
        createRigidBody: vi.fn(() => body),
        createCollider: vi.fn(() => collider),
      },
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    vi.spyOn(manager as any, "addLighting").mockImplementation(() => {});

    // Mock RAPIER module at the instance level
    const RAPIER = await import("@dimforge/rapier3d-compat");
    const fixedSpy = vi.spyOn(RAPIER.RigidBodyDesc, "fixed").mockReturnValue(bodyDesc as any);
    const cuboidSpy = vi.spyOn(RAPIER.ColliderDesc, "cuboid").mockReturnValue({
      setCollisionGroups: vi.fn().mockReturnThis(),
      setTranslation: vi.fn().mockReturnThis(),
    } as any);

    const entry = {
      id: "test-1",
      name: "RotatedBlock",
      parentId: null,
      source: { type: "primitive" as const, primitive: "box" },
      transform: {
        position: [1, 2, 3] as [number, number, number],
        rotation: [0, Math.PI / 4, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
      physics: { type: "static" as const },
    };

    await manager.loadFromJSON({
      version: 2,
      name: "rotated",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      spawnPoint: { position: [0, 2, 0] },
      objects: [entry],
    });

    // Body translation must be set
    expect(setTranslation).toHaveBeenCalledWith(1, 2, 3);

    // Body rotation must be set with the mesh's quaternion (45 deg around Y)
    expect(setRotation).toHaveBeenCalledTimes(1);
    const rotArg = setRotation.mock.calls[0][0];
    // For a 45-degree Y rotation, quaternion ≈ { x: 0, y: 0.3827, z: 0, w: 0.9239 }
    expect(rotArg.x).toBeCloseTo(0, 4);
    expect(rotArg.y).toBeCloseTo(Math.sin(Math.PI / 8), 3);
    expect(rotArg.z).toBeCloseTo(0, 4);
    expect(rotArg.w).toBeCloseTo(Math.cos(Math.PI / 8), 3);

    fixedSpy.mockRestore();
    cuboidSpy.mockRestore();
  });

  it("rebuilds parent-child hierarchy before tracking runtime objects", async () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: {
        createRigidBody: vi.fn(() => ({})),
        createCollider: vi.fn(() => ({})),
      },
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    vi.spyOn(manager as any, "addLighting").mockImplementation(() => {});

    const RAPIER = await import("@dimforge/rapier3d-compat");
    const fixedSpy = vi.spyOn(RAPIER.RigidBodyDesc, "fixed").mockReturnValue({
      setTranslation: vi.fn(),
      setRotation: vi.fn(),
    } as any);
    const cuboidSpy = vi.spyOn(RAPIER.ColliderDesc, "cuboid").mockReturnValue({
      setCollisionGroups: vi.fn().mockReturnThis(),
      setTranslation: vi.fn().mockReturnThis(),
    } as any);

    await manager.loadFromJSON({
      version: 2,
      name: "grouped",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      spawnPoint: { position: [0, 2, 0] },
      objects: [
        {
          id: "group-1",
          name: "Group",
          parentId: null,
          source: { type: "primitive", primitive: "group" },
          transform: {
            position: [5, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          physics: { type: "static" },
        },
        {
          id: "child-1",
          name: "Child",
          parentId: "group-1",
          source: { type: "primitive", primitive: "box" },
          transform: {
            position: [1, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          physics: { type: "static" },
        },
      ],
    });

    const group = manager.getLevelObjects().find((obj) => obj.name === "Group");
    const child = manager.getLevelObjects().find((obj) => obj.name === "Child");
    expect(group).toBeInstanceOf(THREE.Group);
    expect(child?.parent).toBe(group);
    expect(scene.children).toContain(group);
    expect(scene.children).not.toContain(child);
    expect(physicsWorld.world.createRigidBody).toHaveBeenCalledTimes(1);
    expect(physicsWorld.world.createCollider).toHaveBeenCalledTimes(1);

    fixedSpy.mockRestore();
    cuboidSpy.mockRestore();
  });

  it("builds parented physics from the final world pose and inherited uniform scale", async () => {
    const scene = new THREE.Scene();
    const setTranslation = vi.fn();
    const setRotation = vi.fn();
    const colliderSetTranslation = vi.fn().mockReturnThis();
    const physicsWorld = {
      world: { createRigidBody: vi.fn(() => ({})), createCollider: vi.fn(() => ({})) },
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const manager = new LevelManager(scene, physicsWorld as any, { emit: vi.fn() } as any);
    vi.spyOn(manager as any, "addLighting").mockImplementation(() => {});
    const RAPIER = await import("@dimforge/rapier3d-compat");
    const fixedSpy = vi.spyOn(RAPIER.RigidBodyDesc, "fixed").mockReturnValue({ setTranslation, setRotation } as any);
    const cuboidSpy = vi.spyOn(RAPIER.ColliderDesc, "cuboid").mockReturnValue({
      setCollisionGroups: vi.fn().mockReturnThis(),
      setTranslation: colliderSetTranslation,
    } as any);

    await manager.loadFromJSON({
      version: 2,
      name: "parented-physics",
      created: "2026-07-19T00:00:00.000Z",
      modified: "2026-07-19T00:00:00.000Z",
      spawnPoint: { position: [0, 2, 0] },
      objects: [
        {
          id: "parent",
          name: "Parent",
          parentId: null,
          source: { type: "primitive", primitive: "group" },
          transform: { position: [4, 2, -6], rotation: [0.1, Math.PI / 3, -0.2], scale: [2, 2, 2] },
          physics: { type: "static" },
        },
        {
          id: "child",
          name: "Child",
          parentId: "parent",
          source: { type: "primitive", primitive: "cube" },
          transform: { position: [1, 2, 3], rotation: [-0.2, 0.4, 0.1], scale: [1, 1.5, 0.5] },
          physics: { type: "static" },
        },
      ],
    });

    const child = manager.getLevelObjects().find((object) => object.name === "Child");
    expect(child).toBeDefined();
    const expectedPosition = child!.getWorldPosition(new THREE.Vector3());
    const expectedRotation = child!.getWorldQuaternion(new THREE.Quaternion());
    expect(setTranslation).toHaveBeenCalledWith(expectedPosition.x, expectedPosition.y, expectedPosition.z);
    expect(setRotation.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        x: expect.closeTo(expectedRotation.x, 8),
        y: expect.closeTo(expectedRotation.y, 8),
        z: expect.closeTo(expectedRotation.z, 8),
        w: expect.closeTo(expectedRotation.w, 8),
      }),
    );
    const colliderArgs = cuboidSpy.mock.calls[0];
    expect(colliderArgs[0]).toBeCloseTo(1, 8);
    expect(colliderArgs[1]).toBeCloseTo(1.5, 8);
    expect(colliderArgs[2]).toBeCloseTo(0.5, 8);
    const colliderOffset = colliderSetTranslation.mock.calls[0];
    expect(colliderOffset[0]).toBeCloseTo(0, 8);
    expect(colliderOffset[1]).toBeCloseTo(0, 8);
    expect(colliderOffset[2]).toBeCloseTo(0, 8);

    fixedSpy.mockRestore();
    cuboidSpy.mockRestore();
  });

  it("interpolates a parented dynamic visual from Rapier world space without double-applying its parent", () => {
    const scene = new THREE.Scene();
    const manager = new LevelManager(scene, { world: {} } as any, { emit: vi.fn() } as any);
    const parent = new THREE.Group();
    parent.position.set(8, 2, -5);
    parent.rotation.set(0.2, 0.7, -0.1);
    parent.scale.setScalar(2);
    const child = new THREE.Object3D();
    parent.add(child);
    scene.add(parent);
    const worldPosition = new THREE.Vector3(-3, 6, 4);
    const worldRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.5, 0.2));
    const body = {
      translation: () => ({ x: worldPosition.x, y: worldPosition.y, z: worldPosition.z }),
      rotation: () => ({ x: worldRotation.x, y: worldRotation.y, z: worldRotation.z, w: worldRotation.w }),
    };
    (manager as any).dynamicBodies = [
      {
        mesh: child,
        body,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        prevQuat: new THREE.Quaternion(),
        currQuat: new THREE.Quaternion(),
        hasPose: false,
      },
    ];

    manager.postPhysicsUpdate(1 / 60);
    manager.update(1 / 60, 1);
    child.updateWorldMatrix(true, false);

    expect(child.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition)).toBeLessThan(1e-8);
    expect(child.getWorldQuaternion(new THREE.Quaternion()).angleTo(worldRotation)).toBeLessThan(1e-6);
  });

  it("returns enough physics tracking state to restore a dynamic object after undo", () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    const mesh = new THREE.Group();
    const body = {};
    const dynamicEntry = {
      mesh,
      body,
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
      hasPose: false,
    };
    (manager as any).levelObjects = [mesh];
    (manager as any).dynamicBodies = [dynamicEntry];

    const removed = manager.removeLevelObject(mesh);
    expect(manager.getLevelObjects()).not.toContain(mesh);
    expect(manager.getDynamicBodies()).toHaveLength(0);

    manager.addLevelObject(mesh, removed);

    expect(manager.getLevelObjects()).toContain(mesh);
    expect(manager.getDynamicBodies()).toHaveLength(1);
    expect(manager.getDynamicBodies()[0]?.body).toBe(body);
  });

  it("restores removed visual, dynamic, body, and collider tracking at their exact indices", () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const manager = new LevelManager(scene, physicsWorld as any, { emit: vi.fn() } as any);
    const meshes = ["before", "target", "after"].map((name) => {
      const mesh = new THREE.Group();
      mesh.name = name;
      return mesh;
    });
    const bodies = meshes.map((mesh) => ({ id: `${mesh.name}-body`, setEnabled: vi.fn() }));
    const colliders = meshes.map((mesh) => ({ id: `${mesh.name}-collider`, setEnabled: vi.fn() }));
    const dynamicEntries = meshes.map((mesh, index) => ({
      mesh,
      body: bodies[index],
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
      hasPose: false,
    }));
    for (const [index, mesh] of meshes.entries()) {
      manager.addLevelObject(mesh, {
        dynamicBody: dynamicEntries[index] as any,
        physics: { body: bodies[index] as any, collider: colliders[index] as any },
      });
    }
    const project = () => {
      const internals = manager as unknown as {
        levelBodies: Array<{ id: string }>;
        levelColliders: Array<{ id: string }>;
      };
      return {
        levelObjects: manager.getLevelObjects().map(({ name }) => name),
        dynamicBodies: manager.getDynamicBodies().map(({ mesh }) => mesh.name),
        levelBodies: internals.levelBodies.map(({ id }) => id),
        levelColliders: internals.levelColliders.map(({ id }) => id),
      };
    };
    const before = project();
    const target = meshes[1];
    if (!target) throw new Error("Missing target fixture.");

    const tracking = manager.removeLevelObject(target);
    manager.addLevelObject(target, tracking);

    expect(project()).toEqual(before);
  });

  it("falls back to dynamic body physics when object physics was not explicitly mapped", () => {
    const scene = new THREE.Scene();
    const collider = {};
    const body = { collider: vi.fn(() => collider) };
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    const mesh = new THREE.Group();
    (manager as any).levelObjects = [mesh];
    (manager as any).dynamicBodies = [
      {
        mesh,
        body,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        prevQuat: new THREE.Quaternion(),
        currQuat: new THREE.Quaternion(),
        hasPose: false,
      },
    ];

    manager.removeLevelObject(mesh, { removePhysics: true });

    expect(physicsWorld.removeCollider).toHaveBeenCalledWith(collider);
    expect(physicsWorld.removeBody).toHaveBeenCalledWith(body);
  });

  it("retires tracking and preserves the collider error when collider and body cleanup both throw", () => {
    const scene = new THREE.Scene();
    const colliderCleanupError = new Error("collider cleanup failed");
    const bodyCleanupError = new Error("body cleanup failed");
    const removeCollider = vi.fn(() => {
      throw colliderCleanupError;
    });
    const removeBody = vi.fn(() => {
      throw bodyCleanupError;
    });
    const manager = new LevelManager(
      scene,
      { world: {}, removeCollider, removeBody } as unknown as PhysicsWorld,
      { emit: vi.fn() } as unknown as EventBus,
    );
    const mesh = new THREE.Group();
    const collider = { setEnabled: vi.fn() } as unknown as RAPIER.Collider;
    const body = { setEnabled: vi.fn() } as unknown as RAPIER.RigidBody;
    manager.addLevelObject(mesh, { physics: { body, collider } });

    expect(() => manager.removeLevelObject(mesh, { removePhysics: true })).toThrow(colliderCleanupError);

    expect(removeCollider).toHaveBeenCalledOnce();
    expect(removeBody).toHaveBeenCalledWith(body);
    expect(manager.getLevelObjects()).not.toContain(mesh);
    expect(manager.getLevelObjectTracking(mesh).physics).toBeUndefined();
    const internals = manager as unknown as {
      levelBodies: unknown[];
      levelColliders: unknown[];
      objectPhysics: Map<THREE.Object3D, unknown>;
    };
    expect(internals.levelBodies).not.toContain(body);
    expect(internals.levelColliders).not.toContain(collider);
    expect(internals.objectPhysics.has(mesh)).toBe(false);

    manager.removeLevelObject(mesh, { removePhysics: true });
    expect(removeCollider).toHaveBeenCalledOnce();
    expect(removeBody).toHaveBeenCalledOnce();
  });

  it("re-enables tracked static physics when an editor undo restores the object", () => {
    const scene = new THREE.Scene();
    const collider = { setEnabled: vi.fn() };
    const body = { setEnabled: vi.fn() };
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    const mesh = new THREE.Group();

    manager.addLevelObject(mesh, { physics: { body: body as any, collider: collider as any } });
    const removed = manager.removeLevelObject(mesh);
    removed.physics?.body?.setEnabled(false);
    removed.physics?.collider?.setEnabled(false);

    manager.addLevelObject(mesh, removed);

    expect(body.setEnabled).toHaveBeenLastCalledWith(true);
    expect(collider.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it("tracks replacement colliders so later cleanup removes the current collider", () => {
    const scene = new THREE.Scene();
    const oldCollider = { id: "old" };
    const newCollider = { id: "new" };
    const body = { setEnabled: vi.fn() };
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    const mesh = new THREE.Group();

    manager.addLevelObject(mesh, { physics: { body: body as any, collider: oldCollider as any } });
    manager.updateLevelObjectPhysics(mesh, { body: body as any, collider: newCollider as any });
    manager.removeLevelObject(mesh, { removePhysics: true });

    expect(physicsWorld.removeCollider).toHaveBeenCalledWith(newCollider);
    expect(physicsWorld.removeCollider).not.toHaveBeenCalledWith(oldCollider);
    expect(physicsWorld.removeBody).toHaveBeenCalledWith(body);
  });

  it("can remove owned physics when a tracked runtime object is discarded", async () => {
    const scene = new THREE.Scene();
    const body = {};
    const collider = {};
    const physicsWorld = {
      world: {
        createRigidBody: vi.fn(() => body),
        createCollider: vi.fn(() => collider),
      },
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    vi.spyOn(manager as any, "addLighting").mockImplementation(() => {});

    const RAPIER = await import("@dimforge/rapier3d-compat");
    const fixedSpy = vi.spyOn(RAPIER.RigidBodyDesc, "fixed").mockReturnValue({
      setTranslation: vi.fn(),
      setRotation: vi.fn(),
    } as any);
    const cuboidSpy = vi.spyOn(RAPIER.ColliderDesc, "cuboid").mockReturnValue({
      setCollisionGroups: vi.fn().mockReturnThis(),
      setTranslation: vi.fn().mockReturnThis(),
    } as any);

    await manager.loadFromJSON({
      version: 2,
      name: "owned-physics",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      spawnPoint: { position: [0, 2, 0] },
      objects: [
        {
          id: "box-1",
          name: "Box",
          parentId: null,
          source: { type: "primitive", primitive: "box" },
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          physics: { type: "static" },
        },
      ],
    });

    const mesh = manager.getLevelObjects().find((obj) => obj.name === "Box");
    expect(mesh).toBeDefined();

    manager.removeLevelObject(mesh!, { removePhysics: true });

    expect(physicsWorld.removeCollider).toHaveBeenCalledWith(collider);
    expect(physicsWorld.removeBody).toHaveBeenCalledWith(body);

    fixedSpy.mockRestore();
    cuboidSpy.mockRestore();
  });

  it("centers cuboid colliders on local bounds for off-center imported meshes", async () => {
    const scene = new THREE.Scene();
    const colliderSetTranslation = vi.fn().mockReturnThis();
    const physicsWorld = {
      world: {
        createRigidBody: vi.fn(() => ({})),
        createCollider: vi.fn(() => ({})),
      },
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    vi.spyOn(manager as any, "addLighting").mockImplementation(() => {});
    vi.spyOn(manager as any, "loadGLBObject").mockResolvedValue(
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(1, 0, 0), new THREE.MeshBasicMaterial()),
    );

    const RAPIER = await import("@dimforge/rapier3d-compat");
    const fixedSpy = vi.spyOn(RAPIER.RigidBodyDesc, "fixed").mockReturnValue({
      setTranslation: vi.fn(),
      setRotation: vi.fn(),
    } as any);
    const cuboidSpy = vi.spyOn(RAPIER.ColliderDesc, "cuboid").mockReturnValue({
      setCollisionGroups: vi.fn().mockReturnThis(),
      setTranslation: colliderSetTranslation,
    } as any);

    await manager.loadFromJSON({
      version: 2,
      name: "off-center",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      spawnPoint: { position: [0, 2, 0] },
      objects: [
        {
          id: "glb-1",
          name: "OffCenter",
          parentId: null,
          source: { type: "glb", asset: "/test.glb" },
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          physics: { type: "static" },
        },
      ],
    });

    expect(colliderSetTranslation).toHaveBeenCalledWith(1, 0, 0);

    fixedSpy.mockRestore();
    cuboidSpy.mockRestore();
  });
});

describe("LevelManager VFX timing", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("advances VFX callbacks from render update, not fixedUpdate", () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    const vfxCallback = vi.fn();
    (manager as any).vfxUpdateCallbacks = [vfxCallback];

    manager.fixedUpdate(1 / 60);
    expect(vfxCallback).not.toHaveBeenCalled();

    manager.update(1 / 30, 0.5);
    expect(vfxCallback).toHaveBeenCalledTimes(1);
    expect(vfxCallback).toHaveBeenCalledWith(1 / 30);
  });

  it("disposes point-cloud geometry and material during unload", () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const material = new THREE.PointsMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    (manager as any).levelObjects = [points];
    (manager as any).currentLevelName = "vfx";

    manager.unload();

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});

describe("LevelManager moving platform metadata", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("stores authored linear velocity for kinematic moving platforms", () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.position.set(0, 0, 0);
    const body = {
      userData: {},
      setNextKinematicTranslation: vi.fn(),
      setNextKinematicRotation: vi.fn(),
    };

    (manager as any).movingPlatforms = [
      {
        mesh,
        body,
        base: new THREE.Vector3(0, 0, 0),
        mode: "x",
        speed: 1,
        amplitude: 2,
        rotationOffset: new THREE.Euler(),
        lastPosition: new THREE.Vector3(0, 0, 0),
        lastRotX: 0,
        lastRotY: 0,
        linearVelocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
      },
    ];

    manager.fixedUpdate(0.25);

    expect((body.userData as any).kind).toBe("moving-platform");
    expect(Math.abs((body.userData as any).platformLinearVelocity.x)).toBeGreaterThan(0.01);
  });
});
