import { COLLISION_GROUP_WORLD } from "@core/constants";
import type { EventBus } from "@core/EventBus";
import type { Disposable, SpawnPointData } from "@core/types";
import type { GraphicsProfile, ShadowQualityTier } from "@core/UserSettings";
import RAPIER from "@dimforge/rapier3d-compat";
import { getBrushById } from "@editor/brushes/index";
import type { LevelDataV2, SerializedObjectV2 } from "@editor/LevelSerializer";
import type { ShowcaseStationKey } from "@level/ShowcaseLayout";
import type { NavDebugOverlay } from "@navigation/NavDebugOverlay";
import type { NavMeshManager } from "@navigation/NavMeshManager";
import type { NavPatrolSystem } from "@navigation/NavPatrolSystem";
import { ColliderFactory } from "@physics/ColliderFactory";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import * as THREE from "three";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { AssetLoader } from "./AssetLoader";
import { LevelValidator } from "./LevelValidator";
import { LightingSystem } from "./LightingSystem";
import { MeshParser } from "./MeshParser";
import {
  type AnimatedMaterialEntry,
  type DustMoteEntry,
  type DynamicBodyEntry,
  type FloatingPlatformEntry,
  type MovingPlatformEntry,
  ProceduralBuilder,
} from "./ProceduralBuilder";

const _platformNextPos = new THREE.Vector3();
const _platformEuler = new THREE.Euler();
const _platformQuat = new THREE.Quaternion();
const _platformRV3 = new RAPIER.Vector3(0, 0, 0);
const _platformRQuat = new RAPIER.Quaternion(0, 0, 0, 1);
const _floatOrigin = new RAPIER.Vector3(0, 0, 0);
const _floatDown = new RAPIER.Vector3(0, -1, 0);
const _floatImpulse = new RAPIER.Vector3(0, 0, 0);
const _floatLinvel = new RAPIER.Vector3(0, 0, 0);
const DEFAULT_SPAWN_Y = 2;

/** Dispose all texture slots on a PBR material. */
function disposeAllTextures(material: THREE.Material): void {
  const mat = material as THREE.MeshStandardMaterial;
  mat.map?.dispose();
  mat.normalMap?.dispose();
  mat.roughnessMap?.dispose();
  mat.metalnessMap?.dispose();
  mat.aoMap?.dispose();
  mat.emissiveMap?.dispose();
  mat.displacementMap?.dispose();
  mat.alphaMap?.dispose();
  mat.envMap?.dispose();
  mat.lightMap?.dispose();
  mat.bumpMap?.dispose();

  // MeshPhysicalMaterial additional texture slots
  const phys = material as THREE.MeshPhysicalMaterial;
  phys.clearcoatMap?.dispose();
  phys.clearcoatNormalMap?.dispose();
  phys.clearcoatRoughnessMap?.dispose();
  phys.transmissionMap?.dispose();
  phys.thicknessMap?.dispose();
  phys.sheenColorMap?.dispose();
  phys.sheenRoughnessMap?.dispose();
  phys.specularIntensityMap?.dispose();
  phys.specularColorMap?.dispose();
  phys.iridescenceMap?.dispose();
  phys.iridescenceThicknessMap?.dispose();
  phys.anisotropyMap?.dispose();
}

function createDefaultSpawnPoint(): SpawnPointData {
  return { position: new THREE.Vector3(0, DEFAULT_SPAWN_Y, 0) };
}

type SpawnedJsonObject = {
  entry: SerializedObjectV2;
  obj: THREE.Object3D;
  isEditorGizmo: boolean;
};

/**
 * Manages level loading, scene traversal, collider creation, and cleanup.
 */
export class LevelManager implements Disposable {
  private assetLoader = new AssetLoader();
  private meshParser = new MeshParser();
  private levelValidator = new LevelValidator();
  private colliderFactory: ColliderFactory;

  private currentLevelName: string | null = null;
  private levelObjects: THREE.Object3D[] = [];
  private vfxDisposeCallbacks: Array<() => void> = [];
  private vfxUpdateCallbacks: Array<(dt: number) => void> = [];
  private levelColliders: RAPIER.Collider[] = [];
  private levelBodies: RAPIER.RigidBody[] = [];
  /** Per-object imported GLB asset paths loaded during JSON import. */
  private importedAssetPaths = new Set<string>();
  private spawnPoint: SpawnPointData = createDefaultSpawnPoint();
  private movingPlatforms: MovingPlatformEntry[] = [];
  private floatingPlatforms: FloatingPlatformEntry[] = [];
  private dynamicBodies: DynamicBodyEntry[] = [];
  private ladderZones: THREE.Box3[] = [];
  private simTime = 0;
  private animatedMaterials: AnimatedMaterialEntry[] = [];
  private vfxNoiseTexture: THREE.CanvasTexture | null = null;
  private vfxLightningLight: THREE.PointLight | null = null;
  private dustMotes: DustMoteEntry[] = [];
  private sparkleParticles: { update(dt: number): void; dispose(): void } | null = null;
  private lighting: LightingSystem;
  private navMeshManager: NavMeshManager | null = null;
  private navPatrolSystem: NavPatrolSystem | null = null;
  private navDebugOverlay: NavDebugOverlay | null = null;
  private textureAnisotropy = 8;
  private _loadGeneration = { value: 0 };

  constructor(
    private scene: THREE.Scene,
    private physicsWorld: PhysicsWorld,
    private eventBus: EventBus,
    maxAnisotropy?: number,
  ) {
    this.colliderFactory = new ColliderFactory(physicsWorld);
    this.lighting = new LightingSystem(scene);
    if (typeof maxAnisotropy === "number" && Number.isFinite(maxAnisotropy) && maxAnisotropy > 0) {
      this.textureAnisotropy = Math.max(1, Math.floor(maxAnisotropy));
    }
  }

  /** Get the current spawn point. */
  getSpawnPoint(): SpawnPointData {
    return this.spawnPoint;
  }

  /** Ladder trigger volumes for climb assist. */
  getLadderZones(): readonly THREE.Box3[] {
    return this.ladderZones;
  }

  /** Dynamic rigid bodies created by the level (for grab interactions). */
  getDynamicBodies(): ReadonlyArray<{ mesh: THREE.Object3D; body: RAPIER.RigidBody }> {
    // Expose only mesh/body; internal pose buffers are an implementation detail.
    return this.dynamicBodies;
  }

  /** Read-only list of level visuals for editor selection. */
  getLevelObjects(): ReadonlyArray<THREE.Object3D> {
    return this.levelObjects;
  }

  /** Remove a single level object from tracking arrays.
   *  Physics body/collider should be cleaned up by the caller (EditorDocument). */
  removeLevelObject(mesh: THREE.Object3D): void {
    this.levelObjects = this.levelObjects.filter((o) => o !== mesh);
    this.dynamicBodies = this.dynamicBodies.filter((d) => (d as { mesh: THREE.Object3D }).mesh !== mesh);
  }

  /** Navigation patrol system (for game loop wiring). */
  getNavPatrolSystem(): NavPatrolSystem | null {
    return this.navPatrolSystem;
  }

  /** Navigation debug overlay (for toggling navmesh visualization). */
  getNavDebugOverlay(): NavDebugOverlay | null {
    return this.navDebugOverlay;
  }

  /** Allows runtime quality changes to update shadow map budgets. */
  setGraphicsProfile(profile: GraphicsProfile): void {
    this.lighting.setGraphicsProfile(profile);
  }

  setShadowQualityTier(tier: ShadowQualityTier): void {
    this.lighting.setShadowQualityTier(tier);
  }

  getShadowQualityTier(): ShadowQualityTier {
    return this.lighting.getShadowQualityTier();
  }

  setLightDebugEnabled(enabled: boolean): void {
    this.lighting.setLightDebugEnabled(enabled);
  }

  getLightDebugEnabled(): boolean {
    return this.lighting.getLightDebugEnabled();
  }

  setShadowDebugEnabled(enabled: boolean): void {
    this.lighting.setShadowDebugEnabled(enabled);
  }

  getShadowDebugEnabled(): boolean {
    return this.lighting.getShadowDebugEnabled();
  }

  setShadowsEnabled(enabled: boolean): void {
    this.lighting.setShadowsEnabled(enabled);
  }

  /** Load a level by name. 'procedural' generates a test level. */
  async load(name: string): Promise<void> {
    // Unload current level first
    if (this.currentLevelName) {
      this.unload();
    }
    // Always reset before each load so levels without spawnpoints are deterministic.
    this.spawnPoint = createDefaultSpawnPoint();

    if (name === "procedural") {
      await this.buildProcedural(null);
    } else {
      this.eventBus.emit("loading:progress", { progress: 0.1 });
      await this.loadGLTF(name);
      this.eventBus.emit("loading:progress", { progress: 0.8 });
    }

    this.currentLevelName = name;
    this.addLighting();
    this.eventBus.emit("loading:progress", { progress: 1.0 });
    this.eventBus.emit("level:loaded", { name });
    console.log(`[LevelManager] Level "${name}" loaded`);
  }

  /** Load a single showcase station in isolation for debugging. */
  async loadStation(key: ShowcaseStationKey): Promise<void> {
    if (this.currentLevelName) {
      this.unload();
    }
    this.spawnPoint = createDefaultSpawnPoint();
    this.eventBus.emit("loading:progress", { progress: 0.1 });
    await this.buildProcedural(key);
    this.currentLevelName = `station:${key}`;
    this.addLighting();
    this.eventBus.emit("loading:progress", { progress: 1.0 });
    this.eventBus.emit("level:loaded", { name: `station:${key}` });
    console.log(`[LevelManager] Station "${key}" loaded`);
  }

  /** Public accessor for the asset loader (used by editor for GLB import). */
  getAssetLoader(): AssetLoader {
    return this.assetLoader;
  }

  /**
   * Load a level from editor JSON (LevelDataV2).
   * Spawns all objects, creates physics, adds lighting.
   */
  async loadFromJSON(data: LevelDataV2): Promise<void> {
    if (this.currentLevelName) {
      this.unload();
    }
    this.spawnPoint = createDefaultSpawnPoint();
    this.eventBus.emit("loading:progress", { progress: 0.1 });

    // Apply spawn point from JSON — prefer tagged spawnPoints array, fall back to legacy
    const playerSpawn = data.spawnPoints?.find((s) => s.tag === "player") ?? data.spawnPoints?.[0];
    if (playerSpawn) {
      const [x, y, z] = playerSpawn.position;
      this.spawnPoint = {
        position: new THREE.Vector3(x, y, z),
        ...(playerSpawn.rotation && {
          rotation: new THREE.Euler(playerSpawn.rotation[0], playerSpawn.rotation[1], playerSpawn.rotation[2]),
        }),
      };
    } else if (data.spawnPoint?.position) {
      const [x, y, z] = data.spawnPoint.position;
      this.spawnPoint = { position: new THREE.Vector3(x, y, z) };
    }

    const spawnedObjects = new Map<string, SpawnedJsonObject>();

    // Create each object first so hierarchy can be reconstructed before physics is built.
    for (const entry of data.objects) {
      const spawned = await this.spawnJSONObject(entry);
      if (spawned) {
        spawnedObjects.set(entry.id, spawned);
      }
    }

    // Rebuild the authored hierarchy using serialized local transforms.
    for (const entry of data.objects) {
      const spawned = spawnedObjects.get(entry.id);
      if (!spawned) continue;
      const parent = entry.parentId ? (spawnedObjects.get(entry.parentId)?.obj ?? null) : null;
      if (parent) {
        parent.add(spawned.obj);
      } else {
        this.scene.add(spawned.obj);
      }
    }

    // Finalize tracking and physics once world transforms are correct.
    for (const entry of data.objects) {
      const spawned = spawnedObjects.get(entry.id);
      if (!spawned) continue;
      this.finalizeSpawnedJSONObject(spawned);
    }

    this.eventBus.emit("loading:progress", { progress: 0.5 });

    this.currentLevelName = data.name || "custom";
    this.addLighting();
    this.eventBus.emit("loading:progress", { progress: 0.8 });
    this.eventBus.emit("loading:progress", { progress: 1.0 });
    this.eventBus.emit("level:loaded", { name: this.currentLevelName });
    console.log(`[LevelManager] JSON level "${this.currentLevelName}" loaded (${data.objects.length} objects)`);
  }

  private async spawnJSONObject(entry: SerializedObjectV2): Promise<SpawnedJsonObject | null> {
    let obj: THREE.Object3D | null = null;

    if (entry.source.type === "primitive" && entry.source.primitive) {
      obj = this.createPrimitiveMesh(entry.source.primitive);
    } else if (entry.source.type === "brush" && entry.source.brush) {
      obj = this.createBrushMesh(entry.source.brush);
    } else if (entry.source.type === "glb" && entry.source.asset) {
      obj = await this.loadGLBObject(entry.source.asset);
    }

    if (!obj) return null;

    // Apply transform
    const [px, py, pz] = entry.transform.position;
    const [rx, ry, rz] = entry.transform.rotation;
    const [sx, sy, sz] = entry.transform.scale;
    obj.position.set(px, py, pz);
    obj.rotation.set(rx, ry, rz);
    obj.scale.set(sx, sy, sz);

    // Apply material properties to all standard materials in the hierarchy
    if (entry.material) {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          const mat = child.material;
          mat.color.set(entry.material!.color);
          mat.roughness = entry.material!.roughness;
          mat.metalness = entry.material!.metalness;
          mat.emissive.set(entry.material!.emissive);
          mat.emissiveIntensity = entry.material!.emissiveIntensity;
          if (entry.material!.opacity < 1) {
            mat.transparent = true;
            mat.opacity = entry.material!.opacity;
          }
        }
      });
    }

    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    obj.name = entry.name;

    // Editor-only gizmos (spawn, trigger) — hide in play mode, skip physics
    const isEditorGizmo =
      entry.source.type === "brush" && (entry.source.brush === "spawn" || entry.source.brush === "trigger");
    return { entry, obj, isEditorGizmo };
  }

  private finalizeSpawnedJSONObject({ entry, obj, isEditorGizmo }: SpawnedJsonObject): void {
    this.levelObjects.push(obj);
    if (isEditorGizmo) {
      obj.visible = false;
      return;
    }

    // Create physics body
    const physType = entry.physics?.type ?? "static";
    let bodyDesc: RAPIER.RigidBodyDesc;
    if (physType === "dynamic") {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic();
    } else if (physType === "kinematic") {
      bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    } else {
      bodyDesc = RAPIER.RigidBodyDesc.fixed();
    }
    obj.updateWorldMatrix(true, false);
    const worldPos = obj.getWorldPosition(new THREE.Vector3());
    const worldQuat = obj.getWorldQuaternion(new THREE.Quaternion());
    bodyDesc.setTranslation(worldPos.x, worldPos.y, worldPos.z);
    bodyDesc.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w });
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);

    const { center, halfExtents } = this.computeColliderBounds(obj);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      Math.max(halfExtents.x, 0.01),
      Math.max(halfExtents.y, 0.01),
      Math.max(halfExtents.z, 0.01),
    ).setCollisionGroups(COLLISION_GROUP_WORLD);
    colliderDesc.setTranslation(center.x, center.y, center.z);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

    this.levelBodies.push(body);
    this.levelColliders.push(collider);

    // Track dynamic bodies for interpolation
    if (physType === "dynamic") {
      this.dynamicBodies.push({
        mesh: obj,
        body,
        prevPos: worldPos.clone(),
        currPos: worldPos.clone(),
        prevQuat: worldQuat.clone(),
        currQuat: worldQuat.clone(),
        hasPose: false,
      });
    }
  }

  private computeColliderBounds(obj: THREE.Object3D): {
    center: THREE.Vector3;
    halfExtents: THREE.Vector3;
  } {
    const localBounds = new THREE.Box3();
    const childBounds = new THREE.Box3();
    const inverseRoot = obj.matrixWorld.clone().invert();
    const childLocalMatrix = new THREE.Matrix4();
    const scaledCenter = new THREE.Vector3();
    const scaledSize = new THREE.Vector3();

    obj.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return;
      child.geometry.computeBoundingBox();
      const boundingBox = child.geometry.boundingBox;
      if (!boundingBox) return;
      childBounds.copy(boundingBox);
      childLocalMatrix.multiplyMatrices(inverseRoot, child.matrixWorld);
      childBounds.applyMatrix4(childLocalMatrix);
      localBounds.union(childBounds);
    });

    if (localBounds.isEmpty()) {
      localBounds.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    }

    localBounds.getCenter(scaledCenter);
    localBounds.getSize(scaledSize);
    scaledCenter.set(scaledCenter.x * obj.scale.x, scaledCenter.y * obj.scale.y, scaledCenter.z * obj.scale.z);
    scaledSize.set(
      scaledSize.x * Math.abs(obj.scale.x),
      scaledSize.y * Math.abs(obj.scale.y),
      scaledSize.z * Math.abs(obj.scale.z),
    );

    return {
      center: scaledCenter,
      halfExtents: scaledSize.multiplyScalar(0.5),
    };
  }

  private createPrimitiveMesh(primitive: string): THREE.Object3D {
    if (primitive === "group") {
      return new THREE.Group();
    }
    let geometry: THREE.BufferGeometry;
    if (primitive === "sphere") geometry = new THREE.SphereGeometry(0.5, 16, 16);
    else if (primitive === "cylinder") geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
    else if (primitive === "capsule") geometry = new THREE.CapsuleGeometry(0.4, 0.6, 6, 12);
    else if (primitive === "plane") geometry = new THREE.PlaneGeometry(1, 1);
    else geometry = new THREE.BoxGeometry(1, 1, 1);
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb0c4de, roughness: 0.6 }));
  }

  private createBrushMesh(brushId: string): THREE.Mesh | null {
    const brush = getBrushById(brushId);
    if (!brush) return null;
    const bp = brush.defaultParams;
    const defaultParams = {
      anchor: bp?.anchor?.clone() ?? new THREE.Vector3(0, 0, 0),
      current: bp?.current?.clone() ?? new THREE.Vector3(1, 0, 1),
      normal: bp?.normal?.clone() ?? new THREE.Vector3(0, 1, 0),
      height: bp?.height ?? 1,
    };
    const geometry = brush.buildPreviewGeometry(defaultParams);
    const material = brush.getDefaultMaterial();
    return new THREE.Mesh(geometry, material);
  }

  private async loadGLBObject(assetPath: string): Promise<THREE.Object3D | null> {
    try {
      this.importedAssetPaths.add(assetPath);
      const gltf = await this.assetLoader.load(assetPath);
      // Clone the entire scene so multi-mesh GLBs keep all children.
      // Deep-clone geometry and material per-mesh so disposal during unload
      // doesn't invalidate the cached GLTF for future reloads.
      const clone = skeletonClone(gltf.scene);
      clone.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry = child.geometry.clone();
          child.material = Array.isArray(child.material)
            ? child.material.map((m: THREE.Material) => m.clone())
            : child.material.clone();
        }
      });
      return clone;
    } catch (err) {
      console.warn(`[LevelManager] Failed to load GLB "${assetPath}", using placeholder`, err);
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
      return new THREE.Mesh(geo, mat);
    }
  }

  /** Unload all current level resources. */
  unload(): void {
    this._loadGeneration.value++;
    const name = this.currentLevelName;

    // Evict GLTF cache to avoid reusing disposed geometries/materials
    if (name && name !== "procedural") {
      this.assetLoader.evict(`/assets/levels/${name}.glb`);
    }
    // Evict per-object imported GLB assets
    for (const assetPath of this.importedAssetPaths) {
      this.assetLoader.evict(assetPath);
    }
    this.importedAssetPaths.clear();

    // Remove physics
    for (const collider of this.levelColliders) {
      this.physicsWorld.removeCollider(collider);
    }
    for (const body of this.levelBodies) {
      this.physicsWorld.removeBody(body);
    }

    // Clear VFX interval timers
    for (const cb of this.vfxDisposeCallbacks) cb();
    this.vfxDisposeCallbacks = [];
    this.vfxUpdateCallbacks = [];

    // Remove scene objects starting from tracked roots so hierarchy children
    // are only disposed once.
    const trackedObjects = new Set(this.levelObjects);
    const rootObjects = this.levelObjects.filter((obj) => {
      const parent = obj.parent;
      return !(parent && trackedObjects.has(parent));
    });
    for (const obj of rootObjects) {
      this.scene.remove(obj);
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => {
              disposeAllTextures(m);
              m.dispose();
            });
          } else {
            disposeAllTextures(child.material);
            child.material.dispose();
          }
        } else if (child instanceof THREE.Sprite) {
          const mat = child.material as THREE.SpriteMaterial;
          disposeAllTextures(mat);
          mat.dispose();
        }
      });
    }

    this.levelObjects = [];
    this.levelColliders = [];
    this.levelBodies = [];
    this.movingPlatforms = [];
    this.floatingPlatforms = [];
    this.dynamicBodies = [];
    this.ladderZones = [];
    this.simTime = 0;
    this.animatedMaterials = [];
    this.vfxNoiseTexture?.dispose();
    this.vfxNoiseTexture = null;
    this.vfxLightningLight = null;
    this.dustMotes = [];
    this.sparkleParticles?.dispose();
    this.sparkleParticles = null;
    this.navPatrolSystem?.dispose();
    this.navPatrolSystem = null;
    this.navDebugOverlay?.dispose();
    this.navDebugOverlay = null;
    this.navMeshManager?.dispose(this.scene);
    this.navMeshManager = null;
    this.lighting.clearLightReferences();
    this.currentLevelName = null;
    this.spawnPoint = createDefaultSpawnPoint();

    if (name) {
      this.eventBus.emit("level:unloaded", { name });
      console.log(`[LevelManager] Level "${name}" unloaded`);
    }
  }

  /** Update dynamic demo level elements (moving platforms). */
  fixedUpdate(dt: number): void {
    this.simTime += dt;

    for (const platform of this.movingPlatforms) {
      _platformNextPos.copy(platform.base);
      let nextRotY = platform.mesh.rotation.y;
      let nextRotX = platform.mesh.rotation.x;

      switch (platform.mode) {
        case "x":
          _platformNextPos.x = platform.base.x + Math.sin(this.simTime * platform.speed) * platform.amplitude;
          break;
        case "y":
          _platformNextPos.y = platform.base.y + Math.sin(this.simTime * platform.speed) * platform.amplitude;
          break;
        case "yRotate":
          _platformNextPos.y = platform.base.y + Math.sin(this.simTime * platform.speed) * platform.amplitude;
          nextRotY = this.simTime * platform.speed;
          break;
        case "xy":
          _platformNextPos.x = platform.base.x + Math.sin(this.simTime * platform.speed) * platform.amplitude;
          _platformNextPos.y = platform.base.y + Math.cos(this.simTime * platform.speed) * (platform.amplitude * 0.4);
          break;
        case "rotateY":
          nextRotY = this.simTime * platform.speed;
          break;
        case "rotateX":
          nextRotX = this.simTime * platform.speed;
          break;
      }

      platform.linearVelocity
        .copy(_platformNextPos)
        .sub(platform.lastPosition)
        .multiplyScalar(1 / Math.max(dt, 1e-5));
      platform.angularVelocity.set(
        (nextRotX - platform.lastRotX) / Math.max(dt, 1e-5),
        (nextRotY - platform.lastRotY) / Math.max(dt, 1e-5),
        0,
      );
      platform.lastPosition.copy(_platformNextPos);
      platform.lastRotX = nextRotX;
      platform.lastRotY = nextRotY;

      platform.mesh.position.copy(_platformNextPos);
      if (platform.mode === "rotateY" || platform.mode === "yRotate") {
        platform.mesh.rotation.set(
          platform.rotationOffset.x,
          nextRotY + platform.rotationOffset.y,
          platform.rotationOffset.z,
        );
      }
      if (platform.mode === "rotateX") {
        platform.mesh.rotation.set(
          nextRotX + platform.rotationOffset.x,
          platform.rotationOffset.y,
          platform.rotationOffset.z,
        );
      }

      _platformRV3.x = _platformNextPos.x;
      _platformRV3.y = _platformNextPos.y;
      _platformRV3.z = _platformNextPos.z;
      platform.body.setNextKinematicTranslation(_platformRV3);
      if (typeof platform.body.userData !== "object" || platform.body.userData === null) {
        platform.body.userData = {};
      }
      Object.assign(platform.body.userData as Record<string, unknown>, {
        kind: "moving-platform",
        platformLinearVelocity: {
          x: platform.linearVelocity.x,
          y: platform.linearVelocity.y,
          z: platform.linearVelocity.z,
        },
        platformAngularVelocity: {
          x: platform.angularVelocity.x,
          y: platform.angularVelocity.y,
          z: platform.angularVelocity.z,
        },
      });
      if (platform.mode === "rotateY" || platform.mode === "yRotate" || platform.mode === "rotateX") {
        _platformEuler.set(
          (platform.mode === "rotateX" ? nextRotX : 0) + platform.rotationOffset.x,
          (platform.mode === "rotateY" || platform.mode === "yRotate" ? nextRotY : 0) + platform.rotationOffset.y,
          platform.rotationOffset.z,
        );
        _platformQuat.setFromEuler(_platformEuler);
        _platformRQuat.x = _platformQuat.x;
        _platformRQuat.y = _platformQuat.y;
        _platformRQuat.z = _platformQuat.z;
        _platformRQuat.w = _platformQuat.w;
        platform.body.setNextKinematicRotation(_platformRQuat);
      }
    }

    // Floating dynamic platforms — ray from bottom of platform body.
    for (const platform of this.floatingPlatforms) {
      const p = platform.body.translation();
      // Cast from the body center so compressed platforms do not lose their
      // support sample when they dip close to the ground plane.
      _floatOrigin.x = p.x;
      _floatOrigin.y = p.y;
      _floatOrigin.z = p.z;
      const rayHit = this.physicsWorld.castRay(
        _floatOrigin,
        _floatDown,
        platform.rayLength,
        undefined,
        platform.body,
        (c) => !c.isSensor(),
      );
      if (rayHit && rayHit.collider.parent()) {
        const lv = platform.body.linvel();
        const floatingForce =
          platform.springK * (platform.floatingDistance - rayHit.timeOfImpact) - lv.y * platform.dampingC;
        const compression = Math.max(0, platform.floatingDistance - rayHit.timeOfImpact);
        const recoveryBoost = compression > 0.18 ? compression * platform.springK * 0.75 : 0;
        _floatImpulse.x = 0;
        _floatImpulse.y = floatingForce + recoveryBoost;
        _floatImpulse.z = 0;
        platform.body.applyImpulse(_floatImpulse, true);
      }

      if (
        platform.moveRangeMinX != null &&
        platform.moveRangeMaxX != null &&
        platform.moveSpeedX != null &&
        platform.moveDirectionX != null
      ) {
        if (p.x > platform.moveRangeMaxX) {
          platform.moveDirectionX = -1;
        } else if (p.x < platform.moveRangeMinX) {
          platform.moveDirectionX = 1;
        }
        const lv = platform.body.linvel();
        const targetVx = platform.moveDirectionX * platform.moveSpeedX;
        const accel = platform.moveAccelX ?? 6;
        const deltaVx = THREE.MathUtils.clamp(targetVx - lv.x, -accel * dt, accel * dt);
        _floatLinvel.x = lv.x + deltaVx;
        _floatLinvel.y = lv.y;
        _floatLinvel.z = lv.z * Math.max(0, 1 - dt * 8);
        platform.body.setLinvel(_floatLinvel, true);
      }
    }

    // Dynamic rigid body visuals are interpolated in update() using pose buffers filled in postPhysicsUpdate().

    // Animated materials (simple emissive pulse).
    for (const entry of this.animatedMaterials) {
      const pulse = 0.5 + 0.5 * Math.sin(this.simTime * entry.speed);
      entry.mat.emissiveIntensity = entry.baseIntensity + pulse * entry.baseIntensity * 1.35;
    }

    // Lightning light CPU flicker (minimal — everything else is TSL-driven).
    if (this.vfxLightningLight) {
      this.vfxLightningLight.intensity = 8 + Math.random() * 4;
    }

    // Sparkle particles
    this.sparkleParticles?.update(dt);

    // Dust motes gentle drift.
    for (const mote of this.dustMotes) {
      const t = this.simTime * mote.speed + mote.phase;
      mote.sprite.position.set(
        mote.origin.x + Math.sin(t * 0.7) * 1.2,
        mote.origin.y + Math.sin(t * 0.5) * 0.6,
        mote.origin.z + Math.cos(t * 0.6) * 1.0,
      );
      mote.sprite.material.rotation = t * 0.2;
    }
  }

  /** Runs after physics step: capture poses for interpolation. */
  postPhysicsUpdate(_dt: number): void {
    for (const item of this.dynamicBodies) {
      const p = item.body.translation();
      const r = item.body.rotation();
      if (!item.hasPose) {
        item.prevPos.set(p.x, p.y, p.z);
        item.currPos.set(p.x, p.y, p.z);
        item.prevQuat.set(r.x, r.y, r.z, r.w);
        item.currQuat.set(r.x, r.y, r.z, r.w);
        item.hasPose = true;
      } else {
        item.prevPos.copy(item.currPos);
        item.prevQuat.copy(item.currQuat);
        item.currPos.set(p.x, p.y, p.z);
        item.currQuat.set(r.x, r.y, r.z, r.w);
      }
    }
  }

  /** Render-frame interpolation for dynamic body visuals. */
  update(dt: number, alpha: number): void {
    for (const item of this.dynamicBodies) {
      if (!item.hasPose) continue;
      item.mesh.position.lerpVectors(item.prevPos, item.currPos, alpha);
      item.mesh.quaternion.slerpQuaternions(item.prevQuat, item.currQuat, alpha);
    }
    // VFX showcase animations — visual-only, runs at render rate for smooth animation
    for (const cb of this.vfxUpdateCallbacks) cb(dt);
  }

  /** Keep directional light near player for stable, sharp shadows. */
  updateLighting(playerPos: THREE.Vector3): void {
    this.lighting.updateLighting(playerPos);
  }

  private async loadGLTF(name: string): Promise<void> {
    const gltf = await this.assetLoader.load(`/assets/levels/${name}.glb`);
    const root = gltf.scene;

    const parsed = this.meshParser.parse(root);
    this.levelValidator.validate(parsed, name);

    const _worldPos = new THREE.Vector3();
    const _worldQuat = new THREE.Quaternion();

    for (const entry of parsed) {
      switch (entry.type) {
        case "spawnpoint":
          entry.object.updateWorldMatrix(true, false);
          entry.object.getWorldPosition(_worldPos);
          entry.object.getWorldQuaternion(_worldQuat);
          this.spawnPoint = {
            position: _worldPos.clone(),
            rotation: new THREE.Euler().setFromQuaternion(_worldQuat),
          };
          break;

        case "collider": {
          if (entry.mesh) {
            entry.mesh.visible = false;
            this.bakeWorldTransformAndAdd(entry.mesh);
            const collider = this.colliderFactory.createTrimesh(entry.mesh);
            this.levelColliders.push(collider);
            this.levelObjects.push(entry.mesh);
          } else {
            // Non-mesh collider node (e.g. empty/group tagged as collider).
            // Create a box collider from the node's world-space bounding box.
            entry.object.updateWorldMatrix(true, true);
            const box = new THREE.Box3().setFromObject(entry.object);
            if (!box.isEmpty()) {
              const center = box.getCenter(new THREE.Vector3());
              const size = box.getSize(new THREE.Vector3());
              const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
              const body = this.physicsWorld.world.createRigidBody(bodyDesc);
              const colliderDesc = RAPIER.ColliderDesc.cuboid(
                Math.max(size.x / 2, 0.01),
                Math.max(size.y / 2, 0.01),
                Math.max(size.z / 2, 0.01),
              );
              const collider = this.physicsWorld.world.createCollider(colliderDesc, body);
              this.levelBodies.push(body);
              this.levelColliders.push(collider);
            }
          }
          break;
        }

        case "sensor": {
          if (entry.mesh) {
            const { collider, body } = this.colliderFactory.createSensor(entry.mesh);
            this.levelColliders.push(collider);
            this.levelBodies.push(body);
          } else {
            // Non-mesh sensor node — create a box sensor from bounding box.
            entry.object.updateWorldMatrix(true, true);
            const box = new THREE.Box3().setFromObject(entry.object);
            if (!box.isEmpty()) {
              const center = box.getCenter(new THREE.Vector3());
              const size = box.getSize(new THREE.Vector3());
              const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
              const body = this.physicsWorld.world.createRigidBody(bodyDesc);
              const colliderDesc = RAPIER.ColliderDesc.cuboid(
                Math.max(size.x / 2, 0.01),
                Math.max(size.y / 2, 0.01),
                Math.max(size.z / 2, 0.01),
              ).setSensor(true);
              const collider = this.physicsWorld.world.createCollider(colliderDesc, body);
              this.levelBodies.push(body);
              this.levelColliders.push(collider);
            } else {
              console.warn(
                "[LevelManager] Sensor node has no mesh and empty bounding box, skipped:",
                entry.object.name,
              );
            }
          }
          break;
        }

        case "visual":
          if (!entry.mesh) break;
          entry.mesh.castShadow = true;
          entry.mesh.receiveShadow = true;
          this.bakeWorldTransformAndAdd(entry.mesh);
          this.levelObjects.push(entry.mesh);
          break;

        case "navmesh":
          // Future use — skip for now
          break;
      }
    }
  }

  /** Bake world transform into mesh and add to scene. Preserves hierarchy transforms. */
  private bakeWorldTransformAndAdd(mesh: THREE.Mesh): void {
    mesh.updateWorldMatrix(true, false);
    mesh.position.setFromMatrixPosition(mesh.matrixWorld);
    mesh.quaternion.setFromRotationMatrix(mesh.matrixWorld);
    mesh.scale.setFromMatrixScale(mesh.matrixWorld);
    this.scene.add(mesh);
  }

  /**
   * Delegate procedural level construction to ProceduralBuilder and absorb its results.
   */
  private async buildProcedural(stationFilter: ShowcaseStationKey | null): Promise<void> {
    const builder = new ProceduralBuilder(
      this.scene,
      this.physicsWorld,
      this.textureAnisotropy,
      this._loadGeneration,
      stationFilter,
      this.assetLoader,
    );
    await builder.build((progress) => {
      this.eventBus.emit("loading:progress", { progress });
    });
    const result = builder.getResult();

    // Take ownership of the builder's arrays by reference, NOT by copying.
    // This is critical because createVfxBay is fire-and-forget async — it
    // pushes to the meshes/colliders/bodies arrays after dynamic imports
    // resolve.  If we spread-copied we would miss those late additions.
    this.levelObjects = result.meshes;
    this.levelColliders = result.colliders;
    this.levelBodies = result.bodies;
    this.movingPlatforms = result.movingPlatforms;
    this.floatingPlatforms = result.floatingPlatforms;
    this.dynamicBodies = result.dynamicBodies;
    this.ladderZones = result.ladderZones;
    this.animatedMaterials = result.animatedMaterials;
    this.dustMotes = result.dustMotes;
    this.sparkleParticles = result.sparkleParticles;
    this.spawnPoint = result.spawnPoint;
    this.vfxNoiseTexture = result.vfxNoiseTexture;
    this.vfxLightningLight = result.vfxLightningLight;
    this.navMeshManager = result.navMeshManager;
    this.navPatrolSystem = result.navPatrolSystem;
    this.navDebugOverlay = result.navDebugOverlay;
    this.vfxDisposeCallbacks = result.vfxDisposeCallbacks;
    this.vfxUpdateCallbacks = result.vfxUpdateCallbacks;
  }

  private addLighting(): void {
    const lightObjects = this.lighting.addLighting();
    this.levelObjects.push(...lightObjects);
  }

  dispose(): void {
    this.unload();
    this.assetLoader.clearAll();
  }
}
