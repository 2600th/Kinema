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

  private syncLocalTransform(obj: EditorObject): void {
    obj.transform.position = [obj.mesh.position.x, obj.mesh.position.y, obj.mesh.position.z];
    obj.transform.rotation = [obj.mesh.rotation.x, obj.mesh.rotation.y, obj.mesh.rotation.z];
    obj.transform.scale = [obj.mesh.scale.x, obj.mesh.scale.y, obj.mesh.scale.z];
  }

  private removeChildRef(parentId: string | null | undefined, childId: string): void {
    if (!parentId) return;
    const parent = this.findById(parentId);
    if (!parent?.children) return;
    parent.children = parent.children.filter((id) => id !== childId);
  }

  private addChildRef(parent: EditorObject, childId: string): void {
    if (!parent.children) parent.children = [];
    if (!parent.children.includes(childId)) {
      parent.children.push(childId);
    }
  }

  reparentById(childId: string, newParentId: string | null): void {
    const child = this.findById(childId);
    if (!child) return;
    if (child.parentId === newParentId) return;

    const nextParent = newParentId ? this.findById(newParentId) : null;
    if (nextParent) {
      // Prevent cycles: cannot parent under self or descendants.
      let cursor: THREE.Object3D | null = nextParent.mesh;
      while (cursor) {
        if (cursor === child.mesh) return;
        cursor = cursor.parent;
      }
    }

    this.removeChildRef(child.parentId ?? null, childId);

    if (nextParent) {
      nextParent.mesh.attach(child.mesh);
      child.parentId = nextParent.id;
      this.addChildRef(nextParent, childId);
    } else {
      this.scene.attach(child.mesh);
      child.parentId = null;
    }
    this.syncLocalTransform(child);
  }

  groupObjects(ids: string[]): EditorObject | null {
    if (ids.length === 0) return null;
    const groupedObjects = ids
      .map((id) => this.findById(id))
      .filter((o): o is EditorObject => o != null);
    if (groupedObjects.length === 0) return null;

    const selectedIds = new Set(groupedObjects.map((o) => o.id));
    const rootObjects = groupedObjects.filter((obj) => {
      let cursor = obj.parentId ?? null;
      while (cursor) {
        if (selectedIds.has(cursor)) return false;
        cursor = this.findById(cursor)?.parentId ?? null;
      }
      return true;
    });
    if (rootObjects.length === 0) return null;

    const center = new THREE.Vector3();
    for (const obj of rootObjects) {
      obj.mesh.updateWorldMatrix(true, false);
      center.add(new THREE.Vector3().setFromMatrixPosition(obj.mesh.matrixWorld));
    }
    center.multiplyScalar(1 / rootObjects.length);

    const group = new THREE.Group();
    group.name = 'Group';
    group.position.copy(center);
    group.userData.editorSource = { type: 'primitive', primitive: 'group' };
    this.scene.add(group);

    const sharedParentIds = new Set(rootObjects.map((obj) => obj.parentId ?? '__scene__'));
    const commonParentId = sharedParentIds.size === 1 ? (rootObjects[0]?.parentId ?? null) : null;

    const groupObj: EditorObject = {
      id: group.uuid,
      name: 'Group',
      mesh: group,
      source: { type: 'primitive', primitive: 'group' },
      transform: {
        position: [group.position.x, group.position.y, group.position.z],
        rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
        scale: [group.scale.x, group.scale.y, group.scale.z],
      },
      parentId: commonParentId,
      children: [],
      visible: true,
      locked: false,
      physicsType: 'static',
    };

    if (commonParentId) {
      const commonParent = this.findById(commonParentId);
      if (commonParent) {
        commonParent.mesh.attach(group);
        this.addChildRef(commonParent, groupObj.id);
        this.syncLocalTransform(groupObj);
      } else {
        groupObj.parentId = null;
      }
    }

    for (const obj of rootObjects) {
      this.removeChildRef(obj.parentId ?? null, obj.id);
      obj.parentId = group.uuid;
      group.attach(obj.mesh);
      this.addChildRef(groupObj, obj.id);
      this.syncLocalTransform(obj);
    }

    this.objects.push(groupObj);
    return groupObj;
  }

  ungroupObject(groupId: string): boolean {
    const groupObj = this.findById(groupId);
    if (!groupObj || !groupObj.children || groupObj.children.length === 0) return false;

    const targetParent = groupObj.parentId ? this.findById(groupObj.parentId) : null;
    this.removeChildRef(groupObj.parentId ?? null, groupObj.id);

    const childIds = [...groupObj.children];
    for (const childId of childIds) {
      const child = this.findById(childId);
      if (child) {
        if (targetParent) {
          targetParent.mesh.attach(child.mesh);
          child.parentId = targetParent.id;
          this.addChildRef(targetParent, child.id);
        } else {
          this.scene.attach(child.mesh);
          child.parentId = null;
        }
        this.syncLocalTransform(child);
      }
    }

    groupObj.mesh.parent?.remove(groupObj.mesh);
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
