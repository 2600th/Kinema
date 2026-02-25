import * as THREE from 'three';

export class NavAgent {
  readonly mesh: THREE.Mesh;
  readonly id: string;
  private pathLine: THREE.Line | null = null;

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
    if (this.pathLine) {
      scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      (this.pathLine.material as THREE.Material).dispose();
      this.pathLine = null;
    }

    if (points.length < 2) return;

    const lineGeometry = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(p.x, p.y + 0.1, p.z)),
    );
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00bcd4,
      transparent: true,
      opacity: 0.6,
    });
    this.pathLine = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(this.pathLine);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();

    if (this.pathLine) {
      scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      (this.pathLine.material as THREE.Material).dispose();
    }
  }
}
