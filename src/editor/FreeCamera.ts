import * as THREE from 'three';

export class FreeCamera {
  private enabled = false;
  private keys = new Set<string>();
  private lookActive = false;
  private panActive = false;
  private yaw = 0;
  private pitch = 0;
  private lastX = 0;
  private lastY = 0;

  private readonly moveSpeed = 6;
  private readonly fastMult = 3;
  private readonly slowMult = 0.35;
  private readonly lookSpeed = 0.004;
  private readonly panSpeed = 0.004;

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 2) {
      this.lookActive = true;
    }
    if (e.button === 1) {
      this.panActive = true;
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) this.lookActive = false;
    if (e.button === 1) this.panActive = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    if (this.lookActive) {
      this.yaw -= dx * this.lookSpeed;
      this.pitch -= dy * this.lookSpeed;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    }

    if (this.panActive) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.camera.position.addScaledVector(right, -dx * this.panSpeed);
      this.camera.position.addScaledVector(up, dy * this.panSpeed);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.camera.position.addScaledVector(forward, e.deltaY * 0.01);
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  constructor(
    private camera: THREE.PerspectiveCamera,
    private domElement: HTMLElement,
  ) {}

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.pitch = euler.x;
    this.yaw = euler.y;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    this.domElement.addEventListener('wheel', this.onWheel, { passive: true });
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.keys.clear();
    this.lookActive = false;
    this.panActive = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.domElement.removeEventListener('wheel', this.onWheel);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);

    const speedMult = this.keys.has('ShiftLeft') ? this.fastMult : this.keys.has('ControlLeft') ? this.slowMult : 1;
    const speed = this.moveSpeed * speedMult * dt;

    if (this.keys.has('KeyW')) this.camera.position.addScaledVector(forward, speed);
    if (this.keys.has('KeyS')) this.camera.position.addScaledVector(forward, -speed);
    if (this.keys.has('KeyA')) this.camera.position.addScaledVector(right, -speed);
    if (this.keys.has('KeyD')) this.camera.position.addScaledVector(right, speed);
    if (this.keys.has('KeyQ')) this.camera.position.addScaledVector(up, speed);
    if (this.keys.has('KeyE')) this.camera.position.addScaledVector(up, -speed);
  }
}
