import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";

export class TransformGizmo {
  readonly controls: TransformControls;
  private helper: THREE.Object3D;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    scene: THREE.Scene,
    onDraggingChanged: (dragging: boolean) => void,
    onObjectChange: () => void,
  ) {
    this.controls = new TransformControls(camera, domElement);
    this.helper = this.controls.getHelper();
    this.controls.addEventListener("dragging-changed", (e) => {
      onDraggingChanged((e as { value: boolean }).value);
    });
    this.controls.addEventListener("objectChange", () => {
      onObjectChange();
    });
    this.helper.visible = false;
    this.ensureNormalAttributes(this.helper);
    scene.add(this.helper);
  }

  attach(object: THREE.Object3D | null): void {
    if (!object) {
      this.controls.detach();
      this.helper.visible = false;
      return;
    }
    this.controls.attach(object);
    this.helper.visible = true;
  }

  setMode(mode: "translate" | "rotate" | "scale"): void {
    this.controls.setMode(mode);
  }

  setSnaps(position: number | null, rotation: number | null, scale: number | null): void {
    this.controls.setTranslationSnap(position ?? null);
    this.controls.setRotationSnap(rotation ?? null);
    this.controls.setScaleSnap(scale ?? null);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.helper);
    this.controls.dispose();
  }

  private ensureNormalAttributes(root: THREE.Object3D): void {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry || !("attributes" in mesh.geometry)) return;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      if (geometry.attributes.normal) return;
      const position = geometry.attributes.position;
      if (!position) return;
      const count = position.count;
      const normals = new Float32Array(count * 3);
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    });
  }
}
