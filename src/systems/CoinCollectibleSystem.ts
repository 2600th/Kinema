import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import { getProceduralCoinPlacements, type CoinPlacement } from "@level/CoinLayout";
import type { ShowcaseStationKey } from "@level/ShowcaseLayout";
import type { VehicleManager } from "@vehicle/VehicleManager";
import * as THREE from "three";

interface CoinEntry {
  id: string;
  station: ShowcaseStationKey;
  value: number;
  basePosition: THREE.Vector3;
  mesh: THREE.Group;
  bobPhase: number;
  bobTime: number;
}

export interface CoinDebugEntry {
  id: string;
  station: ShowcaseStationKey;
  value: number;
  position: { x: number; y: number; z: number };
}

const COIN_PICKUP_RADIUS = 1.15;
const COIN_BOB_AMPLITUDE = 0.14;
const COIN_BOB_FREQUENCY = 2.75;
const COIN_SPIN_SPEED = Math.PI * 1.8;

const _eventPosition = new THREE.Vector3();
const _playerPos = new THREE.Vector3();
const _noRaycast: THREE.Object3D["raycast"] = () => {};

export class CoinCollectibleSystem implements RuntimeSystem {
  readonly id = "coin-collectibles";

  private readonly coinBodyGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.08, 32);
  private readonly rimGeometry = new THREE.TorusGeometry(0.43, 0.04, 10, 40);
  private readonly coinBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xf7c948,
    emissive: 0xa45f00,
    emissiveIntensity: 0.65,
    metalness: 0.92,
    roughness: 0.24,
  });
  private readonly rimMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe38a,
    emissive: 0xc88700,
    emissiveIntensity: 0.8,
    metalness: 1,
    roughness: 0.18,
  });

  private coins: CoinEntry[] = [];
  private collectedCount = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly eventBus: EventBus,
    private readonly playerController: Pick<PlayerController, "isActive" | "position">,
    private readonly vehicleManager: Pick<VehicleManager, "isActive">,
  ) {}

  setupLevel(): void {
    this.spawnCoins(getProceduralCoinPlacements());
  }

  setupStation(key: ShowcaseStationKey): void {
    this.spawnCoins(getProceduralCoinPlacements(key));
  }

  setupCustomLevel(): void {
    this.resetCoins();
  }

  teardownLevel(): void {
    this.resetCoins();
  }

  fixedUpdate(_dt: number): void {
    if (!this.playerController.isActive || this.vehicleManager.isActive()) {
      return;
    }

    _playerPos.copy(this.playerController.position);

    for (let index = 0; index < this.coins.length; index++) {
      const coin = this.coins[index];
      if (_playerPos.distanceToSquared(coin.mesh.position) > COIN_PICKUP_RADIUS * COIN_PICKUP_RADIUS) {
        continue;
      }

      this.collectCoin(index);
      index--;
    }
  }

  update(dt: number, _alpha: number): void {
    for (const coin of this.coins) {
      coin.bobTime += dt;
      coin.mesh.rotation.y += dt * COIN_SPIN_SPEED;
      coin.mesh.position.y =
        coin.basePosition.y + Math.sin(coin.bobTime * COIN_BOB_FREQUENCY + coin.bobPhase) * COIN_BOB_AMPLITUDE;
    }
  }

  getCollectedCount(): number {
    return this.collectedCount;
  }

  listRemainingCoins(): CoinDebugEntry[] {
    return this.coins.map((coin) => ({
      id: coin.id,
      station: coin.station,
      value: coin.value,
      position: {
        x: coin.basePosition.x,
        y: coin.basePosition.y,
        z: coin.basePosition.z,
      },
    }));
  }

  getTeleportTarget(id?: string): THREE.Vector3 | null {
    const coin = id ? this.coins.find((entry) => entry.id === id) : this.coins[0];
    if (!coin) {
      return null;
    }

    return coin.basePosition.clone();
  }

  dispose(): void {
    this.clearCoinMeshes();
    this.coinBodyGeometry.dispose();
    this.rimGeometry.dispose();
    this.coinBodyMaterial.dispose();
    this.rimMaterial.dispose();
  }

  private spawnCoins(placements: CoinPlacement[]): void {
    this.clearCoinMeshes();
    this.collectedCount = 0;

    for (let index = 0; index < placements.length; index++) {
      const placement = placements[index];
      const mesh = this.createCoinMesh(index);
      mesh.position.copy(placement.position);
      this.scene.add(mesh);
      this.coins.push({
        id: placement.id,
        station: placement.station,
        value: placement.value,
        basePosition: placement.position.clone(),
        mesh,
        bobPhase: index * 0.43,
        bobTime: index * 0.11,
      });
    }

    this.eventBus.emit("collectible:changed", { count: 0 });
  }

  private collectCoin(index: number): void {
    const [coin] = this.coins.splice(index, 1);
    if (!coin) {
      return;
    }

    coin.mesh.getWorldPosition(_eventPosition);
    this.scene.remove(coin.mesh);
    this.collectedCount += coin.value;
    this.eventBus.emit("collectible:changed", { count: this.collectedCount });
    this.eventBus.emit("collectible:collected", {
      id: coin.id,
      position: _eventPosition.clone(),
      count: this.collectedCount,
      value: coin.value,
    });
  }

  private resetCoins(): void {
    this.clearCoinMeshes();
    this.collectedCount = 0;
    this.eventBus.emit("collectible:changed", { count: 0 });
  }

  private clearCoinMeshes(): void {
    for (const coin of this.coins) {
      this.scene.remove(coin.mesh);
    }
    this.coins.length = 0;
  }

  private createCoinMesh(index: number): THREE.Group {
    const root = new THREE.Group();
    root.name = `CoinCollectible_${index + 1}`;

    const body = new THREE.Mesh(this.coinBodyGeometry, this.coinBodyMaterial);
    body.rotation.z = Math.PI * 0.5;
    body.castShadow = true;
    body.receiveShadow = false;
    body.raycast = _noRaycast;
    root.add(body);

    const rim = new THREE.Mesh(this.rimGeometry, this.rimMaterial);
    rim.rotation.y = Math.PI * 0.5;
    rim.castShadow = false;
    rim.receiveShadow = false;
    rim.raycast = _noRaycast;
    root.add(rim);

    return root;
  }
}
