import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../core/EventBus";
import { LevelManager } from "../level/LevelManager";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { CommandHistory } from "./CommandHistory";
import { EditorDocument } from "./EditorDocument";
import { type EditorLoadToken, EditorLoadTransaction } from "./EditorLoadTransaction";
import { EditorManager } from "./EditorManager";
import type { EditorObject } from "./EditorObject";
import type { LevelData } from "./LevelSerializer";

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

interface DeleteManagerHarness {
  guardDocumentMutation(): boolean;
  document: EditorDocument;
  physicsWorld: PhysicsWorld;
  levelManager: LevelManager;
  renderer: { scene: THREE.Scene };
  eventBus: { emit: ReturnType<typeof vi.fn> };
  gizmo: { attach: ReturnType<typeof vi.fn> };
  inspectorPanel: { setSelection: ReturnType<typeof vi.fn> };
  hierarchyPanel: { setSelection: ReturnType<typeof vi.fn>; setObjects: ReturnType<typeof vi.fn> };
  inspectorEditStartTransform: TransformTuple | null;
  inspectorEditObjectId: string | null;
  setSelectionHelper: ReturnType<typeof vi.fn>;
  syncPhysicsSubtree: ReturnType<typeof vi.fn>;
  showPhysicsMutationError: ReturnType<typeof vi.fn>;
  markDirty: ReturnType<typeof vi.fn>;
  history: CommandHistory;
  loadTransaction: EditorLoadTransaction;
  documentState: { markClean: ReturnType<typeof vi.fn> };
  toolbarPanel: { showSaveError: ReturnType<typeof vi.fn>; clearSaveError: ReturnType<typeof vi.fn> };
  deleteSubtree(rootId: string): boolean;
  deleteById(id: string): void;
  deleteSelection(): void;
  applyLoadedLevelContents(
    data: LevelData,
    intent: "user-load" | "playtest-restore",
    loadToken: EditorLoadToken,
  ): Promise<"completed" | "failed" | "superseded">;
}

type DeleteHarness = ReturnType<typeof makeDeleteHarness>;

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

function makeTrackedObject(
  id: string,
  parentId: string | null,
  children: string[],
  physicsType: "static" | "dynamic",
  body?: { setEnabled: ReturnType<typeof vi.fn> },
  collider?: { setEnabled: ReturnType<typeof vi.fn> },
): EditorObject {
  const mesh = new THREE.Object3D();
  mesh.name = id;
  return {
    id,
    name: id,
    mesh,
    body: body as unknown as RAPIER.RigidBody,
    collider: collider as unknown as RAPIER.Collider,
    source: { type: "primitive", primitive: "group" },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId,
    children,
    visible: true,
    locked: false,
    physicsType,
  };
}

function makeDeleteHarness(eventBus = new EventBus()) {
  const scene = new THREE.Scene();
  const removeBody = vi.fn();
  const removeCollider = vi.fn();
  const physicsWorld = { removeBody, removeCollider };
  const levelManager = new LevelManager(scene, physicsWorld as unknown as PhysicsWorld, eventBus);
  const document = new EditorDocument(scene, physicsWorld as unknown as PhysicsWorld);
  const rootBody = { setEnabled: vi.fn() };
  const rootCollider = { setEnabled: vi.fn() };
  const childBody = { setEnabled: vi.fn() };
  const childCollider = { setEnabled: vi.fn() };
  const grandchildCollider = { setEnabled: vi.fn() };
  const sibling = makeTrackedObject("sibling", null, ["root"], "static");
  const root = makeTrackedObject("root", sibling.id, ["child"], "static", rootBody, rootCollider);
  const child = makeTrackedObject("child", root.id, ["grandchild"], "dynamic", childBody, childCollider);
  const grandchild = makeTrackedObject("grandchild", child.id, [], "static", undefined, grandchildCollider);

  scene.add(sibling.mesh);
  sibling.mesh.add(root.mesh);
  root.mesh.add(child.mesh);
  child.mesh.add(grandchild.mesh);
  document.objects = [sibling, root, child, grandchild];
  document.selected = child;
  levelManager.addLevelObject(sibling.mesh);
  levelManager.addLevelObject(root.mesh, { physics: { body: root.body, collider: root.collider } });
  levelManager.addLevelObject(child.mesh, {
    physics: { body: child.body, collider: child.collider },
    dynamicBody: {
      mesh: child.mesh,
      body: childBody as unknown as RAPIER.RigidBody,
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
      hasPose: false,
    },
  });
  levelManager.addLevelObject(grandchild.mesh, { physics: { collider: grandchild.collider } });

  for (const handle of [rootBody, rootCollider, childBody, childCollider, grandchildCollider]) {
    handle.setEnabled.mockClear();
  }

  const markDirty = vi.fn();
  const manager = Object.create(EditorManager.prototype) as unknown as DeleteManagerHarness;
  Object.assign(manager, {
    guardDocumentMutation: () => true,
    document,
    physicsWorld,
    levelManager,
    renderer: { scene },
    eventBus,
    gizmo: { attach: vi.fn() },
    inspectorPanel: { setSelection: vi.fn() },
    hierarchyPanel: { setSelection: vi.fn(), setObjects: vi.fn() },
    inspectorEditStartTransform: null,
    inspectorEditObjectId: null,
    setSelectionHelper: vi.fn(),
    syncPhysicsSubtree: vi.fn(() => ({ ok: true })),
    showPhysicsMutationError: vi.fn(),
    markDirty,
    history: new CommandHistory(markDirty),
    loadTransaction: new EditorLoadTransaction(),
    documentState: { markClean: vi.fn() },
    toolbarPanel: { showSaveError: vi.fn(), clearSaveError: vi.fn() },
  });

  return {
    manager,
    document,
    levelManager,
    scene,
    sibling,
    root,
    child,
    grandchild,
    rootBody,
    rootCollider,
    childBody,
    childCollider,
    grandchildCollider,
    removeBody,
    removeCollider,
    markDirty,
  };
}

function projectDeleteManager({ document, levelManager }: DeleteHarness) {
  const objectByMesh = new Map(document.objects.map((object) => [object.mesh, object.id]));
  return {
    document: document.objects.map((object) => ({
      id: object.id,
      parentId: object.parentId ?? null,
      children: [...(object.children ?? [])],
      meshParent: object.mesh.parent ? (objectByMesh.get(object.mesh.parent) ?? null) : null,
      meshChildren: object.mesh.children.map((mesh) => objectByMesh.get(mesh)),
    })),
    selected: document.selected?.id ?? null,
    levelObjects: levelManager.getLevelObjects().map((mesh) => objectByMesh.get(mesh)),
    dynamicBodies: levelManager.getDynamicBodies().map(({ mesh }) => objectByMesh.get(mesh)),
  };
}

function emptyLevelData(name = "replacement"): LevelData {
  return {
    version: 2,
    name,
    created: "2026-07-20T00:00:00.000Z",
    modified: "2026-07-20T00:00:00.000Z",
    spawnPoint: { position: [0, 2, 0] },
    objects: [],
  };
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

describe("EditorManager subtree delete transactions", () => {
  it("round-trips mixed tracking and selected descendants, then finalizes an applied redo exactly once", () => {
    const harness = makeDeleteHarness();
    const { manager, document, levelManager, root, child, grandchild, sibling } = harness;
    const before = projectDeleteManager(harness);
    const trackingBefore = [root, child, grandchild].map((object) => levelManager.getLevelObjectTracking(object.mesh));
    const removeLevelObject = vi.spyOn(levelManager, "removeLevelObject");

    expect(manager.deleteSubtree(root.id)).toBe(true);
    expect(document.objects).toEqual([sibling]);
    expect(levelManager.getLevelObjects()).toEqual([sibling.mesh]);
    expect(document.selected).toBeNull();
    expect(root.mesh.parent).toBeNull();
    expect(removeLevelObject.mock.calls.slice(0, 3).map(([mesh]) => (mesh as THREE.Object3D).name)).toEqual([
      grandchild.id,
      child.id,
      root.id,
    ]);
    for (const handle of [
      harness.rootBody,
      harness.rootCollider,
      harness.childBody,
      harness.childCollider,
      harness.grandchildCollider,
    ]) {
      expect(handle.setEnabled).toHaveBeenLastCalledWith(false);
    }

    expect(manager.history.undo()).toBe(true);
    expect(projectDeleteManager(harness)).toEqual(before);
    expect([root, child, grandchild].map((object) => levelManager.getLevelObjectTracking(object.mesh))).toEqual(
      trackingBefore,
    );
    expect(manager.syncPhysicsSubtree).toHaveBeenCalledWith(root, false);
    for (const handle of [
      harness.rootBody,
      harness.rootCollider,
      harness.childBody,
      harness.childCollider,
      harness.grandchildCollider,
    ]) {
      expect(handle.setEnabled).toHaveBeenLastCalledWith(true);
    }

    expect(manager.history.redo()).toBe(true);
    manager.history.clear();
    expect(harness.removeBody.mock.calls.map(([body]) => body)).toEqual([root.body, child.body]);
    expect(harness.removeCollider.mock.calls.map(([collider]) => collider)).toEqual([
      root.collider,
      child.collider,
      grandchild.collider,
    ]);
  });

  it("rolls a mid-remove failure back without dirtying or retaining history", () => {
    const harness = makeDeleteHarness();
    const { manager, levelManager, root } = harness;
    const before = projectDeleteManager(harness);
    const removeLevelObject = levelManager.removeLevelObject.bind(levelManager);
    let removalCount = 0;
    vi.spyOn(levelManager, "removeLevelObject").mockImplementation((mesh, options) => {
      removalCount += 1;
      if (removalCount === 2) throw new Error("mid-remove failure");
      return removeLevelObject(mesh, options);
    });

    expect(manager.deleteSubtree(root.id)).toBe(false);

    expect(projectDeleteManager(harness)).toEqual(before);
    expect(harness.markDirty).not.toHaveBeenCalled();
    expect(manager.history.undo()).toBe(false);
    expect(manager.showPhysicsMutationError).toHaveBeenCalledWith(expect.stringMatching(/delete/i));
  });

  it("rolls a mid-restore failure back to the applied deletion and keeps undo retryable", () => {
    const harness = makeDeleteHarness();
    const { manager, document, levelManager, root, sibling } = harness;
    const before = projectDeleteManager(harness);
    expect(manager.deleteSubtree(root.id)).toBe(true);
    const addLevelObject = levelManager.addLevelObject.bind(levelManager);
    let restoreCount = 0;
    const addSpy = vi.spyOn(levelManager, "addLevelObject").mockImplementation((mesh, options) => {
      restoreCount += 1;
      if (restoreCount === 2) throw new Error("mid-restore failure");
      addLevelObject(mesh, options);
    });

    expect(manager.history.undo()).toBe(false);

    expect(document.objects).toEqual([sibling]);
    expect(levelManager.getLevelObjects()).toEqual([sibling.mesh]);
    expect(document.selected).toBeNull();
    expect(harness.markDirty).toHaveBeenCalledOnce();
    expect(manager.syncPhysicsSubtree).not.toHaveBeenCalled();

    addSpy.mockImplementation(addLevelObject);
    expect(manager.history.undo()).toBe(true);
    expect(projectDeleteManager(harness)).toEqual(before);
  });

  it("keeps a failed redo on the redo stack and rolls its partial detach back", () => {
    const harness = makeDeleteHarness();
    const { manager, levelManager, root } = harness;
    const before = projectDeleteManager(harness);
    expect(manager.deleteSubtree(root.id)).toBe(true);
    expect(manager.history.undo()).toBe(true);
    expect(projectDeleteManager(harness)).toEqual(before);
    expect(harness.markDirty).toHaveBeenCalledTimes(2);

    const removeLevelObject = levelManager.removeLevelObject.bind(levelManager);
    let removalCount = 0;
    const removeSpy = vi.spyOn(levelManager, "removeLevelObject").mockImplementation((mesh, options) => {
      removalCount += 1;
      if (removalCount === 2) throw new Error("redo mid-detach failure");
      return removeLevelObject(mesh, options);
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(manager.history.redo()).toBe(false);

      expect(projectDeleteManager(harness)).toEqual(before);
      expect(harness.markDirty).toHaveBeenCalledTimes(2);

      removeSpy.mockImplementation(removeLevelObject);
      expect(manager.history.redo()).toBe(true);
      expect(harness.markDirty).toHaveBeenCalledTimes(3);
      manager.history.clear();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not destroy restored live physics when an undone delete leaves history", () => {
    const harness = makeDeleteHarness();
    const { manager, root } = harness;
    expect(manager.deleteSubtree(root.id)).toBe(true);
    expect(manager.history.undo()).toBe(true);

    manager.history.clear();

    expect(harness.removeBody).not.toHaveBeenCalled();
    expect(harness.removeCollider).not.toHaveBeenCalled();
  });

  it("retires all ownership after a collider cleanup failure and reports the first error once", () => {
    const harness = makeDeleteHarness();
    const { manager, levelManager, root } = harness;
    const cleanupError = new Error("root collider cleanup failed");
    harness.removeCollider.mockImplementation((collider) => {
      if (collider === root.collider) throw cleanupError;
    });
    expect(manager.deleteSubtree(root.id)).toBe(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      manager.history.clear();

      expect(harness.removeBody).toHaveBeenCalledWith(root.body);
      expect(levelManager.getLevelObjectTracking(root.mesh).physics).toBeUndefined();
      const internals = levelManager as unknown as {
        levelBodies: unknown[];
        levelColliders: unknown[];
        objectPhysics: Map<THREE.Object3D, unknown>;
      };
      expect(internals.levelBodies).not.toContain(root.body);
      expect(internals.levelColliders).not.toContain(root.collider);
      expect(internals.objectPhysics.has(root.mesh)).toBe(false);
      expect(consoleError).toHaveBeenCalledWith("[Editor] Command cleanup failed:", cleanupError);

      const bodyCleanupCount = harness.removeBody.mock.calls.length;
      const colliderCleanupCount = harness.removeCollider.mock.calls.length;
      manager.history.clear();
      expect(harness.removeBody).toHaveBeenCalledTimes(bodyCleanupCount);
      expect(harness.removeCollider).toHaveBeenCalledTimes(colliderCleanupCount);
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("rejects a missing root without dirtying or retaining history", () => {
    const harness = makeDeleteHarness();

    expect(harness.manager.deleteSubtree("missing")).toBe(false);

    expect(harness.markDirty).not.toHaveBeenCalled();
    expect(harness.manager.history.undo()).toBe(false);
  });

  it("routes hierarchy and keyboard deletion through deleteSubtree", () => {
    const { manager, document, root } = makeDeleteHarness();
    const deleteSubtree = vi.fn(() => true);
    manager.deleteSubtree = deleteSubtree;

    manager.deleteById(root.id);
    document.selected = root;
    manager.deleteSelection();

    expect(deleteSubtree.mock.calls).toEqual([[root.id], [root.id]]);
  });
});

describe("EditorManager delete ownership at user-load boundaries", () => {
  it("finalizes an applied delete before an external LevelManager load unloads runtime resources", async () => {
    const eventBus = new EventBus();
    const harness = makeDeleteHarness(eventBus);
    const { manager, levelManager, root, child, grandchild } = harness;
    const levelManagerInternals = levelManager as unknown as {
      loadGLTF(name: string): Promise<void>;
      addLighting(): void;
    };
    vi.spyOn(levelManagerInternals, "loadGLTF").mockResolvedValue(undefined);
    vi.spyOn(levelManagerInternals, "addLighting").mockImplementation(() => {});
    eventBus.on("level:willUnload", () => manager.history.clear());
    eventBus.on("level:loaded", () => manager.history.clear());
    await levelManager.load("current");

    expect(manager.deleteSubtree(root.id)).toBe(true);
    await levelManager.load("replacement");
    manager.history.clear();

    for (const collider of [root.collider, child.collider, grandchild.collider]) {
      expect(harness.removeCollider.mock.calls.filter(([removed]) => removed === collider)).toHaveLength(1);
    }
    for (const body of [root.body, child.body]) {
      expect(harness.removeBody.mock.calls.filter(([removed]) => removed === body)).toHaveLength(1);
    }
    expect(manager.history.undo()).toBe(false);
  });

  it("finalizes an applied delete before unloading a validated replacement", async () => {
    const harness = makeDeleteHarness();
    const { manager, root, child, grandchild } = harness;
    expect(manager.deleteSubtree(root.id)).toBe(true);
    const loadToken = manager.loadTransaction.begin("user-load");
    if (!loadToken) throw new Error("Expected the user-load token to start.");

    await expect(manager.applyLoadedLevelContents(emptyLevelData(), "user-load", loadToken)).resolves.toBe(
      "completed",
    );
    manager.history.clear();

    for (const collider of [root.collider, child.collider, grandchild.collider]) {
      expect(harness.removeCollider.mock.calls.filter(([removed]) => removed === collider)).toHaveLength(1);
    }
    for (const body of [root.body, child.body]) {
      expect(harness.removeBody.mock.calls.filter(([removed]) => removed === body)).toHaveLength(1);
    }
  });

  it("leaves an applied delete and its retained resources untouched when validation rejects a load", async () => {
    const harness = makeDeleteHarness();
    const { manager, root } = harness;
    expect(manager.deleteSubtree(root.id)).toBe(true);
    const before = projectDeleteManager(harness);
    const loadToken = manager.loadTransaction.begin("user-load");
    if (!loadToken) throw new Error("Expected the user-load token to start.");
    const invalid = { ...emptyLevelData(), version: 1 } as unknown as LevelData;

    await expect(manager.applyLoadedLevelContents(invalid, "user-load", loadToken)).resolves.toBe("failed");

    expect(projectDeleteManager(harness)).toEqual(before);
    expect(harness.removeBody).not.toHaveBeenCalled();
    expect(harness.removeCollider).not.toHaveBeenCalled();
    manager.history.clear();
    expect(harness.removeBody).toHaveBeenCalledWith(root.body);
    expect(harness.removeCollider).toHaveBeenCalledWith(root.collider);
  });

  it("leaves a valid stale load token without document, selection, physics, or history mutation", async () => {
    const harness = makeDeleteHarness();
    const { manager, document, levelManager, root, sibling } = harness;
    expect(manager.deleteSubtree(root.id)).toBe(true);
    document.selected = sibling;
    const before = projectDeleteManager(harness);
    const loadToken = manager.loadTransaction.begin("user-load");
    if (!loadToken) throw new Error("Expected the user-load token to start.");
    manager.loadTransaction.invalidate();
    const unload = vi.spyOn(levelManager, "unload");

    await expect(manager.applyLoadedLevelContents(emptyLevelData(), "user-load", loadToken)).resolves.toBe(
      "superseded",
    );

    expect(projectDeleteManager(harness)).toEqual(before);
    expect(unload).not.toHaveBeenCalled();
    expect(harness.removeBody).not.toHaveBeenCalled();
    expect(harness.removeCollider).not.toHaveBeenCalled();
    expect(manager.documentState.markClean).not.toHaveBeenCalled();
    manager.history.clear();
    expect(harness.removeBody).toHaveBeenCalledWith(root.body);
    expect(harness.removeCollider).toHaveBeenCalledWith(root.collider);
  });
});
