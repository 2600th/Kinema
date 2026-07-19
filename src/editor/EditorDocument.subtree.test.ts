import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { EditorDocument } from "./EditorDocument";
import type { EditorObject } from "./EditorObject";

function makeObject(
  id: string,
  parentId: string | null,
  children: string[],
  position: [number, number, number],
): EditorObject {
  const mesh = new THREE.Object3D();
  mesh.name = id;
  mesh.position.fromArray(position);
  mesh.rotation.set(position[2] / 10, position[0] / 10, position[1] / 10);
  mesh.scale.set(1 + position[0] / 10, 1 + position[1] / 10, 1 + position[2] / 10);
  return {
    id,
    name: id,
    mesh,
    source: { type: "primitive", primitive: "group" },
    transform: {
      position: [...position],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
    },
    parentId,
    children,
    visible: true,
    locked: false,
    physicsType: "static",
  };
}

function buildDeepDocument() {
  const scene = new THREE.Scene();
  const document = new EditorDocument(scene, {} as PhysicsWorld);
  const sibling = makeObject("sibling", null, ["root"], [9, 8, 7]);
  const root = makeObject("root", sibling.id, ["child"], [1, 2, 3]);
  const child = makeObject("child", root.id, ["grandchild"], [4, 5, 6]);
  const grandchild = makeObject("grandchild", child.id, [], [7, 8, 9]);

  scene.add(sibling.mesh);
  sibling.mesh.add(root.mesh);
  root.mesh.add(child.mesh);
  child.mesh.add(grandchild.mesh);
  document.objects = [sibling, root, child, grandchild];

  return { scene, document, root, child, grandchild, sibling };
}

function projectDocument(document: EditorDocument) {
  return document.objects.map((object) => ({
    id: object.id,
    parentId: object.parentId ?? null,
    children: [...(object.children ?? [])],
    transform: {
      position: [...object.transform.position],
      rotation: [...object.transform.rotation],
      scale: [...object.transform.scale],
    },
    localTransform: {
      position: object.mesh.position.toArray(),
      rotation: [object.mesh.rotation.x, object.mesh.rotation.y, object.mesh.rotation.z],
      scale: object.mesh.scale.toArray(),
    },
    meshParent: document.objects.find((candidate) => candidate.mesh === object.mesh.parent)?.id ?? null,
    meshChildren: object.mesh.children.map((mesh) => document.objects.find((candidate) => candidate.mesh === mesh)?.id),
  }));
}

describe("EditorDocument subtree primitives", () => {
  it("captures parent-first and removes leaf-first without dangling parents", () => {
    const { document, root, child, grandchild, sibling } = buildDeepDocument();

    const snapshot = document.captureSubtree(root.id);

    expect(snapshot?.nodes.map((node) => node.object.id)).toEqual([root.id, child.id, grandchild.id]);
    if (!snapshot) throw new Error("Expected the subtree snapshot to exist.");
    expect(document.removeSubtree(snapshot)).toBe(true);
    expect(document.objects.map((object) => object.id)).toEqual([sibling.id]);
    expect(document.objects.every((object) => object.parentId == null || document.findById(object.parentId))).toBe(
      true,
    );
    expect(sibling.mesh.children).toEqual([]);
    expect(root.mesh.parent).toBeNull();
    expect(root.mesh.children).toEqual([child.mesh]);
    expect(child.mesh.children).toEqual([grandchild.mesh]);
  });

  it("restores exact order, local transforms, and child arrays", () => {
    const { document, root, child, grandchild, sibling } = buildDeepDocument();
    const before = projectDocument(document);
    const snapshot = document.captureSubtree(root.id);
    if (!snapshot) throw new Error("Expected the subtree snapshot to exist.");
    document.removeSubtree(snapshot);

    sibling.children = ["temporary"];
    root.children = [];
    child.children = [];
    root.mesh.position.set(20, 21, 22);
    child.mesh.rotation.set(1, 2, 3);
    grandchild.mesh.scale.set(4, 5, 6);

    expect(document.restoreSubtree(snapshot)).toBe(true);
    expect(projectDocument(document)).toEqual(before);
  });
});
