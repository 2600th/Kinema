import type { EventBus } from "@core/EventBus";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import RAPIER from "@dimforge/rapier3d-compat";
import type { LevelManager } from "@level/LevelManager";
import type { ShowcaseStationKey } from "@level/ShowcaseLayout";
import * as THREE from "three";

const GRAB_CUBE_NAMES = new Set(["PushCubeS", "PushCubeM", "PushCubeL"]);
const SETTLE_DWELL_SECONDS = 0.2;
const RESET_DELAY_SECONDS = 2.5;
const MAX_LINEAR_SPEED = 0.15;
const MAX_ANGULAR_SPEED = 0.25;
const MAX_PAD_HEIGHT_ERROR = 0.35;
const ZERO_VECTOR = { x: 0, y: 0, z: 0 };

export interface GrabGoalDebugState {
  phase: "inactive" | "ready" | "settling" | "completed" | "resetting";
  activeCube: string | null;
  completions: number;
}

interface GrabCubeEntry {
  name: string;
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
  halfSize: THREE.Vector3;
  authoredTranslation: THREE.Vector3;
  authoredRotation: THREE.Quaternion;
}

interface GoalMaterialState {
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveIntensity: number;
}

export class GrabGoalSystem implements RuntimeSystem {
  readonly id = "grab-goal";

  private phase: GrabGoalDebugState["phase"] = "inactive";
  private activeCube: GrabCubeEntry | null = null;
  private completions = 0;
  private settleElapsed = 0;
  private completionElapsed = 0;
  private carriedBody: RAPIER.RigidBody | null = null;
  private goalOutline: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null;
  private goalBounds: THREE.Box3 | null = null;
  private readyMaterial: GoalMaterialState | null = null;
  private cubes = new Map<string, GrabCubeEntry>();
  private readonly unsubs: Array<() => void>;

  constructor(
    private scene: THREE.Scene,
    private eventBus: EventBus,
    private levelManager: LevelManager,
  ) {
    this.unsubs = [
      this.eventBus.on("interaction:grabStart", ({ body }) => {
        this.carriedBody = body;
      }),
      this.eventBus.on("interaction:grabEnd", () => {
        this.carriedBody = null;
      }),
    ];
  }

  setupLevel(): void {
    this.activate();
  }

  setupStation(key: ShowcaseStationKey): void {
    if (key !== "grab") {
      this.clearLevelState();
      return;
    }
    this.activate();
  }

  setupCustomLevel(): void {
    this.clearLevelState();
  }

  fixedUpdate(dt: number): void {
    if (this.phase === "inactive") return;
    if (this.phase === "completed") {
      this.completionElapsed += dt;
      if (this.completionElapsed >= RESET_DELAY_SECONDS) this.resetCompletedCube();
      return;
    }

    const candidate = this.findSettledCubeOnGoal();
    if (!candidate) {
      this.phase = "ready";
      this.activeCube = null;
      this.settleElapsed = 0;
      return;
    }

    if (candidate !== this.activeCube) {
      this.activeCube = candidate;
      this.settleElapsed = 0;
    }
    this.phase = "settling";
    this.settleElapsed += dt;
    if (this.settleElapsed >= SETTLE_DWELL_SECONDS) this.complete(candidate);
  }

  teardownLevel(): void {
    this.clearLevelState();
  }

  getDebugState(): GrabGoalDebugState {
    return {
      phase: this.phase,
      activeCube: this.activeCube?.name ?? null,
      completions: this.completions,
    };
  }

  placeCubeOnGoal(name = "PushCubeS"): boolean {
    const cube = this.cubes.get(name);
    if (!cube || !this.goalBounds || cube.body.bodyType() !== RAPIER.RigidBodyType.Dynamic) return false;

    const center = this.goalBounds.getCenter(new THREE.Vector3());
    cube.body.setTranslation(
      {
        x: center.x,
        y: this.goalBounds.max.y + cube.halfSize.y + 0.02,
        z: center.z,
      },
      true,
    );
    cube.body.setLinvel(ZERO_VECTOR, true);
    cube.body.setAngvel(ZERO_VECTOR, true);
    return true;
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.clearLevelState();
  }

  private activate(): void {
    this.clearLevelState();
    const outline = this.scene.getObjectByName("GrabGoalOutline");
    const core = this.scene.getObjectByName("GrabGoalCore");
    if (!(outline instanceof THREE.Mesh) || !(outline.material instanceof THREE.MeshStandardMaterial) || !core) return;

    outline.updateWorldMatrix(true, false);
    core.updateWorldMatrix(true, false);
    this.goalOutline = outline as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    this.goalBounds = new THREE.Box3().setFromObject(core);
    this.readyMaterial = {
      color: outline.material.color.clone(),
      emissive: outline.material.emissive.clone(),
      emissiveIntensity: outline.material.emissiveIntensity,
    };

    for (const { mesh, body } of this.levelManager.getDynamicBodies()) {
      const name = this.getGrabCubeName(body);
      if (!name) continue;
      mesh.updateWorldMatrix(true, false);
      const halfSize = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const translation = body.translation();
      const rotation = body.rotation();
      this.cubes.set(name, {
        name,
        mesh,
        body,
        halfSize,
        authoredTranslation: new THREE.Vector3(translation.x, translation.y, translation.z),
        authoredRotation: new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
      });
    }

    if (this.goalBounds.isEmpty()) {
      this.clearLevelState();
      return;
    }
    this.phase = "ready";
  }

  private getGrabCubeName(body: RAPIER.RigidBody): string | null {
    const userData = body.userData;
    if (typeof userData !== "object" || userData === null || !("name" in userData)) return null;
    const name = (userData as { name?: unknown }).name;
    return typeof name === "string" && GRAB_CUBE_NAMES.has(name) ? name : null;
  }

  private findSettledCubeOnGoal(): GrabCubeEntry | null {
    for (const cube of this.cubes.values()) {
      if (cube.body === this.carriedBody || cube.body.bodyType() !== RAPIER.RigidBodyType.Dynamic) continue;
      if (!this.isInsideGoal(cube) || !this.isSettled(cube.body)) continue;
      return cube;
    }
    return null;
  }

  private isInsideGoal(cube: GrabCubeEntry): boolean {
    if (!this.goalBounds) return false;
    const position = cube.body.translation();
    const bottom = position.y - cube.halfSize.y;
    return (
      position.x - cube.halfSize.x >= this.goalBounds.min.x &&
      position.x + cube.halfSize.x <= this.goalBounds.max.x &&
      position.z - cube.halfSize.z >= this.goalBounds.min.z &&
      position.z + cube.halfSize.z <= this.goalBounds.max.z &&
      Math.abs(bottom - this.goalBounds.max.y) <= MAX_PAD_HEIGHT_ERROR
    );
  }

  private isSettled(body: RAPIER.RigidBody): boolean {
    const linear = body.linvel();
    const angular = body.angvel();
    return (
      linear.x ** 2 + linear.y ** 2 + linear.z ** 2 <= MAX_LINEAR_SPEED ** 2 &&
      angular.x ** 2 + angular.y ** 2 + angular.z ** 2 <= MAX_ANGULAR_SPEED ** 2
    );
  }

  private complete(cube: GrabCubeEntry): void {
    const translation = cube.body.translation();
    const completionPosition = new THREE.Vector3(translation.x, translation.y, translation.z);
    this.phase = "completed";
    this.activeCube = cube;
    this.completions++;
    this.completionElapsed = 0;
    this.setCompletionMaterial();
    this.eventBus.emit("objective:completed", {
      id: "grab-delivery",
      text: "Cube delivered",
      position: completionPosition.clone(),
    });
  }

  private resetCompletedCube(): void {
    const cube = this.activeCube;
    if (!cube) return;
    this.phase = "resetting";
    cube.body.setTranslation(cube.authoredTranslation, true);
    cube.body.setRotation(cube.authoredRotation, true);
    cube.body.setLinvel(ZERO_VECTOR, true);
    cube.body.setAngvel(ZERO_VECTOR, true);
    cube.body.wakeUp();
    this.restoreReadyMaterial();
    this.activeCube = null;
    this.settleElapsed = 0;
    this.completionElapsed = 0;
    this.phase = "ready";
  }

  private setCompletionMaterial(): void {
    if (!this.goalOutline) return;
    this.goalOutline.material.color.setHex(0x12351f);
    this.goalOutline.material.emissive.setHex(0x50ff91);
    this.goalOutline.material.emissiveIntensity = 2;
  }

  private restoreReadyMaterial(): void {
    if (!this.goalOutline || !this.readyMaterial) return;
    this.goalOutline.material.color.copy(this.readyMaterial.color);
    this.goalOutline.material.emissive.copy(this.readyMaterial.emissive);
    this.goalOutline.material.emissiveIntensity = this.readyMaterial.emissiveIntensity;
  }

  private clearLevelState(): void {
    this.restoreReadyMaterial();
    this.phase = "inactive";
    this.activeCube = null;
    this.completions = 0;
    this.settleElapsed = 0;
    this.completionElapsed = 0;
    this.carriedBody = null;
    this.goalOutline = null;
    this.goalBounds = null;
    this.readyMaterial = null;
    this.cubes.clear();
  }
}
