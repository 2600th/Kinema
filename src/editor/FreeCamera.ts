import * as THREE from 'three';

const _fcForward = new THREE.Vector3();
const _fcRight = new THREE.Vector3();
const _fcUp = new THREE.Vector3(0, 1, 0);
const _fcEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _fcEnableEuler = new THREE.Euler(0, 0, 0, 'YXZ');

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
      _fcEuler.set(this.pitch, this.yaw, 0);
      this.camera.quaternion.setFromEuler(_fcEuler);
    }

    if (this.panActive) {
      _fcRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      _fcForward.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.camera.position.addScaledVector(_fcRight, -dx * this.panSpeed);
      this.camera.position.addScaledVector(_fcForward, dy * this.panSpeed);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    _fcForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    // Negative multiplier: scroll down (positive deltaY) = zoom out (move backward)
    this.camera.position.addScaledVector(_fcForward, -e.deltaY * 0.01);
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
    const euler = _fcEnableEuler.setFromQuaternion(this.camera.quaternion, 'YXZ');
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
    _fcForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _fcRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const forward = _fcForward;
    const right = _fcRight;
    const up = _fcUp;

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
