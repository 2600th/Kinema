import * as THREE from "three";

export interface ParticleConfig {
  maxParticles: number;
  /** Base world-unit radius of each particle. */
  size: number;
  /** Random size variation (0 = uniform, 1 = 0×–2× base size). */
  sizeVariation: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
  /** Use additive blending (ideal for sparks, fire, glow effects). */
  additive: boolean;
}

const DEFAULT_CONFIG: ParticleConfig = {
  maxParticles: 100,
  size: 0.1,
  sizeVariation: 0.3,
  color: new THREE.Color(0xffffff),
  gravity: 1,
  drag: 2,
  additive: false,
};

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _camQuat = new THREE.Quaternion();

/** Shared procedural soft-circle texture (created once, reused). */
let _softCircleTex: THREE.CanvasTexture | null = null;
function getSoftCircleTexture(): THREE.CanvasTexture {
  if (_softCircleTex) return _softCircleTex;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.8)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.3)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  _softCircleTex = new THREE.CanvasTexture(canvas);
  return _softCircleTex;
}

/**
 * GPU-instanced particle pool using billboard PlaneGeometry.
 *
 * Improvements over basic box/sphere particles:
 *  - Billboard planes always face the camera
 *  - Soft-circle procedural texture for natural falloff
 *  - Per-particle random size variation
 *  - Smooth size-over-lifetime curve (grow → linger → shrink)
 *  - Additive blending option for sparks/glow
 *  - Compact live range with swap-remove: CPU/GPU work scales with live count
 */
export class ParticlePool {
  private mesh: THREE.InstancedMesh;
  private material: THREE.MeshBasicMaterial;
  // SOA arrays
  private posX: Float32Array;
  private posY: Float32Array;
  private posZ: Float32Array;
  private velX: Float32Array;
  private velY: Float32Array;
  private velZ: Float32Array;
  private lifetimes: Float32Array;
  private ages: Float32Array;
  /** Per-particle random scale multiplier (set at emit time). */
  private scales: Float32Array;
  private maxParticles: number;
  private baseSize: number;
  private sizeVariation: number;
  /** Number of currently live particles. Live slots are [0, activeCount). */
  private activeCount = 0;
  private gravity: number;
  private drag: number;

  constructor(scene: THREE.Scene, config: Partial<ParticleConfig> = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    this.maxParticles = cfg.maxParticles;
    this.baseSize = cfg.size;
    this.sizeVariation = cfg.sizeVariation;
    this.gravity = cfg.gravity;
    this.drag = cfg.drag;

    // Billboard plane — geometry is 1×1, scaled via instance matrix
    const geo = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({
      color: cfg.color,
      map: getSoftCircleTexture(),
      transparent: true,
      depthWrite: false,
      blending: cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, cfg.maxParticles);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;

    // Allocate SOA arrays
    const n = cfg.maxParticles;
    this.posX = new Float32Array(n);
    this.posY = new Float32Array(n);
    this.posZ = new Float32Array(n);
    this.velX = new Float32Array(n);
    this.velY = new Float32Array(n);
    this.velZ = new Float32Array(n);
    this.lifetimes = new Float32Array(n);
    this.ages = new Float32Array(n);
    this.scales = new Float32Array(n);

    scene.add(this.mesh);
  }

  /**
   * Swap all SOA data between two indices.
   * Used by swap-remove compaction to keep [0, activeCount) dense.
   */
  private swapParticle(a: number, b: number): void {
    let tmp: number;

    tmp = this.posX[a];
    this.posX[a] = this.posX[b];
    this.posX[b] = tmp;
    tmp = this.posY[a];
    this.posY[a] = this.posY[b];
    this.posY[b] = tmp;
    tmp = this.posZ[a];
    this.posZ[a] = this.posZ[b];
    this.posZ[b] = tmp;

    tmp = this.velX[a];
    this.velX[a] = this.velX[b];
    this.velX[b] = tmp;
    tmp = this.velY[a];
    this.velY[a] = this.velY[b];
    this.velY[b] = tmp;
    tmp = this.velZ[a];
    this.velZ[a] = this.velZ[b];
    this.velZ[b] = tmp;

    tmp = this.lifetimes[a];
    this.lifetimes[a] = this.lifetimes[b];
    this.lifetimes[b] = tmp;
    tmp = this.ages[a];
    this.ages[a] = this.ages[b];
    this.ages[b] = tmp;
    tmp = this.scales[a];
    this.scales[a] = this.scales[b];
    this.scales[b] = tmp;
  }

  /**
   * Emit a burst of particles at a position with velocity spread.
   * New particles are appended at the end of the live range [0, activeCount).
   */
  emit(
    position: THREE.Vector3,
    count: number,
    options: {
      velocityMin?: THREE.Vector3;
      velocityMax?: THREE.Vector3;
      lifetime?: number;
      spread?: number;
    } = {},
  ): void {
    const { velocityMin, velocityMax, lifetime = 0.5, spread = 0 } = options;

    const vMinX = velocityMin?.x ?? 0;
    const vMinY = velocityMin?.y ?? 0;
    const vMinZ = velocityMin?.z ?? 0;
    const vMaxX = velocityMax?.x ?? 0;
    const vMaxY = velocityMax?.y ?? 0;
    const vMaxZ = velocityMax?.z ?? 0;

    for (let i = 0; i < count; i++) {
      if (this.activeCount >= this.maxParticles) break;

      const idx = this.activeCount++;

      this.posX[idx] = position.x + (Math.random() - 0.5) * spread;
      this.posY[idx] = position.y + Math.random() * spread * 0.3; // bias upward
      this.posZ[idx] = position.z + (Math.random() - 0.5) * spread;

      this.velX[idx] = vMinX + Math.random() * (vMaxX - vMinX);
      this.velY[idx] = vMinY + Math.random() * (vMaxY - vMinY);
      this.velZ[idx] = vMinZ + Math.random() * (vMaxZ - vMinZ);

      this.lifetimes[idx] = lifetime;
      this.ages[idx] = 0;
      // Random scale variation: (1 - variation) to (1 + variation)
      this.scales[idx] = 1 + (Math.random() * 2 - 1) * this.sizeVariation;
    }
  }

  /**
   * Advance all live particles and update billboard instance matrices.
   * Dead particles are removed via swap-remove so iteration stays O(live).
   * Requires camera for billboard orientation.
   */
  update(dt: number, camera?: THREE.Camera): void {
    const dragFactor = Math.max(0, 1 - this.drag * dt);
    const gravDt = this.gravity * dt;

    // Extract camera quaternion for billboard orientation
    if (camera) {
      _camQuat.copy(camera.quaternion);
    }

    let i = 0;
    while (i < this.activeCount) {
      const age = this.ages[i] + dt;
      this.ages[i] = age;

      if (age >= this.lifetimes[i]) {
        // Swap with last live particle and shrink live range
        this.swapParticle(i, this.activeCount - 1);
        this.activeCount--;
        // Re-check index i (now holds the swapped particle)
        continue;
      }

      // Apply drag and gravity
      this.velX[i] *= dragFactor;
      this.velY[i] *= dragFactor;
      this.velZ[i] *= dragFactor;
      this.velY[i] -= gravDt;

      // Integrate position
      this.posX[i] += this.velX[i] * dt;
      this.posY[i] += this.velY[i] * dt;
      this.posZ[i] += this.velZ[i] * dt;

      // Size-over-lifetime: quick grow (0-15%), linger (15-55%), shrink (55-100%)
      const t = age / this.lifetimes[i];
      let sizeT: number;
      if (t < 0.15) {
        sizeT = t / 0.15; // grow
      } else if (t < 0.55) {
        sizeT = 1; // full size
      } else {
        sizeT = 1 - (t - 0.55) / 0.45; // shrink
      }

      const s = this.baseSize * this.scales[i] * sizeT;

      // Compose billboard matrix: camera rotation + particle scale + position
      _pos.set(this.posX[i], this.posY[i], this.posZ[i]);
      _scale.set(s, s, s);
      _mat4.compose(_pos, camera ? _camQuat : _camQuat.identity(), _scale);
      this.mesh.setMatrixAt(i, _mat4);

      i++;
    }

    this.mesh.count = this.activeCount;
    if (this.activeCount > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
