import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CommandHistory } from "./CommandHistory";
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
});
