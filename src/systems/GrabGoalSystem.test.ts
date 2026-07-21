import { readFileSync } from "node:fs";
import { EventBus } from "@core/EventBus";
import RAPIER from "@dimforge/rapier3d-compat";
import type { LevelManager } from "@level/LevelManager";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GrabGoalSystem } from "./GrabGoalSystem";

function createFixture(bodyType = RAPIER.RigidBodyType.Dynamic) {
  const scene = new THREE.Scene();
  const goal = new THREE.Mesh(
    new THREE.RingGeometry(1.45, 1.75, 32),
    new THREE.MeshStandardMaterial({ color: 0x0a2730, emissive: 0x00d8ff }),
  );
  goal.name = "GrabGoalOutline";
  goal.rotation.x = -Math.PI / 2;
  scene.add(goal);
  const goalCore = new THREE.Mesh(new THREE.CircleGeometry(1.42, 32), new THREE.MeshStandardMaterial());
  goalCore.name = "GrabGoalCore";
  goalCore.rotation.x = -Math.PI / 2;
  scene.add(goalCore);

  const authoredPose = new THREE.Vector3(4, 1, 8);
  const authoredRotation = new THREE.Quaternion(0, 0.25, 0, Math.sqrt(1 - 0.25 ** 2));
  let translation = authoredPose.clone();
  let rotation = authoredRotation.clone();
  let linearVelocity = new THREE.Vector3();
  let currentBodyType = bodyType;
  const cube = {
    userData: { kind: "showcase-prop", name: "PushCubeS" },
    bodyType: vi.fn(() => currentBodyType),
    translation: vi.fn(() => translation),
    rotation: vi.fn(() => rotation),
    linvel: vi.fn(() => linearVelocity),
    angvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    setTranslation: vi.fn((next: THREE.Vector3Like) => {
      translation = new THREE.Vector3(next.x, next.y, next.z);
    }),
    setRotation: vi.fn((next: THREE.QuaternionLike) => {
      rotation = new THREE.Quaternion(next.x, next.y, next.z, next.w);
    }),
    setLinvel: vi.fn(),
    setAngvel: vi.fn(),
    wakeUp: vi.fn(),
  };
  const cubeMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  cubeMesh.name = "PushCubeS_dyn";
  cubeMesh.userData.debugName = "PushCubeS";
  cubeMesh.position.copy(authoredPose);
  scene.add(cubeMesh);

  const levelManager = {
    getDynamicBodies: () => [{ mesh: cubeMesh, body: cube }],
  } as unknown as LevelManager;
  const eventBus = new EventBus();
  const system = new GrabGoalSystem(scene, eventBus, levelManager);

  return {
    authoredPose,
    authoredRotation,
    cube,
    eventBus,
    setBodyTranslation: (next: THREE.Vector3) => {
      translation = next.clone();
    },
    setBodyType: (next: RAPIER.RigidBodyType) => {
      currentBodyType = next;
    },
    setLinearVelocity: (next: THREE.Vector3) => {
      linearVelocity = next.clone();
    },
    system,
  };
}

describe("GrabGoalSystem", () => {
  it("is wired through every Game lifecycle and the development debug surface", () => {
    const gameSource = readFileSync(new URL("../Game.ts", import.meta.url), "utf8");
    const mainSource = readFileSync(new URL("../main.ts", import.meta.url), "utf8");

    expect(gameSource).toContain("this.grabGoalSystem = new GrabGoalSystem");
    expect(gameSource).toContain("this.grabGoalSystem.setupCustomLevel()");
    expect(gameSource).toContain("this.grabGoalSystem.setupStation(key)");
    expect(gameSource).toContain("return this.grabGoalSystem.getDebugState()");
    expect(gameSource).toContain("return this.grabGoalSystem.placeCubeOnGoal(name)");
    expect(mainSource).toContain('eventBus.on("objective:completed"');
    expect(mainSource).toContain('type: "objective:completed"');
    expect(mainSource).toContain("getInputSource: () => inputManager.lastInputSource");
    expect(mainSource).toContain("getGrabGoalState: () => game.getGrabGoalState()");
    expect(mainSource).toContain("placeGrabCubeOnGoal: (name?: string) => game.placeGrabCubeOnGoal(name)");
  });

  it("completes a settled delivery and restores the authored cube pose for replay", () => {
    const { authoredPose, authoredRotation, cube, eventBus, system } = createFixture();
    const completed: Array<{ id: string; text: string; position?: THREE.Vector3 }> = [];
    eventBus.on("objective:completed", (payload) => completed.push(payload));

    expect(system.getDebugState().phase).toBe("inactive");
    system.setupStation("grab");
    expect(system.getDebugState().phase).toBe("ready");

    expect(system.placeCubeOnGoal("PushCubeS")).toBe(true);
    system.fixedUpdate(0.1);
    expect(system.getDebugState().phase).toBe("settling");
    system.fixedUpdate(0.2);

    expect(completed).toContainEqual(
      expect.objectContaining({
        id: "grab-delivery",
        text: "Cube delivered",
        position: expect.any(THREE.Vector3),
      }),
    );
    expect(system.getDebugState()).toMatchObject({ phase: "completed", activeCube: "PushCubeS", completions: 1 });

    system.fixedUpdate(2.6);

    expect(system.getDebugState()).toMatchObject({ phase: "ready", activeCube: null, completions: 1 });
    expect(cube.setTranslation).toHaveBeenLastCalledWith(authoredPose, true);
    expect(cube.setRotation).toHaveBeenLastCalledWith(authoredRotation, true);
    expect(cube.setLinvel).toHaveBeenLastCalledWith({ x: 0, y: 0, z: 0 }, true);
    expect(cube.setAngvel).toHaveBeenLastCalledWith({ x: 0, y: 0, z: 0 }, true);
    expect(cube.wakeUp).toHaveBeenCalledOnce();
  });

  it("does not settle or complete a cube that is still moving", () => {
    const { eventBus, setLinearVelocity, system } = createFixture();
    const completed = vi.fn();
    eventBus.on("objective:completed", completed);
    system.setupStation("grab");
    expect(system.placeCubeOnGoal()).toBe(true);
    setLinearVelocity(new THREE.Vector3(0.5, 0, 0));

    system.fixedUpdate(1);

    expect(system.getDebugState()).toMatchObject({ phase: "ready", activeCube: null, completions: 0 });
    expect(completed).not.toHaveBeenCalled();
  });

  it("does not settle or complete a cube outside the goal bounds", () => {
    const { eventBus, setBodyTranslation, system } = createFixture();
    const completed = vi.fn();
    eventBus.on("objective:completed", completed);
    system.setupStation("grab");
    expect(system.placeCubeOnGoal()).toBe(true);
    setBodyTranslation(new THREE.Vector3(4, 0.52, 0));

    system.fixedUpdate(1);

    expect(system.getDebugState()).toMatchObject({ phase: "ready", activeCube: null, completions: 0 });
    expect(completed).not.toHaveBeenCalled();
  });

  it("keeps non-grab stations inactive", () => {
    const { system } = createFixture();

    system.setupStation("steps");

    expect(system.getDebugState()).toEqual({ phase: "inactive", activeCube: null, completions: 0 });
    expect(system.placeCubeOnGoal()).toBe(false);
  });

  it("does not complete kinematic or currently carried cubes", () => {
    const kinematic = createFixture(RAPIER.RigidBodyType.KinematicPositionBased);
    kinematic.system.setupStation("grab");

    expect(kinematic.system.placeCubeOnGoal()).toBe(false);
    kinematic.system.fixedUpdate(1);
    expect(kinematic.system.getDebugState().phase).toBe("ready");

    const carried = createFixture();
    const completed = vi.fn();
    carried.eventBus.on("objective:completed", completed);
    carried.system.setupStation("grab");
    carried.eventBus.emit("interaction:grabStart", {
      body: carried.cube as unknown as RAPIER.RigidBody,
      offset: new THREE.Vector3(),
    });
    expect(carried.system.placeCubeOnGoal()).toBe(true);
    carried.system.fixedUpdate(1);

    expect(carried.system.getDebugState().phase).toBe("ready");
    expect(completed).not.toHaveBeenCalled();

    carried.eventBus.emit("interaction:grabEnd", undefined);
    carried.system.fixedUpdate(0.21);
    carried.system.fixedUpdate(0.21);
    expect(completed).toHaveBeenCalledOnce();
  });

  it("clears level references during custom setup and teardown", () => {
    const { system } = createFixture();
    system.setupLevel();
    expect(system.placeCubeOnGoal()).toBe(true);

    system.setupCustomLevel();
    expect(system.getDebugState().phase).toBe("inactive");
    expect(system.placeCubeOnGoal()).toBe(false);

    system.setupStation("grab");
    expect(system.getDebugState().phase).toBe("ready");
    system.teardownLevel();
    expect(system.getDebugState().phase).toBe("inactive");
    expect(system.placeCubeOnGoal()).toBe(false);
  });
});
