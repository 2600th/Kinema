import * as THREE from "three";
import { cos, Fn, float, mix, positionLocal, positionWorld, sin, time, uniform, uv, vec3 } from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";

/**
 * Procedural grass patch using InstancedMesh + TSL vertex displacement.
 * Each blade is a thin triangle strip that sways with wind noise.
 * Stylized, bright, saturated look inspired by Astro Bot PS5.
 */
export class GrassEffect {
  readonly mesh: THREE.InstancedMesh;

  private material: MeshStandardNodeMaterial;
  private geometry: THREE.PlaneGeometry;

  constructor(options: {
    width: number;
    depth: number;
    bladeCount: number;
    bladeHeight: number;
    bladeWidth: number;
    color?: THREE.Color;
    tipColor?: THREE.Color;
    position: THREE.Vector3;
    windSpeed?: number;
    windStrength?: number;
  }) {
    const {
      width,
      depth,
      bladeCount,
      bladeHeight,
      bladeWidth,
      color = new THREE.Color(0x2d8a4e),
      tipColor = new THREE.Color(0x8fce5a),
      position,
      windSpeed = 1.0,
      windStrength = 0.3,
    } = options;

    // --- Uniforms ---
    const uWindSpeed = uniform(float(windSpeed));
    const uWindStrength = uniform(float(windStrength));
    const uBaseColor = uniform(color);
    const uTipColor = uniform(tipColor);

    // --- Blade geometry: plane with 4 height segments for smooth bending ---
    this.geometry = new THREE.PlaneGeometry(bladeWidth, bladeHeight, 1, 4);

    // Shift pivot so the base of the blade sits at y=0
    this.geometry.translate(0, bladeHeight * 0.5, 0);

    // --- TSL material ---
    this.material = new MeshStandardNodeMaterial();
    this.material.side = THREE.DoubleSide;
    this.material.alphaTest = 0.1;

    // Color gradient: base color at bottom, tip color at top
    const colorGradient = Fn(() => {
      const t = uv().y;
      return mix(uBaseColor, uTipColor, t);
    });

    this.material.colorNode = colorGradient();

    // Wind vertex displacement
    const windDisplacement = Fn(() => {
      const pos = positionLocal.toVar();
      const worldPos = positionWorld;
      const uvY = uv().y;

      // Quadratic weight: base stays fixed, tip moves most
      const weight = uvY.mul(uvY);

      // Wind displacement on X axis
      const windX = sin(worldPos.x.mul(0.5).add(worldPos.z.mul(0.3)).add(time.mul(uWindSpeed)))
        .mul(uWindStrength)
        .mul(weight);

      // Wind displacement on Z axis (offset frequency for natural look)
      const windZ = cos(worldPos.z.mul(0.4).add(time.mul(uWindSpeed).mul(0.7)))
        .mul(uWindStrength)
        .mul(0.5)
        .mul(weight);

      return vec3(pos.x.add(windX), pos.y, pos.z.add(windZ));
    });

    this.material.positionNode = windDisplacement();

    // Roughness / metalness for stylized look
    this.material.roughness = 0.8;
    this.material.metalness = 0.0;

    // --- Instanced mesh ---
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, bladeCount);

    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;

    // --- Scatter blades randomly within the patch ---
    const dummy = new THREE.Object3D();

    for (let i = 0; i < bladeCount; i++) {
      // Random position within patch
      const x = (Math.random() - 0.5) * width;
      const z = (Math.random() - 0.5) * depth;

      dummy.position.set(x, 0, z);

      // Random Y rotation for variety
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);

      // Random height scale between 0.7 and 1.0
      const heightScale = 0.7 + Math.random() * 0.3;
      dummy.scale.set(1, heightScale, 1);

      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;

    // Position the entire patch
    this.mesh.position.copy(position);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
