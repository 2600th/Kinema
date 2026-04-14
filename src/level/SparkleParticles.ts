import * as THREE from "three";

/**
 * Floating sparkle particles that drift gently through the corridor.
 * Creates an Astro Bot-style magical atmosphere with colorful star-shaped points.
 */
export class SparkleParticles {
  readonly points: THREE.Points;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  private readonly velocities: Float32Array;
  private readonly phases: Float32Array;
  private readonly baseSizes: Float32Array;

  private readonly boundsMin: THREE.Vector3;
  private readonly boundsMax: THREE.Vector3;

  private elapsed = 0;

  constructor(options: {
    count: number;
    areaWidth: number;
    areaHeight: number;
    areaDepth: number;
    position: THREE.Vector3;
    colors?: number[];
    minSize?: number;
    maxSize?: number;
  }) {
    const {
      count,
      areaWidth,
      areaHeight,
      areaDepth,
      position,
      colors = [0x00d4ff, 0xffd700, 0xff69b4, 0x00ff88, 0xffffff],
      minSize = 0.08,
      maxSize = 0.2,
    } = options;

    const halfW = areaWidth / 2;
    const halfH = areaHeight / 2;
    const halfD = areaDepth / 2;

    this.boundsMin = new THREE.Vector3(-halfW, -halfH, -halfD);
    this.boundsMax = new THREE.Vector3(halfW, halfH, halfD);

    // Per-particle arrays
    const positions = new Float32Array(count * 3);
    const colorsArr = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    this.velocities = new Float32Array(count * 3);
    this.phases = new Float32Array(count);
    this.baseSizes = new Float32Array(count);

    const tmpColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Random position within bounds
      positions[i3] = (Math.random() - 0.5) * areaWidth;
      positions[i3 + 1] = (Math.random() - 0.5) * areaHeight;
      positions[i3 + 2] = (Math.random() - 0.5) * areaDepth;

      // Slow upward drift with slight horizontal variance
      this.velocities[i3] = (Math.random() - 0.5) * 0.05; // x drift
      this.velocities[i3 + 1] = 0.2 + Math.random() * 0.2; // y drift ~0.2-0.4
      this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.05; // z drift

      // Phase offset for twinkle and wobble
      this.phases[i] = Math.random() * Math.PI * 2;

      // Size
      const size = minSize + Math.random() * (maxSize - minSize);
      sizes[i] = size;
      this.baseSizes[i] = size;

      // Color — pick randomly from palette. Multiply into HDR range so
      // sparkles exceed 1.0 and trigger the bloom pass on bright backgrounds.
      const hex = colors[Math.floor(Math.random() * colors.length)];
      tmpColor.setHex(hex);
      const hdrBoost = 4.0;
      colorsArr[i3] = tmpColor.r * hdrBoost;
      colorsArr[i3 + 1] = tmpColor.g * hdrBoost;
      colorsArr[i3 + 2] = tmpColor.b * hdrBoost;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colorsArr, 3));
    this.geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    // Sparkles need HDR-range color to trigger bloom on bright backgrounds.
    // Use standard blending with high opacity to remain visible against light floors.
    this.material = new THREE.PointsMaterial({
      size: maxSize,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Disable fog on sparkles so they don't wash out at distance.
    this.material.fog = false;

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.position.copy(position);
    this.points.frustumCulled = false;
  }

  update(dt: number): void {
    this.elapsed += dt;

    const posAttr = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const sizeAttr = this.geometry.getAttribute("size") as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const sizes = sizeAttr.array as Float32Array;
    const count = posAttr.count;

    const bMin = this.boundsMin;
    const bMax = this.boundsMax;
    const bWidth = bMax.x - bMin.x;
    const bDepth = bMax.z - bMin.z;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const phase = this.phases[i];

      // Drift upward + base velocity
      positions[i3] += this.velocities[i3] * dt;
      positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      // Gentle X/Z wobble via sine
      const wobbleAmount = 0.15;
      positions[i3] += Math.sin(this.elapsed * 1.2 + phase) * wobbleAmount * dt;
      positions[i3 + 2] += Math.cos(this.elapsed * 0.9 + phase * 1.3) * wobbleAmount * dt;

      // Wrap around bounds
      if (positions[i3 + 1] > bMax.y) {
        positions[i3 + 1] = bMin.y;
        positions[i3] = bMin.x + Math.random() * bWidth;
        positions[i3 + 2] = bMin.z + Math.random() * bDepth;
      }
      if (positions[i3] > bMax.x) positions[i3] = bMin.x;
      else if (positions[i3] < bMin.x) positions[i3] = bMax.x;
      if (positions[i3 + 2] > bMax.z) positions[i3 + 2] = bMin.z;
      else if (positions[i3 + 2] < bMin.z) positions[i3 + 2] = bMax.z;

      // Twinkle: sine-based size oscillation
      const twinkle = 0.5 + 0.5 * Math.sin(this.elapsed * 3.0 + phase);
      sizes[i] = this.baseSizes[i] * (0.4 + 0.6 * twinkle);
    }

    posAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
