import * as THREE from 'three';
import type { Disposable } from '@core/types';
import type { PhysicsWorld } from './PhysicsWorld';

/**
 * Rapier debug-render lines for collider visualization.
 */
export class PhysicsDebugView implements Disposable {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  private readonly lines = new THREE.LineSegments(this.geometry, this.material);
  private enabled = false;

  constructor(
    private scene: THREE.Scene,
    private physicsWorld: PhysicsWorld,
  ) {
    this.lines.frustumCulled = false;
    this.lines.name = '__kinema_physics_debug';
    this.lines.renderOrder = 40;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.scene.add(this.lines);
    } else {
      this.scene.remove(this.lines);
    }
  }

  update(): void {
    if (!this.enabled) return;
    const buffers = this.physicsWorld.world.debugRender();
    const { vertices, colors } = buffers;
    if (!vertices || vertices.length === 0) {
      this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      this.geometry.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
      return;
    }

    const rgbColors = new Float32Array((colors.length / 4) * 3);
    for (let i = 0, j = 0; i < colors.length; i += 4, j += 3) {
      rgbColors[j] = colors[i];
      rgbColors[j + 1] = colors[i + 1];
      rgbColors[j + 2] = colors[i + 2];
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(rgbColors, 3));
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.scene.remove(this.lines);
    this.geometry.dispose();
    this.material.dispose();
  }
}
