import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { LevelManager } from "../level/LevelManager";
import { CommandHistory } from "./CommandHistory";
import { EditorDocument } from "./EditorDocument";
import { EditorManager } from "./EditorManager";
import type { EditorObject } from "./EditorObject";

type TransformTuple = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

interface EditorManagerHarness {
  guardDocumentMutation(): boolean;
  document: { selected: EditorObject };
  validatePhysicsSubtree(): { ok: true };
  inspectorPanel: { setSelection: ReturnType<typeof vi.fn> };
  showPhysicsMutationError: ReturnType<typeof vi.fn>;
  markDirty: ReturnType<typeof vi.fn>;
  syncPhysicsSubtree: ReturnType<typeof vi.fn>;
  inspectorEditStartTransform: {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  } | null;
  inspectorEditObjectId: string | null;
  applyInspectorTransform(transform: TransformTuple, phase: "preview" | "commit"): void;
  applyTransform(
    obj: EditorObject,
    transform: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 },
  ): boolean;
  onDragStateChanged(dragging: boolean): void;
  dragStartTransform: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 } | null;
  history: CommandHistory;
}

interface DuplicateManagerHarness {
  guardDocumentMutation(): boolean;
  document: {
    duplicateById: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  physicsWorld: {
    world: {
      createRigidBody: ReturnType<typeof vi.fn>;
      createCollider: ReturnType<typeof vi.fn>;
    };
    removeBody: ReturnType<typeof vi.fn>;
  };
  history: { push: ReturnType<typeof vi.fn> };
  showPhysicsMutationError: ReturnType<typeof vi.fn>;
  setSelection: ReturnType<typeof vi.fn>;
  duplicateById(id: string): void;
}

function makeObject(): EditorObject {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  return {
    id: "object-1",
    name: "Object",
    mesh,
    source: { type: "primitive", primitive: "cube" },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: null,
    children: [],
    visible: true,
    locked: false,
    physicsType: "static",
  };
}

function makeManager(selected: EditorObject): EditorManagerHarness {
  const manager = Object.create(EditorManager.prototype) as EditorManagerHarness;
  manager.guardDocumentMutation = () => true;
  manager.document = { selected };
  manager.validatePhysicsSubtree = () => ({ ok: true });
  manager.inspectorPanel = { setSelection: vi.fn() };
  manager.showPhysicsMutationError = vi.fn();
  manager.markDirty = vi.fn();
  manager.syncPhysicsSubtree = vi.fn();
  manager.inspectorEditStartTransform = null;
  manager.inspectorEditObjectId = null;
  return manager;
}

describe("EditorManager inspector transform transactions", () => {
  it("previews body poses without rebuilding, then rebuilds once at commit", () => {
    const selected = makeObject();
    const manager = makeManager(selected);
    manager.syncPhysicsSubtree = vi.fn(() => ({ ok: true }));
    const transform = {
      position: [2, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };

    manager.applyInspectorTransform(transform, "preview");
    manager.applyInspectorTransform(transform, "commit");

    expect(manager.syncPhysicsSubtree.mock.calls.map((call: unknown[]) => call[1])).toEqual([false, true]);
    expect(manager.markDirty).toHaveBeenCalledOnce();
  });

  it("rolls the visual and document transform back when atomic collider replacement fails", () => {
    const selected = makeObject();
    const manager = makeManager(selected);
    manager.syncPhysicsSubtree = vi
      .fn()
      .mockReturnValueOnce({ ok: false, reason: "second descendant failed" })
      .mockReturnValueOnce({ ok: true });
    manager.inspectorEditStartTransform = {
      position: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Euler(0, 0, 0),
      scale: new THREE.Vector3(1, 1, 1),
    };
    manager.inspectorEditObjectId = selected.id;
    selected.mesh.position.set(3, 4, 5);
    selected.transform.position = [3, 4, 5];

    manager.applyInspectorTransform({ position: [3, 4, 5], rotation: [0, 0, 0], scale: [1, 1, 1] }, "commit");

    expect(selected.mesh.position.toArray()).toEqual([0, 0, 0]);
    expect(selected.transform.position).toEqual([0, 0, 0]);
    expect(manager.syncPhysicsSubtree.mock.calls.map((call: unknown[]) => call[1])).toEqual([true, false]);
    expect(manager.markDirty).not.toHaveBeenCalled();
    expect(manager.showPhysicsMutationError).toHaveBeenCalledWith(
      expect.stringMatching(/reverted.*second descendant/i),
    );
  });
});

describe("EditorManager gizmo history transactions", () => {
  it("rolls a failed gizmo commit back and does not dirty or retain history", () => {
    const selected = makeObject();
    const manager = makeManager(selected);
    manager.dragStartTransform = {
      position: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Euler(0, 0, 0),
      scale: new THREE.Vector3(1, 1, 1),
    };
    manager.history = new CommandHistory(() => (manager.markDirty as unknown as () => void)());
    manager.syncPhysicsSubtree = vi
      .fn()
      .mockReturnValueOnce({ ok: true })
      .mockReturnValueOnce({ ok: false, reason: "commit failed" })
      .mockReturnValueOnce({ ok: true });
    selected.mesh.position.set(4, 5, 6);
    selected.transform.position = [4, 5, 6];

    manager.onDragStateChanged(false);

    expect(selected.mesh.position.toArray()).toEqual([0, 0, 0]);
    expect(selected.transform.position).toEqual([0, 0, 0]);
    expect(manager.markDirty).not.toHaveBeenCalled();
    manager.history.undo();
    expect(manager.syncPhysicsSubtree).toHaveBeenCalledTimes(3);
    expect(manager.showPhysicsMutationError).toHaveBeenCalledWith(expect.stringMatching(/commit failed/i));
  });

  it("keeps duplicate physics and history unpublished when collider creation fails", () => {
    const duplicate = makeObject();
    const body = { id: "duplicate-body" };
    const removeBody = vi.fn();
    const historyPush = vi.fn();
    const manager = Object.create(EditorManager.prototype) as DuplicateManagerHarness;
    manager.guardDocumentMutation = () => true;
    manager.document = { duplicateById: vi.fn(() => duplicate), findById: vi.fn(() => undefined) };
    manager.physicsWorld = {
      world: {
        createRigidBody: vi.fn(() => body),
        createCollider: vi.fn(() => {
          throw new Error("duplicate collider failed");
        }),
      },
      removeBody,
    };
    manager.history = { push: historyPush };
    manager.showPhysicsMutationError = vi.fn();
    manager.setSelection = vi.fn();

    expect(() => manager.duplicateById("source")).not.toThrow();

    expect(removeBody).toHaveBeenCalledWith(body);
    expect(historyPush).not.toHaveBeenCalled();
    expect(manager.setSelection).not.toHaveBeenCalled();
    expect(manager.showPhysicsMutationError).toHaveBeenCalledWith(expect.stringMatching(/duplicate/i));
  });

  it("rolls a partially published duplicate back through LevelManager and detaches its gizmo", () => {
    const scene = new THREE.Scene();
    const removeBody = vi.fn();
    const removeCollider = vi.fn();
    const body = { setEnabled: vi.fn() };
    const collider = { setEnabled: vi.fn() };
    const physicsWorld = {
      world: {
        createRigidBody: vi.fn(() => body),
        createCollider: vi.fn(() => collider),
      },
      removeBody,
      removeCollider,
    };
    const levelManager = new LevelManager(scene, physicsWorld as any, { emit: vi.fn() } as any);
    const document = new EditorDocument(scene, physicsWorld as any);
    const source = makeObject();
    document.addObject(source, scene);
    let selectionEventThrows = true;
    const eventBus = {
      emit: vi.fn((event: string, payload: unknown) => {
        if (event === "editor:objectSelected" && payload && selectionEventThrows) {
          selectionEventThrows = false;
          throw new Error("selection publication failed");
        }
      }),
    };
    const gizmo = { attach: vi.fn() };
    const manager = Object.create(EditorManager.prototype) as any;
    Object.assign(manager, {
      guardDocumentMutation: () => true,
      document,
      physicsWorld,
      levelManager,
      renderer: { scene },
      eventBus,
      gizmo,
      inspectorPanel: { setSelection: vi.fn() },
      hierarchyPanel: { setSelection: vi.fn() },
      inspectorEditStartTransform: null,
      inspectorEditObjectId: null,
      setSelectionHelper: vi.fn(),
      syncHierarchy: vi.fn(),
      history: new CommandHistory(),
      showPhysicsMutationError: vi.fn(),
    });

    expect(() => manager.duplicateById(source.id)).not.toThrow();

    expect(document.objects).toEqual([source]);
    expect(document.selected).toBeNull();
    expect(scene.children).toEqual([source.mesh]);
    expect((levelManager as any).objectPhysics.size).toBe(0);
    expect((levelManager as any).levelBodies).toHaveLength(0);
    expect((levelManager as any).levelColliders).toHaveLength(0);
    expect(levelManager.getLevelObjects()).toHaveLength(0);
    expect(removeCollider).toHaveBeenCalledWith(collider);
    expect(removeBody).toHaveBeenCalledWith(body);
    expect(gizmo.attach).toHaveBeenLastCalledWith(null);
  });

  it("clears LevelManager physics metadata when duplicate tracking itself throws", () => {
    const scene = new THREE.Scene();
    const removeBody = vi.fn();
    const removeCollider = vi.fn();
    const body = { setEnabled: vi.fn() };
    const collider = {
      setEnabled: vi
        .fn()
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw new Error("tracking failed");
        }),
    };
    const physicsWorld = {
      world: { createRigidBody: vi.fn(() => body), createCollider: vi.fn(() => collider) },
      removeBody,
      removeCollider,
    };
    const levelManager = new LevelManager(scene, physicsWorld as any, { emit: vi.fn() } as any);
    const document = new EditorDocument(scene, physicsWorld as any);
    const source = makeObject();
    document.addObject(source, scene);
    const manager = Object.create(EditorManager.prototype) as any;
    Object.assign(manager, {
      guardDocumentMutation: () => true,
      document,
      physicsWorld,
      levelManager,
      renderer: { scene },
      eventBus: { emit: vi.fn() },
      gizmo: { attach: vi.fn() },
      inspectorPanel: { setSelection: vi.fn() },
      hierarchyPanel: { setSelection: vi.fn() },
      inspectorEditStartTransform: null,
      inspectorEditObjectId: null,
      setSelectionHelper: vi.fn(),
      syncHierarchy: vi.fn(),
      history: new CommandHistory(),
      showPhysicsMutationError: vi.fn(),
    });

    expect(() => manager.duplicateById(source.id)).not.toThrow();

    expect(document.objects).toEqual([source]);
    expect((levelManager as any).objectPhysics.size).toBe(0);
    expect((levelManager as any).levelBodies).toHaveLength(0);
    expect((levelManager as any).levelColliders).toHaveLength(0);
    expect(levelManager.getLevelObjects()).toHaveLength(0);
    expect(removeCollider).toHaveBeenCalledWith(collider);
    expect(removeBody).toHaveBeenCalledWith(body);
  });
});

describe("EditorManager collider rollback fidelity", () => {
  it("prepares an explicit-mass collider restore with pose and interaction properties intact", () => {
    const obj = makeObject();
    obj.body = { id: "body" } as any;
    const createCollider = vi.fn((_desc: RAPIER.ColliderDesc, _body: unknown) => ({ id: "restored" }));
    const manager = Object.create(EditorManager.prototype) as any;
    manager.physicsWorld = { world: { createCollider } };
    const collider = {
      shape: RAPIER.ColliderDesc.cuboid(1, 2, 3).shape,
      translationWrtParent: () => ({ x: 1.25, y: -2.5, z: 3.75 }),
      rotationWrtParent: () => ({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 }),
      isSensor: () => true,
      isEnabled: () => false,
      friction: () => 0.37,
      restitution: () => 0.62,
      density: () => 9,
      mass: () => 7.5,
      frictionCombineRule: () => 2,
      restitutionCombineRule: () => 3,
      collisionGroups: () => 0x12340056,
      solverGroups: () => 0x43210065,
      activeHooks: () => 4,
      activeEvents: () => 5,
      activeCollisionTypes: () => 6,
      contactForceEventThreshold: () => 8.5,
      contactSkin: () => 0.0125,
    };

    const restore = manager.prepareEditorColliderRestore(obj, collider);
    expect(restore()).toEqual({ id: "restored" });

    const [desc, body] = createCollider.mock.calls[0]!;
    expect(body).toBe(obj.body);
    expect(desc.massPropsMode).toBe(RAPIER.MassPropsMode.Mass);
    expect(desc.mass).toBe(7.5);
    expect(desc.density).not.toBe(9);
    expect(desc.translation).toMatchObject({ x: 1.25, y: -2.5, z: 3.75 });
    expect(desc.rotation).toMatchObject({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
    expect(desc.isSensor).toBe(true);
    expect(desc.enabled).toBe(false);
    expect(desc.friction).toBe(0.37);
    expect(desc.restitution).toBe(0.62);
    expect(desc.frictionCombineRule).toBe(2);
    expect(desc.restitutionCombineRule).toBe(3);
    expect(desc.collisionGroups).toBe(0x12340056);
    expect(desc.solverGroups).toBe(0x43210065);
    expect(desc.activeHooks).toBe(4);
    expect(desc.activeEvents).toBe(5);
    expect(desc.activeCollisionTypes).toBe(6);
    expect(desc.contactForceEventThreshold).toBe(8.5);
    expect(desc.contactSkin).toBe(0.0125);
  });
});
