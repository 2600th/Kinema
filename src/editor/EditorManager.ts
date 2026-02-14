import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { GameLoop } from '@core/GameLoop';
import type { RendererManager } from '@renderer/RendererManager';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { LevelManager } from '@level/LevelManager';
import type { PlayerController } from '@character/PlayerController';
import type { InteractionManager } from '@interaction/InteractionManager';
import { AssetLoader } from '@level/AssetLoader';
import { EditorUI } from './EditorUI';
import { TransformGizmo } from './TransformGizmo';
import { SnapGrid } from './SnapGrid';
import { FreeCamera } from './FreeCamera';
import { AssetBrowser, type AssetEntry } from './AssetBrowser';
import { CommandHistory } from './CommandHistory';
import { LevelSerializer, type LevelData } from './LevelSerializer';
import type { EditorObject } from './EditorObject';

export class EditorManager {
  private active = false;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private editorObjects: EditorObject[] = [];
  private selected: EditorObject | null = null;
  private selectionHelper: THREE.BoxHelper | null = null;
  private placementAsset: AssetEntry | null = null;
  private placementPreview: THREE.Object3D | null = null;
  private placementPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private dragStartTransform: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 } | null = null;

  private gizmo: TransformGizmo;
  private grid: SnapGrid;
  private gridWasVisible = true;
  private freeCamera: FreeCamera;
  private ui: EditorUI;
  private assetBrowser: AssetBrowser;
  private history = new CommandHistory();
  private assetLoader = new AssetLoader();

  constructor(
    private renderer: RendererManager,
    private physicsWorld: PhysicsWorld,
    private eventBus: EventBus,
    private gameLoop: GameLoop,
    private levelManager: LevelManager,
    private player: PlayerController,
    private interactionManager: InteractionManager,
  ) {
    this.freeCamera = new FreeCamera(this.renderer.camera, this.renderer.canvas);
    this.grid = new SnapGrid(this.renderer.scene);
    this.ui = new EditorUI({
      onSave: () => this.saveLevel(),
      onLoad: () => this.loadLevel(),
      onUndo: () => this.history.undo(),
      onRedo: () => this.history.redo(),
      onToggleSnap: () => this.toggleSnap(),
      onToggleGrid: () => this.grid.toggleGrid(),
      onModeChange: (mode) => this.gizmo.setMode(mode),
      onInspectorChange: (values) => this.applyInspectorChange(values),
    });
    document.body.appendChild(this.ui.root);
    this.assetBrowser = new AssetBrowser(this.ui.assetPanel, (asset) => this.startPlacement(asset));

    this.gizmo = new TransformGizmo(
      this.renderer.camera,
      this.renderer.canvas,
      this.renderer.scene,
      (dragging) => this.onDragStateChanged(dragging),
      () => this.onGizmoObjectChanged(),
    );
    this.gizmo.setSnaps(this.grid.positionSnap, this.grid.rotationSnap, this.grid.scaleSnap);

    this.eventBus.on('editor:toggle', () => this.toggle());
  }

  isActive(): boolean {
    return this.active;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.freeCamera.update(dt);
    this.updatePlacementPreview();
    this.selectionHelper?.update();
  }

  dispose(): void {
    this.ui.dispose();
    this.assetBrowser.dispose();
    this.gizmo.dispose(this.renderer.scene);
    this.grid.dispose(this.renderer.scene);
    this.clearSelectionHelper();
  }

  private toggle(): void {
    if (this.active) {
      this.exit();
    } else {
      this.enter();
    }
  }

  private enter(): void {
    this.active = true;
    this.gameLoop.setSimulationEnabled(false);
    this.interactionManager.setEnabled(false);
    this.player.setActive(false);
    document.exitPointerLock();
    this.freeCamera.enable();
    this.grid.setVisible(this.gridWasVisible);
    this.ui.show();
    this.buildEditorObjects();
    this.bindEditorInput();
  }

  private exit(): void {
    this.active = false;
    this.gameLoop.setSimulationEnabled(true);
    this.interactionManager.setEnabled(true);
    this.player.setActive(true);
    this.gridWasVisible = this.grid.isVisible();
    this.grid.setVisible(false);
    this.freeCamera.disable();
    this.ui.hide();
    this.clearPlacement();
    this.setSelection(null);
    this.unbindEditorInput();
    this.gizmo.attach(null);
  }

  private bindEditorInput(): void {
    this.renderer.canvas.addEventListener('mousedown', this.onMouseDown);
    this.renderer.canvas.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('keydown', this.onKeyDown);
  }

  private unbindEditorInput(): void {
    this.renderer.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.renderer.canvas.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.active) return;
    if (e.button !== 0) return;
    if (this.ui.root.contains(e.target as Node)) return;
    if (this.placementAsset && this.placementPreview) {
      this.confirmPlacement();
      return;
    }
    this.selectAtPointer(e.clientX, e.clientY);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.active) return;
    const rect = this.renderer.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.code === 'KeyW') this.gizmo.setMode('translate');
    if (e.code === 'KeyE') this.gizmo.setMode('rotate');
    if (e.code === 'KeyR') this.gizmo.setMode('scale');
    if (e.code === 'Escape') this.clearPlacement();
    if (e.code === 'KeyG') this.grid.toggleGrid();
    if (e.code === 'KeyZ' && e.ctrlKey) {
      this.history.undo();
      e.preventDefault();
    }
    if (e.code === 'KeyY' && e.ctrlKey) {
      this.history.redo();
      e.preventDefault();
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      this.deleteSelection();
      e.preventDefault();
    }
  };

  private selectAtPointer(clientX: number, clientY: number): void {
    const rect = this.renderer.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
    const meshes = this.editorObjects.map((obj) => obj.mesh);
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (!hits.length) {
      this.setSelection(null);
      return;
    }
    const mesh = hits[0].object;
    const target = this.editorObjects.find((obj) => obj.mesh === mesh || obj.mesh.getObjectById(mesh.id) !== undefined);
    this.setSelection(target ?? null);
  }

  private setSelection(obj: EditorObject | null): void {
    this.selected = obj;
    this.gizmo.attach(obj?.mesh ?? null);
    this.ui.setSelection(obj);
    this.setSelectionHelper(obj?.mesh ?? null);
    this.eventBus.emit('editor:objectSelected', obj ? { id: obj.id } : null);
  }

  private setSelectionHelper(target: THREE.Object3D | null): void {
    this.clearSelectionHelper();
    if (!target) return;
    const helper = new THREE.BoxHelper(target, 0x4fc3f7);
    const material = helper.material as THREE.LineBasicMaterial;
    material.depthTest = false;
    material.transparent = true;
    material.opacity = 0.85;
    this.ensureHelperNormals(helper);
    this.renderer.scene.add(helper);
    this.selectionHelper = helper;
  }

  private ensureHelperNormals(root: THREE.Object3D): void {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry || !('attributes' in mesh.geometry)) return;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      if (geometry.attributes.normal) return;
      const position = geometry.attributes.position;
      if (!position) return;
      const count = position.count;
      const normals = new Float32Array(count * 3);
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    });
  }

  private clearSelectionHelper(): void {
    if (!this.selectionHelper) return;
    this.renderer.scene.remove(this.selectionHelper);
    this.selectionHelper = null;
  }

  private buildEditorObjects(): void {
    const map = new Map<string, EditorObject>();
    for (const obj of this.levelManager.getLevelObjects()) {
      if (obj instanceof THREE.Mesh) {
        const entry = this.buildEditorObject(obj);
        map.set(obj.uuid, entry);
      }
    }
    for (const dyn of this.levelManager.getDynamicBodies()) {
      const existing = map.get(dyn.mesh.uuid);
      if (existing) {
        existing.body = dyn.body;
        existing.collider = dyn.body.collider(0) ?? undefined;
      } else {
        const entry = this.buildEditorObject(dyn.mesh);
        entry.body = dyn.body;
        entry.collider = dyn.body.collider(0) ?? undefined;
        map.set(dyn.mesh.uuid, entry);
      }
    }
    this.editorObjects = Array.from(map.values());
  }

  private buildEditorObject(mesh: THREE.Object3D): EditorObject {
    const source = this.detectSource(mesh);
    const transform = {
      position: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] as [number, number, number],
    };
    return {
      id: mesh.uuid,
      name: mesh.name || 'Object',
      mesh,
      source,
      transform,
    };
  }

  private detectSource(mesh: THREE.Object3D): { type: 'primitive' | 'glb' | 'sprite'; asset?: string; primitive?: string } {
    const userSource = (mesh.userData as { editorSource?: { type: string; asset?: string; primitive?: string } })
      .editorSource;
    if (userSource) {
      return {
        type: userSource.type as 'primitive' | 'glb' | 'sprite',
        asset: userSource.asset,
        primitive: userSource.primitive,
      };
    }
    if ((mesh as THREE.Sprite).isSprite) {
      return { type: 'sprite' };
    }
    if ((mesh as THREE.Mesh).isMesh && (mesh as THREE.Mesh).geometry) {
      const geomType = (mesh as THREE.Mesh).geometry.type;
      if (geomType.includes('Box')) return { type: 'primitive', primitive: 'cube' };
      if (geomType.includes('Sphere')) return { type: 'primitive', primitive: 'sphere' };
      if (geomType.includes('Cylinder')) return { type: 'primitive', primitive: 'cylinder' };
      if (geomType.includes('Plane')) return { type: 'primitive', primitive: 'plane' };
    }
    return { type: 'primitive', primitive: 'cube' };
  }

  private startPlacement(asset: AssetEntry): void {
    this.clearPlacement();
    this.placementAsset = asset;
    this.placementPreview = this.createPreviewObject(asset);
    if (this.placementPreview) {
      this.renderer.scene.add(this.placementPreview);
    }
  }

  private createPreviewObject(asset: AssetEntry): THREE.Object3D | null {
    if (asset.type === 'primitive') {
      const mesh = this.createPrimitiveMesh(asset.primitive ?? 'cube', 0.8, true);
      return mesh;
    }
    if (asset.type === 'sprite' && asset.url) {
      const tex = new THREE.TextureLoader().load(asset.url);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8 }));
      sprite.scale.set(1.2, 1.2, 1.2);
      return sprite;
    }
    if (asset.type === 'glb' && asset.url) {
      const group = new THREE.Group();
      this.assetLoader.load(asset.url).then((gltf) => {
        const clone = gltf.scene.clone(true);
        clone.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        group.add(clone);
      });
      return group;
    }
    return null;
  }

  private updatePlacementPreview(): void {
    if (!this.placementPreview) return;
    this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
    const point = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.placementPlane, point);
    if (this.grid.enabled) {
      point.x = Math.round(point.x / this.grid.positionSnap) * this.grid.positionSnap;
      point.y = Math.round(point.y / this.grid.positionSnap) * this.grid.positionSnap;
      point.z = Math.round(point.z / this.grid.positionSnap) * this.grid.positionSnap;
    }
    this.placementPreview.position.copy(point);
  }

  private confirmPlacement(): void {
    if (!this.placementAsset || !this.placementPreview) return;
    const asset = this.placementAsset;
    const preview = this.placementPreview;
    const clone = preview.clone(true);
    const editorObj = this.buildEditorObject(clone);
    editorObj.source = {
      type: asset.type,
      asset: asset.url,
      primitive: asset.primitive,
    };
    clone.userData.editorSource = editorObj.source;
    if (asset.type === 'primitive') {
      const pos = clone.position;
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z);
      const body = this.physicsWorld.world.createRigidBody(bodyDesc);
      let colliderDesc: RAPIER.ColliderDesc;
      const size = 0.6;
      if (asset.primitive === 'sphere') {
        colliderDesc = RAPIER.ColliderDesc.ball(size * 0.5);
      } else if (asset.primitive === 'cylinder') {
        colliderDesc = RAPIER.ColliderDesc.cylinder(size * 0.6, size * 0.3);
      } else if (asset.primitive === 'capsule') {
        colliderDesc = RAPIER.ColliderDesc.capsule(size * 0.4, size * 0.2);
      } else {
        colliderDesc = RAPIER.ColliderDesc.cuboid(size, size, size);
      }
      const collider = this.physicsWorld.world.createCollider(colliderDesc, body);
      editorObj.body = body;
      editorObj.collider = collider;
    }
    this.history.push({
      execute: () => {
        this.addEditorObject(editorObj, this.renderer.scene);
        this.eventBus.emit('editor:objectAdded', { id: editorObj.id });
      },
      undo: () => {
        this.removeEditorObject(editorObj);
        this.eventBus.emit('editor:objectRemoved', { id: editorObj.id });
      },
    });
    this.setSelection(editorObj);
    this.clearPlacement();
  }

  private clearPlacement(): void {
    if (this.placementPreview) {
      this.renderer.scene.remove(this.placementPreview);
    }
    this.placementPreview = null;
    this.placementAsset = null;
  }

  private createPrimitiveMesh(type: string, size: number, preview = false): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    if (type === 'sphere') geometry = new THREE.SphereGeometry(size * 0.6, 16, 16);
    else if (type === 'cylinder') geometry = new THREE.CylinderGeometry(size * 0.5, size * 0.5, size, 16);
    else if (type === 'capsule') geometry = new THREE.CapsuleGeometry(size * 0.4, size * 0.6, 6, 12);
    else if (type === 'plane') geometry = new THREE.PlaneGeometry(size, size);
    else geometry = new THREE.BoxGeometry(size, size, size);

    const material = preview
      ? new THREE.MeshStandardMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.4 })
      : new THREE.MeshStandardMaterial({ color: 0xb0c4de, roughness: 0.6 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private onDragStateChanged(dragging: boolean): void {
    if (dragging && this.selected) {
      this.dragStartTransform = {
        position: this.selected.mesh.position.clone(),
        rotation: this.selected.mesh.rotation.clone(),
        scale: this.selected.mesh.scale.clone(),
      };
    } else if (!dragging && this.selected && this.dragStartTransform) {
      const target = this.selected;
      const before = this.dragStartTransform;
      const after = {
        position: target.mesh.position.clone(),
        rotation: target.mesh.rotation.clone(),
        scale: target.mesh.scale.clone(),
      };
      this.history.push({
        execute: () => this.applyTransform(target, after),
        undo: () => this.applyTransform(target, before),
      });
      this.dragStartTransform = null;
    }
  }

  private onGizmoObjectChanged(): void {
    if (!this.selected) return;
    this.updateEditorObjectTransform(this.selected);
    if (this.grid.enabled) {
      this.applySnapToSelection();
    }
    this.applyPhysicsTransform(this.selected);
    this.ui.setSelection(this.selected);
  }

  private toggleSnap(): void {
    this.grid.toggleSnap();
    if (this.grid.enabled) {
      this.gizmo.setSnaps(this.grid.positionSnap, this.grid.rotationSnap, this.grid.scaleSnap);
    } else {
      this.gizmo.setSnaps(null, null, null);
    }
  }

  private applySnapToSelection(): void {
    if (!this.selected) return;
    const snap = this.grid.positionSnap;
    const pos = this.selected.mesh.position;
    pos.set(
      Math.round(pos.x / snap) * snap,
      Math.round(pos.y / snap) * snap,
      Math.round(pos.z / snap) * snap,
    );
  }

  private applyInspectorChange(values: { position?: number[]; rotation?: number[]; scale?: number[] }): void {
    if (!this.selected) return;
    if (values.position) {
      this.selected.mesh.position.set(values.position[0], values.position[1], values.position[2]);
    }
    if (values.rotation) {
      this.selected.mesh.rotation.set(
        THREE.MathUtils.degToRad(values.rotation[0]),
        THREE.MathUtils.degToRad(values.rotation[1]),
        THREE.MathUtils.degToRad(values.rotation[2]),
      );
    }
    if (values.scale) {
      this.selected.mesh.scale.set(values.scale[0], values.scale[1], values.scale[2]);
    }
    this.updateEditorObjectTransform(this.selected);
    this.applyPhysicsTransform(this.selected);
  }

  private updateEditorObjectTransform(obj: EditorObject): void {
    obj.transform.position = [obj.mesh.position.x, obj.mesh.position.y, obj.mesh.position.z];
    obj.transform.rotation = [obj.mesh.rotation.x, obj.mesh.rotation.y, obj.mesh.rotation.z];
    obj.transform.scale = [obj.mesh.scale.x, obj.mesh.scale.y, obj.mesh.scale.z];
  }

  private applyPhysicsTransform(obj: EditorObject): void {
    if (!obj.body) return;
    const pos = obj.mesh.position;
    obj.body.setTranslation(new RAPIER.Vector3(pos.x, pos.y, pos.z), true);
    const q = obj.mesh.quaternion;
    obj.body.setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w), true);
  }

  private applyTransform(obj: EditorObject, transform: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }): void {
    obj.mesh.position.copy(transform.position);
    obj.mesh.rotation.copy(transform.rotation);
    obj.mesh.scale.copy(transform.scale);
    this.updateEditorObjectTransform(obj);
    this.applyPhysicsTransform(obj);
    this.ui.setSelection(obj);
  }

  private addEditorObject(obj: EditorObject, parent?: THREE.Object3D): void {
    const targetParent = parent ?? this.renderer.scene;
    if (!obj.mesh.parent) {
      targetParent.add(obj.mesh);
    }
    if (!this.editorObjects.includes(obj)) {
      this.editorObjects.push(obj);
    }
    obj.body?.setEnabled(true);
    obj.collider?.setEnabled(true);
  }

  private removeEditorObject(obj: EditorObject): void {
    const parent = obj.mesh.parent;
    if (parent) {
      parent.remove(obj.mesh);
    }
    obj.body?.setEnabled(false);
    obj.collider?.setEnabled(false);
    this.editorObjects = this.editorObjects.filter((entry) => entry !== obj);
    if (this.selected === obj) {
      this.setSelection(null);
    }
  }

  private deleteSelection(): void {
    if (!this.selected) return;
    const target = this.selected;
    const parent = target.mesh.parent ?? this.renderer.scene;
    this.history.push({
      execute: () => {
        this.removeEditorObject(target);
        this.eventBus.emit('editor:objectRemoved', { id: target.id });
      },
      undo: () => {
        this.addEditorObject(target, parent);
        this.eventBus.emit('editor:objectAdded', { id: target.id });
      },
    });
  }

  private async saveLevel(): Promise<void> {
    const data = LevelSerializer.serialize('custom', this.editorObjects);
    LevelSerializer.download(data);
    this.eventBus.emit('editor:saved', { name: data.name });
  }

  private async loadLevel(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const data = await LevelSerializer.loadFromFile(file);
      if (!data) return;
      void this.applyLoadedLevel(data);
    });
    input.click();
  }

  private async applyLoadedLevel(data: LevelData): Promise<void> {
    for (const obj of this.editorObjects) {
      if (obj.mesh.userData.editorSource) {
        this.renderer.scene.remove(obj.mesh);
        if (obj.body) {
          this.physicsWorld.removeBody(obj.body);
        } else if (obj.collider) {
          this.physicsWorld.removeCollider(obj.collider);
        }
      }
    }
    this.editorObjects = this.editorObjects.filter((obj) => !obj.mesh.userData.editorSource);

    for (const entry of data.objects) {
      await this.spawnSerializedObject(entry);
    }

    this.eventBus.emit('editor:loaded', { name: data.name });
    this.ui.setStatus(`Loaded "${data.name}"`);
  }

  private async spawnSerializedObject(entry: LevelData['objects'][number]): Promise<void> {
    let obj: THREE.Object3D | null = null;
    if (entry.source.type === 'primitive') {
      obj = this.createPrimitiveMesh(entry.source.primitive ?? 'cube', 1, false);
    } else if (entry.source.type === 'sprite' && entry.source.asset) {
      const tex = new THREE.TextureLoader().load(entry.source.asset);
      obj = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    } else if (entry.source.type === 'glb' && entry.source.asset) {
      const gltf = await this.assetLoader.load(entry.source.asset);
      obj = gltf.scene.clone(true);
    }
    if (!obj) return;

    obj.position.set(entry.transform.position[0], entry.transform.position[1], entry.transform.position[2]);
    obj.rotation.set(entry.transform.rotation[0], entry.transform.rotation[1], entry.transform.rotation[2]);
    obj.scale.set(entry.transform.scale[0], entry.transform.scale[1], entry.transform.scale[2]);
    obj.userData.editorSource = entry.source;

    const editorObj = this.buildEditorObject(obj);
    editorObj.source = entry.source;
    if (entry.source.type === 'primitive') {
      const pos = obj.position;
      let bodyDesc: RAPIER.RigidBodyDesc;
      if (entry.physics?.type === 'static') {
        bodyDesc = RAPIER.RigidBodyDesc.fixed();
      } else if (entry.physics?.type === 'kinematic') {
        bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
      } else {
        bodyDesc = RAPIER.RigidBodyDesc.dynamic();
      }
      bodyDesc.setTranslation(pos.x, pos.y, pos.z);
      const body = this.physicsWorld.world.createRigidBody(bodyDesc);
      let colliderDesc: RAPIER.ColliderDesc;
      const size = 0.6;
      if (entry.source.primitive === 'sphere') {
        colliderDesc = RAPIER.ColliderDesc.ball(size * 0.5);
      } else if (entry.source.primitive === 'cylinder') {
        colliderDesc = RAPIER.ColliderDesc.cylinder(size * 0.6, size * 0.3);
      } else if (entry.source.primitive === 'capsule') {
        colliderDesc = RAPIER.ColliderDesc.capsule(size * 0.4, size * 0.2);
      } else {
        colliderDesc = RAPIER.ColliderDesc.cuboid(size, size, size);
      }
      if (Number.isFinite(entry.physics?.mass ?? NaN)) {
        body.setAdditionalMass(entry.physics!.mass!, true);
      }
      const collider = this.physicsWorld.world.createCollider(colliderDesc, body);
      editorObj.body = body;
      editorObj.collider = collider;
    }
    this.addEditorObject(editorObj, this.renderer.scene);
  }
}
