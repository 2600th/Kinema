import * as THREE from 'three';

export class NavAgent {
  readonly mesh: THREE.Mesh;
  readonly id: string;
  private pathLine: THREE.Line | null = null;
  private pathLineMaterial: THREE.LineBasicMaterial | null = null;
  private pathPositions: Float32Array | null = null;
  private pathAttribute: THREE.BufferAttribute | null = null;
  private pathCapacity = 0;

  constructor(scene: THREE.Scene, position: THREE.Vector3) {
    const geometry = new THREE.CapsuleGeometry(0.25, 0.5, 4, 8);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      roughness: 0.5,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.castShadow = true;
    this.id = THREE.MathUtils.generateUUID();
    scene.add(this.mesh);
  }

  updatePosition(position: { x: number; y: number; z: number }): void {
    this.mesh.position.set(position.x, position.y + 0.5, position.z);
  }

  updatePathVisualization(
    scene: THREE.Scene,
    points: Array<{ x: number; y: number; z: number }>,
  ): void {
    if (points.length < 2) {
      // Hide but keep the line object for reuse
      if (this.pathLine) this.pathLine.visible = false;
      return;
    }

    if (!this.pathLine) {
      // Create once, reuse every frame
      this.pathLineMaterial = new THREE.LineBasicMaterial({
        color: 0x00bcd4,
        transparent: true,
        opacity: 0.6,
      });
      const geometry = new THREE.BufferGeometry();
      this.pathLine = new THREE.Line(geometry, this.pathLineMaterial);
      scene.add(this.pathLine);
    }

    // Update geometry buffer in-place — only reallocate when point count grows.
    const neededFloats = points.length * 3;
    if (!this.pathPositions || this.pathCapacity < points.length) {
      this.pathCapacity = points.length;
      this.pathPositions = new Float32Array(neededFloats);
      this.pathAttribute = new THREE.BufferAttribute(this.pathPositions, 3);
      this.pathLine.geometry.setAttribute('position', this.pathAttribute);
    }
    const positions = this.pathPositions;
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i].x;
      positions[i * 3 + 1] = points[i].y + 0.1;
      positions[i * 3 + 2] = points[i].z;
    }
    this.pathAttribute!.needsUpdate = true;
    this.pathLine.geometry.setDrawRange(0, points.length);
    this.pathLine.visible = true;
  }

  highlight(durationMs = 2000): void {
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    const originalColor = mat.color.getHex();
    mat.color.setHex(0x00ff88);
    mat.emissive.setHex(0x00ff88);
    mat.emissiveIntensity = 0.6;
    setTimeout(() => {
      mat.color.setHex(originalColor);
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }, durationMs);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();

    if (this.pathLine) {
      scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
    }
    if (this.pathLineMaterial) {
      this.pathLineMaterial.dispose();
    }
  }
}
