import * as THREE from 'three';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { EditorObject } from './EditorObject';

/**
 * EditorDocument owns the editor object list and all object-mutation
 * operations (add / remove / duplicate / rename / visibility / lock /
 * reparent / group / ungroup).  It is a pure data-model layer with no
 * UI or input concerns.
 */
export class EditorDocument {
  objects: EditorObject[] = [];
  selected: EditorObject | null = null;

  constructor(
    private scene: THREE.Scene,
    private physicsWorld: PhysicsWorld,
  ) {}

  /* ================================================================
   *  Lookup
   * ================================================================ */

  findById(id: string): EditorObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  /* ================================================================
   *  Add / Remove
   * ================================================================ */

  addObject(obj: EditorObject, parent?: THREE.Object3D): void {
    const targetParent = parent ?? this.scene;
    if (!obj.mesh.parent) {
      targetParent.add(obj.mesh);
    }
    if (!this.objects.includes(obj)) {
      this.objects.push(obj);
    }
    obj.body?.setEnabled(true);
    obj.collider?.setEnabled(true);
  }

  removeObject(obj: EditorObject): void {
    const parent = obj.mesh.parent;
    if (parent) {
      parent.remove(obj.mesh);
    }
    // Disable (not remove) physics so undo can re-enable them
    obj.body?.setEnabled(false);
    obj.collider?.setEnabled(false);
    this.objects = this.objects.filter((entry) => entry !== obj);
    if (this.selected === obj) {
      this.selected = null;
    }
  }

  /* ================================================================
   *  Delete (with full physics + mesh cleanup)
   * ================================================================ */

  deleteById(id: string): EditorObject | null {
    const obj = this.findById(id);
    if (!obj) return null;
    this.removeObject(obj);
    return obj;
  }

  /* ================================================================
   *  Duplicate
   * ================================================================ */

  duplicateById(id: string): EditorObject | null {
    const obj = this.findById(id);
    if (!obj) return null;

    const clone = obj.mesh.clone(true);
    clone.position.addScalar(0.5); // Offset slightly
    const newObj: EditorObject = {
      ...structuredClone({
        id: '',
        name: obj.name + '_copy',
        source: obj.source,
        transform: {
          position: [clone.position.x, clone.position.y, clone.position.z] as [number, number, number],
          rotation: [clone.rotation.x, clone.rotation.y, clone.rotation.z] as [number, number, number],
          scale: [clone.scale.x, clone.scale.y, clone.scale.z] as [number, number, number],
        },
        parentId: obj.parentId ?? null,
        children: [],
        visible: obj.visible ?? true,
        locked: false,
        material: obj.material,
        brushParams: obj.brushParams,
        physicsType: obj.physicsType ?? 'static',
      }),
      id: clone.uuid,
      mesh: clone,
    };
    return newObj;
  }

  /* ================================================================
   *  Rename
   * ================================================================ */

  renameById(id: string, name: string): void {
    const obj = this.findById(id);
    if (!obj) return;
    obj.name = name;
    obj.mesh.name = name;
  }

  /* ================================================================
   *  Visibility / Lock
   * ================================================================ */

  toggleVisibleById(id: string): void {
    const obj = this.findById(id);
    if (!obj) return;
    const newVisible = !(obj.visible ?? true);
    obj.visible = newVisible;
    obj.mesh.visible = newVisible;
  }

  toggleLockById(id: string): void {
    const obj = this.findById(id);
    if (!obj) return;
    obj.locked = !(obj.locked ?? false);
    if (obj.locked && this.selected === obj) {
      this.selected = null;
    }
  }

  /* ================================================================
   *  Hierarchy
   * ================================================================ */

  reparentById(childId: string, newParentId: string | null): void {
    const child = this.findById(childId);
    if (!child) return;

    // Remove from old parent
    if (child.parentId) {
      const oldParent = this.findById(child.parentId);
      if (oldParent?.children) {
        oldParent.children = oldParent.children.filter((cid) => cid !== childId);
      }
    }

    // Set new parent
    child.parentId = newParentId ?? null;

    if (newParentId) {
      const newParent = this.findById(newParentId);
      if (newParent) {
        if (!newParent.children) newParent.children = [];
        newParent.children.push(childId);
        newParent.mesh.add(child.mesh);
      }
    } else {
      this.scene.add(child.mesh);
    }
  }

  groupObjects(ids: string[]): EditorObject | null {
    if (ids.length === 0) return null;
    const groupedObjects = ids
      .map((id) => this.findById(id))
      .filter((o): o is EditorObject => o != null);
    if (groupedObjects.length === 0) return null;

    const group = new THREE.Group();
    group.name = 'Group';
    this.scene.add(group);

    const groupObj: EditorObject = {
      id: group.uuid,
      name: 'Group',
      mesh: group,
      source: { type: 'primitive', primitive: 'group' },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      parentId: null,
      children: ids.slice(),
      visible: true,
      locked: false,
      physicsType: 'static',
    };

    for (const obj of groupedObjects) {
      obj.parentId = group.uuid;
      group.add(obj.mesh);
    }

    this.objects.push(groupObj);
    return groupObj;
  }

  ungroupObject(groupId: string): boolean {
    const groupObj = this.findById(groupId);
    if (!groupObj || !groupObj.children || groupObj.children.length === 0) return false;

    for (const childId of groupObj.children) {
      const child = this.findById(childId);
      if (child) {
        child.parentId = null;
        this.scene.add(child.mesh);
      }
    }

    this.scene.remove(groupObj.mesh);
    this.objects = this.objects.filter((o) => o.id !== groupId);
    if (this.selected === groupObj) {
      this.selected = null;
    }
    return true;
  }

  /* ================================================================
   *  Bulk cleanup (used by play-test restore and level load)
   * ================================================================ */

  removeEditorSpawnedObjects(): void {
    for (const obj of this.objects) {
      if (obj.mesh.userData.editorSource) {
        this.scene.remove(obj.mesh);
        obj.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            const mat = child.material;
            if (Array.isArray(mat)) {
              mat.forEach((m) => m.dispose());
            } else if (mat) {
              (mat as THREE.Material).dispose();
            }
          }
        });
        if (obj.body) {
          this.physicsWorld.removeBody(obj.body);
        } else if (obj.collider) {
          this.physicsWorld.removeCollider(obj.collider);
        }
      }
    }
    this.objects = this.objects.filter((obj) => !obj.mesh.userData.editorSource);
  }
}
