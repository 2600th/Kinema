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
import { getObjectWorldPhysicsPose } from "./EditorPhysicsSync";
import type { LevelData } from "./LevelSerializer";

type TransformTuple = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

interface EditorManagerHarness {
  guardDocumentMutation(): boolean;
  document: { selected: EditorObject; objects: EditorObject[]; findById(id: string): EditorObject | undefined };
  validatePhysicsSubtree(): { ok: true };
  inspectorPanel: { setSelection: ReturnType<typeof vi.fn> };
  showPhysicsMutationError: ReturnType<typeof vi.fn>;
  markDirty: ReturnType<typeof vi.fn>;
  syncPhysicsSubtree: ReturnType<typeof vi.fn>;
  inspectorEditStartTransform: TransformTuple | null;
  inspectorEditObjectId: string | null;
  applyInspectorTransform(transform: TransformTuple, phase: "preview" | "commit"): void;
  applyTransform(id: string, transform: TransformTuple): boolean;
  onDragStateChanged(dragging: boolean): void;
  dragStartTransform: TransformTuple | null;
  history: CommandHistory;
}

interface MaterialManagerHarness {
  guardDocumentMutation(): boolean;
  document: EditorDocument;
  inspectorPanel: { setSelection: ReturnType<typeof vi.fn> };
  history: CommandHistory;
  materialEditSession: {
    objectId: string;
    before: {
      serialized: EditorObject["material"];
      live: readonly { material: object }[];
    };
  } | null;
  applyMaterialChange(id: string, material: NonNullable<EditorObject["material"]>, phase: "preview" | "commit"): void;
}

interface ScalarManagerHarness {
  document: EditorDocument;
  gizmo: { attach: ReturnType<typeof vi.fn> };
  inspectorPanel: { setSelection: ReturnType<typeof vi.fn> };
  hierarchyPanel: { setSelection: ReturnType<typeof vi.fn>; setObjects: ReturnType<typeof vi.fn> };
  setSelectionHelper: ReturnType<typeof vi.fn>;
  eventBus: { emit: ReturnType<typeof vi.fn> };
  history: CommandHistory;
  guardDocumentMutation(): boolean;
  renameById(id: string, name: string): void;
  toggleVisibilityById(id: string): void;
  toggleLockById(id: string): void;
}

interface HierarchyManagerHarness {
  guardDocumentMutation(): boolean;
  commitPendingMaterialEdit(): boolean;
  document: EditorDocument;
  renderer: { scene: THREE.Scene };
  levelManager: LevelManager;
  gizmo: { attach: ReturnType<typeof vi.fn> };
  inspectorPanel: { setSelection: ReturnType<typeof vi.fn> };
  hierarchyPanel: { setSelection: ReturnType<typeof vi.fn>; setObjects: ReturnType<typeof vi.fn> };
  setSelectionHelper: ReturnType<typeof vi.fn>;
  eventBus: { emit: ReturnType<typeof vi.fn> };
  showPhysicsMutationError: ReturnType<typeof vi.fn>;
  markDirty: ReturnType<typeof vi.fn>;
  syncPhysicsSubtree: ReturnType<typeof vi.fn>;
  finalizeDetachedHierarchyObject: ReturnType<typeof vi.fn>;
  history: CommandHistory;
  reparentById(childId: string, newParentId: string | null): boolean;
  groupObjects(ids: string[]): EditorObject | null;
  ungroupObject(groupId: string): boolean;
}

interface MaterialSelectionHarness extends MaterialManagerHarness {
  hierarchyPanel: { setSelection: ReturnType<typeof vi.fn> };
  gizmo: { attach: ReturnType<typeof vi.fn> };
  setSelectionHelper: ReturnType<typeof vi.fn>;
  eventBus: { emit: ReturnType<typeof vi.fn> };
  inspectorEditStartTransform: TransformTuple | null;
  inspectorEditObjectId: string | null;
  setSelection(object: EditorObject | null): void;
}

interface SaveBoundaryHarness {
  commitPendingMaterialEdit(): boolean;
  documentState: { value: { name: string } };
  saveLevel(): Promise<void>;
}

interface PlaytestBoundaryHarness {
  active: boolean;
  playTestActive: boolean;
  guardDocumentMutation(): boolean;
  commitPendingMaterialEdit(): boolean;
  history: { clear(): void };
  startPlayTest(): void;
}

interface ExternalUnloadHarness {
  cancelPendingMaterialEdit(): void;
  history: { clear(): void };
  prepareForExternalUnload(): void;
}

interface DisposeBoundaryHarness {
  cancelPendingMaterialEdit(): void;
  loadTransaction: { invalidate(): void };
  glbPlacementTool: { cancelPendingImport(context: object): void };
  buildToolContext(): object;
  abortPlayTest(): void;
  unsubs: (() => void)[];
  panels: { dispose(): void }[];
  gizmo: { dispose(scene: THREE.Scene): void };
  renderer: { scene: THREE.Scene };
  grid: { dispose(scene: THREE.Scene): void };
  clearSelectionHelper(): void;
  dispose(): void;
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

interface PhysicsTypeManagerHarness {
  guardDocumentMutation(): boolean;
  document: EditorDocument;
  physicsWorld: PhysicsWorld;
  levelManager: LevelManager;
  inspectorPanel: { setSelection: ReturnType<typeof vi.fn> };
  showPhysicsMutationError: ReturnType<typeof vi.fn>;
  markDirty: ReturnType<typeof vi.fn>;
  history: CommandHistory;
  applyPhysicsTypeChange(id: string, type: "static" | "dynamic" | "kinematic"): void;
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
  cancelPendingMaterialEdit(): void;
  materialEditSession: MaterialManagerHarness["materialEditSession"];
  applyMaterialChange(id: string, material: NonNullable<EditorObject["material"]>, phase: "preview" | "commit"): void;
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
  manager.document = {
    selected,
    objects: [selected],
    findById: (id) => (id === selected.id ? selected : undefined),
  };
  manager.validatePhysicsSubtree = () => ({ ok: true });
  manager.inspectorPanel = { setSelection: vi.fn() };
  manager.showPhysicsMutationError = vi.fn();
  manager.markDirty = vi.fn();
  manager.syncPhysicsSubtree = vi.fn();
  manager.inspectorEditStartTransform = null;
  manager.inspectorEditObjectId = null;
  return manager;
}

type PhysicsFailurePhase =
  | "success"
  | "allocation"
  | "collider"
  | "publication"
  | "destructive-retirement"
  | "replacement-cleanup"
  | "restoration";

type FakePhysicsBody = {
  id: string;
  live: boolean;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  isValid(): boolean;
};

type FakePhysicsCollider = {
  id: string;
  live: boolean;
  body?: FakePhysicsBody;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  isValid(): boolean;
};

function makePhysicsFailureHarness(phase: PhysicsFailurePhase) {
  const scene = new THREE.Scene();
  const liveBodies = new Set<FakePhysicsBody>();
  const liveColliders = new Set<FakePhysicsCollider>();
  const removedBodies: FakePhysicsBody[] = [];
  const removedColliders: FakePhysicsCollider[] = [];
  let nextBody = 0;
  let nextCollider = 0;
  const makeBody = (id: string, initiallyEnabled = true): FakePhysicsBody => {
    let enabled = initiallyEnabled;
    const body = {
      id,
      live: true,
      setEnabled: vi.fn((next: boolean) => {
        enabled = next;
      }),
      isEnabled() {
        return enabled;
      },
      isValid() {
        return this.live;
      },
    };
    liveBodies.add(body);
    return body;
  };
  const makeCollider = (id: string, body?: FakePhysicsBody, initiallyEnabled = true): FakePhysicsCollider => {
    let enabled = initiallyEnabled;
    const collider = {
      id,
      body,
      live: true,
      setEnabled: vi.fn((next: boolean) => {
        enabled = next;
      }),
      isEnabled() {
        return enabled;
      },
      isValid() {
        return this.live;
      },
    };
    liveColliders.add(collider);
    return collider;
  };
  const destroyBody = (body: FakePhysicsBody): void => {
    body.live = false;
    liveBodies.delete(body);
    for (const collider of [...liveColliders]) {
      if (collider.body !== body) continue;
      collider.live = false;
      liveColliders.delete(collider);
    }
  };
  const destroyCollider = (collider: FakePhysicsCollider): void => {
    collider.live = false;
    liveColliders.delete(collider);
  };

  const oldBody = makeBody("old-body");
  const oldCollider = makeCollider("old-collider", oldBody);
  const createRigidBody = vi.fn((desc: RAPIER.RigidBodyDesc) => {
    if (phase === "allocation") throw new Error("body allocation failed");
    return makeBody(`replacement-body-${++nextBody}`, desc.enabled);
  });
  const createCollider = vi.fn((desc: RAPIER.ColliderDesc, body?: FakePhysicsBody) => {
    if (phase === "collider" || phase === "replacement-cleanup") {
      throw new Error("collider creation failed");
    }
    return makeCollider(`replacement-collider-${++nextCollider}`, body, desc.enabled);
  });
  const removeBody = vi.fn((body: FakePhysicsBody) => {
    removedBodies.push(body);
    if (phase === "destructive-retirement" && body === oldBody) {
      destroyBody(body);
      throw new Error("old body retirement failed after destruction");
    }
    if (phase === "replacement-cleanup" && body !== oldBody) {
      destroyBody(body);
      throw new Error("replacement cleanup failed after destruction");
    }
    destroyBody(body);
  });
  const removeCollider = vi.fn((collider: FakePhysicsCollider) => {
    removedColliders.push(collider);
    destroyCollider(collider);
  });
  const physicsWorld = {
    world: { createRigidBody, createCollider },
    removeBody,
    removeCollider,
  } as unknown as PhysicsWorld;
  const levelManager = new LevelManager(scene, physicsWorld, new EventBus());
  const document = new EditorDocument(scene, physicsWorld);
  const target = makeObject();
  target.body = oldBody as unknown as RAPIER.RigidBody;
  target.collider = oldCollider as unknown as RAPIER.Collider;
  scene.add(target.mesh);
  document.objects = [target];
  document.selected = target;
  levelManager.addLevelObject(target.mesh, {
    physics: { body: target.body, collider: target.collider },
  });

  const originalAdd = levelManager.addLevelObject.bind(levelManager);
  if (phase === "publication" || phase === "restoration") {
    let failedPublications = 0;
    vi.spyOn(levelManager, "addLevelObject").mockImplementation((mesh, options) => {
      originalAdd(mesh, options);
      if (failedPublications === 0) {
        failedPublications += 1;
        throw new Error("replacement LevelManager publication failed");
      }
      if (phase === "restoration" && failedPublications === 1) {
        failedPublications += 1;
        throw new Error("current LevelManager restoration failed");
      }
    });
  }

  const dirty = vi.fn();
  const manager = Object.create(EditorManager.prototype) as PhysicsTypeManagerHarness;
  Object.assign(manager, {
    guardDocumentMutation: () => true,
    document,
    physicsWorld,
    levelManager,
    inspectorPanel: { setSelection: vi.fn() },
    showPhysicsMutationError: vi.fn(),
    markDirty: dirty,
    history: new CommandHistory(dirty),
  });
  const metadataKey = "__kinemaLevelObjectPhysics";
  const project = () => {
    const tracking = levelManager.getLevelObjectTracking(target.mesh);
    const internals = levelManager as unknown as {
      levelBodies: RAPIER.RigidBody[];
      levelColliders: RAPIER.Collider[];
      objectPhysics: Map<THREE.Object3D, { body?: RAPIER.RigidBody; collider?: RAPIER.Collider }>;
    };
    const metadata = target.mesh.userData[metadataKey] as
      | { body?: RAPIER.RigidBody; collider?: RAPIER.Collider }
      | undefined;
    return {
      type: target.physicsType,
      body: target.body,
      collider: target.collider,
      tracked: levelManager.getLevelObjects().includes(target.mesh),
      dynamicBody: levelManager.getDynamicBodies()[0]?.body,
      trackingBody: tracking.physics?.body,
      trackingCollider: tracking.physics?.collider,
      levelBodies: [...internals.levelBodies],
      levelColliders: [...internals.levelColliders],
      mapBody: internals.objectPhysics.get(target.mesh)?.body,
      mapCollider: internals.objectPhysics.get(target.mesh)?.collider,
      metadataBody: metadata?.body,
      metadataCollider: metadata?.collider,
      liveBodies: [...liveBodies],
      liveColliders: [...liveColliders],
    };
  };
  return {
    manager,
    target,
    oldBody,
    oldCollider,
    dirty,
    project,
    removedBodies,
    removedColliders,
    liveBodies,
    liveColliders,
  };
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

function makeHierarchyHarness() {
  const scene = new THREE.Scene();
  const physicsWorld = {} as PhysicsWorld;
  const levelManager = new LevelManager(scene, physicsWorld, new EventBus());
  const document = new EditorDocument(scene, physicsWorld);
  const parentA = makeTrackedObject("parent-a", null, ["child", "sibling"], "static");
  const child = makeTrackedObject("child", parentA.id, ["grandchild"], "dynamic");
  const sibling = makeTrackedObject("sibling", parentA.id, [], "static");
  const grandchild = makeTrackedObject("grandchild", child.id, [], "static");
  const parentB = makeTrackedObject("parent-b", null, [], "static");

  parentA.mesh.position.set(4, -2, 3);
  parentA.mesh.rotation.set(0.1, -0.2, 0.3);
  child.mesh.position.set(-1, 2, 0.5);
  child.mesh.rotation.set(-0.2, 0.4, -0.1);
  child.mesh.scale.set(1.2, 0.8, 1.1);
  sibling.mesh.position.set(3, 1, -2);
  grandchild.mesh.position.set(0.25, 0.5, -0.75);
  parentB.mesh.position.set(-5, 1, 6);
  parentB.mesh.rotation.set(-0.1, 0.25, -0.35);
  for (const object of [parentA, child, sibling, grandchild, parentB]) {
    object.transform = {
      position: object.mesh.position.toArray(),
      rotation: object.mesh.rotation.toArray().slice(0, 3) as [number, number, number],
      scale: object.mesh.scale.toArray(),
    };
  }
  scene.add(parentA.mesh, parentB.mesh);
  parentA.mesh.add(child.mesh, sibling.mesh);
  child.mesh.add(grandchild.mesh);
  document.objects = [parentB, child, parentA, grandchild, sibling];
  document.selected = grandchild;
  for (const object of document.objects) levelManager.addLevelObject(object.mesh);

  const physicsPose = {
    position: child.mesh.getWorldPosition(new THREE.Vector3()).toArray(),
    rotation: child.mesh.getWorldQuaternion(new THREE.Quaternion()).toArray(),
  };
  const syncPhysicsSubtree = vi.fn((root: EditorObject) => {
    let cursor: THREE.Object3D | null = child.mesh;
    let includesChild = false;
    while (cursor) {
      if (cursor === root.mesh) includesChild = true;
      cursor = cursor.parent;
    }
    if (includesChild) {
      physicsPose.position = child.mesh.getWorldPosition(new THREE.Vector3()).toArray();
      physicsPose.rotation = child.mesh.getWorldQuaternion(new THREE.Quaternion()).toArray();
    }
    return { ok: true as const };
  });
  const markDirty = vi.fn();
  const manager = Object.create(EditorManager.prototype) as unknown as HierarchyManagerHarness;
  Object.assign(manager, {
    guardDocumentMutation: () => true,
    commitPendingMaterialEdit: () => true,
    document,
    renderer: { scene },
    levelManager,
    gizmo: { attach: vi.fn() },
    inspectorPanel: { setSelection: vi.fn() },
    hierarchyPanel: { setSelection: vi.fn(), setObjects: vi.fn() },
    setSelectionHelper: vi.fn(),
    eventBus: { emit: vi.fn() },
    showPhysicsMutationError: vi.fn(),
    markDirty,
    syncPhysicsSubtree,
    finalizeDetachedHierarchyObject: vi.fn(),
    history: new CommandHistory(markDirty),
  });

  const project = () => {
    scene.updateMatrixWorld(true);
    const objectByMesh = new Map(document.objects.map((object) => [object.mesh, object.id]));
    return {
      document: document.objects.map((object) => ({
        id: object.id,
        parentId: object.parentId ?? null,
        children: [...(object.children ?? [])],
        local: {
          position: object.mesh.position.toArray(),
          rotation: object.mesh.rotation.toArray().slice(0, 3),
          scale: object.mesh.scale.toArray(),
        },
        world: [...object.mesh.matrixWorld.elements],
        meshParent: object.mesh.parent ? (objectByMesh.get(object.mesh.parent) ?? null) : null,
        meshChildren: object.mesh.children.map((mesh) => objectByMesh.get(mesh)),
      })),
      selected: document.selected?.id ?? null,
      levelObjects: levelManager.getLevelObjects().map((mesh) => objectByMesh.get(mesh)),
      physicsPose: structuredClone(physicsPose),
    };
  };
  return { manager, document, scene, levelManager, parentA, child, sibling, grandchild, parentB, project, markDirty };
}

function makePhysicsEnabledGroupHarness() {
  const scene = new THREE.Scene();
  let bodyEnabled = true;
  let colliderEnabled = true;
  const body = {
    setEnabled: vi.fn((enabled: boolean) => {
      bodyEnabled = enabled;
    }),
    isEnabled: () => bodyEnabled,
  };
  const collider = {
    setEnabled: vi.fn((enabled: boolean) => {
      colliderEnabled = enabled;
    }),
    isEnabled: () => colliderEnabled,
  };
  const removeBody = vi.fn();
  const removeCollider = vi.fn();
  const physicsWorld = { removeBody, removeCollider } as unknown as PhysicsWorld;
  const levelManager = new LevelManager(scene, physicsWorld, new EventBus());
  const document = new EditorDocument(scene, physicsWorld);
  const group = makeTrackedObject("existing-group", null, ["existing-child"], "static", body, collider);
  const child = makeTrackedObject("existing-child", group.id, [], "static");
  scene.add(group.mesh);
  group.mesh.add(child.mesh);
  document.objects = [group, child];
  document.selected = group;
  levelManager.addLevelObject(child.mesh);
  levelManager.addLevelObject(group.mesh, { physics: { body: group.body, collider: group.collider } });
  body.setEnabled.mockClear();
  collider.setEnabled.mockClear();

  const markDirty = vi.fn();
  const manager = Object.create(EditorManager.prototype) as unknown as HierarchyManagerHarness;
  Object.assign(manager, {
    guardDocumentMutation: () => true,
    commitPendingMaterialEdit: () => true,
    document,
    renderer: { scene },
    physicsWorld,
    levelManager,
    gizmo: { attach: vi.fn() },
    inspectorPanel: { setSelection: vi.fn() },
    hierarchyPanel: { setSelection: vi.fn(), setObjects: vi.fn() },
    setSelectionHelper: vi.fn(),
    eventBus: { emit: vi.fn() },
    showPhysicsMutationError: vi.fn(),
    markDirty,
    syncPhysicsSubtree: vi.fn(() => ({ ok: true as const })),
    history: new CommandHistory(markDirty),
  });
  const ownership = () => {
    const internals = levelManager as unknown as {
      levelBodies: RAPIER.RigidBody[];
      levelColliders: RAPIER.Collider[];
      objectPhysics: Map<THREE.Object3D, unknown>;
    };
    return {
      levelBodies: [...internals.levelBodies],
      levelColliders: [...internals.levelColliders],
      hasMetadata: internals.objectPhysics.has(group.mesh),
    };
  };
  return { manager, document, levelManager, group, child, body, collider, removeBody, removeCollider, ownership };
}

function makeOrderedPhysicsGroupHarness() {
  const scene = new THREE.Scene();
  const physicsWorld = { removeBody: vi.fn(), removeCollider: vi.fn() } as unknown as PhysicsWorld;
  const levelManager = new LevelManager(scene, physicsWorld, new EventBus());
  const document = new EditorDocument(scene, physicsWorld);
  const groupBody = { id: "group-body", setEnabled: vi.fn() };
  const groupCollider = { id: "group-collider", setEnabled: vi.fn() };
  const laterBody = { id: "later-body", setEnabled: vi.fn() };
  const laterCollider = { id: "later-collider", setEnabled: vi.fn() };
  const group = makeTrackedObject("ordered-group", null, ["ordered-child"], "dynamic", groupBody, groupCollider);
  const child = makeTrackedObject("ordered-child", group.id, [], "static");
  const later = makeTrackedObject("later-sibling", null, [], "dynamic", laterBody, laterCollider);
  scene.add(group.mesh, later.mesh);
  group.mesh.add(child.mesh);
  document.objects = [group, child, later];
  document.selected = group;
  const dynamicEntry = (object: EditorObject, body: { setEnabled: ReturnType<typeof vi.fn> }) => ({
    mesh: object.mesh,
    body: body as unknown as RAPIER.RigidBody,
    prevPos: new THREE.Vector3(),
    currPos: new THREE.Vector3(),
    prevQuat: new THREE.Quaternion(),
    currQuat: new THREE.Quaternion(),
    hasPose: false,
  });
  levelManager.addLevelObject(group.mesh, {
    physics: { body: group.body, collider: group.collider },
    dynamicBody: dynamicEntry(group, groupBody),
  });
  levelManager.addLevelObject(child.mesh);
  levelManager.addLevelObject(later.mesh, {
    physics: { body: later.body, collider: later.collider },
    dynamicBody: dynamicEntry(later, laterBody),
  });
  for (const handle of [groupBody, groupCollider, laterBody, laterCollider]) handle.setEnabled.mockClear();

  const markDirty = vi.fn();
  const syncPhysicsSubtree = vi.fn((): { ok: true } | { ok: false; reason: string } => ({ ok: true }));
  const manager = Object.create(EditorManager.prototype) as unknown as HierarchyManagerHarness;
  Object.assign(manager, {
    guardDocumentMutation: () => true,
    commitPendingMaterialEdit: () => true,
    document,
    renderer: { scene },
    physicsWorld,
    levelManager,
    gizmo: { attach: vi.fn() },
    inspectorPanel: { setSelection: vi.fn() },
    hierarchyPanel: { setSelection: vi.fn(), setObjects: vi.fn() },
    setSelectionHelper: vi.fn(),
    eventBus: { emit: vi.fn() },
    showPhysicsMutationError: vi.fn(),
    markDirty,
    syncPhysicsSubtree,
    history: new CommandHistory(markDirty),
  });
  const projectTracking = () => {
    const internals = levelManager as unknown as {
      levelBodies: Array<{ id: string }>;
      levelColliders: Array<{ id: string }>;
      objectPhysics: Map<THREE.Object3D, { body?: unknown; collider?: unknown }>;
    };
    return {
      levelObjects: levelManager.getLevelObjects().map(({ name }) => name),
      dynamicBodies: levelManager.getDynamicBodies().map(({ mesh }) => mesh.name),
      levelBodies: internals.levelBodies.map(({ id }) => id),
      levelColliders: internals.levelColliders.map(({ id }) => id),
      physicsOwnership: [group, later].map((object) => ({
        id: object.id,
        body: internals.objectPhysics.get(object.mesh)?.body,
        collider: internals.objectPhysics.get(object.mesh)?.collider,
      })),
    };
  };
  return { manager, document, levelManager, group, child, later, markDirty, syncPhysicsSubtree, projectTracking };
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
    materialEditSession: null,
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

function projectLiveMaterials(materials: readonly THREE.MeshStandardMaterial[]) {
  return materials.map((material) => ({
    color: [material.color.r, material.color.g, material.color.b],
    roughness: material.roughness,
    metalness: material.metalness,
    emissive: [material.emissive.r, material.emissive.g, material.emissive.b],
    emissiveIntensity: material.emissiveIntensity,
    opacity: material.opacity,
    transparent: material.transparent,
  }));
}

describe("EditorManager inspector transform transactions", () => {
  it("previews three body poses without history, then commits one exact undoable transform", () => {
    const selected = makeObject();
    const manager = makeManager(selected);
    const bodyPose = { position: [0, 0, 0] as number[], rotation: [0, 0, 0] as number[] };
    selected.body = { id: "body" } as unknown as RAPIER.RigidBody;
    selected.collider = { id: "collider" } as unknown as RAPIER.Collider;
    manager.syncPhysicsSubtree = vi.fn((root: EditorObject) => {
      bodyPose.position = root.mesh.position.toArray();
      bodyPose.rotation = root.mesh.rotation.toArray().slice(0, 3) as number[];
      return { ok: true };
    });
    manager.history = new CommandHistory(() => (manager.markDirty as unknown as () => void)());
    const before = {
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };
    const after: TransformTuple = { position: [4, 5, 6], rotation: [0.1, 0.2, 0.3], scale: [2, 3, 4] };
    const previews: TransformTuple[] = [
      { position: [1, 0, 0], rotation: [0.1, 0, 0], scale: [1, 1, 1] },
      { position: [2, 3, 0], rotation: [0.1, 0.2, 0], scale: [1, 1, 1] },
      after,
    ];
    const snapshot = () => ({
      mesh: {
        position: selected.mesh.position.toArray(),
        rotation: selected.mesh.rotation.toArray().slice(0, 3),
        scale: selected.mesh.scale.toArray(),
      },
      serialized: structuredClone(selected.transform),
      bodyPose: structuredClone(bodyPose),
    });

    for (const preview of previews) manager.applyInspectorTransform(preview, "preview");
    expect(snapshot()).toEqual({
      mesh: after,
      serialized: after,
      bodyPose: { position: after.position, rotation: after.rotation },
    });
    expect(manager.markDirty).not.toHaveBeenCalled();
    expect(manager.history.undo()).toBe(false);

    manager.applyInspectorTransform(after, "commit");
    manager.applyInspectorTransform(after, "commit");
    expect(manager.markDirty).toHaveBeenCalledOnce();
    expect(manager.history.undo()).toBe(true);
    expect(snapshot()).toEqual({
      mesh: before,
      serialized: before,
      bodyPose: { position: before.position, rotation: before.rotation },
    });
    expect(manager.history.redo()).toBe(true);
    expect(snapshot()).toEqual({
      mesh: after,
      serialized: after,
      bodyPose: { position: after.position, rotation: after.rotation },
    });
    expect(manager.markDirty).toHaveBeenCalledTimes(3);
  });

  it("keeps transform, serialized state, physics, history, and dirty state before a failed commit", () => {
    const selected = makeObject();
    const manager = makeManager(selected);
    const oldBody = { pose: [0, 0, 0] as number[] };
    const oldCollider = { id: "old-collider" };
    selected.body = oldBody as unknown as RAPIER.RigidBody;
    selected.collider = oldCollider as unknown as RAPIER.Collider;
    let failRebuild = false;
    manager.syncPhysicsSubtree = vi.fn(
      (
        root: EditorObject,
        shouldRebuildCollider: (entry: EditorObject, nextPose: ReturnType<typeof getObjectWorldPhysicsPose>) => boolean,
      ) => {
        if (shouldRebuildCollider(root, getObjectWorldPhysicsPose(root.mesh)) && failRebuild) {
          return { ok: false, reason: "second descendant failed" };
        }
        oldBody.pose = root.mesh.position.toArray();
        return { ok: true };
      },
    );
    manager.history = new CommandHistory(() => (manager.markDirty as unknown as () => void)());
    const seed = { execute: () => true, undo: () => true };
    expect(manager.history.push(seed)).toBe(true);
    expect(manager.history.undo()).toBe(true);
    manager.markDirty.mockClear();
    const after: TransformTuple = { position: [3, 4, 5], rotation: [0.2, 0.3, 0.4], scale: [2, 2, 2] };

    manager.applyInspectorTransform(after, "preview");
    failRebuild = true;
    manager.applyInspectorTransform(after, "commit");

    expect(selected.mesh.position.toArray()).toEqual([0, 0, 0]);
    expect(selected.mesh.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(selected.mesh.scale.toArray()).toEqual([1, 1, 1]);
    expect(selected.transform).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(selected.body).toBe(oldBody);
    expect(selected.collider).toBe(oldCollider);
    expect(oldBody.pose).toEqual([0, 0, 0]);
    expect(manager.markDirty).not.toHaveBeenCalled();
    expect(manager.history.redo()).toBe(true);
    expect(manager.showPhysicsMutationError).toHaveBeenCalledWith(
      expect.stringMatching(/reverted.*second descendant/i),
    );
  });

  it("reconciles the before body pose when preliminary inspector restore sync rolls back to preview", () => {
    const selected = makeObject();
    const manager = makeManager(selected);
    const before: TransformTuple = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const after: TransformTuple = { position: [7, 8, 9], rotation: [0.2, 0.3, 0.4], scale: [1, 1, 1] };
    const bodyPose = { position: [...before.position], rotation: [...before.rotation] };
    selected.body = { id: "body" } as unknown as RAPIER.RigidBody;
    manager.history = new CommandHistory(() => (manager.markDirty as unknown as () => void)());
    let failPreliminaryRestore = true;
    manager.syncPhysicsSubtree = vi.fn((root: EditorObject) => {
      const previous = structuredClone(bodyPose);
      bodyPose.position = root.mesh.position.toArray();
      bodyPose.rotation = root.mesh.rotation.toArray().slice(0, 3) as number[];
      if (root.mesh.position.x === before.position[0] && failPreliminaryRestore) {
        failPreliminaryRestore = false;
        bodyPose.position = previous.position;
        bodyPose.rotation = previous.rotation;
        return { ok: false, reason: "preliminary pose sync failed and rolled back" };
      }
      return { ok: true };
    });

    manager.applyInspectorTransform(after, "preview");
    manager.applyInspectorTransform(after, "commit");

    expect(selected.mesh.position.toArray()).toEqual(before.position);
    expect(selected.mesh.rotation.toArray().slice(0, 3)).toEqual(before.rotation);
    expect(selected.transform).toEqual(before);
    expect(bodyPose).toEqual({ position: before.position, rotation: before.rotation });
    expect(manager.history.undo()).toBe(false);
    expect(manager.markDirty).not.toHaveBeenCalled();
    expect(manager.showPhysicsMutationError).toHaveBeenCalledWith(expect.stringMatching(/preliminary/i));
  });
});

describe("EditorManager scalar and material history transactions", () => {
  it("applies exact hierarchy state and restores selection through hide and lock history", () => {
    const scene = new THREE.Scene();
    const document = new EditorDocument(scene, {} as PhysicsWorld);
    const target = makeObject();
    scene.add(target.mesh);
    document.objects = [target];
    document.selected = target;
    const dirty = vi.fn();
    const publicationOrder: string[] = [];
    const selectedDuringPublication = (): string => document.selected?.id ?? "none";
    const manager = Object.create(EditorManager.prototype) as ScalarManagerHarness;
    Object.assign(manager, {
      document,
      gizmo: { attach: vi.fn(() => publicationOrder.push(`gizmo:${selectedDuringPublication()}`)) },
      inspectorPanel: {
        setSelection: vi.fn(() => publicationOrder.push(`inspector:${selectedDuringPublication()}`)),
      },
      hierarchyPanel: {
        setSelection: vi.fn(() => publicationOrder.push(`hierarchy-selection:${selectedDuringPublication()}`)),
        setObjects: vi.fn(() => publicationOrder.push(`hierarchy-objects:${selectedDuringPublication()}`)),
      },
      setSelectionHelper: vi.fn(() => publicationOrder.push(`helper:${selectedDuringPublication()}`)),
      eventBus: { emit: vi.fn(() => publicationOrder.push(`event:${selectedDuringPublication()}`)) },
      history: new CommandHistory(dirty),
      guardDocumentMutation: () => true,
    });

    const expectPublishedSelection = (selected: EditorObject | null): void => {
      const selectedId = selected?.id ?? "none";
      expect(document.selected).toBe(selected);
      expect(publicationOrder).toEqual([
        `gizmo:${selectedId}`,
        `inspector:${selectedId}`,
        `hierarchy-selection:${selectedId}`,
        `helper:${selectedId}`,
        `event:${selectedId}`,
        `hierarchy-objects:${selectedId}`,
      ]);
      expect(manager.gizmo.attach).toHaveBeenLastCalledWith(selected?.mesh ?? null);
      expect(manager.inspectorPanel.setSelection).toHaveBeenLastCalledWith(selected);
      expect(manager.hierarchyPanel.setSelection).toHaveBeenLastCalledWith(selected?.id ?? null);
      expect(manager.setSelectionHelper).toHaveBeenLastCalledWith(selected?.mesh ?? null);
      expect(manager.eventBus.emit).toHaveBeenLastCalledWith(
        "editor:objectSelected",
        selected ? { id: selected.id } : null,
      );
      expect(manager.hierarchyPanel.setObjects).toHaveBeenLastCalledWith(document.objects);
      publicationOrder.length = 0;
    };

    manager.renameById(target.id, "Renamed");
    publicationOrder.length = 0;
    manager.toggleVisibilityById(target.id);
    expect(target.name).toBe("Renamed");
    expect(target.mesh.name).toBe("Renamed");
    expect(target.visible).toBe(false);
    expect(target.mesh.visible).toBe(false);
    expectPublishedSelection(null);

    expect(manager.history.undo()).toBe(true);
    expect(target.visible).toBe(true);
    expect(target.mesh.visible).toBe(true);
    expectPublishedSelection(target);
    expect(manager.history.redo()).toBe(true);
    expect(target.visible).toBe(false);
    expect(target.mesh.visible).toBe(false);
    expectPublishedSelection(null);
    expect(manager.history.undo()).toBe(true);
    expectPublishedSelection(target);

    manager.toggleLockById(target.id);
    expect(target.locked).toBe(true);
    expectPublishedSelection(null);
    expect(manager.history.undo()).toBe(true);
    expect(target.locked).toBe(false);
    expectPublishedSelection(target);
    expect(manager.history.redo()).toBe(true);
    expect(target.locked).toBe(true);
    expectPublishedSelection(null);
    expect(manager.history.undo()).toBe(true);
    expect(target.locked).toBe(false);
    expectPublishedSelection(target);
    expect(dirty).toHaveBeenCalledTimes(9);
  });

  it("previews heterogeneous shared materials without dirtying and commits one exact undoable snapshot", () => {
    const scene = new THREE.Scene();
    const document = new EditorDocument(scene, {} as PhysicsWorld);
    const root = new THREE.Group();
    const shared = new THREE.MeshStandardMaterial({
      color: "#112233",
      roughness: 0.21,
      metalness: 0.31,
      emissive: "#010203",
      emissiveIntensity: 0.41,
      opacity: 0.51,
      transparent: true,
    });
    const other = new THREE.MeshStandardMaterial({
      color: "#abcdef",
      roughness: 0.62,
      metalness: 0.72,
      emissive: "#101112",
      emissiveIntensity: 0.82,
      opacity: 0.92,
      transparent: false,
    });
    shared.color.setRGB(0.123456789, 0.234567891, 0.345678912);
    shared.emissive.setRGB(0.456789123, 0.567891234, 0.678912345);
    other.color.setRGB(0.789123456, 0.891234567, 0.912345678);
    other.emissive.setRGB(0.321987654, 0.210876543, 0.109765432);
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(), shared),
      new THREE.Mesh(new THREE.BoxGeometry(), other),
      new THREE.Mesh(new THREE.BoxGeometry(), shared),
    );
    const target: EditorObject = {
      ...makeObject(),
      id: "material-target",
      mesh: root,
      material: {
        color: "#223344",
        roughness: 0.25,
        metalness: 0.35,
        emissive: "#020304",
        emissiveIntensity: 0.45,
        opacity: 0.55,
      },
    };
    scene.add(root);
    document.objects = [target];
    document.selected = target;
    const beforeSerialized = structuredClone(target.material);
    const beforeLive = projectLiveMaterials([shared, other]);
    const dirty = vi.fn();
    const manager = Object.create(EditorManager.prototype) as MaterialManagerHarness;
    Object.assign(manager, {
      guardDocumentMutation: () => true,
      document,
      inspectorPanel: { setSelection: vi.fn() },
      history: new CommandHistory(dirty),
      materialEditSession: null,
    });
    const first = {
      color: "#ff0000",
      roughness: 0.1,
      metalness: 0.2,
      emissive: "#001100",
      emissiveIntensity: 0.3,
      opacity: 0.4,
    };
    const after = { ...first, color: "#00ff00", opacity: 1 };

    manager.applyMaterialChange(target.id, first, "preview");
    expect(manager.materialEditSession?.before.live).toHaveLength(2);
    expect(manager.materialEditSession?.before.live.map(({ material }) => material)).toEqual([shared, other]);
    manager.applyMaterialChange(target.id, after, "preview");
    const afterLive = projectLiveMaterials([shared, other]);
    expect(target.material).toEqual(after);
    expect([shared, other].map((material) => `#${material.color.getHexString()}`)).toEqual(["#00ff00", "#00ff00"]);
    expect([shared.transparent, other.transparent]).toEqual([false, false]);
    expect(dirty).not.toHaveBeenCalled();
    expect(manager.history.undo()).toBe(false);

    manager.applyMaterialChange(target.id, after, "commit");
    manager.applyMaterialChange(target.id, after, "commit");
    expect(dirty).toHaveBeenCalledOnce();
    expect(manager.history.undo()).toBe(true);
    expect(target.material).toEqual(beforeSerialized);
    expect(projectLiveMaterials([shared, other])).toEqual(beforeLive);
    expect(manager.history.redo()).toBe(true);
    expect(target.material).toEqual(after);
    expect(projectLiveMaterials([shared, other])).toEqual(afterLive);
    expect(dirty).toHaveBeenCalledTimes(3);
  });

  it("commits a pending material edit before changing selection", () => {
    const scene = new THREE.Scene();
    const document = new EditorDocument(scene, {} as PhysicsWorld);
    const material = new THREE.MeshStandardMaterial({ color: "#101010" });
    const target = { ...makeObject(), id: "target", mesh: new THREE.Mesh(new THREE.BoxGeometry(), material) };
    const other = { ...makeObject(), id: "other", mesh: new THREE.Mesh(new THREE.BoxGeometry()) };
    target.material = {
      color: "#101010",
      roughness: material.roughness,
      metalness: material.metalness,
      emissive: "#000000",
      emissiveIntensity: material.emissiveIntensity,
      opacity: material.opacity,
    };
    document.objects = [target, other];
    document.selected = target;
    const dirty = vi.fn();
    const manager = Object.create(EditorManager.prototype) as MaterialSelectionHarness;
    Object.assign(manager, {
      guardDocumentMutation: () => true,
      document,
      inspectorPanel: { setSelection: vi.fn() },
      hierarchyPanel: { setSelection: vi.fn() },
      gizmo: { attach: vi.fn() },
      setSelectionHelper: vi.fn(),
      eventBus: { emit: vi.fn() },
      history: new CommandHistory(dirty),
      materialEditSession: null,
      inspectorEditStartTransform: null,
      inspectorEditObjectId: null,
    });

    manager.applyMaterialChange(target.id, { ...target.material, color: "#f00000" }, "preview");
    manager.setSelection(other);

    expect(document.selected).toBe(other);
    expect(dirty).toHaveBeenCalledOnce();
    expect(manager.materialEditSession).toBeNull();
    expect(manager.history.undo()).toBe(true);
    expect(material.color.getHexString()).toBe("101010");
  });

  it("restores a real pending preview when material history push is rejected", () => {
    const scene = new THREE.Scene();
    const document = new EditorDocument(scene, {} as PhysicsWorld);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.27, metalness: 0.38 });
    material.color.setRGB(0.123456789, 0.234567891, 0.345678912);
    material.emissive.setRGB(0.456789123, 0.567891234, 0.678912345);
    material.emissiveIntensity = 0.49;
    material.opacity = 0.61;
    material.transparent = true;
    const target: EditorObject = {
      ...makeObject(),
      id: "target",
      mesh: new THREE.Mesh(new THREE.BoxGeometry(), material),
      material: {
        color: "#123456",
        roughness: 0.27,
        metalness: 0.38,
        emissive: "#654321",
        emissiveIntensity: 0.49,
        opacity: 0.61,
      },
    };
    const other = { ...makeObject(), id: "other" };
    document.objects = [target, other];
    document.selected = target;
    const beforeSerialized = structuredClone(target.material);
    const beforeLive = projectLiveMaterials([material]);
    const dirty = vi.fn();
    const rejected = vi.fn();
    let canMutate = true;
    const manager = Object.create(EditorManager.prototype) as MaterialSelectionHarness;
    Object.assign(manager, {
      guardDocumentMutation: () => true,
      document,
      inspectorPanel: { setSelection: vi.fn() },
      hierarchyPanel: { setSelection: vi.fn() },
      gizmo: { attach: vi.fn() },
      setSelectionHelper: vi.fn(),
      eventBus: { emit: vi.fn() },
      history: new CommandHistory(dirty, () => canMutate, rejected),
      materialEditSession: null,
      inspectorEditStartTransform: null,
      inspectorEditObjectId: null,
    });

    manager.applyMaterialChange(
      target.id,
      {
        color: "#abcdef",
        roughness: 0.72,
        metalness: 0.83,
        emissive: "#fedcba",
        emissiveIntensity: 0.94,
        opacity: 1,
      },
      "preview",
    );
    canMutate = false;
    manager.setSelection(other);

    expect(document.selected).toBe(target);
    expect(target.material).toEqual(beforeSerialized);
    expect(projectLiveMaterials([material])).toEqual(beforeLive);
    expect(manager.materialEditSession).toBeNull();
    expect(dirty).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledOnce();
    canMutate = true;
    expect(manager.history.undo()).toBe(false);
  });

  it("flushes pending material edits before save and aborts playtest when a flush fails", async () => {
    const saveManager = Object.create(EditorManager.prototype) as SaveBoundaryHarness;
    const saveCommit = vi.fn(() => true);
    Object.assign(saveManager, {
      commitPendingMaterialEdit: saveCommit,
      documentState: { value: { name: "Untitled" } },
    });
    vi.stubGlobal("window", { prompt: vi.fn(() => null) });
    try {
      await saveManager.saveLevel();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(saveCommit).toHaveBeenCalledOnce();

    const playManager = Object.create(EditorManager.prototype) as PlaytestBoundaryHarness;
    const playCommit = vi.fn(() => false);
    const clear = vi.fn();
    Object.assign(playManager, {
      active: true,
      playTestActive: false,
      guardDocumentMutation: () => true,
      commitPendingMaterialEdit: playCommit,
      history: { clear },
    });
    try {
      playManager.startPlayTest();
    } catch {
      // The RED implementation continues into unrelated playtest dependencies.
    }
    expect(playCommit).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
  });

  it("cancels pending material state only after a user load is validated and owns teardown", async () => {
    const invalidHarness = makeDeleteHarness();
    const invalidCancel = vi.fn();
    invalidHarness.manager.cancelPendingMaterialEdit = invalidCancel;
    const invalidToken = invalidHarness.manager.loadTransaction.begin("user-load");
    if (!invalidToken) throw new Error("Expected a user-load token.");
    const invalid = { ...emptyLevelData(), version: 1 } as unknown as LevelData;
    await invalidHarness.manager.applyLoadedLevelContents(invalid, "user-load", invalidToken);
    expect(invalidCancel).not.toHaveBeenCalled();

    const harness = makeDeleteHarness();
    const order: string[] = [];
    harness.manager.cancelPendingMaterialEdit = vi.fn(() => order.push("cancel"));
    const unload = harness.levelManager.unload.bind(harness.levelManager);
    vi.spyOn(harness.levelManager, "unload").mockImplementation(() => {
      order.push("unload");
      unload();
    });
    const token = harness.manager.loadTransaction.begin("user-load");
    if (!token) throw new Error("Expected a user-load token.");
    await harness.manager.applyLoadedLevelContents(emptyLevelData(), "user-load", token);
    expect(order.slice(0, 2)).toEqual(["cancel", "unload"]);
  });

  it("cancels pending material state before external unload and manager disposal", () => {
    const externalOrder: string[] = [];
    const externalManager = Object.create(EditorManager.prototype) as ExternalUnloadHarness;
    Object.assign(externalManager, {
      cancelPendingMaterialEdit: vi.fn(() => externalOrder.push("cancel")),
      history: { clear: vi.fn(() => externalOrder.push("clear")) },
    });
    externalManager.prepareForExternalUnload();
    expect(externalOrder).toEqual(["cancel", "clear"]);

    const disposeOrder: string[] = [];
    const disposeManager = Object.create(EditorManager.prototype) as DisposeBoundaryHarness;
    Object.assign(disposeManager, {
      cancelPendingMaterialEdit: vi.fn(() => disposeOrder.push("cancel")),
      loadTransaction: { invalidate: vi.fn(() => disposeOrder.push("invalidate")) },
      glbPlacementTool: { cancelPendingImport: vi.fn() },
      buildToolContext: vi.fn(() => ({})),
      abortPlayTest: vi.fn(),
      unsubs: [],
      panels: [],
      gizmo: { dispose: vi.fn() },
      renderer: { scene: new THREE.Scene() },
      grid: { dispose: vi.fn() },
      clearSelectionHelper: vi.fn(),
    });
    disposeManager.dispose();
    expect(disposeOrder.slice(0, 2)).toEqual(["cancel", "invalidate"]);
  });
});

describe("EditorManager gizmo history transactions", () => {
  it("reconciles the before body pose when preliminary gizmo restore sync rolls back to preview", () => {
    const selected = makeObject();
    const manager = makeManager(selected);
    const before: TransformTuple = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const after: TransformTuple = { position: [5, 6, 7], rotation: [0.4, 0.3, 0.2], scale: [1, 1, 1] };
    const bodyPose = { position: [...after.position], rotation: [...after.rotation] };
    selected.body = { id: "body" } as unknown as RAPIER.RigidBody;
    selected.mesh.position.fromArray(after.position);
    selected.mesh.rotation.set(...after.rotation);
    selected.transform = structuredClone(after);
    manager.dragStartTransform = before;
    manager.history = new CommandHistory(() => (manager.markDirty as unknown as () => void)());
    let failPreliminaryRestore = true;
    manager.syncPhysicsSubtree = vi.fn((root: EditorObject) => {
      const previous = structuredClone(bodyPose);
      bodyPose.position = root.mesh.position.toArray();
      bodyPose.rotation = root.mesh.rotation.toArray().slice(0, 3) as number[];
      if (failPreliminaryRestore) {
        failPreliminaryRestore = false;
        bodyPose.position = previous.position;
        bodyPose.rotation = previous.rotation;
        return { ok: false, reason: "preliminary pose sync failed and rolled back" };
      }
      return { ok: true };
    });

    manager.onDragStateChanged(false);

    expect(selected.mesh.position.toArray()).toEqual(before.position);
    expect(selected.mesh.rotation.toArray().slice(0, 3)).toEqual(before.rotation);
    expect(selected.transform).toEqual(before);
    expect(bodyPose).toEqual({ position: before.position, rotation: before.rotation });
    expect(manager.history.undo()).toBe(false);
    expect(manager.markDirty).not.toHaveBeenCalled();
    expect(manager.showPhysicsMutationError).toHaveBeenCalledWith(expect.stringMatching(/preliminary/i));
  });

  it("commits one successful gizmo transform and round-trips exact local state", () => {
    const selected = makeObject();
    const manager = makeManager(selected);
    const before: TransformTuple = structuredClone(selected.transform);
    const after: TransformTuple = { position: [3, 2, 1], rotation: [0.4, 0.5, 0.6], scale: [2, 3, 4] };
    const bodyPose = { position: [...before.position], rotation: [...before.rotation] };
    selected.body = { id: "body" } as unknown as RAPIER.RigidBody;
    manager.history = new CommandHistory(() => (manager.markDirty as unknown as () => void)());
    manager.syncPhysicsSubtree = vi.fn((root: EditorObject) => {
      bodyPose.position = root.mesh.position.toArray();
      bodyPose.rotation = root.mesh.rotation.toArray().slice(0, 3) as number[];
      return { ok: true };
    });

    manager.onDragStateChanged(true);
    selected.mesh.position.fromArray(after.position);
    selected.mesh.rotation.set(...after.rotation);
    selected.mesh.scale.fromArray(after.scale);
    selected.transform = structuredClone(after);
    bodyPose.position = [...after.position];
    bodyPose.rotation = [...after.rotation];
    manager.onDragStateChanged(false);
    manager.onDragStateChanged(false);

    expect(manager.markDirty).toHaveBeenCalledOnce();
    expect(manager.history.undo()).toBe(true);
    expect(selected.transform).toEqual(before);
    expect(bodyPose).toEqual({ position: before.position, rotation: before.rotation });
    expect(manager.history.redo()).toBe(true);
    expect(selected.transform).toEqual(after);
    expect(bodyPose).toEqual({ position: after.position, rotation: after.rotation });
    expect(manager.markDirty).toHaveBeenCalledTimes(3);
  });

  it.each<[string, TransformTuple, boolean]>([
    ["translation", { position: [9, 8, 7], rotation: [0, 0, 0], scale: [1, 1, 1] }, false],
    ["rotation", { position: [0, 0, 0], rotation: [0.7, 0.8, 0.9], scale: [1, 1, 1] }, false],
    ["selected scale", { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 3, 4] }, true],
    ["negative scale sign flip", { position: [0, 0, 0], rotation: [0, 0, 0], scale: [-1, 1, 1] }, true],
  ])("selects per-entry collider rebuilds for a pure %s replay", (_label, transform, expectedRebuild) => {
    const selected = makeObject();
    selected.id = "parent";
    selected.collider = { id: "parent-collider" } as unknown as RAPIER.Collider;
    const child = makeObject();
    child.id = "child";
    child.parentId = selected.id;
    child.collider = { id: "child-collider" } as unknown as RAPIER.Collider;
    selected.children = [child.id];
    selected.mesh.add(child.mesh);
    const manager = makeManager(selected);
    manager.document.objects = [selected, child];
    const rebuilds: Array<{ id: string; rebuild: boolean }> = [];
    manager.syncPhysicsSubtree = vi.fn(
      (
        root: EditorObject,
        shouldRebuildCollider: (entry: EditorObject, nextPose: ReturnType<typeof getObjectWorldPhysicsPose>) => boolean,
      ) => {
        root.mesh.updateWorldMatrix(true, true);
        for (const entry of manager.document.objects) {
          rebuilds.push({
            id: entry.id,
            rebuild: shouldRebuildCollider(entry, getObjectWorldPhysicsPose(entry.mesh)),
          });
        }
        return { ok: true };
      },
    );

    expect(manager.applyTransform(selected.id, transform)).toBe(true);

    expect(rebuilds).toEqual([
      { id: "parent", rebuild: expectedRebuild },
      { id: "child", rebuild: expectedRebuild },
    ]);
    expect(child.mesh.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("rolls a failed gizmo commit back and does not dirty or retain history", () => {
    const selected = makeObject();
    const manager = makeManager(selected);
    manager.dragStartTransform = {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
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

describe("EditorManager physics type history transactions", () => {
  it.each([
    "allocation",
    "collider",
    "publication",
  ] as const)("keeps the complete live physics projection unchanged when %s fails", (phase) => {
    const harness = makePhysicsFailureHarness(phase);
    const before = harness.project();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    harness.manager.applyPhysicsTypeChange(harness.target.id, "dynamic");

    expect(harness.project()).toEqual(before);
    expect(harness.oldBody.isValid()).toBe(true);
    expect(harness.oldCollider.isValid()).toBe(true);
    expect(harness.manager.history.undo()).toBe(false);
    expect(harness.dirty).not.toHaveBeenCalled();
    expect(harness.manager.showPhysicsMutationError).toHaveBeenCalledWith(expect.stringMatching(new RegExp(phase)));
    const replacementRemovals = harness.removedBodies.filter((body) => body !== harness.oldBody);
    expect(replacementRemovals).toHaveLength(phase === "allocation" ? 0 : 1);
    expect(new Set(replacementRemovals).size).toBe(replacementRemovals.length);
    expect(harness.removedBodies).not.toContain(harness.oldBody);
    expect(harness.removedColliders).not.toContain(harness.oldCollider);
    consoleError.mockRestore();
  });

  it("recreates the previous recipe instead of republishing destroyed handles after destructive retirement", () => {
    const harness = makePhysicsFailureHarness("destructive-retirement");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    harness.manager.applyPhysicsTypeChange(harness.target.id, "dynamic");

    const restored = harness.project();
    expect(restored).toMatchObject({
      type: "static",
      body: restored.body,
      collider: restored.collider,
      tracked: true,
      dynamicBody: undefined,
      trackingBody: restored.body,
      trackingCollider: restored.collider,
      levelBodies: [restored.body],
      levelColliders: [restored.collider],
      mapBody: restored.body,
      mapCollider: restored.collider,
      metadataBody: restored.body,
      metadataCollider: restored.collider,
      liveBodies: [restored.body],
      liveColliders: [restored.collider],
    });
    expect(restored.body).not.toBe(harness.oldBody);
    expect(restored.collider).not.toBe(harness.oldCollider);
    expect((restored.body as unknown as FakePhysicsBody).isValid()).toBe(true);
    expect((restored.collider as unknown as FakePhysicsCollider).isValid()).toBe(true);
    expect(harness.oldBody.isValid()).toBe(false);
    expect(harness.oldCollider.isValid()).toBe(false);
    const replacementRemovals = harness.removedBodies.filter((body) => body !== harness.oldBody);
    expect(replacementRemovals).toHaveLength(1);
    expect(harness.manager.history.undo()).toBe(false);
    expect(harness.dirty).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reports replacement cleanup failure without retrying cleanup or retaining partial resources", () => {
    const harness = makePhysicsFailureHarness("replacement-cleanup");
    const before = harness.project();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    harness.manager.applyPhysicsTypeChange(harness.target.id, "dynamic");

    expect(harness.project()).toEqual(before);
    const replacementRemovals = harness.removedBodies.filter((body) => body !== harness.oldBody);
    expect(replacementRemovals).toHaveLength(1);
    expect(new Set(replacementRemovals).size).toBe(1);
    expect(harness.liveBodies).toEqual(new Set([harness.oldBody]));
    expect(harness.manager.showPhysicsMutationError).toHaveBeenCalledWith(expect.stringMatching(/rollback.*cleanup/i));
    expect(harness.manager.history.undo()).toBe(false);
    expect(harness.dirty).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reports restoration failure while leaving the prior live projection coherent", () => {
    const harness = makePhysicsFailureHarness("restoration");
    const before = harness.project();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    harness.manager.applyPhysicsTypeChange(harness.target.id, "dynamic");

    expect(harness.project()).toEqual(before);
    const replacementRemovals = harness.removedBodies.filter((body) => body !== harness.oldBody);
    expect(replacementRemovals).toHaveLength(1);
    expect(new Set(replacementRemovals).size).toBe(1);
    expect(harness.manager.showPhysicsMutationError).toHaveBeenCalledWith(expect.stringMatching(/rollback.*restor/i));
    expect(harness.manager.history.undo()).toBe(false);
    expect(harness.dirty).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("restores a disabled tracked body as disabled after undo publication", () => {
    const harness = makePhysicsFailureHarness("success");
    harness.oldBody.setEnabled(false);

    harness.manager.applyPhysicsTypeChange(harness.target.id, "dynamic");
    const dynamicFirst = harness.project();
    expect((dynamicFirst.body as unknown as FakePhysicsBody).isEnabled()).toBe(true);
    expect(harness.manager.history.undo()).toBe(true);

    const restored = harness.project();
    expect(restored).toMatchObject({
      type: "static",
      body: restored.body,
      collider: restored.collider,
      tracked: true,
      dynamicBody: undefined,
      trackingBody: restored.body,
      trackingCollider: restored.collider,
      levelBodies: [restored.body],
      levelColliders: [restored.collider],
      mapBody: restored.body,
      mapCollider: restored.collider,
      metadataBody: restored.body,
      metadataCollider: restored.collider,
      liveBodies: [restored.body],
      liveColliders: [restored.collider],
    });
    expect(restored.body).not.toBe(harness.oldBody);
    expect((restored.body as unknown as FakePhysicsBody).isEnabled()).toBe(false);
    expect((restored.body as unknown as FakePhysicsBody).isValid()).toBe(true);
    expect((restored.collider as unknown as FakePhysicsCollider).isValid()).toBe(true);

    expect(harness.manager.history.redo()).toBe(true);
    const dynamicRedo = harness.project();
    expect(dynamicRedo.type).toBe("dynamic");
    expect(dynamicRedo.body).not.toBe(dynamicFirst.body);
    expect(dynamicRedo.body).not.toBe(restored.body);
    expect(dynamicRedo.dynamicBody).toBe(dynamicRedo.body);
    expect(dynamicRedo.liveBodies).toEqual([dynamicRedo.body]);
    expect(dynamicRedo.liveColliders).toEqual([dynamicRedo.collider]);
  });

  it("recreates fresh static and dynamic handles across change, undo, and redo", () => {
    const scene = new THREE.Scene();
    const removeBody = vi.fn();
    const removeCollider = vi.fn();
    let nextBody = 0;
    let nextCollider = 0;
    const createRigidBody = vi.fn(() => ({ id: `body-${++nextBody}`, setEnabled: vi.fn() }));
    const createCollider = vi.fn(() => ({ id: `collider-${++nextCollider}`, setEnabled: vi.fn() }));
    const physicsWorld = {
      world: { createRigidBody, createCollider },
      removeBody,
      removeCollider,
    } as unknown as PhysicsWorld;
    const levelManager = new LevelManager(scene, physicsWorld, new EventBus());
    const document = new EditorDocument(scene, physicsWorld);
    const target = makeObject();
    const oldBody = { id: "old-body", setEnabled: vi.fn() } as unknown as RAPIER.RigidBody;
    const oldCollider = { id: "old-collider", setEnabled: vi.fn() } as unknown as RAPIER.Collider;
    target.body = oldBody;
    target.collider = oldCollider;
    scene.add(target.mesh);
    document.objects = [target];
    document.selected = target;
    levelManager.addLevelObject(target.mesh, { physics: { body: oldBody, collider: oldCollider } });
    const dirty = vi.fn();
    const manager = Object.create(EditorManager.prototype) as PhysicsTypeManagerHarness;
    Object.assign(manager, {
      guardDocumentMutation: () => true,
      document,
      physicsWorld,
      levelManager,
      inspectorPanel: { setSelection: vi.fn() },
      showPhysicsMutationError: vi.fn(),
      markDirty: dirty,
      history: new CommandHistory(dirty),
    });
    const projection = () => {
      const tracking = levelManager.getLevelObjectTracking(target.mesh);
      return {
        type: target.physicsType,
        body: target.body,
        collider: target.collider,
        tracked: levelManager.getLevelObjects().includes(target.mesh),
        trackedBody: tracking.physics?.body,
        trackedCollider: tracking.physics?.collider,
        dynamicBody: levelManager.getDynamicBodies()[0]?.body,
        levelBodies: [...(levelManager as unknown as { levelBodies: RAPIER.RigidBody[] }).levelBodies],
        levelColliders: [...(levelManager as unknown as { levelColliders: RAPIER.Collider[] }).levelColliders],
      };
    };

    manager.applyPhysicsTypeChange(target.id, "dynamic");
    const dynamicFirst = projection();
    expect(dynamicFirst).toMatchObject({
      type: "dynamic",
      tracked: true,
      trackedBody: dynamicFirst.body,
      trackedCollider: dynamicFirst.collider,
      dynamicBody: dynamicFirst.body,
      levelBodies: [dynamicFirst.body],
      levelColliders: [dynamicFirst.collider],
    });
    expect(dynamicFirst.body).not.toBe(oldBody);
    expect(manager.history.undo()).toBe(true);
    const restoredStatic = projection();
    expect(restoredStatic).toMatchObject({
      type: "static",
      tracked: true,
      trackedBody: restoredStatic.body,
      trackedCollider: restoredStatic.collider,
      dynamicBody: undefined,
      levelBodies: [restoredStatic.body],
      levelColliders: [restoredStatic.collider],
    });
    expect(restoredStatic.body).not.toBe(oldBody);
    expect(restoredStatic.body).not.toBe(dynamicFirst.body);
    expect(manager.history.redo()).toBe(true);
    const dynamicRedo = projection();
    expect(dynamicRedo).toMatchObject({
      type: "dynamic",
      tracked: true,
      trackedBody: dynamicRedo.body,
      trackedCollider: dynamicRedo.collider,
      dynamicBody: dynamicRedo.body,
      levelBodies: [dynamicRedo.body],
      levelColliders: [dynamicRedo.collider],
    });
    expect(dynamicRedo.body).not.toBe(dynamicFirst.body);
    expect(dynamicRedo.body).not.toBe(restoredStatic.body);
    manager.applyPhysicsTypeChange(target.id, "kinematic");
    const kinematicFirst = projection();
    expect(kinematicFirst).toMatchObject({
      type: "kinematic",
      tracked: true,
      trackedBody: kinematicFirst.body,
      trackedCollider: kinematicFirst.collider,
      dynamicBody: undefined,
      levelBodies: [kinematicFirst.body],
      levelColliders: [kinematicFirst.collider],
    });
    expect(manager.history.undo()).toBe(true);
    const restoredDynamic = projection();
    expect(restoredDynamic.type).toBe("dynamic");
    expect(restoredDynamic.dynamicBody).toBe(restoredDynamic.body);
    expect(manager.history.redo()).toBe(true);
    const kinematicRedo = projection();
    expect(kinematicRedo.type).toBe("kinematic");
    expect(kinematicRedo.dynamicBody).toBeUndefined();
    expect(kinematicRedo.body).not.toBe(kinematicFirst.body);
    expect(removeBody.mock.calls.map(([body]) => body)).toEqual([
      oldBody,
      dynamicFirst.body,
      restoredStatic.body,
      dynamicRedo.body,
      kinematicFirst.body,
      restoredDynamic.body,
    ]);
    expect(removeCollider).not.toHaveBeenCalled();
    expect(dirty).toHaveBeenCalledTimes(6);
  });

  it("restores an originally body-less tracked object without retaining destroyed replacement tracking", () => {
    const scene = new THREE.Scene();
    const removeBody = vi.fn();
    const physicsWorld = {
      world: {
        createRigidBody: vi.fn(() => ({ id: "replacement-body", setEnabled: vi.fn() })),
        createCollider: vi.fn(() => ({ id: "replacement-collider", setEnabled: vi.fn() })),
      },
      removeBody,
      removeCollider: vi.fn(),
    } as unknown as PhysicsWorld;
    const levelManager = new LevelManager(scene, physicsWorld, new EventBus());
    const document = new EditorDocument(scene, physicsWorld);
    const target = makeObject();
    scene.add(target.mesh);
    document.objects = [target];
    document.selected = target;
    levelManager.addLevelObject(target.mesh);
    const manager = Object.create(EditorManager.prototype) as PhysicsTypeManagerHarness;
    Object.assign(manager, {
      guardDocumentMutation: () => true,
      document,
      physicsWorld,
      levelManager,
      inspectorPanel: { setSelection: vi.fn() },
      showPhysicsMutationError: vi.fn(),
      markDirty: vi.fn(),
      history: new CommandHistory(),
    });

    manager.applyPhysicsTypeChange(target.id, "dynamic");
    const replacementBody = target.body;
    expect(replacementBody).toBeDefined();
    expect(manager.history.undo()).toBe(true);

    expect(target.physicsType).toBe("static");
    expect(target.body).toBeUndefined();
    expect(target.collider).toBeUndefined();
    const restoredTracking = levelManager.getLevelObjectTracking(target.mesh);
    expect(restoredTracking.dynamicBody).toBeUndefined();
    expect(restoredTracking.physics?.body).toBeUndefined();
    expect(restoredTracking.physics?.collider).toBeUndefined();
    expect(removeBody).toHaveBeenCalledOnce();
    expect(removeBody).toHaveBeenCalledWith(replacementBody);
  });

  it("round-trips a translated and rotated standalone collider with its exact descriptor recipe", () => {
    const scene = new THREE.Scene();
    const createdColliderDescs: Array<{ desc: RAPIER.ColliderDesc; body?: FakePhysicsBody }> = [];
    const liveBodies = new Set<FakePhysicsBody>();
    const liveColliders = new Set<FakePhysicsCollider>();
    let bodyId = 0;
    let colliderId = 0;
    const createRigidBody = vi.fn((desc: RAPIER.RigidBodyDesc) => {
      let enabled = desc.enabled;
      const body: FakePhysicsBody = {
        id: `body-${++bodyId}`,
        live: true,
        setEnabled: vi.fn((next: boolean) => {
          enabled = next;
        }),
        isEnabled() {
          return enabled;
        },
        isValid() {
          return this.live;
        },
      };
      liveBodies.add(body);
      return body;
    });
    const createCollider = vi.fn((desc: RAPIER.ColliderDesc, body?: FakePhysicsBody) => {
      createdColliderDescs.push({ desc, body });
      let enabled = desc.enabled;
      const collider: FakePhysicsCollider = {
        id: `collider-${++colliderId}`,
        body,
        live: true,
        setEnabled: vi.fn((next: boolean) => {
          enabled = next;
        }),
        isEnabled() {
          return enabled;
        },
        isValid() {
          return this.live;
        },
      };
      liveColliders.add(collider);
      return collider;
    });
    const removeBody = vi.fn((body: FakePhysicsBody) => {
      body.live = false;
      liveBodies.delete(body);
      for (const collider of [...liveColliders]) {
        if (collider.body !== body) continue;
        collider.live = false;
        liveColliders.delete(collider);
      }
    });
    const removeCollider = vi.fn((collider: FakePhysicsCollider) => {
      collider.live = false;
      liveColliders.delete(collider);
    });
    const physicsWorld = {
      world: { createRigidBody, createCollider },
      removeBody,
      removeCollider,
    } as unknown as PhysicsWorld;
    const levelManager = new LevelManager(scene, physicsWorld, new EventBus());
    const document = new EditorDocument(scene, physicsWorld);
    const target = makeObject();
    target.mesh.position.set(4.5, -2.25, 7.75);
    target.mesh.rotation.set(0.35, -0.6, 0.2);
    target.mesh.updateWorldMatrix(true, true);
    target.transform.position = target.mesh.position.toArray();
    target.transform.rotation = target.mesh.rotation.toArray().slice(0, 3) as [number, number, number];
    const worldPosition = target.mesh.getWorldPosition(new THREE.Vector3());
    const worldRotation = target.mesh.getWorldQuaternion(new THREE.Quaternion());
    let oldColliderEnabled = false;
    const oldCollider = {
      id: "standalone-old",
      live: true,
      shape: RAPIER.ColliderDesc.cuboid(0.5, 0.75, 1.25).shape,
      setEnabled: vi.fn((enabled: boolean) => {
        oldColliderEnabled = enabled;
      }),
      isEnabled: () => oldColliderEnabled,
      isValid() {
        return this.live;
      },
      translation: () => worldPosition,
      rotation: () => worldRotation,
      translationWrtParent: () => null,
      rotationWrtParent: () => null,
      isSensor: () => true,
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
    liveColliders.add(oldCollider as unknown as FakePhysicsCollider);
    target.collider = oldCollider as unknown as RAPIER.Collider;
    scene.add(target.mesh);
    document.objects = [target];
    document.selected = target;
    levelManager.addLevelObject(target.mesh, { physics: { collider: target.collider } });
    oldCollider.setEnabled(false);
    const manager = Object.create(EditorManager.prototype) as PhysicsTypeManagerHarness;
    Object.assign(manager, {
      guardDocumentMutation: () => true,
      document,
      physicsWorld,
      levelManager,
      inspectorPanel: { setSelection: vi.fn() },
      showPhysicsMutationError: vi.fn(),
      markDirty: vi.fn(),
      history: new CommandHistory(),
    });

    manager.applyPhysicsTypeChange(target.id, "dynamic");
    expect(manager.history.undo()).toBe(true);

    const standaloneCreation = [...createdColliderDescs].reverse().find(({ body }) => body === undefined);
    expect(standaloneCreation).toBeDefined();
    const restoredDesc = standaloneCreation?.desc;
    expect(restoredDesc?.translation).toMatchObject({
      x: expect.closeTo(worldPosition.x, 8),
      y: expect.closeTo(worldPosition.y, 8),
      z: expect.closeTo(worldPosition.z, 8),
    });
    expect(restoredDesc?.rotation).toMatchObject({
      x: expect.closeTo(worldRotation.x, 8),
      y: expect.closeTo(worldRotation.y, 8),
      z: expect.closeTo(worldRotation.z, 8),
      w: expect.closeTo(worldRotation.w, 8),
    });
    expect(restoredDesc).toMatchObject({
      isSensor: true,
      enabled: false,
      friction: 0.37,
      restitution: 0.62,
      massPropsMode: RAPIER.MassPropsMode.Mass,
      mass: 7.5,
      frictionCombineRule: 2,
      restitutionCombineRule: 3,
      collisionGroups: 0x12340056,
      solverGroups: 0x43210065,
      activeHooks: 4,
      activeEvents: 5,
      activeCollisionTypes: 6,
      contactForceEventThreshold: 8.5,
      contactSkin: 0.0125,
    });
    expect(target.body).toBeUndefined();
    expect(target.collider).toBeDefined();
    const restoredStandalone = target.collider as unknown as FakePhysicsCollider;
    expect(restoredStandalone.isEnabled()).toBe(false);
    expect(restoredStandalone.isValid()).toBe(true);
    expect(liveBodies).toEqual(new Set());
    expect(liveColliders).toEqual(new Set([restoredStandalone]));
    expect(levelManager.getLevelObjectTracking(target.mesh).physics).toEqual({ collider: target.collider });
    expect(manager.history.redo()).toBe(true);
    expect(target.physicsType).toBe("dynamic");
    expect(target.body).toBeDefined();
    expect(target.collider).toBeDefined();
    const dynamicRedoBody = target.body as unknown as FakePhysicsBody;
    const dynamicRedoCollider = target.collider as unknown as FakePhysicsCollider;
    expect(dynamicRedoBody.isValid()).toBe(true);
    expect(dynamicRedoCollider.isValid()).toBe(true);
    expect(dynamicRedoCollider).not.toBe(restoredStandalone);
    expect(liveBodies).toEqual(new Set([dynamicRedoBody]));
    expect(liveColliders).toEqual(new Set([dynamicRedoCollider]));
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

describe("EditorManager reparent history transactions", () => {
  it("round-trips document order, complete topology, exact transforms, selection, tracking, and physics pose", () => {
    const harness = makeHierarchyHarness();
    const { manager, parentA, parentB, child, grandchild, project, markDirty } = harness;
    const before = project();
    const worldBefore = [...child.mesh.matrixWorld.elements];

    expect(manager.reparentById(child.id, parentB.id)).toBe(true);
    const after = project();
    expect(parentA.children).toEqual(["sibling"]);
    expect(parentB.children).toEqual([child.id]);
    expect(child.parentId).toBe(parentB.id);
    expect(child.children).toEqual([grandchild.id]);
    expect(after.document.map(({ id }) => id)).toEqual(before.document.map(({ id }) => id));
    expect(after.selected).toBe(grandchild.id);
    expect(after.levelObjects).toEqual(before.levelObjects);
    child.mesh.matrixWorld.elements.forEach((value, index) => {
      expect(value).toBeCloseTo(worldBefore[index] ?? Number.NaN, 12);
    });
    expect(after.physicsPose.position).toEqual(child.mesh.getWorldPosition(new THREE.Vector3()).toArray());
    expect(after.physicsPose.rotation).toEqual(child.mesh.getWorldQuaternion(new THREE.Quaternion()).toArray());

    expect(manager.history.undo()).toBe(true);
    expect(project()).toEqual(before);
    expect(manager.history.redo()).toBe(true);
    expect(project()).toEqual(after);
    expect(markDirty).toHaveBeenCalledTimes(3);
  });

  it("rejects self, cycle, shear, and no-op reparents without history or dirty state", () => {
    const harness = makeHierarchyHarness();
    const { manager, parentA, parentB, child, grandchild, project, markDirty } = harness;
    const before = project();
    parentB.mesh.scale.set(2, 1, 1);
    parentB.mesh.rotation.set(0.2, 0.4, -0.3);
    parentB.mesh.updateMatrixWorld(true);
    child.mesh.rotation.set(0.35, -0.45, 0.25);
    parentA.mesh.updateMatrixWorld(true);
    const beforeRejected = project();

    expect(manager.reparentById(child.id, child.id)).toBe(false);
    expect(manager.reparentById(parentA.id, grandchild.id)).toBe(false);
    expect(manager.reparentById(child.id, parentA.id)).toBe(false);
    expect(manager.reparentById(child.id, parentB.id)).toBe(false);

    expect(project()).toEqual(beforeRejected);
    expect(before.document.map(({ id }) => id)).toEqual(beforeRejected.document.map(({ id }) => id));
    expect(manager.history.undo()).toBe(false);
    expect(markDirty).not.toHaveBeenCalled();
    expect(manager.showPhysicsMutationError).toHaveBeenCalledWith(expect.stringMatching(/self|descendant|shear/i));
  });

  it("rolls a failed physics pose sync back without history or dirty state", () => {
    const harness = makeHierarchyHarness();
    const { manager, child, parentB, project, markDirty } = harness;
    const before = project();
    manager.syncPhysicsSubtree.mockReturnValueOnce({ ok: false, reason: "pose sync failed" });

    expect(manager.reparentById(child.id, parentB.id)).toBe(false);

    expect(project()).toEqual(before);
    expect(manager.history.undo()).toBe(false);
    expect(markDirty).not.toHaveBeenCalled();
    expect(manager.showPhysicsMutationError).toHaveBeenCalledWith(expect.stringMatching(/pose sync failed/i));
  });
});

describe("EditorManager group and ungroup history transactions", () => {
  it("disables retained group physics while detached and finalizes applied ownership exactly once", () => {
    const harness = makePhysicsEnabledGroupHarness();
    const { manager, document, levelManager, group, body, collider, removeBody, removeCollider, ownership } = harness;

    expect(manager.ungroupObject(group.id)).toBe(true);
    expect(document.findById(group.id)).toBeUndefined();
    expect(levelManager.getLevelObjects()).not.toContain(group.mesh);
    expect(body.setEnabled).toHaveBeenLastCalledWith(false);
    expect(collider.setEnabled).toHaveBeenLastCalledWith(false);

    expect(manager.history.undo()).toBe(true);
    expect(document.findById(group.id)).toBe(group);
    expect(levelManager.getLevelObjects()).toContain(group.mesh);
    expect(body.setEnabled).toHaveBeenLastCalledWith(true);
    expect(collider.setEnabled).toHaveBeenLastCalledWith(true);

    expect(manager.history.redo()).toBe(true);
    expect(levelManager.getLevelObjects()).not.toContain(group.mesh);
    expect(body.setEnabled).toHaveBeenLastCalledWith(false);
    expect(collider.setEnabled).toHaveBeenLastCalledWith(false);
    manager.history.clear();
    manager.history.clear();

    expect(removeCollider).toHaveBeenCalledOnce();
    expect(removeCollider).toHaveBeenCalledWith(collider);
    expect(removeBody).toHaveBeenCalledOnce();
    expect(removeBody).toHaveBeenCalledWith(body);
    expect(ownership()).toEqual({ levelBodies: [], levelColliders: [], hasMetadata: false });
    expect(levelManager.getLevelObjectTracking(group.mesh).physics).toBeUndefined();
  });

  it("restores exact LevelManager visual, dynamic, and physics ownership order when ungroup is undone", () => {
    const harness = makeOrderedPhysicsGroupHarness();
    const before = harness.projectTracking();

    expect(harness.manager.ungroupObject(harness.group.id)).toBe(true);
    expect(harness.manager.history.undo()).toBe(true);

    expect(harness.projectTracking()).toEqual(before);
    expect(harness.document.findById(harness.group.id)).toBe(harness.group);
  });

  it("restores exact LevelManager order when an ungroup apply fails after detaching tracking", () => {
    const harness = makeOrderedPhysicsGroupHarness();
    const before = harness.projectTracking();
    harness.syncPhysicsSubtree.mockReturnValueOnce({ ok: false, reason: "injected ungroup apply failure" });

    expect(harness.manager.ungroupObject(harness.group.id)).toBe(false);

    expect(harness.projectTracking()).toEqual(before);
    expect(harness.document.findById(harness.group.id)).toBe(harness.group);
    expect(harness.manager.history.undo()).toBe(false);
    expect(harness.markDirty).not.toHaveBeenCalled();
  });

  it("retains one group identity across multiple-parent undo and redo with exact order, selection, and tracking", () => {
    const harness = makeHierarchyHarness();
    const { manager, document, levelManager, parentA, parentB, child, sibling, project, markDirty } = harness;
    document.selected = child;
    const before = project();
    const childWorldBefore = [...child.mesh.matrixWorld.elements];
    const parentBWorldBefore = [...parentB.mesh.matrixWorld.elements];

    const group = manager.groupObjects([child.id, parentB.id]);

    expect(group).not.toBeNull();
    if (!group) return;
    const after = project();
    expect(document.objects).toEqual([parentB, child, parentA, harness.grandchild, sibling, group]);
    expect(parentA.children).toEqual([sibling.id]);
    expect(group.children).toEqual([child.id, parentB.id]);
    expect(child.parentId).toBe(group.id);
    expect(parentB.parentId).toBe(group.id);
    expect(document.selected).toBe(group);
    expect(levelManager.getLevelObjects()).toContain(group.mesh);
    child.mesh.matrixWorld.elements.forEach((value, index) => {
      expect(value).toBeCloseTo(childWorldBefore[index] ?? Number.NaN, 12);
    });
    parentB.mesh.matrixWorld.elements.forEach((value, index) => {
      expect(value).toBeCloseTo(parentBWorldBefore[index] ?? Number.NaN, 12);
    });

    expect(manager.history.undo()).toBe(true);
    expect(project()).toEqual(before);
    expect(document.findById(group.id)).toBeUndefined();
    expect(levelManager.getLevelObjects()).not.toContain(group.mesh);
    expect(manager.history.redo()).toBe(true);
    expect(document.findById(group.id)).toBe(group);
    expect(project()).toEqual(after);
    expect(markDirty).toHaveBeenCalledTimes(3);
  });

  it("restores selected groups and preserves selected children across ungroup undo and redo", () => {
    const selectedGroupHarness = makeHierarchyHarness();
    const group = selectedGroupHarness.manager.groupObjects([
      selectedGroupHarness.child.id,
      selectedGroupHarness.parentB.id,
    ]);
    expect(group).not.toBeNull();
    if (!group) return;
    selectedGroupHarness.manager.history.clear();
    selectedGroupHarness.markDirty.mockClear();
    selectedGroupHarness.document.selected = group;
    const beforeSelectedGroup = selectedGroupHarness.project();

    expect(selectedGroupHarness.manager.ungroupObject(group.id)).toBe(true);
    const afterSelectedGroup = selectedGroupHarness.project();
    expect(selectedGroupHarness.document.findById(group.id)).toBeUndefined();
    expect(selectedGroupHarness.levelManager.getLevelObjects()).not.toContain(group.mesh);
    expect(selectedGroupHarness.document.selected).toBeNull();
    expect(selectedGroupHarness.manager.history.undo()).toBe(true);
    expect(selectedGroupHarness.document.findById(group.id)).toBe(group);
    expect(selectedGroupHarness.project()).toEqual(beforeSelectedGroup);
    expect(selectedGroupHarness.manager.history.redo()).toBe(true);
    expect(selectedGroupHarness.project()).toEqual(afterSelectedGroup);

    const selectedChildHarness = makeHierarchyHarness();
    const childGroup = selectedChildHarness.manager.groupObjects([
      selectedChildHarness.child.id,
      selectedChildHarness.parentB.id,
    ]);
    expect(childGroup).not.toBeNull();
    if (!childGroup) return;
    selectedChildHarness.manager.history.clear();
    selectedChildHarness.markDirty.mockClear();
    selectedChildHarness.document.selected = selectedChildHarness.child;

    expect(selectedChildHarness.manager.ungroupObject(childGroup.id)).toBe(true);
    expect(selectedChildHarness.document.selected).toBe(selectedChildHarness.child);
    expect(selectedChildHarness.manager.history.undo()).toBe(true);
    expect(selectedChildHarness.document.selected).toBe(selectedChildHarness.child);
    expect(selectedChildHarness.manager.history.redo()).toBe(true);
    expect(selectedChildHarness.document.selected).toBe(selectedChildHarness.child);
  });

  it("rolls group and ungroup failures back without history, dirty state, or incorrect ownership cleanup", () => {
    const groupHarness = makeHierarchyHarness();
    const beforeGroup = groupHarness.project();
    groupHarness.manager.syncPhysicsSubtree.mockReturnValueOnce({ ok: false, reason: "group pose failed" });

    expect(groupHarness.manager.groupObjects([groupHarness.child.id, groupHarness.parentB.id])).toBeNull();
    expect(groupHarness.project()).toEqual(beforeGroup);
    expect(groupHarness.manager.history.undo()).toBe(false);
    expect(groupHarness.markDirty).not.toHaveBeenCalled();
    expect(groupHarness.manager.finalizeDetachedHierarchyObject).toHaveBeenCalledOnce();

    const ungroupHarness = makeHierarchyHarness();
    const group = ungroupHarness.manager.groupObjects([ungroupHarness.child.id, ungroupHarness.parentB.id]);
    expect(group).not.toBeNull();
    if (!group) return;
    ungroupHarness.manager.history.clear();
    ungroupHarness.markDirty.mockClear();
    ungroupHarness.manager.finalizeDetachedHierarchyObject.mockClear();
    const beforeUngroup = ungroupHarness.project();
    ungroupHarness.manager.syncPhysicsSubtree.mockReturnValueOnce({ ok: false, reason: "ungroup pose failed" });

    expect(ungroupHarness.manager.ungroupObject(group.id)).toBe(false);
    expect(ungroupHarness.project()).toEqual(beforeUngroup);
    expect(ungroupHarness.manager.history.undo()).toBe(false);
    expect(ungroupHarness.markDirty).not.toHaveBeenCalled();
    expect(ungroupHarness.manager.finalizeDetachedHierarchyObject).not.toHaveBeenCalled();
  });

  it("finalizes only detached command-owned groups when history is discarded", () => {
    const groupHarness = makeHierarchyHarness();
    const group = groupHarness.manager.groupObjects([groupHarness.child.id, groupHarness.parentB.id]);
    expect(group).not.toBeNull();
    if (!group) return;
    groupHarness.manager.history.clear();
    expect(groupHarness.manager.finalizeDetachedHierarchyObject).not.toHaveBeenCalled();

    const detachedGroup = groupHarness.manager.groupObjects([groupHarness.sibling.id]);
    expect(detachedGroup).not.toBeNull();
    if (!detachedGroup) return;
    expect(groupHarness.manager.history.undo()).toBe(true);
    groupHarness.manager.history.clear();
    expect(groupHarness.manager.finalizeDetachedHierarchyObject).toHaveBeenCalledOnce();
    expect(groupHarness.manager.finalizeDetachedHierarchyObject).toHaveBeenCalledWith(detachedGroup);

    const ungroupHarness = makeHierarchyHarness();
    const ungrouped = ungroupHarness.manager.groupObjects([ungroupHarness.child.id, ungroupHarness.parentB.id]);
    expect(ungrouped).not.toBeNull();
    if (!ungrouped) return;
    ungroupHarness.manager.history.clear();
    ungroupHarness.manager.finalizeDetachedHierarchyObject.mockClear();
    expect(ungroupHarness.manager.ungroupObject(ungrouped.id)).toBe(true);
    ungroupHarness.manager.history.clear();
    expect(ungroupHarness.manager.finalizeDetachedHierarchyObject).toHaveBeenCalledOnce();
    expect(ungroupHarness.manager.finalizeDetachedHierarchyObject).toHaveBeenCalledWith(ungrouped);
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
    expect(manager.syncPhysicsSubtree).toHaveBeenCalledWith(root, expect.any(Function));
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

    await expect(manager.applyLoadedLevelContents(emptyLevelData(), "user-load", loadToken)).resolves.toBe("completed");
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
    const liveMaterial = new THREE.MeshStandardMaterial({ roughness: 0.24, metalness: 0.36 });
    liveMaterial.color.setRGB(0.123456789, 0.234567891, 0.345678912);
    liveMaterial.emissive.setRGB(0.456789123, 0.567891234, 0.678912345);
    const materialMesh = new THREE.Mesh(new THREE.BoxGeometry(), liveMaterial);
    sibling.mesh.add(materialMesh);
    sibling.material = {
      color: "#123456",
      roughness: 0.24,
      metalness: 0.36,
      emissive: "#654321",
      emissiveIntensity: 0.48,
      opacity: 0.6,
    };
    document.selected = sibling;
    manager.applyMaterialChange(
      sibling.id,
      {
        color: "#abcdef",
        roughness: 0.72,
        metalness: 0.84,
        emissive: "#fedcba",
        emissiveIntensity: 0.96,
        opacity: 1,
      },
      "preview",
    );
    const before = projectDeleteManager(harness);
    const beforeSerialized = structuredClone(sibling.material);
    const beforeLive = projectLiveMaterials([liveMaterial]);
    const pendingSession = manager.materialEditSession;
    const dirtyCount = harness.markDirty.mock.calls.length;
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
    expect(sibling.material).toEqual(beforeSerialized);
    expect(projectLiveMaterials([liveMaterial])).toEqual(beforeLive);
    expect(manager.materialEditSession).toBe(pendingSession);
    expect(harness.markDirty).toHaveBeenCalledTimes(dirtyCount);
    expect(manager.history.undo()).toBe(true);
    expect(manager.history.redo()).toBe(true);
    manager.cancelPendingMaterialEdit();
    manager.history.clear();
    expect(harness.removeBody).toHaveBeenCalledWith(root.body);
    expect(harness.removeCollider).toHaveBeenCalledWith(root.collider);
  });
});
