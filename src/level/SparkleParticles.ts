import * as THREE from "three";

interface SparkleRegion {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  readonly count: number;
  readonly worldCenterZ: number;
  readonly boundsMin: THREE.Vector3;
  readonly boundsMax: THREE.Vector3;
  readonly velocities: Float32Array;
  readonly baseSizes: Float32Array;
  readonly phaseSin: Float32Array;
  readonly phaseCos: Float32Array;
  readonly phaseSin13: Float32Array;
  readonly phaseCos13: Float32Array;
  distanceVisible: boolean;
}

export interface SparkleParticlesDebugState {
  readonly configuredCount: number;
  readonly visibleCount: number;
  readonly regionCount: number;
  readonly visibleRegionCount: number;
}

/**
 * Floating corridor sparkles split into independently culled Z regions.
 * Regions outside the explicit observer-distance band skip both rendering and
 * CPU animation, while visible regions retain Three.js view-frustum culling.
 */
export class SparkleParticles {
  readonly root = new THREE.Group();
  /** Backward-compatible scene root used by ProceduralBuilder. */
  readonly points = this.root;

  private readonly regions: SparkleRegion[] = [];
  private readonly configuredCount: number;
  private readonly visibilityDistance: number;
  private globallyVisible = true;
  private elapsed = 0;
  private disposed = false;

  constructor(options: {
    count: number;
    areaWidth: number;
    areaHeight: number;
    areaDepth: number;
    position: THREE.Vector3;
    colors?: number[];
    minSize?: number;
    maxSize?: number;
    regionCount?: number;
    visibilityDistance?: number;
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
      regionCount = 4,
      visibilityDistance,
    } = options;

    this.configuredCount = Math.max(0, Math.floor(count));
    const actualRegionCount = Math.max(1, Math.min(Math.floor(regionCount), Math.max(1, this.configuredCount)));
    const regionDepth = areaDepth / actualRegionCount;
    this.visibilityDistance = visibilityDistance ?? Math.max(120, regionDepth * 1.5);
    this.root.name = "SparkleRegions";
    this.root.position.copy(position);

    const baseCount = Math.floor(this.configuredCount / actualRegionCount);
    const remainder = this.configuredCount % actualRegionCount;
    for (let index = 0; index < actualRegionCount; index += 1) {
      const regionParticleCount = baseCount + (index < remainder ? 1 : 0);
      const localCenterZ = -areaDepth * 0.5 + regionDepth * (index + 0.5);
      const region = this.createRegion({
        count: regionParticleCount,
        areaWidth,
        areaHeight,
        areaDepth: regionDepth,
        localCenterZ,
        worldCenterZ: position.z + localCenterZ,
        colors,
        minSize,
        maxSize,
        index,
      });
      this.regions.push(region);
      this.root.add(region.points);
    }
  }

  update(dt: number, observerWorldZ?: number): void {
    if (this.disposed) return;
    this.elapsed += dt;

    for (const region of this.regions) {
      if (observerWorldZ !== undefined && Number.isFinite(observerWorldZ)) {
        region.distanceVisible = Math.abs(region.worldCenterZ - observerWorldZ) <= this.visibilityDistance;
      }
      region.points.visible = this.globallyVisible && region.distanceVisible;
      if (!region.points.visible || dt <= 0) continue;
      this.updateRegion(region, dt);
    }
  }

  setVisible(visible: boolean): void {
    this.globallyVisible = visible;
    for (const region of this.regions) {
      region.points.visible = visible && region.distanceVisible;
    }
  }

  getDebugState(): SparkleParticlesDebugState {
    let visibleCount = 0;
    let visibleRegionCount = 0;
    for (const region of this.regions) {
      if (!region.points.visible) continue;
      visibleRegionCount += 1;
      visibleCount += region.count;
    }
    return {
      configuredCount: this.configuredCount,
      visibleCount,
      regionCount: this.regions.length,
      visibleRegionCount,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const region of this.regions) {
      region.points.geometry.dispose();
      region.points.material.dispose();
    }
    this.root.removeFromParent();
    this.root.clear();
  }

  private createRegion(options: {
    count: number;
    areaWidth: number;
    areaHeight: number;
    areaDepth: number;
    localCenterZ: number;
    worldCenterZ: number;
    colors: number[];
    minSize: number;
    maxSize: number;
    index: number;
  }): SparkleRegion {
    const { count, areaWidth, areaHeight, areaDepth, localCenterZ, worldCenterZ, colors, minSize, maxSize, index } =
      options;
    const halfW = areaWidth * 0.5;
    const halfH = areaHeight * 0.5;
    const halfD = areaDepth * 0.5;
    const positions = new Float32Array(count * 3);
    const colorsArray = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const velocities = new Float32Array(count * 3);
    const baseSizes = new Float32Array(count);
    const phaseSin = new Float32Array(count);
    const phaseCos = new Float32Array(count);
    const phaseSin13 = new Float32Array(count);
    const phaseCos13 = new Float32Array(count);
    const color = new THREE.Color();

    for (let particleIndex = 0; particleIndex < count; particleIndex += 1) {
      const offset = particleIndex * 3;
      positions[offset] = (Math.random() - 0.5) * areaWidth;
      positions[offset + 1] = (Math.random() - 0.5) * areaHeight;
      positions[offset + 2] = (Math.random() - 0.5) * areaDepth;
      velocities[offset] = (Math.random() - 0.5) * 0.05;
      velocities[offset + 1] = 0.2 + Math.random() * 0.2;
      velocities[offset + 2] = (Math.random() - 0.5) * 0.05;

      const phase = Math.random() * Math.PI * 2;
      phaseSin[particleIndex] = Math.sin(phase);
      phaseCos[particleIndex] = Math.cos(phase);
      phaseSin13[particleIndex] = Math.sin(phase * 1.3);
      phaseCos13[particleIndex] = Math.cos(phase * 1.3);

      const size = minSize + Math.random() * (maxSize - minSize);
      sizes[particleIndex] = size;
      baseSizes[particleIndex] = size;
      color.setHex(colors[Math.floor(Math.random() * colors.length)] ?? 0xffffff);
      colorsArray[offset] = color.r * 4;
      colorsArray[offset + 1] = color.g * 4;
      colorsArray[offset + 2] = color.b * 4;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colorsArray, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.computeBoundingSphere();
    const material = new THREE.PointsMaterial({
      size: maxSize,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const points = new THREE.Points(geometry, material);
    points.name = `SparkleRegion_${index}`;
    points.position.z = localCenterZ;
    points.frustumCulled = true;

    return {
      points,
      count,
      worldCenterZ,
      boundsMin: new THREE.Vector3(-halfW, -halfH, -halfD),
      boundsMax: new THREE.Vector3(halfW, halfH, halfD),
      velocities,
      baseSizes,
      phaseSin,
      phaseCos,
      phaseSin13,
      phaseCos13,
      distanceVisible: true,
    };
  }

  private updateRegion(region: SparkleRegion, dt: number): void {
    const positionAttribute = region.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const sizeAttribute = region.points.geometry.getAttribute("size") as THREE.BufferAttribute;
    const positions = positionAttribute.array as Float32Array;
    const sizes = sizeAttribute.array as Float32Array;
    const boundsWidth = region.boundsMax.x - region.boundsMin.x;
    const boundsDepth = region.boundsMax.z - region.boundsMin.z;
    const sinWobbleX = Math.sin(this.elapsed * 1.2);
    const cosWobbleX = Math.cos(this.elapsed * 1.2);
    const sinWobbleZ = Math.sin(this.elapsed * 0.9);
    const cosWobbleZ = Math.cos(this.elapsed * 0.9);
    const sinTwinkle = Math.sin(this.elapsed * 3);
    const cosTwinkle = Math.cos(this.elapsed * 3);

    for (let index = 0; index < region.count; index += 1) {
      const offset = index * 3;
      const sinPhase = region.phaseSin[index];
      const cosPhase = region.phaseCos[index];
      positions[offset] += region.velocities[offset] * dt;
      positions[offset + 1] += region.velocities[offset + 1] * dt;
      positions[offset + 2] += region.velocities[offset + 2] * dt;
      positions[offset] += (sinWobbleX * cosPhase + cosWobbleX * sinPhase) * 0.15 * dt;
      positions[offset + 2] +=
        (cosWobbleZ * region.phaseCos13[index] - sinWobbleZ * region.phaseSin13[index]) * 0.15 * dt;

      if (positions[offset + 1] > region.boundsMax.y) {
        positions[offset + 1] = region.boundsMin.y;
        positions[offset] = region.boundsMin.x + Math.random() * boundsWidth;
        positions[offset + 2] = region.boundsMin.z + Math.random() * boundsDepth;
      }
      if (positions[offset] > region.boundsMax.x) positions[offset] = region.boundsMin.x;
      else if (positions[offset] < region.boundsMin.x) positions[offset] = region.boundsMax.x;
      if (positions[offset + 2] > region.boundsMax.z) positions[offset + 2] = region.boundsMin.z;
      else if (positions[offset + 2] < region.boundsMin.z) positions[offset + 2] = region.boundsMax.z;

      const twinkle = 0.5 + 0.5 * (sinTwinkle * cosPhase + cosTwinkle * sinPhase);
      sizes[index] = region.baseSizes[index] * (0.4 + 0.6 * twinkle);
    }

    positionAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
  }
}
