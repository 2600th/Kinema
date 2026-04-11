import type { PlayerController } from "@character/PlayerController";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import { getProceduralSpikePlacements, type SpikePlacement } from "@level/SpikeLayout";
import type { ShowcaseStationKey } from "@level/ShowcaseLayout";
import { PlayerHealthSystem } from "@systems/PlayerHealthSystem";
import type { VehicleManager } from "@vehicle/VehicleManager";
import * as THREE from "three";

interface SpikeParticleState {
  sprite: THREE.Sprite;
  baseX: number;
  baseY: number;
  baseZ: number;
  driftRadius: number;
  driftSpeed: number;
  riseSpeed: number;
  heightRange: number;
  scale: number;
  phase: number;
}

interface SpikeHazardEntry {
  id: string;
  station: ShowcaseStationKey;
  position: THREE.Vector3;
  size: THREE.Vector3;
  rotationY: number;
  mesh: THREE.Group;
  particles: SpikeParticleState[];
  pulseOffset: number;
}

export interface HazardDebugEntry {
  id: string;
  station: ShowcaseStationKey;
  position: { x: number; y: number; z: number };
}

const _footPos = new THREE.Vector3();
const _localFootPos = new THREE.Vector3();
const _noRaycast: THREE.Object3D["raycast"] = () => {};

function createSpikeParticleTexture(): THREE.CanvasTexture {
  if (typeof document === "undefined") {
    const data = new Uint8Array([255, 255, 255, 255]);
    const fallback = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    fallback.needsUpdate = true;
    return fallback as unknown as THREE.CanvasTexture;
  }

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  const half = size * 0.5;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.28, "rgba(255,255,255,0.78)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.18)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export class SpikeHazardSystem implements RuntimeSystem {
  readonly id = "spike-hazards";

  private readonly baseGeometry = new THREE.BoxGeometry(1, 0.14, 1);
  private readonly spikeGeometry = new THREE.ConeGeometry(0.18, 0.72, 4);
  private readonly particleTexture = createSpikeParticleTexture();
  private readonly baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c2431,
    roughness: 0.42,
    metalness: 0.78,
    emissive: 0x080d14,
    emissiveIntensity: 0.2,
  });
  private readonly particleColor = new THREE.Color();
  private hazards: SpikeHazardEntry[] = [];
  private animationTime = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly playerController: Pick<PlayerController, "isActive" | "groundPosition">,
    private readonly vehicleManager: Pick<VehicleManager, "isActive">,
    private readonly healthSystem: Pick<PlayerHealthSystem, "applySpikeDamage" | "isInvulnerable">,
  ) {}

  setupLevel(): void {
    this.spawnHazards(getProceduralSpikePlacements());
  }

  setupCustomLevel(): void {
    this.clearHazards();
  }

  setupStation(key: ShowcaseStationKey): void {
    this.spawnHazards(getProceduralSpikePlacements(key));
  }

  teardownLevel(): void {
    this.clearHazards();
  }

  fixedUpdate(_dt: number): void {
    if (!this.playerController.isActive || this.vehicleManager.isActive() || this.healthSystem.isInvulnerable()) {
      return;
    }

    _footPos.copy(this.playerController.groundPosition);

    for (const hazard of this.hazards) {
      _localFootPos.copy(_footPos).sub(hazard.position);
      _localFootPos.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -hazard.rotationY);

      const halfX = hazard.size.x * 0.5;
      const halfY = hazard.size.y * 0.5;
      const halfZ = hazard.size.z * 0.5;
      if (Math.abs(_localFootPos.x) > halfX || Math.abs(_localFootPos.y) > halfY || Math.abs(_localFootPos.z) > halfZ) {
        continue;
      }

      this.healthSystem.applySpikeDamage(_footPos);
      return;
    }
  }

  update(dt: number, _alpha: number): void {
    this.animationTime += dt;

    for (const hazard of this.hazards) {
      const pulse = 0.72 + 0.28 * Math.sin(this.animationTime * 2.4 + hazard.pulseOffset);

      for (const particle of hazard.particles) {
        const t = this.animationTime * particle.driftSpeed + particle.phase;
        const riseT = (this.animationTime * particle.riseSpeed + particle.phase * 0.19) % 1;
        const fade = Math.sin(riseT * Math.PI);
        const bob = Math.sin(t * 1.7) * 0.035;
        particle.sprite.position.set(
          particle.baseX + Math.cos(t) * particle.driftRadius,
          particle.baseY + riseT * particle.heightRange + bob,
          particle.baseZ + Math.sin(t * 1.1) * particle.driftRadius * 0.7,
        );
        const material = particle.sprite.material as THREE.SpriteMaterial;
        material.opacity = (0.1 + pulse * 0.14) * fade;
        const scale = particle.scale * (0.72 + fade * 0.58 + pulse * 0.08);
        particle.sprite.scale.setScalar(scale);
      }
    }
  }

  listHazards(): HazardDebugEntry[] {
    return this.hazards.map((hazard) => ({
      id: hazard.id,
      station: hazard.station,
      position: {
        x: hazard.position.x,
        y: hazard.position.y,
        z: hazard.position.z,
      },
    }));
  }

  getTeleportTarget(id?: string): THREE.Vector3 | null {
    const hazard = id ? this.hazards.find((entry) => entry.id === id) : this.hazards[0];
    return hazard ? hazard.position.clone() : null;
  }

  dispose(): void {
    this.clearHazards();
    this.baseGeometry.dispose();
    this.spikeGeometry.dispose();
    this.baseMaterial.dispose();
    this.particleTexture.dispose();
  }

  private spawnHazards(placements: SpikePlacement[]): void {
    this.clearHazards();
    this.animationTime = 0;

    for (const placement of placements) {
      const visual = this.createHazardMesh(placement);
      visual.mesh.position.copy(placement.position);
      visual.mesh.rotation.y = placement.rotationY;
      this.scene.add(visual.mesh);
      this.hazards.push({
        id: placement.id,
        station: placement.station,
        position: placement.position.clone(),
        size: placement.size.clone(),
        rotationY: placement.rotationY,
        mesh: visual.mesh,
        particles: visual.particles,
        pulseOffset: Math.random() * Math.PI * 2,
      });
    }
  }

  private clearHazards(): void {
    for (const hazard of this.hazards) {
      this.scene.remove(hazard.mesh);
      hazard.mesh.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.material) return;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => material.dispose());
        } else if (mesh.material !== this.baseMaterial) {
          mesh.material.dispose();
        }
      });
    }
    this.hazards.length = 0;
  }

  private createHazardMesh(placement: SpikePlacement): {
    mesh: THREE.Group;
    particles: SpikeParticleState[];
  } {
    const root = new THREE.Group();
    root.name = `SpikeHazard_${placement.id}`;

    const base = new THREE.Mesh(this.baseGeometry, this.baseMaterial);
    base.scale.set(placement.size.x, 1, placement.size.z);
    base.castShadow = true;
    base.receiveShadow = true;
    base.raycast = _noRaycast;
    root.add(base);

    const accentMaterial = new THREE.MeshStandardMaterial({
      color: placement.accentColor,
      emissive: placement.accentColor,
      emissiveIntensity: 0.95,
      roughness: 0.28,
      metalness: 0.08,
    });
    const spikeCount = Math.max(3, Math.round(placement.size.x / 1.3));
    const rowOffsets = [-0.28, 0, 0.28];
    for (let rowIndex = 0; rowIndex < rowOffsets.length; rowIndex += 1) {
      for (let i = 0; i < spikeCount; i += 1) {
        const spike = new THREE.Mesh(this.spikeGeometry, accentMaterial);
        const xT = spikeCount === 1 ? 0 : i / (spikeCount - 1) - 0.5;
        spike.position.set(
          xT * Math.max(placement.size.x - 0.8, 0.2),
          0.38 + rowIndex * 0.04,
          rowOffsets[rowIndex] * Math.max(placement.size.z - 0.55, 0.35),
        );
        spike.rotation.y = ((i + rowIndex) % 2) * (Math.PI * 0.25);
        spike.castShadow = true;
        spike.receiveShadow = false;
        spike.raycast = _noRaycast;
        root.add(spike);
      }
    }

    const particles: SpikeParticleState[] = [];
    const particleCount = Math.max(7, Math.min(14, Math.round((placement.size.x + placement.size.z) * 0.8)));
    this.particleColor.setHex(placement.accentColor);
    for (let index = 0; index < particleCount; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: this.particleTexture,
        color: this.particleColor,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.raycast = _noRaycast;
      const baseX = (Math.random() - 0.5) * Math.max(placement.size.x - 0.55, 0.5);
      const baseZ = (Math.random() - 0.5) * Math.max(placement.size.z - 0.55, 0.5);
      const baseY = 0.16 + Math.random() * 0.14;
      const scale = 0.08 + Math.random() * 0.08;
      sprite.scale.setScalar(scale);
      sprite.position.set(baseX, baseY, baseZ);
      root.add(sprite);
      particles.push({
        sprite,
        baseX,
        baseY,
        baseZ,
        driftRadius: 0.03 + Math.random() * 0.08,
        driftSpeed: 0.9 + Math.random() * 0.9,
        riseSpeed: 0.35 + Math.random() * 0.45,
        heightRange: 0.34 + Math.random() * 0.34,
        scale,
        phase: Math.random() * Math.PI * 2,
      });
    }

    return { mesh: root, particles };
  }
}
