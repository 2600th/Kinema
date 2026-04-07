import type { PlayerController } from "@character/PlayerController";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import { getProceduralSpikePlacements, type SpikePlacement } from "@level/SpikeLayout";
import type { ShowcaseStationKey } from "@level/ShowcaseLayout";
import { PlayerHealthSystem } from "@systems/PlayerHealthSystem";
import type { VehicleManager } from "@vehicle/VehicleManager";
import * as THREE from "three";

interface SpikeHazardEntry {
  id: string;
  station: ShowcaseStationKey;
  position: THREE.Vector3;
  size: THREE.Vector3;
  rotationY: number;
  mesh: THREE.Group;
}

export interface HazardDebugEntry {
  id: string;
  station: ShowcaseStationKey;
  position: { x: number; y: number; z: number };
}

const _footPos = new THREE.Vector3();
const _localFootPos = new THREE.Vector3();
const _noRaycast: THREE.Object3D["raycast"] = () => {};

export class SpikeHazardSystem implements RuntimeSystem {
  readonly id = "spike-hazards";

  private readonly baseGeometry = new THREE.BoxGeometry(1, 0.14, 1);
  private readonly spikeGeometry = new THREE.ConeGeometry(0.18, 0.72, 4);
  private readonly coreGeometry = new THREE.BoxGeometry(1, 0.05, 0.14);
  private readonly baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c2431,
    roughness: 0.42,
    metalness: 0.78,
    emissive: 0x080d14,
    emissiveIntensity: 0.2,
  });

  private hazards: SpikeHazardEntry[] = [];

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
    this.coreGeometry.dispose();
    this.baseMaterial.dispose();
  }

  private spawnHazards(placements: SpikePlacement[]): void {
    this.clearHazards();

    for (const placement of placements) {
      const mesh = this.createHazardMesh(placement);
      mesh.position.copy(placement.position);
      mesh.rotation.y = placement.rotationY;
      this.scene.add(mesh);
      this.hazards.push({
        id: placement.id,
        station: placement.station,
        position: placement.position.clone(),
        size: placement.size.clone(),
        rotationY: placement.rotationY,
        mesh,
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

  private createHazardMesh(placement: SpikePlacement): THREE.Group {
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
      emissiveIntensity: 1.25,
      roughness: 0.22,
      metalness: 0.18,
    });
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x090c13,
      emissive: placement.accentColor,
      emissiveIntensity: 0.75,
      roughness: 0.12,
      metalness: 0.05,
    });

    const spikeCount = Math.max(3, Math.round(placement.size.x / 1.3));
    const rowOffsets = [-0.28, 0, 0.28];
    for (let rowIndex = 0; rowIndex < rowOffsets.length; rowIndex++) {
      for (let i = 0; i < spikeCount; i++) {
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

    const coreStrip = new THREE.Mesh(this.coreGeometry, coreMaterial);
    coreStrip.scale.set(placement.size.x * 0.82, 1, 1);
    coreStrip.position.set(0, 0.1, 0);
    coreStrip.raycast = _noRaycast;
    root.add(coreStrip);

    return root;
  }
}
