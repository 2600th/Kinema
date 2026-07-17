import type { EventBus } from "@core/EventBus";
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

    manager.unload();

    expect(manager.getSpawnPoint().position.equals(defaultSpawn)).toBe(true);
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
