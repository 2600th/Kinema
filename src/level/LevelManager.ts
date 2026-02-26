import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { Disposable, SpawnPointData } from '@core/types';
import type { GraphicsProfile } from '@core/UserSettings';
import { COLLISION_GROUP_WORLD } from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { ColliderFactory } from '@physics/ColliderFactory';
import type { LevelDataV2, SerializedObjectV2 } from '@editor/LevelSerializer';
import { getBrushById } from '@editor/brushes/index';
import {
  SHOWCASE_LAYOUT,
  SHOWCASE_STATION_ORDER,
  getShowcaseBayTopY,
  getShowcaseStationZ,
} from '@level/ShowcaseLayout';
import { NavMeshManager } from '@navigation/NavMeshManager';
import { NavPatrolSystem } from '@navigation/NavPatrolSystem';
import { NavDebugOverlay } from '@navigation/NavDebugOverlay';
import { AssetLoader } from './AssetLoader';
import { MeshParser } from './MeshParser';
import { LevelValidator } from './LevelValidator';

const _lightGoalPos = new THREE.Vector3();
const _lightGoalTarget = new THREE.Vector3();
const DEFAULT_SPAWN_Y = 2;

function createDefaultSpawnPoint(): SpawnPointData {
  return { position: new THREE.Vector3(0, DEFAULT_SPAWN_Y, 0) };
}

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
  private levelColliders: RAPIER.Collider[] = [];
  private levelBodies: RAPIER.RigidBody[] = [];
  private spawnPoint: SpawnPointData = createDefaultSpawnPoint();
  private movingPlatforms: Array<{
    mesh: THREE.Mesh;
    body: RAPIER.RigidBody;
    base: THREE.Vector3;
    mode: 'x' | 'y' | 'rotateY' | 'rotateX' | 'xy' | 'yRotate';
    speed: number;
    amplitude: number;
    rotationOffset: THREE.Euler;
  }> = [];
  private floatingPlatforms: Array<{
    mesh: THREE.Mesh;
    body: RAPIER.RigidBody;
    rayLength: number;
    floatingDistance: number;
    springK: number;
    dampingC: number;
    moveRangeMinX?: number;
    moveRangeMaxX?: number;
    moveSpeedX?: number;
    moveDirectionX?: number;
  }> = [];
  private dynamicBodies: Array<{
    mesh: THREE.Mesh;
    body: RAPIER.RigidBody;
    prevPos: THREE.Vector3;
    currPos: THREE.Vector3;
    prevQuat: THREE.Quaternion;
    currQuat: THREE.Quaternion;
    hasPose: boolean;
  }> = [];
  private ladderZones: THREE.Box3[] = [];
  private simTime = 0;
  private animatedMaterials: Array<{ mat: THREE.MeshStandardMaterial; baseIntensity: number; speed: number }> = [];
  private vfxNoiseTexture: THREE.CanvasTexture | null = null;
  private vfxLightningLight: THREE.PointLight | null = null;
  private dustMotes: Array<{ sprite: THREE.Sprite; origin: THREE.Vector3; speed: number; phase: number }> = [];
  private dirLight: THREE.DirectionalLight | null = null;
  private dirLightTarget: THREE.Object3D | null = null;
  private lightDebugEnabled = false;
  private shadowDebugEnabled = false;
  private lightHelpers: THREE.Object3D[] = [];
  private shadowFrustumHelpers: THREE.CameraHelper[] = [];
  private shadowsEnabled = true;
  private graphicsProfile: GraphicsProfile = 'cinematic';
  private lightFollowPos = new THREE.Vector3(20, 30, 10);
  private lightTargetPos = new THREE.Vector3(0, 1, 0);
  private navMeshManager: NavMeshManager | null = null;
  private navPatrolSystem: NavPatrolSystem | null = null;
  private navDebugOverlay: NavDebugOverlay | null = null;
  private textureAnisotropy = 8;
  private _loadGeneration = 0;

  constructor(
    private scene: THREE.Scene,
    private physicsWorld: PhysicsWorld,
    private eventBus: EventBus,
    maxAnisotropy?: number,
  ) {
    this.colliderFactory = new ColliderFactory(physicsWorld);
    if (typeof maxAnisotropy === 'number' && Number.isFinite(maxAnisotropy) && maxAnisotropy > 0) {
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
  getDynamicBodies(): ReadonlyArray<{ mesh: THREE.Mesh; body: RAPIER.RigidBody }> {
    // Expose only mesh/body; internal pose buffers are an implementation detail.
    return this.dynamicBodies;
  }

  /** Read-only list of level visuals for editor selection. */
  getLevelObjects(): ReadonlyArray<THREE.Object3D> {
    return this.levelObjects;
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
    this.graphicsProfile = profile;
    this.applyDirectionalLightQuality();
  }

  setLightDebugEnabled(enabled: boolean): void {
    this.lightDebugEnabled = enabled;
    if (!enabled) {
      this.removeLightHelpers();
      return;
    }
    this.ensureLightHelpers();
  }

  setShadowDebugEnabled(enabled: boolean): void {
    this.shadowDebugEnabled = enabled;
    if (!enabled) {
      this.removeShadowHelpers();
      return;
    }
    this.ensureShadowHelpers();
  }

  getShadowDebugEnabled(): boolean {
    return this.shadowDebugEnabled;
  }

  setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    // IMPORTANT: Avoid toggling `light.castShadow` at runtime under WebGPU.
    // It can trigger shadow texture destruction/recreation while render commands
    // are being encoded/submitted, causing WebGPU validation errors.
    this.applyDirectionalLightQuality();
  }

  /** Load a level by name. 'procedural' generates a test level. */
  async load(name: string): Promise<void> {
    // Unload current level first
    if (this.currentLevelName) {
      this.unload();
    }
    // Always reset before each load so levels without spawnpoints are deterministic.
    this.spawnPoint = createDefaultSpawnPoint();

    if (name === 'procedural') {
      this.buildProceduralLevel();
    } else {
      await this.loadGLTF(name);
    }

    this.currentLevelName = name;

    // Add ambient + directional light
    this.addLighting();

    this.eventBus.emit('level:loaded', { name });
    console.log(`[LevelManager] Level "${name}" loaded`);
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

    // Apply spawn point from JSON
    if (data.spawnPoint?.position) {
      const [x, y, z] = data.spawnPoint.position;
      this.spawnPoint = { position: new THREE.Vector3(x, y, z) };
    }

    // Spawn each object
    for (const entry of data.objects) {
      await this.spawnJSONObject(entry);
    }

    this.currentLevelName = data.name || 'custom';
    this.addLighting();
    this.eventBus.emit('level:loaded', { name: this.currentLevelName });
    console.log(`[LevelManager] JSON level "${this.currentLevelName}" loaded (${data.objects.length} objects)`);
  }

  private async spawnJSONObject(entry: SerializedObjectV2): Promise<void> {
    let mesh: THREE.Mesh | null = null;

    if (entry.source.type === 'primitive' && entry.source.primitive) {
      mesh = this.createPrimitiveMesh(entry.source.primitive);
    } else if (entry.source.type === 'brush' && entry.source.brush) {
      mesh = this.createBrushMesh(entry.source.brush);
    } else if (entry.source.type === 'glb' && entry.source.asset) {
      mesh = await this.loadGLBObject(entry.source.asset);
    }

    if (!mesh) return;

    // Apply transform
    const [px, py, pz] = entry.transform.position;
    const [rx, ry, rz] = entry.transform.rotation;
    const [sx, sy, sz] = entry.transform.scale;
    mesh.position.set(px, py, pz);
    mesh.rotation.set(rx, ry, rz);
    mesh.scale.set(sx, sy, sz);

    // Apply material properties
    if (entry.material && mesh.material instanceof THREE.MeshStandardMaterial) {
      const mat = mesh.material;
      mat.color.set(entry.material.color);
      mat.roughness = entry.material.roughness;
      mat.metalness = entry.material.metalness;
      mat.emissive.set(entry.material.emissive);
      mat.emissiveIntensity = entry.material.emissiveIntensity;
      if (entry.material.opacity < 1) {
        mat.transparent = true;
        mat.opacity = entry.material.opacity;
      }
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = entry.name;
    this.scene.add(mesh);
    this.levelObjects.push(mesh);

    // Create physics body
    const physType = entry.physics?.type ?? 'static';
    let bodyDesc: RAPIER.RigidBodyDesc;
    if (physType === 'dynamic') {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic();
    } else if (physType === 'kinematic') {
      bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    } else {
      bodyDesc = RAPIER.RigidBodyDesc.fixed();
    }
    bodyDesc.setTranslation(px, py, pz);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);

    // Approximate collider from geometry bounding box
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    const halfW = ((bb.max.x - bb.min.x) / 2) * sx;
    const halfH = ((bb.max.y - bb.min.y) / 2) * sy;
    const halfD = ((bb.max.z - bb.min.z) / 2) * sz;
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      Math.max(halfW, 0.01),
      Math.max(halfH, 0.01),
      Math.max(halfD, 0.01),
    ).setCollisionGroups(COLLISION_GROUP_WORLD);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

    this.levelBodies.push(body);
    this.levelColliders.push(collider);

    // Track dynamic bodies for interpolation
    if (physType === 'dynamic') {
      this.dynamicBodies.push({
        mesh,
        body,
        prevPos: mesh.position.clone(),
        currPos: mesh.position.clone(),
        prevQuat: mesh.quaternion.clone(),
        currQuat: mesh.quaternion.clone(),
        hasPose: false,
      });
    }
  }

  private createPrimitiveMesh(primitive: string): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    if (primitive === 'sphere') geometry = new THREE.SphereGeometry(0.5, 16, 16);
    else if (primitive === 'cylinder') geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
    else if (primitive === 'capsule') geometry = new THREE.CapsuleGeometry(0.4, 0.6, 6, 12);
    else if (primitive === 'plane') geometry = new THREE.PlaneGeometry(1, 1);
    else geometry = new THREE.BoxGeometry(1, 1, 1);
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb0c4de, roughness: 0.6 }));
  }

  private createBrushMesh(brushId: string): THREE.Mesh | null {
    const brush = getBrushById(brushId);
    if (!brush) return null;
    const defaultParams = {
      anchor: new THREE.Vector3(0, 0, 0),
      current: new THREE.Vector3(1, 0, 1),
      normal: new THREE.Vector3(0, 1, 0),
      height: 1,
    };
    const geometry = brush.buildPreviewGeometry(defaultParams);
    const material = brush.getDefaultMaterial();
    return new THREE.Mesh(geometry, material);
  }

  private async loadGLBObject(assetPath: string): Promise<THREE.Mesh | null> {
    try {
      const gltf = await this.assetLoader.load(assetPath);
      // Find the first mesh in the GLB scene
      let foundMesh: THREE.Mesh | null = null;
      gltf.scene.traverse((child) => {
        if (!foundMesh && child instanceof THREE.Mesh) {
          foundMesh = child.clone();
        }
      });
      if (foundMesh) return foundMesh;
      // If no individual mesh found, bake the whole scene into a group-like mesh
      const clone = gltf.scene.clone();
      // Wrap in a dummy mesh for consistent handling
      const wrapper = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ visible: false }));
      wrapper.add(clone);
      return wrapper;
    } catch (err) {
      console.warn(`[LevelManager] Failed to load GLB "${assetPath}", using placeholder`, err);
      // Magenta wireframe cube placeholder
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
      return new THREE.Mesh(geo, mat);
    }
  }

  /** Unload all current level resources. */
  unload(): void {
    this._loadGeneration++;
    const name = this.currentLevelName;

    // Evict GLTF cache to avoid reusing disposed geometries/materials
    if (name && name !== 'procedural') {
      this.assetLoader.evict(`/assets/levels/${name}.glb`);
    }

    // Remove physics
    for (const collider of this.levelColliders) {
      this.physicsWorld.removeCollider(collider);
    }
    for (const body of this.levelBodies) {
      this.physicsWorld.removeBody(body);
    }

    // Remove scene objects
    for (const obj of this.levelObjects) {
      this.scene.remove(obj);
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => {
              const mat = m as THREE.Material & { map?: THREE.Texture | null };
              mat.map?.dispose();
              m.dispose();
            });
          } else {
            const mat = child.material as THREE.Material & { map?: THREE.Texture | null };
            mat.map?.dispose();
            child.material.dispose();
          }
        } else if (child instanceof THREE.Sprite) {
          const mat = child.material as THREE.SpriteMaterial;
          mat.map?.dispose();
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
    this.navPatrolSystem?.dispose();
    this.navPatrolSystem = null;
    this.navDebugOverlay?.dispose();
    this.navDebugOverlay = null;
    this.navMeshManager?.dispose(this.scene);
    this.navMeshManager = null;
    this.dirLight = null;
    this.dirLightTarget = null;
    this.removeLightHelpers();
    this.removeShadowHelpers();
    this.currentLevelName = null;
    this.spawnPoint = createDefaultSpawnPoint();

    if (name) {
      this.eventBus.emit('level:unloaded', { name });
      console.log(`[LevelManager] Level "${name}" unloaded`);
    }
  }

  /** Update dynamic demo level elements (moving platforms). */
  fixedUpdate(dt: number): void {
    this.simTime += dt;

    for (const platform of this.movingPlatforms) {
      const nextPos = platform.base.clone();
      let nextRotY = platform.mesh.rotation.y;
      let nextRotX = platform.mesh.rotation.x;

      switch (platform.mode) {
        case 'x':
          nextPos.x = platform.base.x + Math.sin(this.simTime * platform.speed) * platform.amplitude;
          break;
        case 'y':
          nextPos.y = platform.base.y + Math.sin(this.simTime * platform.speed) * platform.amplitude;
          break;
        case 'yRotate':
          nextPos.y = platform.base.y + Math.sin(this.simTime * platform.speed) * platform.amplitude;
          nextRotY = this.simTime * platform.speed;
          break;
        case 'xy':
          nextPos.x = platform.base.x + Math.sin(this.simTime * platform.speed) * platform.amplitude;
          nextPos.y = platform.base.y + Math.cos(this.simTime * platform.speed) * (platform.amplitude * 0.4);
          break;
        case 'rotateY':
          nextRotY = this.simTime * platform.speed;
          break;
        case 'rotateX':
          nextRotX = this.simTime * platform.speed;
          break;
      }

      platform.mesh.position.copy(nextPos);
      if (platform.mode === 'rotateY' || platform.mode === 'yRotate') {
        platform.mesh.rotation.set(
          platform.rotationOffset.x,
          nextRotY + platform.rotationOffset.y,
          platform.rotationOffset.z,
        );
      }
      if (platform.mode === 'rotateX') {
        platform.mesh.rotation.set(
          nextRotX + platform.rotationOffset.x,
          platform.rotationOffset.y,
          platform.rotationOffset.z,
        );
      }

      platform.body.setNextKinematicTranslation(new RAPIER.Vector3(nextPos.x, nextPos.y, nextPos.z));
      if (platform.mode === 'rotateY' || platform.mode === 'yRotate' || platform.mode === 'rotateX') {
        const qEuler = new THREE.Euler(
          (platform.mode === 'rotateX' ? nextRotX : 0) + platform.rotationOffset.x,
          (platform.mode === 'rotateY' || platform.mode === 'yRotate' ? nextRotY : 0) + platform.rotationOffset.y,
          platform.rotationOffset.z,
        );
        const q = new THREE.Quaternion().setFromEuler(qEuler);
        platform.body.setNextKinematicRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w));
      }
    }

    // Floating dynamic platforms.
    for (const platform of this.floatingPlatforms) {
      const p = platform.body.translation();
      const origin = new RAPIER.Vector3(p.x, p.y, p.z);
      const rayHit = this.physicsWorld.castRay(
        origin,
        new RAPIER.Vector3(0, -1, 0),
        platform.rayLength,
        undefined,
        platform.body,
        (c) => !c.isSensor(),
      );
      if (rayHit && rayHit.collider.parent()) {
        const lv = platform.body.linvel();
        const floatingForce =
          platform.springK * (platform.floatingDistance - rayHit.timeOfImpact) -
          lv.y * platform.dampingC;
        platform.body.applyImpulse(new RAPIER.Vector3(0, floatingForce, 0), true);
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
        platform.body.setLinvel(
          new RAPIER.Vector3(platform.moveDirectionX * platform.moveSpeedX, lv.y, 0),
          true,
        );
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
  update(_dt: number, alpha: number): void {
    for (const item of this.dynamicBodies) {
      if (!item.hasPose) continue;
      item.mesh.position.lerpVectors(item.prevPos, item.currPos, alpha);
      item.mesh.quaternion.slerpQuaternions(item.prevQuat, item.currQuat, alpha);
    }
  }

  /** Keep directional light near player for stable, sharp shadows. */
  updateLighting(playerPos: THREE.Vector3): void {
    if (!this.dirLight || !this.dirLightTarget) return;
    _lightGoalPos.set(playerPos.x + 20, playerPos.y + 30, playerPos.z + 10);
    _lightGoalTarget.set(playerPos.x, playerPos.y + 1, playerPos.z);
    this.lightFollowPos.lerp(_lightGoalPos, 0.08);
    this.lightTargetPos.lerp(_lightGoalTarget, 0.1);
    this.dirLight.position.copy(this.lightFollowPos);
    this.dirLightTarget.position.copy(this.lightTargetPos);
    this.dirLight.shadow.camera.left = -22;
    this.dirLight.shadow.camera.right = 22;
    this.dirLight.shadow.camera.top = 22;
    this.dirLight.shadow.camera.bottom = -22;
    this.dirLight.shadow.camera.near = 1;
    this.dirLight.shadow.camera.far = 90;
    this.dirLight.shadow.camera.updateProjectionMatrix();
    this.updateDebugHelpers();
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
        case 'spawnpoint':
          entry.object.updateWorldMatrix(true, false);
          entry.object.getWorldPosition(_worldPos);
          entry.object.getWorldQuaternion(_worldQuat);
          this.spawnPoint = {
            position: _worldPos.clone(),
            rotation: new THREE.Euler().setFromQuaternion(_worldQuat),
          };
          break;

        case 'collider': {
          if (!entry.mesh) break;
          this.bakeWorldTransformAndAdd(entry.mesh);
          const collider = this.colliderFactory.createTrimesh(entry.mesh);
          this.levelColliders.push(collider);
          this.levelObjects.push(entry.mesh);
          break;
        }

        case 'sensor': {
          if (!entry.mesh) break;
          const { collider, body } = this.colliderFactory.createSensor(entry.mesh);
          this.levelColliders.push(collider);
          this.levelBodies.push(body);
          break;
        }

        case 'visual':
          if (!entry.mesh) break;
          this.bakeWorldTransformAndAdd(entry.mesh);
          this.levelObjects.push(entry.mesh);
          break;

        case 'navmesh':
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

  /** Build a simple test level with floor, ramps, walls. */
  private buildProceduralLevel(): void {
    const gridTexture = this.createGroundGridTexture();
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a1d24,
      map: gridTexture,
      roughness: 0.75,
      metalness: 0.05,
    });
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x3a4a68, roughness: 0.85, metalness: 0.05, emissive: 0xc0d8ff, emissiveIntensity: 0.4 });
    const slopeMat = new THREE.MeshStandardMaterial({ color: 0x5568a0, roughness: 0.8, metalness: 0.05 });
    const obstacleMat = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.8, metalness: 0.05, emissive: 0x4488cc, emissiveIntensity: 0.3 });
    const kinematicPlatformMat = new THREE.MeshStandardMaterial({ color: 0xccaa22, roughness: 0.85, metalness: 0.05 });
    const floatingPlatformMat = new THREE.MeshStandardMaterial({ color: 0x3366aa, roughness: 0.85, metalness: 0.05 });

    // Broad floor
    const floor = new THREE.Mesh(new THREE.BoxGeometry(300, 5, 300), floorMat);
    // WHY: The showcase hall floor surface sits at y=-1.0. If the broad floor
    // also has its top face at y=-1.0, the two coplanar surfaces z-fight and
    // the grid flickers. Keep the broad floor below the hall floor plane.
    floor.position.set(0, -4.0, 0);
    floor.name = 'Floor_col';
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.levelObjects.push(floor);
    floor.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(floor));

    // === Showcase corridor (inspired by Unity/Unreal sample bays) ===
    // Centered at world origin and used for *all* features (old + new).
    const showcaseCenterZ = SHOWCASE_LAYOUT.centerZ;
    const hallWidth = SHOWCASE_LAYOUT.hall.width;
    const hallLength = SHOWCASE_LAYOUT.hall.length;
    const bayWidth = hallWidth - SHOWCASE_LAYOUT.bay.widthInset;
    const bayLength = SHOWCASE_LAYOUT.bay.pedestalLength;
    const bayPedestalY = SHOWCASE_LAYOUT.bay.pedestalY;
    const bayPedestalHeight = SHOWCASE_LAYOUT.bay.pedestalHeight;
    const bayTopY = getShowcaseBayTopY();
    const hallFloorMat = new THREE.MeshStandardMaterial({ color: 0x282c38, roughness: 0.88, metalness: 0.02 });
    // Show a readable ground grid in normal play mode too.
    hallFloorMat.map = gridTexture;
    hallFloorMat.needsUpdate = true;
    // Keep corridor walls non-metallic to avoid SSR "sparkle" on rough surfaces.
    const hallWallMat = new THREE.MeshStandardMaterial({ color: 0xd8dce5, roughness: 0.9, metalness: 0.0 });
    const bayMat = new THREE.MeshStandardMaterial({ color: 0x404858, roughness: 0.75, metalness: 0.05 });

    const hallFloor = new THREE.Mesh(new THREE.BoxGeometry(hallWidth, 0.6, hallLength), hallFloorMat);
    hallFloor.position.set(0, -1.3, showcaseCenterZ);
    hallFloor.name = 'ShowcaseFloor_col';
    hallFloor.receiveShadow = true;
    this.scene.add(hallFloor);
    this.levelObjects.push(hallFloor);
    hallFloor.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(hallFloor));

    const wallThickness = 0.6;
    // Taller corridor so drone camera pivot doesn't end up inside the ceiling.
    const wallHeight = 18;
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, hallLength), hallWallMat);
    leftWall.position.set(-hallWidth / 2 - wallThickness / 2, wallHeight / 2 - 1.0, showcaseCenterZ);
    leftWall.name = 'ShowcaseWallL_col';
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);
    this.levelObjects.push(leftWall);
    leftWall.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(leftWall));

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, hallLength), hallWallMat);
    rightWall.position.set(hallWidth / 2 + wallThickness / 2, wallHeight / 2 - 1.0, showcaseCenterZ);
    rightWall.name = 'ShowcaseWallR_col';
    rightWall.receiveShadow = true;
    this.scene.add(rightWall);
    this.levelObjects.push(rightWall);
    rightWall.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(rightWall));

    const endWall = new THREE.Mesh(new THREE.BoxGeometry(hallWidth + wallThickness * 2, wallHeight, wallThickness), hallWallMat);
    endWall.position.set(0, wallHeight / 2 - 1.0, showcaseCenterZ - hallLength / 2 - wallThickness / 2);
    endWall.name = 'ShowcaseWallEnd_col';
    endWall.receiveShadow = true;
    this.scene.add(endWall);
    this.levelObjects.push(endWall);
    endWall.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(endWall));

    // Close the corridor on the entrance side as well, to avoid seeing the environment.
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(hallWidth + wallThickness * 2, wallHeight, wallThickness), hallWallMat);
    frontWall.position.set(0, wallHeight / 2 - 1.0, showcaseCenterZ + hallLength / 2 + wallThickness / 2);
    frontWall.name = 'ShowcaseWallFront_col';
    frontWall.receiveShadow = true;
    this.scene.add(frontWall);
    this.levelObjects.push(frontWall);
    frontWall.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(frontWall));

    // Ceiling to fully enclose the bay corridor (prevents "sky triangle" artifacts).
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(hallWidth + wallThickness * 2, wallThickness, hallLength + wallThickness * 2), hallWallMat);
    ceiling.position.set(0, -1.0 + wallHeight + wallThickness / 2, showcaseCenterZ);
    ceiling.name = 'ShowcaseCeiling_col';
    ceiling.receiveShadow = true;
    this.scene.add(ceiling);
    this.levelObjects.push(ceiling);
    ceiling.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(ceiling));

    // Bay pedestals (grid stations) along the corridor.
    const bayZ = SHOWCASE_STATION_ORDER.map((k) => getShowcaseStationZ(k));
    bayZ.forEach((z, i) => {
      const pedestal = new THREE.Mesh(new THREE.BoxGeometry(bayWidth, bayPedestalHeight, bayLength), bayMat);
      pedestal.position.set(0, bayPedestalY, z);
      pedestal.receiveShadow = true;
      pedestal.name = `ShowcaseBay${i}_col`;
      this.scene.add(pedestal);
      this.levelObjects.push(pedestal);
      pedestal.updateWorldMatrix(true, false);
      this.levelColliders.push(this.colliderFactory.createTrimesh(pedestal));
    });

    // Ceiling accent lights above each bay (no shadows) for clearer readability.
    // WHY: keeps the corridor visually appealing without adding expensive shadowed lights.
    // Colors progress warm→cool along the corridor for a visual journey.
    const ceilingY = -1.0 + wallHeight - 0.45;
    const warmPanel = new THREE.Color(0xd0e0ff);
    const coolPanel = new THREE.Color(0xe0e8ff);
    const warmLight = new THREE.Color(0xc8d8ff);
    const coolLight = new THREE.Color(0xe8e0f0);
    const bayCount = bayZ.length;
    bayZ.forEach((z, i) => {
      const t = bayCount > 1 ? i / (bayCount - 1) : 0;
      const panelEmissive = new THREE.Color().lerpColors(warmPanel, coolPanel, t);
      const lightColor = new THREE.Color().lerpColors(warmLight, coolLight, t);

      const panelMat = new THREE.MeshStandardMaterial({
        color: 0xd0d4dc,
        roughness: 0.35,
        metalness: 0.05,
        emissive: panelEmissive,
        emissiveIntensity: 1.0,
      });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(bayWidth - 6, 0.08, 2.6), panelMat);
      panel.position.set(0, ceilingY, z);
      panel.name = `ShowcaseCeilingPanel${i}`;
      panel.castShadow = false;
      panel.receiveShadow = false;
      this.scene.add(panel);
      this.levelObjects.push(panel);

      const light = new THREE.PointLight(lightColor, 120, 28, 2);
      light.position.set(0, ceilingY - 0.25, z);
      light.castShadow = false;
      light.name = `ShowcaseBayLight${i}`;
      this.scene.add(light);
      this.levelObjects.push(light);
    });

    // Spawn the player near the first showcase station (steps at z=170).
    this.spawnPoint = {
      position: new THREE.Vector3(0, 2, showcaseCenterZ + hallLength / 2 - 160),
      rotation: new THREE.Euler(0, Math.PI, 0),
    };

    // Station Z coordinates used below.
    const zSteps = getShowcaseStationZ('steps');
    const zSlopes = getShowcaseStationZ('slopes');
    const zMovement = getShowcaseStationZ('movement');
    const zDoubleJump = getShowcaseStationZ('doubleJump');
    const zGrab = getShowcaseStationZ('grab');
    const zThrow = getShowcaseStationZ('throw');
    const zDoor = getShowcaseStationZ('door');
    const zVehicles = getShowcaseStationZ('vehicles');
    const zPlatformsMoving = getShowcaseStationZ('platformsMoving');
    const zPlatformsPhysics = getShowcaseStationZ('platformsPhysics');
    const zMaterials = getShowcaseStationZ('materials');
    const zVfx = getShowcaseStationZ('vfx');
    const zNavigation = getShowcaseStationZ('navigation');
    const zFutureA = getShowcaseStationZ('futureA');

    // Rough plane section (materials + footing). Kept inside the showcase corridor.
    const roughPlane = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 10), obstacleMat);
    roughPlane.position.set(20, bayTopY + 0.3, zSteps + 2);
    roughPlane.rotation.set(-0.08, 0.12, 0.06);
    roughPlane.name = 'RoughPlane_col';
    roughPlane.receiveShadow = true;
    this.scene.add(roughPlane);
    this.levelObjects.push(roughPlane);
    roughPlane.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(roughPlane));

    // Slope lane: ~23.5, 43.1, 62.7 degrees (showcase station)
    const slopeAngles = [23.5, 43.1, 62.7];
    slopeAngles.forEach((deg, i) => {
      // Keep a consistent rise so the steep ramp doesn't clip the walls/ceiling.
      const angle = (deg * Math.PI) / 180;
      const desiredRise = 3.2;
      const thickness = 0.4;
      const width = 6.0;
      const length = THREE.MathUtils.clamp(desiredRise / Math.max(0.001, Math.sin(angle)), 3.6, 11.5);

      const slope = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, length), slopeMat);
      slope.rotation.x = -angle;

      // Place so the low end touches the bay surface and stays inside the pedestal footprint.
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const centerY = bayTopY + (thickness * 0.5) * cos + (length * 0.5) * sin;

      const bayHalfZ = bayLength * 0.5;
      const lowEndZ = zSlopes + (bayHalfZ - 1.2);
      const lowEndLocalZ = (length * 0.5) * cos - (thickness * 0.5) * sin;
      const centerZ = lowEndZ - lowEndLocalZ;

      const laneX = [-10, 0, 10][i] ?? 0;
      slope.position.set(laneX, centerY, centerZ);
      slope.name = `Slope${Math.round(deg)}_col`;
      slope.receiveShadow = true;
      this.scene.add(slope);
      this.levelObjects.push(slope);
      slope.updateWorldMatrix(true, false);
      this.levelColliders.push(this.colliderFactory.createTrimesh(slope));
    });
    this.createSectionLabel(
      'Slopes\n23.5\u00B0 \u2022 43.1\u00B0 \u2022 62.7\u00B0',
      new THREE.Vector3(0, 3.6, zSlopes + 6),
      7.2,
      1.55,
    );

    // Step series
    const addStep = (name: string, size: THREE.Vector3, pos: THREE.Vector3) => {
      const step = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), stepMat);
      step.position.copy(pos);
      step.name = name;
      step.receiveShadow = true;
      this.scene.add(step);
      this.levelObjects.push(step);
      step.updateWorldMatrix(true, false);
      this.levelColliders.push(this.colliderFactory.createTrimesh(step));
    };
    addStep('Step0_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(-8, bayTopY + 0.07, zSteps - 6));
    addStep('Step1_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(-8, bayTopY + 0.07, zSteps - 5));
    addStep('Step2_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(-8, bayTopY + 0.07, zSteps - 4));
    addStep('Step3_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(-8, bayTopY + 0.07, zSteps - 3));
    addStep('Step4_col', new THREE.Vector3(4, 0.2, 4), new THREE.Vector3(-8, bayTopY + 0.1, zSteps));
    this.createSectionLabel(
      'Steps & Autostep\nAutomatic stair climbing',
      new THREE.Vector3(0, 2.0, zSteps + 3),
      8.4,
      1.75,
    );
    this.createStaircase(new THREE.Vector3(8, bayTopY, zSteps - 6), 10, 0.14, 0.78, 4.8, stepMat);

    // Combined movement bay: ladder + crouch + rope in a single platform stage.
    this.createLadder('MainLadder', new THREE.Vector3(14, bayTopY, zMovement), 4.2, obstacleMat);
    this.createCrouchCourse(new THREE.Vector3(0, bayTopY, zMovement), obstacleMat);
    this.createSectionLabel(
      'Movement\nW/S climb \u2022 C crouch \u2022 Space jump off rope',
      new THREE.Vector3(0, 3.0, zMovement + 6),
      11.2,
      2.25,
    );
    this.createDoubleJumpCourse(new THREE.Vector3(-6, bayTopY, zDoubleJump), stepMat);
    this.createSectionLabel(
      'Double Jump\nSpace \u2022 Multi-tier jump platforms',
      new THREE.Vector3(-2, 4.9, zDoubleJump),
      7.6,
      1.65,
    );

    // Showcase cluster (physics interactions + vehicles). Kept away from the moving platform suites.
    this.createSectionLabel(
      'Grab & Pull\nPress F to grab / release',
      new THREE.Vector3(0, 2.55, zGrab),
      10.2,
      2.2,
    );
    this.createSectionLabel(
      'Pick Up & Throw\nF to pick up \u2022 LMB to throw \u2022 C to drop',
      new THREE.Vector3(0, 2.55, zThrow),
      11.0,
      2.25,
    );
    this.createSectionLabel(
      'Door & Beacon\nPress F near objects',
      new THREE.Vector3(0, 2.55, zDoor),
      10.2,
      2.15,
    );
    this.createSectionLabel(
      'Vehicles\nF to enter / exit \u2022 E/Q altitude (drone)',
      new THREE.Vector3(0, 2.55, zVehicles),
      9.2,
      2.05,
    );
    // Rope signage is included in the movement bay label above.

    const grabbableMat = new THREE.MeshStandardMaterial({ color: 0x4fa8d8, roughness: 0.5, metalness: 0.1 });
    this.createDynamicBox('PushCubeS', new THREE.Vector3(0, bayTopY + 0.5, zGrab + 2), new THREE.Vector3(1, 1, 1), grabbableMat, { grabbable: true });
    this.createDynamicBox('PushCubeM', new THREE.Vector3(0, bayTopY + 0.75, zGrab), new THREE.Vector3(1.5, 1.5, 1.5), grabbableMat, { grabbable: true });
    this.createDynamicBox('PushCubeL', new THREE.Vector3(0, bayTopY + 1.0, zGrab - 3), new THREE.Vector3(2, 2, 2), grabbableMat, { grabbable: true });
    this.createDynamicBox('PushCubeTinyA', new THREE.Vector3(3.5, bayTopY + 0.25, zGrab), new THREE.Vector3(0.5, 0.5, 0.5), obstacleMat, { grabbable: false });
    this.createDynamicBox('PushCubeTinyB', new THREE.Vector3(-3.5, bayTopY + 0.25, zGrab), new THREE.Vector3(0.5, 0.5, 0.5), obstacleMat, { grabbable: false });
    this.createSpinningToy(new THREE.Vector3(14, 2.5, zGrab - 2), obstacleMat);

    // Platform stage A: kinematic moving platforms (single bay).
    this.createKinematicPlatform(
      'SideMovePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(-12, bayTopY + 0.1, zPlatformsMoving + 3),
      'x',
      0.5,
      5,
      kinematicPlatformMat,
    );
    this.createKinematicPlatform(
      'ElevatePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(0, bayTopY + 2.2, zPlatformsMoving + 3),
      'yRotate',
      0.5,
      2,
      kinematicPlatformMat,
    );
    this.createKinematicPlatform(
      'RotatePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(12, bayTopY + 0.1, zPlatformsMoving + 3),
      'rotateY',
      0.5,
      0,
      kinematicPlatformMat,
    );
    this.createSectionLabel(
      'Moving Platforms\nSide \u2022 Elevating \u2022 Rotating',
      new THREE.Vector3(0, 3.6, zPlatformsMoving + 6.5),
      9.2,
      1.9,
    );

    // Platform stage B: dynamic/pushable platforms + rotating drum (single bay).
    this.createFloatingPlatform(
      'FloatingPlatformA',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(-10, bayTopY + 1.2, zPlatformsPhysics + 3),
      floatingPlatformMat,
    );
    this.createFloatingPlatform(
      'FloatingPlatformB',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(10, bayTopY + 1.2, zPlatformsPhysics + 3),
      floatingPlatformMat,
      { lockX: true, lockY: false, lockZ: true, rotX: false, rotY: true, rotZ: false },
    );
    this.createFloatingPlatform(
      'FloatingMovingPlatform',
      new THREE.Vector3(2.5, 0.2, 2.5),
      new THREE.Vector3(0, bayTopY + 1.2, zPlatformsPhysics - 4),
      floatingPlatformMat,
      undefined,
      { minX: -5, maxX: 10, speedX: 2 },
    );
    this.createKinematicDrum(
      'RotatingDrum',
      new THREE.Vector3(0, bayTopY + 1.0, zPlatformsPhysics - 4),
      1.0,
      10.0,
      'rotateX',
      0.5,
      kinematicPlatformMat,
    );
    this.createSectionLabel(
      'Physics Platforms\nFloating \u2022 Moving \u2022 Rotating Drum',
      new THREE.Vector3(0, 3.6, zPlatformsPhysics + 6.5),
      11.4,
      2.05,
    );

    // Materials bay.
    this.createSectionLabel(
      'Materials\nGlass \u2022 Mirror \u2022 Copper \u2022 Ceramic \u2022 Emissive\nRough \u2022 Metal \u2022 Brushed \u2022 Iridescent \u2022 Lava',
      new THREE.Vector3(0, 3.2, zMaterials + 6),
      11.4,
      2.45,
    );
    this.createMaterialsBay(new THREE.Vector3(0, bayTopY, zMaterials), bayWidth, obstacleMat);

    // VFX bay.
    this.createSectionLabel(
      'Visual Effects\nTornado \u2022 Fire \u2022 Laser \u2022 Lightning \u2022 Scanner',
      new THREE.Vector3(0, 3.2, zVfx + 6),
      11.4,
      2.15,
    );
    void this.createVfxBay(new THREE.Vector3(0, bayTopY, zVfx), bayWidth);

    // Navigation bay: navmesh + patrol agents.
    this.createSectionLabel(
      'Navigation\nNavMesh \u2022 Crowd Patrol \u2022 N=debug \u2022 T=target',
      new THREE.Vector3(0, 3.2, zNavigation + 6),
      11.4,
      2.25,
    );
    this.createNavcatBay(zNavigation, bayTopY);

    // Reserved empty bay for future additions (keep pedestal but no gameplay objects).
    this.createSectionLabel('Reserved\nFuture demos', new THREE.Vector3(0, 2.5, zFutureA), 8.8, 2.0);

    // --- Visual polish ---
    this.addFloorCenterline(hallLength, showcaseCenterZ);
    this.addBayAccentBorders(bayZ, bayWidth, bayLength, bayPedestalY, bayPedestalHeight);
    this.addCorridorTrim(hallWidth, wallHeight, hallLength, showcaseCenterZ, wallThickness);
    this.addWallPilasters(bayZ, hallWidth, wallHeight, wallThickness);
    this.addEntranceFrame(hallWidth, wallHeight, hallLength, showcaseCenterZ);
    this.addFloorBayGrooves(bayZ, hallWidth, bayLength);
    this.addWallEmissiveStrips(hallWidth, hallLength, showcaseCenterZ, wallThickness);
    this.addDustMotes(hallWidth, hallLength, showcaseCenterZ);
    this.addBulkheadFrames(hallWidth, wallHeight, showcaseCenterZ);
    this.addBayPedestalEdgeGlow(bayZ, bayWidth, bayLength, bayPedestalY, bayPedestalHeight);
    this.addHeroSpotlights(bayZ, bayPedestalY);
    this.addWallRecessedPanels(bayZ, hallWidth, wallHeight, wallThickness);
    this.addReflectiveFloorPatches(bayZ, bayWidth, bayLength, bayPedestalY);
    this.addBackWallPartition(hallWidth, wallHeight, showcaseCenterZ, hallLength, hallWallMat);

    // spawnPoint is set to the showcase corridor near the top of this method.
  }

  private createGroundGridTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return new THREE.CanvasTexture(canvas);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1e28';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const majorStep = 256;
    const minorStep = 64;

    // Draw crisp, tileable lines:
    // - avoid drawing outside the canvas bounds (no `<= width`),
    // - draw on pixel centers for stable mipmaps,
    // - then copy border pixels ("wrap pad") so RepeatWrapping is seamless.
    ctx.save();
    ctx.translate(0.5, 0.5);

    ctx.strokeStyle = 'rgba(160, 170, 190, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += minorStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height - 1);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += minorStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width - 1, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(180, 190, 210, 0.30)';
    ctx.lineWidth = 2;
    for (let x = 0; x < canvas.width; x += majorStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height - 1);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += majorStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width - 1, y);
      ctx.stroke();
    }
    ctx.restore();

    // Ensure RepeatWrapping is seamless by matching border texels.
    const wrapPad = 4; // pixels
    const w = canvas.width;
    const h = canvas.height;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const copyPixel = (sx: number, sy: number, dx: number, dy: number): void => {
      const si = (sy * w + sx) * 4;
      const di = (dy * w + dx) * 4;
      d[di + 0] = d[si + 0];
      d[di + 1] = d[si + 1];
      d[di + 2] = d[si + 2];
      d[di + 3] = d[si + 3];
    };
    // Copy left edge band to right edge band
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < wrapPad; x += 1) {
        copyPixel(x, y, w - wrapPad + x, y);
      }
    }
    // Copy top edge band to bottom edge band
    for (let y = 0; y < wrapPad; y += 1) {
      for (let x = 0; x < w; x += 1) {
        copyPixel(x, y, x, h - wrapPad + y);
      }
    }
    ctx.putImageData(img, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(10, 10);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = this.textureAnisotropy;
    texture.needsUpdate = true;
    return texture;
  }

  private createDynamicBox(
    name: string,
    position: THREE.Vector3,
    size: THREE.Vector3,
    material: THREE.Material,
    options?: { grabbable?: boolean },
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${name}_dyn`;
    mesh.userData.grabbable = options?.grabbable === true;
    this.scene.add(mesh);
    this.levelObjects.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    body.enableCcd(true);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setFriction(0.7)
      .setRestitution(0.05)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

    this.levelBodies.push(body);
    this.levelColliders.push(collider);
    this.dynamicBodies.push({
      mesh,
      body,
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
      hasPose: false,
    });
  }

  private createStaircase(
    base: THREE.Vector3,
    stepCount: number,
    rise: number,
    run: number,
    width: number,
    material: THREE.Material,
  ): void {
    for (let i = 0; i < stepCount; i++) {
      const y = base.y + rise * i + rise * 0.5;
      const z = base.z + run * i + run * 0.5;
      const step = new THREE.Mesh(new THREE.BoxGeometry(width, rise, run), material);
      step.position.set(base.x, y, z);
      step.castShadow = true;
      step.receiveShadow = true;
      step.name = `StairStep${i}_col`;
      this.scene.add(step);
      this.levelObjects.push(step);
      step.updateWorldMatrix(true, false);
      this.levelColliders.push(this.colliderFactory.createTrimesh(step));
    }
  }

  private createCrouchCourse(base: THREE.Vector3, material: THREE.Material): void {
    const roofY = base.y + 1.29;
    const wallY = base.y + 0.66;
    const gateY = base.y + 1.28;

    // Replace simple boxes with an arched/angular sci-fi tunnel structure
    // For colliders we still use boxes as they are simple
    this.createStaticColliderBox(
      'CrouchRoof_col',
      new THREE.Vector3(2.8, 0.14, 9.6),
      new THREE.Vector3(base.x, roofY, base.z),
      material,
    );
    this.createStaticColliderBox(
      'CrouchWallL_col',
      new THREE.Vector3(0.18, 1.32, 9.6),
      new THREE.Vector3(base.x - 1.4, wallY, base.z),
      material,
    );
    this.createStaticColliderBox(
      'CrouchWallR_col',
      new THREE.Vector3(0.18, 1.32, 9.6),
      new THREE.Vector3(base.x + 1.4, wallY, base.z),
      material,
    );
    this.createStaticColliderBox(
      'CrouchCeilingGate_col',
      new THREE.Vector3(2.8, 0.24, 0.36),
      new THREE.Vector3(base.x, gateY, base.z - 5.04),
      material,
    );
    this.createStaticColliderBox(
      'CrouchCeilingGateOut_col',
      new THREE.Vector3(2.8, 0.24, 0.36),
      new THREE.Vector3(base.x, gateY, base.z + 5.04),
      material,
    );

    // Visual embellishments (sci-fi arches)
    const archMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.15, roughness: 0.6, emissive: 0x0088ff, emissiveIntensity: 1.5 });
    for (let zOffset = -4; zOffset <= 4; zOffset += 2) {
      const arch = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 0.2), archMat);
      arch.position.set(base.x, base.y + 1.4, base.z + zOffset);
      this.scene.add(arch);
      this.levelObjects.push(arch);
      const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), archMat);
      sideL.position.set(base.x - 1.4, base.y + 0.75, base.z + zOffset);
      this.scene.add(sideL);
      this.levelObjects.push(sideL);
      const sideR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), archMat);
      sideR.position.set(base.x + 1.4, base.y + 0.75, base.z + zOffset);
      this.scene.add(sideR);
      this.levelObjects.push(sideR);
    }
  }

  private createDoubleJumpCourse(base: THREE.Vector3, material: THREE.Material): void {
    this.createStaticColliderBox(
      'DoubleJumpStep0_col',
      new THREE.Vector3(3.2, 0.5, 3.2),
      new THREE.Vector3(base.x, base.y + 0.25, base.z),
      material,
    );
    this.createStaticColliderBox(
      'DoubleJumpStep1_col',
      new THREE.Vector3(2.8, 0.45, 2.8),
      new THREE.Vector3(base.x + 3.2, base.y + 1.3, base.z),
      material,
    );
    this.createStaticColliderBox(
      'DoubleJumpStep2_col',
      new THREE.Vector3(2.6, 0.45, 2.6),
      new THREE.Vector3(base.x + 6.3, base.y + 2.9, base.z),
      material,
    );
    this.createStaticColliderBox(
      'DoubleJumpStep3_col',
      new THREE.Vector3(3.8, 0.5, 3.8),
      new THREE.Vector3(base.x + 10.2, base.y + 4.1, base.z),
      material,
    );
  }

  private createStaticColliderBox(
    name: string,
    size: THREE.Vector3,
    position: THREE.Vector3,
    material: THREE.Material,
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.copy(position);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.levelObjects.push(mesh);
    mesh.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(mesh));
  }

  private createLadder(
    name: string,
    base: THREE.Vector3,
    height: number,
    material: THREE.Material,
  ): void {
    const railGeom = new THREE.BoxGeometry(0.12, height, 0.12);
    const rungGeom = new THREE.BoxGeometry(1.2, 0.08, 0.1);
    const leftRail = new THREE.Mesh(railGeom, material);
    const rightRail = new THREE.Mesh(railGeom, material);
    leftRail.position.set(base.x - 0.6, base.y + height * 0.5, base.z);
    rightRail.position.set(base.x + 0.6, base.y + height * 0.5, base.z);
    leftRail.castShadow = true;
    rightRail.castShadow = true;
    leftRail.receiveShadow = true;
    rightRail.receiveShadow = true;
    this.scene.add(leftRail);
    this.scene.add(rightRail);
    this.levelObjects.push(leftRail, rightRail);

    const rungCount = Math.max(4, Math.floor(height / 0.45));
    for (let i = 0; i < rungCount; i++) {
      const rung = new THREE.Mesh(rungGeom, material);
      rung.position.set(base.x, base.y + 0.4 + i * (height - 0.7) / (rungCount - 1), base.z);
      rung.castShadow = true;
      rung.receiveShadow = true;
      rung.name = `${name}_rung_${i}`;
      this.scene.add(rung);
      this.levelObjects.push(rung);
    }

    const ladderBody = this.physicsWorld.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(base.x, base.y + height * 0.5, base.z - 0.1),
    );
    const ladderCollider = this.physicsWorld.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.8, height * 0.5, 0.08)
        .setFriction(0.7)
        .setCollisionGroups(COLLISION_GROUP_WORLD),
      ladderBody,
    );
    this.levelBodies.push(ladderBody);
    this.levelColliders.push(ladderCollider);

    const ladderZone = new THREE.Box3(
      new THREE.Vector3(base.x - 1.1, base.y - 0.2, base.z - 0.9),
      new THREE.Vector3(base.x + 1.1, base.y + height + 0.4, base.z + 0.9),
    );
    this.ladderZones.push(ladderZone);
  }

  private createSpinningToy(position: THREE.Vector3, material: THREE.Material): void {
    // Truncated cone visual (cylinderGeometry [2.5, 0.2, 0.5]).
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 0.2, 0.5, 24), material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'SpinningToy_dyn';
    this.scene.add(mesh);
    this.levelObjects.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    body.enableCcd(true);

    // Compound collider: thin cylinder stem + ball at center (mass ~1.24)
    const stemDesc = RAPIER.ColliderDesc.cylinder(0.03, 2.5)
      .setTranslation(0, 0.25, 0)
      .setDensity(0)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    const ballDesc = RAPIER.ColliderDesc.ball(0.25)
      .setDensity(0)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    const stemCollider = this.physicsWorld.world.createCollider(stemDesc, body);
    const ballCollider = this.physicsWorld.world.createCollider(ballDesc, body);
    body.setAdditionalMass(1.24, true);

    this.levelBodies.push(body);
    this.levelColliders.push(stemCollider);
    this.levelColliders.push(ballCollider);
    this.dynamicBodies.push({
      mesh,
      body,
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
      hasPose: false,
    });
  }

  private createKinematicPlatform(
    name: string,
    size: THREE.Vector3,
    base: THREE.Vector3,
    mode: 'x' | 'y' | 'rotateY' | 'rotateX' | 'xy' | 'yRotate',
    speed: number,
    amplitude: number,
    material: THREE.Material,
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.copy(base);
    mesh.name = `${name}_col`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.levelObjects.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(base.x, base.y, base.z);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setFriction(0.8)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

    this.levelBodies.push(body);
    this.levelColliders.push(collider);
    this.movingPlatforms.push({
      mesh,
      body,
      base: base.clone(),
      mode,
      speed,
      amplitude,
      rotationOffset: new THREE.Euler(0, 0, 0),
    });
  }

  private createFloatingPlatform(
    name: string,
    size: THREE.Vector3,
    position: THREE.Vector3,
    material: THREE.Material,
    lockConfig?: { lockX: boolean; lockY: boolean; lockZ: boolean; rotX: boolean; rotY: boolean; rotZ: boolean },
    movingConfig?: { minX: number; maxX: number; speedX: number },
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${name}_dyn`;
    this.scene.add(mesh);
    this.levelObjects.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    body.userData = {
      kind: 'floating-platform',
      moving: movingConfig != null,
    };
    body.enableCcd(true);
    if (lockConfig) {
      body.setEnabledTranslations(!lockConfig.lockX, !lockConfig.lockY, !lockConfig.lockZ, true);
      body.setEnabledRotations(lockConfig.rotX, lockConfig.rotY, lockConfig.rotZ, true);
    } else {
      body.lockRotations(true, true);
    }

    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setFriction(0.8)
      .setDensity(0.2)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

    this.levelBodies.push(body);
    this.levelColliders.push(collider);
    this.dynamicBodies.push({
      mesh,
      body,
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
      hasPose: false,
    });
    this.floatingPlatforms.push({
      mesh,
      body,
      rayLength: 0.8,
      floatingDistance: 0.8,
      springK: 2.5,
      dampingC: 0.15,
      moveRangeMinX: movingConfig?.minX,
      moveRangeMaxX: movingConfig?.maxX,
      moveSpeedX: movingConfig?.speedX,
      moveDirectionX: movingConfig ? 1 : undefined,
    });
  }

  private createKinematicDrum(
    name: string,
    base: THREE.Vector3,
    radius: number,
    length: number,
    mode: 'rotateX' | 'rotateY',
    speed: number,
    material: THREE.Material,
  ): void {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24), material);
    mesh.position.copy(base);
    mesh.rotation.z = Math.PI / 2; // align drum
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${name}_col`;
    this.scene.add(mesh);
    this.levelObjects.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(base.x, base.y, base.z)
      .setRotation(new RAPIER.Quaternion(0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)));
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cylinder(length / 2, radius)
      .setFriction(0.8)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

    this.levelBodies.push(body);
    this.levelColliders.push(collider);
    this.movingPlatforms.push({
      mesh,
      body,
      base: base.clone(),
      mode,
      speed,
      amplitude: 0,
      rotationOffset: new THREE.Euler(0, 0, Math.PI / 2),
    });
  }

  /**
   * Navigation showcase bay: creates a dedicated platform, generates a navmesh from it,
   * and spawns patrol agents constrained to the navigation station area.
   */
  private createNavcatBay(zStation: number, bayTopY: number): void {
    // Dedicated navigation platform — agents are confined to this area only.
    const platformWidth = 24;
    const platformDepth = 20;
    const platformThickness = 0.12;
    const platformY = bayTopY + 0.01; // sits just above the bay pedestal
    const surfaceY = platformY + platformThickness / 2;

    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x1e2d3d,
      roughness: 0.55,
      metalness: 0.15,
    });
    const navPlatform = new THREE.Mesh(
      new THREE.BoxGeometry(platformWidth, platformThickness, platformDepth),
      platformMat,
    );
    navPlatform.position.set(0, platformY, zStation);
    navPlatform.receiveShadow = true;
    navPlatform.name = 'NavPlatform';
    this.scene.add(navPlatform);
    this.levelObjects.push(navPlatform);

    // --- Obstacles for navmesh carving ---
    const obstacleH = 1.2;
    const obstacleMat = new THREE.MeshStandardMaterial({
      color: 0x2a3a4a,
      roughness: 0.4,
      metalness: 0.3,
    });
    const obstacleAccent = new THREE.MeshStandardMaterial({
      color: 0x334455,
      roughness: 0.35,
      metalness: 0.4,
      emissive: 0x112233,
      emissiveIntensity: 0.4,
    });

    const obstacles: THREE.Mesh[] = [];
    const addObstacle = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.levelObjects.push(mesh);
      obstacles.push(mesh);
    };

    // L-wall: horizontal arm + vertical arm
    const lWallH = new THREE.Mesh(new THREE.BoxGeometry(4, obstacleH, 0.4), obstacleMat);
    lWallH.position.set(-3, surfaceY + obstacleH / 2, zStation - 1);
    lWallH.name = 'NavObstacle_LWallH';
    addObstacle(lWallH);

    const lWallV = new THREE.Mesh(new THREE.BoxGeometry(0.4, obstacleH, 3), obstacleMat);
    lWallV.position.set(-5, surfaceY + obstacleH / 2, zStation + 0.5);
    lWallV.name = 'NavObstacle_LWallV';
    addObstacle(lWallV);

    // Horizontal wall (back area)
    const hWall = new THREE.Mesh(new THREE.BoxGeometry(5, obstacleH, 0.4), obstacleAccent);
    hWall.position.set(5, surfaceY + obstacleH / 2, zStation - 4);
    hWall.name = 'NavObstacle_HWall';
    addObstacle(hWall);

    // Vertical wall (front area)
    const vWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, obstacleH, 4), obstacleAccent);
    vWall.position.set(-7, surfaceY + obstacleH / 2, zStation + 3);
    vWall.name = 'NavObstacle_VWall';
    addObstacle(vWall);

    // Column A (back-left)
    const colA = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 12), obstacleMat);
    colA.position.set(-4, surfaceY + 1.5 / 2, zStation - 5);
    colA.name = 'NavObstacle_ColA';
    addObstacle(colA);

    // Column B (front-right)
    const colB = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 12), obstacleMat);
    colB.position.set(6, surfaceY + 1.5 / 2, zStation + 2);
    colB.name = 'NavObstacle_ColB';
    addObstacle(colB);

    // Ensure world matrices are up to date for geometry extraction
    navPlatform.updateWorldMatrix(true, false);
    for (const obs of obstacles) obs.updateWorldMatrix(true, false);

    // Add physics colliders so the player can't walk through obstacles
    for (const obs of obstacles) {
      this.levelColliders.push(this.colliderFactory.createTrimesh(obs));
    }

    // Create a padded invisible platform for navmesh generation.
    // walkableRadiusVoxels * cellSize = 2 * 0.15 = 0.3 erosion per side;
    // padding compensates so the resulting navmesh matches the visual platform.
    const erosionPad = 0.3;
    const navInputGeo = new THREE.BoxGeometry(
      platformWidth + erosionPad * 2,
      platformThickness,
      platformDepth + erosionPad * 2,
    );
    const navInputMesh = new THREE.Mesh(navInputGeo);
    navInputMesh.position.copy(navPlatform.position);
    navInputMesh.updateWorldMatrix(true, false);

    // Generate navmesh from padded platform + all obstacles
    this.navMeshManager = new NavMeshManager();
    this.navMeshManager.generate([navInputMesh, ...obstacles]);
    navInputGeo.dispose();

    const navMesh = this.navMeshManager.getNavMesh();
    if (!navMesh) {
      console.warn('[LevelManager] Failed to generate navmesh for navigation bay');
      return;
    }

    this.navPatrolSystem = new NavPatrolSystem(this.scene, navMesh, 5);
    this.navDebugOverlay = new NavDebugOverlay(this.scene, this.navMeshManager);
  }

  // ---------------------------------------------------------------------------
  // Visual polish helpers
  // ---------------------------------------------------------------------------

  /** Thin emissive strip running the full corridor length at center. */
  private addFloorCenterline(hallLength: number, centerZ: number): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xaa8800,
      emissive: 0xddbb33,
      emissiveIntensity: 1.2,
      roughness: 0.3,
    });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, hallLength), mat);
    strip.position.set(0, -0.99, centerZ);
    strip.name = 'FloorCenterline';
    strip.receiveShadow = false;
    strip.castShadow = false;
    this.scene.add(strip);
    this.levelObjects.push(strip);
  }

  /** Emissive strip at front edge of each bay pedestal, colors warm→cool. */
  private addBayAccentBorders(
    bayZ: number[],
    bayWidth: number,
    bayLength: number,
    pedestalY: number,
    pedestalHeight: number,
  ): void {
    const count = bayZ.length;
    if (count === 0) return;
    const geo = new THREE.BoxGeometry(bayWidth - 2, 0.04, 0.12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      emissive: 0xffffff,
      emissiveIntensity: 0.8,
      roughness: 0.3,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = 'BayAccentBorders';
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const warmColor = new THREE.Color(0x3388dd);
    const coolColor = new THREE.Color(0x3388dd);
    const dummy = new THREE.Object3D();
    const topY = pedestalY + pedestalHeight * 0.5 + 0.02;

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      dummy.position.set(0, topY, bayZ[i] + bayLength / 2 - 0.05);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new THREE.Color().lerpColors(warmColor, coolColor, t));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
    this.levelObjects.push(mesh);
  }

  /** Baseboard and ceiling trim strips at wall-floor / wall-ceiling junctions. */
  private addCorridorTrim(
    hallWidth: number,
    wallHeight: number,
    hallLength: number,
    centerZ: number,
    wallThickness: number,
  ): void {
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x4a6090, roughness: 0.7, metalness: 0.05 });
    const trimHeight = 0.18;
    const trimDepth = 0.12;
    const floorY = -1.0 + trimHeight / 2;
    const ceilingY = -1.0 + wallHeight - trimHeight / 2;
    const halfW = hallWidth / 2 + wallThickness / 2 - trimDepth / 2;

    const positions = [
      { x: -halfW, y: floorY, label: 'BaseboardL' },
      { x: halfW, y: floorY, label: 'BaseboardR' },
      { x: -halfW, y: ceilingY, label: 'CeilingTrimL' },
      { x: halfW, y: ceilingY, label: 'CeilingTrimR' },
    ];

    for (const p of positions) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(trimDepth, trimHeight, hallLength), trimMat);
      strip.position.set(p.x, p.y, centerZ);
      strip.name = p.label;
      strip.castShadow = false;
      strip.receiveShadow = false;
      this.scene.add(strip);
      this.levelObjects.push(strip);
    }
  }

  /** Subtle vertical extrusions at bay boundaries along both walls. */
  private addWallPilasters(
    bayZ: number[],
    hallWidth: number,
    wallHeight: number,
    wallThickness: number,
  ): void {
    const count = bayZ.length;
    if (count === 0) return;
    const pilasterWidth = 0.5;
    const pilasterDepth = 0.2;
    const pilasterHeight = wallHeight - 0.4;
    const geo = new THREE.BoxGeometry(pilasterDepth, pilasterHeight, pilasterWidth);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4060a0, roughness: 0.7, metalness: 0.05 });

    // 2 instanced meshes: left wall and right wall.
    const halfW = hallWidth / 2 + wallThickness / 2 - pilasterDepth / 2;
    const yCenter = -1.0 + pilasterHeight / 2 + 0.2;

    for (const side of [-1, 1]) {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.name = side < 0 ? 'PilastersL' : 'PilastersR';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        dummy.position.set(side * halfW, yCenter, bayZ[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.levelObjects.push(mesh);
    }
  }

  private addEntranceFrame(
    hallWidth: number,
    wallHeight: number,
    hallLength: number,
    centerZ: number,
  ): void {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a5080, roughness: 0.55, metalness: 0.15, emissive: 0x2244aa, emissiveIntensity: 0.3 });
    const pillarW = 1.2;
    const pillarD = 0.8;
    const pillarH = 14.0;
    // Place entrance frame near the spawn point (player spawns at hallLength/2 - 160)
    const entranceZ = centerZ + hallLength / 2 - 165;
    const halfW = hallWidth / 2 - pillarW / 2 - 1.0;
    const pillarY = -1.0 + pillarH / 2;

    // Left pillar
    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(pillarW, pillarH, pillarD), frameMat);
    leftPillar.position.set(-halfW, pillarY, entranceZ);
    leftPillar.name = 'EntrancePillarL';
    leftPillar.castShadow = true;
    leftPillar.receiveShadow = true;
    this.scene.add(leftPillar);
    this.levelObjects.push(leftPillar);

    // Right pillar
    const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(pillarW, pillarH, pillarD), frameMat);
    rightPillar.position.set(halfW, pillarY, entranceZ);
    rightPillar.name = 'EntrancePillarR';
    rightPillar.castShadow = true;
    rightPillar.receiveShadow = true;
    this.scene.add(rightPillar);
    this.levelObjects.push(rightPillar);

    // Emissive accent strips on pillars (vertical glowing lines)
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x3388dd, emissive: 0x3388dd, emissiveIntensity: 1.5, roughness: 0.2 });
    for (const sideX of [-halfW, halfW]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, pillarH - 1.0, 0.06), accentMat);
      strip.position.set(sideX, pillarY, entranceZ + pillarD / 2 + 0.04);
      strip.castShadow = false;
      strip.receiveShadow = false;
      this.scene.add(strip);
      this.levelObjects.push(strip);
    }

    // Lintel (thicker, grander)
    const lintelW = halfW * 2 + pillarW;
    const lintelH = 0.8;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(lintelW, lintelH, pillarD), frameMat);
    lintel.position.set(0, pillarY + pillarH / 2 + lintelH / 2, entranceZ);
    lintel.name = 'EntranceLintel';
    lintel.castShadow = true;
    lintel.receiveShadow = true;
    this.scene.add(lintel);
    this.levelObjects.push(lintel);

    // Emissive underside glow on lintel
    const undersideMat = new THREE.MeshStandardMaterial({ color: 0xd8e0f0, emissive: 0xd8e0f0, emissiveIntensity: 1.2, roughness: 0.3 });
    const underside = new THREE.Mesh(new THREE.BoxGeometry(lintelW - 2, 0.05, pillarD - 0.2), undersideMat);
    underside.position.set(0, pillarY + pillarH / 2 - 0.03, entranceZ);
    underside.castShadow = false;
    underside.receiveShadow = false;
    this.scene.add(underside);
    this.levelObjects.push(underside);

    // Branding label above the entrance
    this.createSectionLabel(
      'KINEMA\nThird-Person Controller Showcase',
      new THREE.Vector3(0, pillarY + pillarH / 2 + lintelH + 1.4, entranceZ + 0.3),
      14,
      3.6,
    );

    // Extra entrance spotlight for brighter spawn area
    const spot = new THREE.SpotLight(0xe8f0ff, 60, 35, Math.PI / 4, 0.5, 1.5);
    spot.position.set(0, -1.0 + wallHeight - 0.6, entranceZ - 2);
    spot.target.position.set(0, -1.0, entranceZ);
    spot.castShadow = false;
    spot.name = 'EntranceSpot';
    this.scene.add(spot);
    this.scene.add(spot.target);
    this.levelObjects.push(spot);
    this.levelObjects.push(spot.target);
  }

  /** Thin dark grooves on the floor at bay boundaries. */
  private addFloorBayGrooves(bayZ: number[], hallWidth: number, bayLength: number): void {
    const count = bayZ.length;
    if (count === 0) return;
    // Two grooves per bay (front + back edge) = 2 * count instances.
    const instanceCount = count * 2;
    const geo = new THREE.BoxGeometry(hallWidth - 2, 0.02, 0.06);
    const mat = new THREE.MeshStandardMaterial({ color: 0x0e1018, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(geo, mat, instanceCount);
    mesh.name = 'FloorBayGrooves';
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const dummy = new THREE.Object3D();
    const grooveY = -0.99;
    const halfBay = bayLength / 2;

    for (let i = 0; i < count; i++) {
      // Front edge
      dummy.position.set(0, grooveY, bayZ[i] + halfBay);
      dummy.updateMatrix();
      mesh.setMatrixAt(i * 2, dummy.matrix);
      // Back edge
      dummy.position.set(0, grooveY, bayZ[i] - halfBay);
      dummy.updateMatrix();
      mesh.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.levelObjects.push(mesh);
  }

  /** Emissive accent strips at 1m and 3m height on both corridor walls. */
  private addWallEmissiveStrips(
    hallWidth: number,
    hallLength: number,
    centerZ: number,
    wallThickness: number,
  ): void {
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x2255aa,
      emissive: 0x3366bb,
      emissiveIntensity: 0.8,
      roughness: 0.3,
    });
    const stripHeight = 0.06;
    const stripDepth = 0.04;
    const halfW = hallWidth / 2 + wallThickness / 2 - stripDepth / 2;

    // Two strips per side at different heights
    for (const yOffset of [1.0, 3.0]) {
      const y = -1.0 + yOffset;
      for (const side of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(stripDepth, stripHeight, hallLength), stripMat);
        strip.position.set(side * halfW, y, centerZ);
        strip.name = `WallStrip${side < 0 ? 'L' : 'R'}_${yOffset}m`;
        strip.castShadow = false;
        strip.receiveShadow = false;
        this.scene.add(strip);
        this.levelObjects.push(strip);
      }
    }

    // Floor edge glow strips along both walls
    const floorGlowMat = new THREE.MeshStandardMaterial({
      color: 0xaa8800,
      emissive: 0xccaa22,
      emissiveIntensity: 0.8,
      roughness: 0.3,
    });
    const floorGlowY = -0.99;
    const floorGlowHalfW = hallWidth / 2 - 0.15;
    for (const side of [-1, 1]) {
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, hallLength), floorGlowMat);
      glow.position.set(side * floorGlowHalfW, floorGlowY, centerZ);
      glow.name = `FloorEdgeGlow${side < 0 ? 'L' : 'R'}`;
      glow.castShadow = false;
      glow.receiveShadow = false;
      this.scene.add(glow);
      this.levelObjects.push(glow);
    }
  }

  /** Gentle floating dust motes throughout the corridor. */
  private addDustMotes(hallWidth: number, hallLength: number, centerZ: number): void {
    const circleTexture = this.createCircleTexture();
    const moteMat = new THREE.SpriteMaterial({
      color: 0xe0e8ff,
      map: circleTexture,
      transparent: true,
      opacity: 0.15,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    moteMat.premultipliedAlpha = false;

    const count = 60;
    const halfW = hallWidth / 2 - 1;
    const halfL = hallLength / 2 - 2;

    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(moteMat.clone());
      const s = 0.08 + Math.random() * 0.15;
      sprite.scale.set(s, s, 1);
      const x = (Math.random() - 0.5) * 2 * halfW;
      const y = 0.5 + Math.random() * 5.5;
      const z = centerZ + (Math.random() - 0.5) * 2 * halfL;
      sprite.position.set(x, y, z);
      sprite.name = `DustMote_${i}`;
      sprite.renderOrder = 2;
      this.scene.add(sprite);
      this.levelObjects.push(sprite);
      this.dustMotes.push({
        sprite,
        origin: sprite.position.clone(),
        speed: 0.3 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /** Structural archway frames every ~60 units to break infinite-corridor look. */
  private addBulkheadFrames(hallWidth: number, wallHeight: number, centerZ: number): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a5080, roughness: 0.55, metalness: 0.15,
      emissive: 0x2244aa, emissiveIntensity: 0.2,
    });
    const postW = 0.4, postD = 0.3;
    const beamH = 0.4;
    const halfW = hallWidth / 2;
    const floorY = -1.0;
    // Place at z=150, 90, 30, -30, -90, -150, -210 (every 60 units)
    for (let z = 150; z >= -210; z -= 60) {
      // Left post
      const leftPost = new THREE.Mesh(new THREE.BoxGeometry(postW, wallHeight, postD), mat);
      leftPost.position.set(-halfW + postW / 2 + 0.3, floorY + wallHeight / 2, centerZ + z);
      leftPost.name = `Bulkhead_L_${z}`;
      leftPost.receiveShadow = true;
      this.scene.add(leftPost);
      this.levelObjects.push(leftPost);
      // Right post
      const rightPost = new THREE.Mesh(new THREE.BoxGeometry(postW, wallHeight, postD), mat);
      rightPost.position.set(halfW - postW / 2 - 0.3, floorY + wallHeight / 2, centerZ + z);
      rightPost.name = `Bulkhead_R_${z}`;
      rightPost.receiveShadow = true;
      this.scene.add(rightPost);
      this.levelObjects.push(rightPost);
      // Horizontal beam
      const beam = new THREE.Mesh(new THREE.BoxGeometry(hallWidth - 1.0, beamH, postD), mat);
      beam.position.set(0, floorY + wallHeight - beamH / 2 - 0.2, centerZ + z);
      beam.name = `Bulkhead_Beam_${z}`;
      beam.receiveShadow = true;
      this.scene.add(beam);
      this.levelObjects.push(beam);
    }
  }

  /** Emissive edge strips around each bay pedestal for definition. */
  private addBayPedestalEdgeGlow(
    bayZ: number[], bayWidth: number, bayLength: number,
    bayPedestalY: number, bayPedestalHeight: number,
  ): void {
    const topY = bayPedestalY + bayPedestalHeight / 2 + 0.015;
    const stripH = 0.03;
    const stripW = 0.08;
    const warmColor = new THREE.Color(0x3388dd);
    const coolColor = new THREE.Color(0x3388dd);

    bayZ.forEach((z, i) => {
      const t = bayZ.length > 1 ? i / (bayZ.length - 1) : 0;
      const emissiveColor = new THREE.Color().lerpColors(warmColor, coolColor, t);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x222222, emissive: emissiveColor, emissiveIntensity: 1.0,
        roughness: 0.3, metalness: 0.1,
      });
      // Front edge
      const front = new THREE.Mesh(new THREE.BoxGeometry(bayWidth - 1, stripH, stripW), mat);
      front.position.set(0, topY, z + bayLength / 2 - stripW / 2);
      front.name = `BayEdge_F_${i}`;
      this.scene.add(front);
      this.levelObjects.push(front);
      // Back edge
      const back = new THREE.Mesh(new THREE.BoxGeometry(bayWidth - 1, stripH, stripW), mat);
      back.position.set(0, topY, z - bayLength / 2 + stripW / 2);
      back.name = `BayEdge_B_${i}`;
      this.scene.add(back);
      this.levelObjects.push(back);
      // Left edge
      const left = new THREE.Mesh(new THREE.BoxGeometry(stripW, stripH, bayLength - 1), mat);
      left.position.set(-(bayWidth / 2) + stripW / 2 + 0.5, topY, z);
      left.name = `BayEdge_L_${i}`;
      this.scene.add(left);
      this.levelObjects.push(left);
      // Right edge
      const right = new THREE.Mesh(new THREE.BoxGeometry(stripW, stripH, bayLength - 1), mat);
      right.position.set(bayWidth / 2 - stripW / 2 - 0.5, topY, z);
      right.name = `BayEdge_R_${i}`;
      this.scene.add(right);
      this.levelObjects.push(right);
    });
  }

  /** Focused SpotLight per bay for hero illumination. */
  private addHeroSpotlights(bayZ: number[], bayPedestalY: number): void {
    // Themed colors for specific bays; neutral white for most
    const bayColors: Record<number, number> = {};
    // VFX bay at index 11 gets warm orange, materials at 10 gets cool cyan
    bayColors[11] = 0xfff0dd;
    bayColors[10] = 0xd8e8ff;
    bayZ.forEach((z, i) => {
      const color = bayColors[i] ?? 0xffeedd;
      const light = new THREE.SpotLight(color, 20, 14, 0.5, 0.6);
      light.position.set(0, bayPedestalY + 8, z);
      light.target.position.set(0, bayPedestalY, z);
      light.castShadow = false;
      light.name = `HeroSpot_${i}`;
      this.scene.add(light);
      this.scene.add(light.target);
      this.levelObjects.push(light);
    });
  }

  /** Shallow recessed wall panels between bays for architectural detail. */
  private addWallRecessedPanels(
    bayZ: number[], hallWidth: number, _wallHeight: number, wallThickness: number,
  ): void {
    const panelW = 4, panelH = 3, panelD = 0.08;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8090a8, roughness: 0.7, metalness: 0.1 });
    const recessMat = new THREE.MeshStandardMaterial({
      color: 0x606878, roughness: 0.85, metalness: 0.05,
      emissive: 0x4466aa, emissiveIntensity: 0.2,
    });
    const halfW = hallWidth / 2;
    const panelY = -1.0 + 4; // Eye-level
    // Place a panel between each pair of consecutive bays
    for (let i = 0; i < bayZ.length - 1; i++) {
      const midZ = (bayZ[i] + bayZ[i + 1]) / 2;
      for (const side of [-1, 1]) {
        const wallX = side * (halfW - wallThickness / 2);
        // Outer frame
        const frame = new THREE.Mesh(new THREE.BoxGeometry(panelD, panelH + 0.2, panelW + 0.2), frameMat);
        frame.position.set(wallX + side * 0.04, panelY, midZ);
        frame.name = `WallPanel_F_${i}_${side > 0 ? 'R' : 'L'}`;
        this.scene.add(frame);
        this.levelObjects.push(frame);
        // Inner recess (slightly inset)
        const recess = new THREE.Mesh(new THREE.BoxGeometry(panelD, panelH, panelW), recessMat);
        recess.position.set(wallX + side * 0.08, panelY, midZ);
        recess.name = `WallPanel_R_${i}_${side > 0 ? 'R' : 'L'}`;
        this.scene.add(recess);
        this.levelObjects.push(recess);
      }
    }
  }

  /** Reflective floor patches in front of each bay for SSR showcase. */
  private addReflectiveFloorPatches(
    bayZ: number[], bayWidth: number, bayLength: number, _bayPedestalY: number,
  ): void {
    const floorY = -1.0 + 0.005; // Just above hall floor surface
    const patchMat = new THREE.MeshStandardMaterial({
      color: 0x1a1e28, roughness: 0.08, metalness: 0.85,
    });
    bayZ.forEach((z, i) => {
      const patch = new THREE.Mesh(new THREE.BoxGeometry(bayWidth - 4, 0.02, 3), patchMat);
      patch.position.set(0, floorY, z + bayLength / 2 + 2);
      patch.receiveShadow = true;
      patch.name = `FloorPatch_${i}`;
      this.scene.add(patch);
      this.levelObjects.push(patch);
    });
  }

  /** Ground-hugging fog sprites for atmospheric depth. */
  /** Solid wall behind spawn to close off the empty corridor end. */
  private addBackWallPartition(
    hallWidth: number, wallHeight: number, centerZ: number,
    hallLength: number, wallMat: THREE.Material,
  ): void {
    const spawnZ = centerZ + hallLength / 2 - 160;
    const wallZ = spawnZ + 10; // 10 units behind spawn
    const floorY = -1.0;
    // Main wall
    const wall = new THREE.Mesh(new THREE.BoxGeometry(hallWidth - 1.2, wallHeight, 0.6), wallMat);
    wall.position.set(0, floorY + wallHeight / 2, wallZ);
    wall.receiveShadow = true;
    wall.name = 'BackWallPartition_col';
    this.scene.add(wall);
    this.levelObjects.push(wall);
    wall.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(wall));
    // Emissive accent strip on the player-facing side
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x3366aa, emissive: 0x3388dd, emissiveIntensity: 0.8,
      roughness: 0.3, metalness: 0.1,
    });
    const accent = new THREE.Mesh(new THREE.BoxGeometry(hallWidth - 4, 0.06, 0.02), accentMat);
    accent.position.set(0, floorY + 1.0, wallZ - 0.32);
    accent.name = 'BackWallAccent';
    this.scene.add(accent);
    this.levelObjects.push(accent);
  }

  private createSectionLabel(
    text: string,
    position: THREE.Vector3,
    scaleX = 9.6,
    scaleY = 2.7,
  ): void {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const logicalWidth = 1440;
    const logicalHeight = 420;
    const panelPad = 56;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(logicalWidth * dpr);
    canvas.height = Math.floor(logicalHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    // Dark panel with warm accent border (closer to Unity/Unreal sample signage).
    const panelX = panelPad;
    const panelY = 86;
    const panelW = logicalWidth - panelPad * 2;
    const panelH = logicalHeight - 172;
    // Clean Sci-fi Theme for UI Panels
    ctx.fillStyle = 'rgba(20, 30, 50, 0.80)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = 'rgba(60, 130, 220, 0.86)';
    ctx.lineWidth = 6;
    ctx.strokeRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = 'rgba(200, 180, 50, 0.4)';
    ctx.lineWidth = 3;
    ctx.strokeRect(panelX + 10, panelY + 10, panelW - 20, panelH - 20);

    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const header = lines[0] ?? '';
    const headerMatch = header.match(/^(\S+)\s+(.*)$/);
    const headerCode = headerMatch?.[1] ?? null;
    const headerTitle = headerMatch?.[2] ?? header;
    const bodyLines = lines.slice(1);

    const headerFontPx = 86;
    const bodyFontPx = bodyLines.length > 0 ? 60 : 76;
    const headerLineHeight = headerFontPx * 1.05;
    const bodyLineHeight = bodyFontPx * 1.05;

    // Measure widths to compute a single horizontal scale factor.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const contentX = panelX + 56;
    const availableTextWidth = panelX + panelW - contentX - 56;
    ctx.font = `800 ${headerFontPx}px Segoe UI, Arial, sans-serif`;
    const headerWidth =
      headerCode && headerTitle
        ? ctx.measureText(`${headerCode}  ${headerTitle}`).width
        : ctx.measureText(headerTitle).width;
    ctx.font = `600 ${bodyFontPx}px Segoe UI, Arial, sans-serif`;
    const bodyWidths = bodyLines.map((l) => ctx.measureText(l).width);
    const maxLineWidth = Math.max(1, headerWidth, ...bodyWidths);
    const scaleFactor = Math.min(1, availableTextWidth / maxLineWidth);

    const totalHeight = headerLineHeight + bodyLineHeight * bodyLines.length;
    const startY = (logicalHeight - totalHeight) / 2 + headerLineHeight / 2;

    ctx.save();
    ctx.translate(contentX, 0);
    ctx.scale(scaleFactor, 1);
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 10;

    // Header: draw "code" in accent + title in white.
    ctx.font = `800 ${headerFontPx}px Segoe UI, Arial, sans-serif`;
    if (headerCode) {
      const code = `${headerCode}`;
      const codeWidth = ctx.measureText(`${code}  `).width;
      ctx.fillStyle = '#5599dd';
      ctx.fillText(code, 0, startY);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`  ${headerTitle}`, codeWidth, startY);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(headerTitle, 0, startY);
    }

    // Body: smaller, slightly muted.
    ctx.shadowBlur = 6;
    ctx.font = `600 ${bodyFontPx}px Segoe UI, Arial, sans-serif`;
    ctx.fillStyle = 'rgba(233, 238, 250, 0.92)';
    const bodyStartY = startY + headerLineHeight / 2 + bodyLineHeight / 2;
    for (let i = 0; i < bodyLines.length; i += 1) {
      ctx.fillText(bodyLines[i], 0, bodyStartY + i * bodyLineHeight);
    }
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // WHY: Mipmaps + transparent edges can bleed and create large faint quads.
    // Labels are close-range dev signage, so disable mipmaps for clean blending.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = this.textureAnisotropy;
    // NOTE: Keep straight alpha; this is more consistent across WebGL/WebGPU for SpriteMaterial.
    texture.premultiplyAlpha = false;
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map: texture,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    });
    material.premultipliedAlpha = false;
    // NOTE: Avoid CustomBlending for broad WebGPU compatibility.
    material.blending = THREE.NormalBlending;
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(scaleX, scaleY, 1);
    sprite.name = `Label_${text.slice(0, 18)}`;
    sprite.renderOrder = 20;
    this.scene.add(sprite);
    this.levelObjects.push(sprite);
  }

  private addLighting(): void {
    // Slightly lower ambient for more depth/contrast in the showcase corridor.
    const ambientLight = new THREE.AmbientLight(0xfff8f0, 0.70);
    ambientLight.name = '__kinema_ambient';
    this.scene.add(ambientLight);
    this.levelObjects.push(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffeedd, 0xb0b8cc, 0.50);
    hemiLight.name = '__kinema_hemilight';
    this.scene.add(hemiLight);
    this.levelObjects.push(hemiLight);

    // Warm key light for friendlier materials.
    const dirLight = new THREE.DirectionalLight(0xfff4e0, 2.2);
    dirLight.position.set(20, 30, 10);
    dirLight.castShadow = this.shadowsEnabled;
    const shadowSize = this.getShadowMapSize();
    dirLight.shadow.mapSize.set(shadowSize, shadowSize);
    dirLight.shadow.normalBias = 0.02;
    dirLight.shadow.bias = -0.00012;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 90;
    dirLight.shadow.camera.left = -22;
    dirLight.shadow.camera.right = 22;
    dirLight.shadow.camera.top = 22;
    dirLight.shadow.camera.bottom = -22;
    dirLight.shadow.radius = 2;
    dirLight.shadow.blurSamples = 8;
    dirLight.name = '__kinema_dirlight';

    const lightTarget = new THREE.Object3D();
    lightTarget.position.set(0, 1, 0);
    lightTarget.name = '__kinema_dirlight_target';
    this.scene.add(lightTarget);
    this.levelObjects.push(lightTarget);
    dirLight.target = lightTarget;

    this.scene.add(dirLight);
    this.levelObjects.push(dirLight);
    this.dirLight = dirLight;
    this.dirLightTarget = lightTarget;
    this.lightFollowPos.copy(dirLight.position);
    this.lightTargetPos.copy(lightTarget.position);
    this.applyDirectionalLightQuality();
    if (this.lightDebugEnabled) {
      this.ensureLightHelpers();
    }
  }

  private getShadowMapSize(): number {
    if (this.graphicsProfile === 'performance') return 1024;
    if (this.graphicsProfile === 'balanced') return 2048;
    return 4096; // cinematic
  }

  private applyDirectionalLightQuality(): void {
    if (!this.dirLight) return;
    // Keep castShadow stable; enable/disable shadowing via renderer.shadowMap.enabled instead.
    this.dirLight.castShadow = true;
    this.dirLight.shadow.autoUpdate = this.shadowsEnabled;
    if (!this.shadowsEnabled) {
      this.updateDebugHelpers();
      return;
    }
    const size = this.getShadowMapSize();
    this.dirLight.shadow.mapSize.set(size, size);
    this.dirLight.shadow.needsUpdate = true;
    this.updateDebugHelpers();
  }

  private ensureLightHelpers(): void {
    // Rebuild helpers to reflect the full light set (and any runtime changes).
    this.removeLightHelpers();

    this.scene.traverse((obj) => {
      if (!(obj as unknown as { isLight?: boolean }).isLight) return;
      const light = obj as unknown as THREE.Light & {
        isAmbientLight?: boolean;
        isDirectionalLight?: boolean;
        isPointLight?: boolean;
        isSpotLight?: boolean;
        isHemisphereLight?: boolean;
        castShadow?: boolean;
        distance?: number;
        decay?: number;
      };
      if (light.isAmbientLight) return;

      let helper: THREE.Object3D | null = null;
      if (light.isDirectionalLight) {
        helper = new THREE.DirectionalLightHelper(light as unknown as THREE.DirectionalLight, 2.2, 0xffcc66);
      } else if (light.isPointLight) {
        helper = new THREE.PointLightHelper(light as unknown as THREE.PointLight, 0.55, 0xffcc66);
      } else if (light.isSpotLight) {
        helper = new THREE.SpotLightHelper(light as unknown as THREE.SpotLight, 0xffcc66);
      } else if (light.isHemisphereLight) {
        helper = new THREE.HemisphereLightHelper(light as unknown as THREE.HemisphereLight, 1.6, 0xffcc66);
      }

      if (helper) {
        helper.userData.__kinemaLightHelper = true;
        this.scene.add(helper);
        this.lightHelpers.push(helper);
      }

      // Range visualization (radius) for local lights with finite distance.
      const distance = (light as unknown as { distance?: number }).distance ?? 0;
      if ((light.isPointLight || light.isSpotLight) && distance > 0) {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(1, 16, 12),
          new THREE.MeshBasicMaterial({
            color: light.color,
            wireframe: true,
            transparent: true,
            opacity: 0.22,
            depthTest: false,
          }),
        );
        sphere.userData.__kinemaLightHelper = true;
        sphere.userData.__kinemaLightRef = light;
        sphere.renderOrder = 9999;
        sphere.scale.setScalar(distance);
        sphere.position.copy((light as unknown as { position: THREE.Vector3 }).position);
        this.scene.add(sphere);
        this.lightHelpers.push(sphere);
      }
    });

    this.updateDebugHelpers();
  }

  private removeLightHelpers(): void {
    for (const helper of this.lightHelpers) {
      this.scene.remove(helper);
      (helper as unknown as { dispose?: () => void }).dispose?.();
      if (helper instanceof THREE.Mesh) {
        helper.geometry.dispose();
        (helper.material as THREE.Material).dispose();
      }
    }
    this.lightHelpers = [];
    // Light helpers previously included the directional shadow camera helper; keep that under the
    // dedicated shadow frustum toggle now.
    if (!this.shadowDebugEnabled) {
      this.removeShadowHelpers();
    }
  }

  private ensureShadowHelpers(): void {
    this.removeShadowHelpers();

    this.scene.traverse((obj) => {
      if (!(obj as unknown as { isLight?: boolean }).isLight) return;
      const light = obj as unknown as THREE.Light & {
        castShadow?: boolean;
        shadow?: { camera?: THREE.Camera };
      };
      if (!light.castShadow) return;
      const camera = light.shadow?.camera;
      if (!camera) return;
      const helper = new THREE.CameraHelper(camera);
      helper.userData.__kinemaLightHelper = true;
      this.scene.add(helper);
      this.shadowFrustumHelpers.push(helper);
    });

    this.updateDebugHelpers();
  }

  private removeShadowHelpers(): void {
    for (const helper of this.shadowFrustumHelpers) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.shadowFrustumHelpers = [];
  }

  private updateDebugHelpers(): void {
    if (this.lightDebugEnabled) {
      for (const helper of this.lightHelpers) {
        (helper as unknown as { update?: () => void }).update?.();
        const ref = (helper.userData?.__kinemaLightRef ?? null) as (THREE.Object3D | null);
        if (ref && helper instanceof THREE.Mesh) {
          helper.position.copy(ref.position);
          helper.updateWorldMatrix(true, false);
        }
      }
    }
    if (this.shadowDebugEnabled) {
      for (const helper of this.shadowFrustumHelpers) {
        helper.update();
      }
    }
  }

  dispose(): void {
    this.unload();
    this.assetLoader.clearAll();
  }

  private createMaterialsBay(base: THREE.Vector3, bayWidth: number, fallbackMaterial: THREE.Material): void {
    const frontZ = base.z + 3;
    const backZ = base.z - 2;
    const xSpan = Math.max(8, bayWidth - 12);
    const spacing = xSpan / 5;
    const startX = -xSpan / 2 + spacing * 0.5;

    // --- Materials ---
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xbfe9ff, roughness: 0.05, metalness: 0,
      transmission: 1, thickness: 0.35, ior: 1.45, transparent: true, opacity: 0.7,
    });
    const mirror = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.35, metalness: 1 });
    const ceramic = new THREE.MeshPhysicalMaterial({
      color: 0xf5f0e8, roughness: 0.25, metalness: 0, clearcoat: 1.0, clearcoatRoughness: 0.08,
    });
    const emissiveGreen = new THREE.MeshStandardMaterial({
      color: 0x222222, roughness: 0.55, metalness: 0.05,
      emissive: 0x44ff99, emissiveIntensity: 1.8,
    });
    this.animatedMaterials.push({ mat: emissiveGreen, baseIntensity: 1.8, speed: 2.2 });

    const rough = new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.95, metalness: 0 });
    const metallic = new THREE.MeshStandardMaterial({ color: 0x9aa7b0, roughness: 0.18, metalness: 1 });
    const brushed = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.72, metalness: 0.9 });
    const iridescent = new THREE.MeshPhysicalMaterial({
      color: 0xccccdd, roughness: 0.15, metalness: 0.1,
      iridescence: 1.0, iridescenceIOR: 1.3,
    });
    const lava = new THREE.MeshStandardMaterial({
      color: 0x331100, roughness: 0.6, metalness: 0.1,
      emissive: 0xff4400, emissiveIntensity: 2.5,
    });
    this.animatedMaterials.push({ mat: lava, baseIntensity: 2.5, speed: 1.6 });

    // Front row (z = frontZ): Glass, Mirror, Copper, Ceramic, Emissive
    const frontRow: Array<{ name: string; mat: THREE.Material; shape: 'sphere' | 'box' }> = [
      { name: 'Glass', mat: glass, shape: 'box' },
      { name: 'Mirror', mat: mirror, shape: 'box' },
      { name: 'Copper', mat: copper, shape: 'sphere' },
      { name: 'Ceramic', mat: ceramic, shape: 'sphere' },
      { name: 'Emissive', mat: emissiveGreen, shape: 'sphere' },
    ];
    // Back row (z = backZ): Rough, Metal, Brushed, Iridescent, Lava
    const backRow: Array<{ name: string; mat: THREE.Material; shape: 'sphere' | 'box' }> = [
      { name: 'Rough', mat: rough, shape: 'sphere' },
      { name: 'Metal', mat: metallic, shape: 'sphere' },
      { name: 'Brushed', mat: brushed, shape: 'box' },
      { name: 'Iridescent', mat: iridescent, shape: 'sphere' },
      { name: 'Lava', mat: lava, shape: 'sphere' },
    ];

    const placeRow = (samples: typeof frontRow, rowZ: number) => {
      samples.forEach((s, i) => {
        const x = startX + i * spacing;
        const y = base.y + 1.05;
        const geom = s.shape === 'sphere'
          ? new THREE.SphereGeometry(0.8, 22, 18)
          : new THREE.BoxGeometry(1.6, 1.6, 1.6);
        const mesh = new THREE.Mesh(geom, s.mat);
        mesh.position.set(x, y, rowZ);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `MatSample_${s.name}`;
        this.scene.add(mesh);
        this.levelObjects.push(mesh);
        mesh.updateWorldMatrix(true, false);
        this.levelColliders.push(this.colliderFactory.createTrimesh(mesh));
      });
    };
    placeRow(frontRow, frontZ);
    placeRow(backRow, backZ);

    // Point light near emissive (green glow)
    const emissiveX = startX + 4 * spacing;
    const greenLight = new THREE.PointLight(0x44ff99, 8, 10, 2);
    greenLight.position.set(emissiveX, base.y + 2.0, frontZ);
    greenLight.castShadow = false;
    greenLight.name = 'MatLight_Green';
    this.scene.add(greenLight);
    this.levelObjects.push(greenLight);

    // Point light near lava (orange glow)
    const lavaX = startX + 4 * spacing;
    const lavaLight = new THREE.PointLight(0xff6622, 10, 10, 2);
    lavaLight.position.set(lavaX, base.y + 2.0, backZ);
    lavaLight.castShadow = false;
    lavaLight.name = 'MatLight_Lava';
    this.scene.add(lavaLight);
    this.levelObjects.push(lavaLight);

    // Backplate to catch reflections.
    this.createStaticColliderBox(
      'MaterialsBackplate_col',
      new THREE.Vector3(bayWidth - 10, 3.5, 0.25),
      new THREE.Vector3(base.x, base.y + 2.0, base.z - 5.8),
      fallbackMaterial,
    );
  }

  /** Generate a 256x256 tileable noise texture (3 independent channels) for TSL VFX. */
  private createNoiseTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(size, size);

    // Integer hash for fast deterministic pseudo-random
    const hash = (n: number): number => {
      let x = ((n << 13) ^ n) | 0;
      x = (x * (x * x * 15731 + 789221) + 1376312589) | 0;
      return (x & 0x7fffffff) / 0x7fffffff;
    };

    // Smoothed value noise
    const noise2d = (px: number, py: number, seed: number): number => {
      const ix = Math.floor(px), iy = Math.floor(py);
      const fx = px - ix, fy = py - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const n00 = hash(ix + iy * 57 + seed);
      const n10 = hash(ix + 1 + iy * 57 + seed);
      const n01 = hash(ix + (iy + 1) * 57 + seed);
      const n11 = hash(ix + 1 + (iy + 1) * 57 + seed);
      return n00 * (1 - sx) * (1 - sy) + n10 * sx * (1 - sy) + n01 * (1 - sx) * sy + n11 * sx * sy;
    };

    // Fractal noise (3 octaves)
    const fbm = (x: number, y: number, seed: number): number => {
      return noise2d(x, y, seed) * 0.5 + noise2d(x * 2, y * 2, seed + 100) * 0.3 + noise2d(x * 4, y * 4, seed + 200) * 0.2;
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        img.data[i]     = (fbm(x / 32, y / 32, 0) * 255) | 0;     // R channel
        img.data[i + 1] = (fbm(x / 32, y / 32, 500) * 255) | 0;   // G channel
        img.data[i + 2] = (fbm(x / 32, y / 32, 1000) * 255) | 0;  // B channel
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  private async createVfxBay(base: THREE.Vector3, bayWidth: number): Promise<void> {
    const gen = this._loadGeneration;
    // Try TSL GPU-driven path; fall back to legacy sprites if unavailable.
    try {
      const { MeshBasicNodeMaterial } = await import('three/webgpu');
      const {
        Fn, time, uv, positionLocal, vec3, vec4, vec2, float, sin, cos, mul, add, mix, min, atan,
        texture, color, PI, TWO_PI, luminance,
      } = await import('three/tsl');
      const { mx_fractal_noise_float } = await import('three/tsl');

      // Guard: if a new load/unload happened while awaiting imports, bail out
      if (this._loadGeneration !== gen) {
        console.log('[LevelManager] VFX bay creation aborted — level changed during import');
        return;
      }

      // Shared noise texture.
      this.vfxNoiseTexture = this.createNoiseTexture();
      const noiseTex = this.vfxNoiseTexture;

      // Distributed station positions across the platform.
      const halfW = bayWidth * 0.5;
      const tornadoX = -Math.min(16, halfW * 0.6);
      const lightningX = 0;
      const laserX = Math.min(16, halfW * 0.6);
      const scannerX = -Math.min(8, halfW * 0.3);
      const fireX = Math.min(10, halfW * 0.37);
      const backRowZ = base.z - 3;
      const frontRowZ = base.z + 3;

      // ── Shared TSL helpers ────────────────────────────────────────────────

      const tornadoTime = mul(time, float(0.2));
      const fireTime = mul(time, float(0.4));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const twistedCylinder = Fn(([pos_immutable, parabolStr, parabolOff, parabolAmp, t]: [any, any, any, any, any]) => {
        const pos = vec3(pos_immutable).toVar();
        const angle = atan(pos.z, pos.x).toVar();
        const elevation = pos.y;
        const radius = parabolStr.mul(elevation.sub(parabolOff).pow(float(2))).add(parabolAmp).toVar();
        radius.addAssign(sin(elevation.sub(t).mul(float(20)).add(angle.mul(float(2)))).mul(float(0.05)));
        return vec3(cos(angle).mul(radius), elevation, sin(angle).mul(radius));
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toSkewedUv = Fn(([uvIn, skew]: [any, any]) => {
        return vec2(uvIn.x.add(uvIn.y.mul(skew.x)), uvIn.y.add(uvIn.x.mul(skew.y)));
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toRadialUv = Fn(([uvIn, multiplier, rotation, offset]: [any, any, any, any]) => {
        const centered = uvIn.sub(vec2(0.5, 0.5));
        const distanceToCenter = centered.length().mul(multiplier);
        const ang = atan(centered.y, centered.x).add(rotation);
        return vec2(ang.add(PI).div(TWO_PI), distanceToCenter).add(offset);
      });

      // ── 1. TORNADO (faithful port from webgpu_tsl_vfx_tornado) ────────────

      const tornadoCylGeo = new THREE.CylinderGeometry(1, 1, 1, 30, 30, true);
      tornadoCylGeo.translate(0, 0.5, 0);

      // Emissive tornado (inner glow)
      const tornadoEmissiveMat = new MeshBasicNodeMaterial();
      tornadoEmissiveMat.transparent = true;
      tornadoEmissiveMat.side = THREE.DoubleSide;
      tornadoEmissiveMat.blending = THREE.AdditiveBlending;
      tornadoEmissiveMat.depthWrite = false;

      tornadoEmissiveMat.positionNode = twistedCylinder(
        positionLocal, float(1), float(0.3), float(0.2), tornadoTime,
      );

      const emissiveColor = color('#ff8b4d');

      tornadoEmissiveMat.outputNode = Fn(() => {
        const uvVar = uv().toVar();
        // Layer 1: large-scale diagonal flow
        const n1Uv = toSkewedUv(
          uvVar.add(vec2(float(0), tornadoTime.negate())),
          vec2(float(-3), float(0)),
        ).mul(vec2(float(2), float(0.25)));
        const n1 = texture(noiseTex, n1Uv).r.remap(float(0.45), float(0.7));
        // Layer 2: fine detail
        const n2Uv = toSkewedUv(
          uvVar.add(vec2(float(0), tornadoTime.negate().add(float(123.4)))),
          vec2(float(-3), float(0)),
        ).mul(vec2(float(5), float(1)));
        const n2 = texture(noiseTex, n2Uv).g.remap(float(0.45), float(0.7));
        // Multiplicative blend for contrast
        const effect = n1.mul(n2);
        // Vertical fades
        const bottomFade = uvVar.y.smoothstep(float(0), float(0.05));
        const topFade = uvVar.y.oneMinus().smoothstep(float(0), float(0.5));
        const alpha = effect.mul(bottomFade).mul(topFade);
        // Normalize brightness by luminance (reference pattern)
        const col = emissiveColor.mul(float(1.2)).div(luminance(emissiveColor));
        return vec4(col, alpha);
      })();

      const tornadoInner = new THREE.Mesh(tornadoCylGeo, tornadoEmissiveMat);
      tornadoInner.scale.set(2.5, 6, 2.5);
      tornadoInner.position.set(tornadoX, base.y + 0.1, backRowZ);
      tornadoInner.name = 'VFX_TornadoInner';
      tornadoInner.castShadow = false;
      tornadoInner.receiveShadow = false;
      tornadoInner.frustumCulled = false;
      this.scene.add(tornadoInner);
      this.levelObjects.push(tornadoInner);

      // Dark outer silhouette
      const tornadoDarkMat = new MeshBasicNodeMaterial();
      tornadoDarkMat.transparent = true;
      tornadoDarkMat.side = THREE.DoubleSide;
      tornadoDarkMat.blending = THREE.NormalBlending;
      tornadoDarkMat.depthWrite = false;

      tornadoDarkMat.positionNode = twistedCylinder(
        positionLocal, float(1), float(0.3), float(0.25), tornadoTime,
      );

      tornadoDarkMat.outputNode = Fn(() => {
        const uvVar = uv().toVar();
        const n1Uv = toSkewedUv(
          uvVar.add(vec2(float(0), tornadoTime.negate().add(float(50)))),
          vec2(float(-3), float(0)),
        ).mul(vec2(float(2), float(0.25)));
        const n1 = texture(noiseTex, n1Uv).r.remap(float(0.45), float(0.7));
        const n2Uv = toSkewedUv(
          uvVar.add(vec2(float(0), tornadoTime.negate().add(float(200)))),
          vec2(float(-3), float(0)),
        ).mul(vec2(float(5), float(1)));
        const n2 = texture(noiseTex, n2Uv).g.remap(float(0.45), float(0.7));
        const effect = n1.mul(n2);
        const bottomFade = uvVar.y.smoothstep(float(0), float(0.05));
        const topFade = uvVar.y.oneMinus().smoothstep(float(0), float(0.5));
        return vec4(vec3(0), effect.mul(bottomFade).mul(topFade).smoothstep(float(0), float(0.01)));
      })();

      const tornadoOuter = new THREE.Mesh(tornadoCylGeo, tornadoDarkMat);
      tornadoOuter.scale.set(3.0, 6.5, 3.0);
      tornadoOuter.position.set(tornadoX, base.y + 0.1, backRowZ);
      tornadoOuter.name = 'VFX_TornadoOuter';
      tornadoOuter.castShadow = false;
      tornadoOuter.receiveShadow = false;
      tornadoOuter.frustumCulled = false;
      this.scene.add(tornadoOuter);
      this.levelObjects.push(tornadoOuter);

      // Tornado floor glow (radial polar noise)
      const tornadoFloorMat = new MeshBasicNodeMaterial();
      tornadoFloorMat.transparent = true;
      tornadoFloorMat.blending = THREE.AdditiveBlending;
      tornadoFloorMat.depthWrite = false;

      tornadoFloorMat.outputNode = Fn(() => {
        const uvVar = uv().toVar();
        const radUv = toRadialUv(uvVar, float(3), tornadoTime, vec2(0, 0));
        const n = texture(noiseTex, radUv).r;
        const effect = n.step(float(0.2)).mul(float(3));
        const dist = uvVar.sub(vec2(0.5, 0.5)).length();
        const fade = float(1).sub(dist.mul(float(2))).clamp();
        const col = emissiveColor.mul(float(1.2)).div(luminance(emissiveColor));
        return vec4(col, effect.mul(fade).mul(float(0.6)));
      })();

      const tornadoFloor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), tornadoFloorMat);
      tornadoFloor.rotation.x = -Math.PI / 2;
      tornadoFloor.position.set(tornadoX, base.y + 0.02, backRowZ);
      tornadoFloor.name = 'VFX_TornadoFloor';
      tornadoFloor.castShadow = false;
      tornadoFloor.receiveShadow = false;
      this.scene.add(tornadoFloor);
      this.levelObjects.push(tornadoFloor);

      // Tornado point light
      const tornadoLight = new THREE.PointLight(0xff6b2d, 12, 16, 2);
      tornadoLight.position.set(tornadoX, base.y + 3.0, backRowZ);
      tornadoLight.castShadow = false;
      tornadoLight.name = 'VFX_TornadoLight';
      this.scene.add(tornadoLight);
      this.levelObjects.push(tornadoLight);

      // ── 2. FIRE COLUMN ────────────────────────────────────────────────────

      const fireCylGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 20, true);
      fireCylGeo.translate(0, 0.5, 0);

      const fireInnerMat = new MeshBasicNodeMaterial();
      fireInnerMat.transparent = true;
      fireInnerMat.side = THREE.DoubleSide;
      fireInnerMat.blending = THREE.AdditiveBlending;
      fireInnerMat.depthWrite = false;

      fireInnerMat.positionNode = twistedCylinder(positionLocal, float(0.5), float(0.0), float(0.6), fireTime);

      fireInnerMat.outputNode = Fn(() => {
        const uvVar = uv().toVar();
        // Noise layer 1: upward scroll + diagonal skew
        const n1Uv = toSkewedUv(
          uvVar.add(vec2(fireTime, fireTime.negate())),
          vec2(float(-1), float(0)),
        ).mul(vec2(float(2), float(0.5)));
        const n1 = texture(noiseTex, n1Uv).r;

        // Noise layer 2: slower scroll, different scale
        const n2Uv = toSkewedUv(
          uvVar.add(vec2(fireTime.mul(float(0.5)), fireTime.negate())),
          vec2(float(-1), float(0)),
        ).mul(vec2(float(3), float(0.8)));
        const n2 = texture(noiseTex, n2Uv).g;

        // Additive-multiplicative blend for density
        const noiseMix = n1.mul(float(0.6)).add(n2.mul(float(0.4)));

        // Vertical fade: smoothstep at bottom and top edges
        const outerFade = min(
          uvVar.y.smoothstep(float(0), float(0.08)),
          uvVar.y.oneMinus().smoothstep(float(0), float(0.35)),
        );
        const effect = noiseMix.mul(outerFade);

        // Warm color gradient: deep orange → bright orange-yellow core
        const col = mix(vec3(1.0, 0.15, 0.0), vec3(1.0, 0.6, 0.1), noiseMix);
        return vec4(col.mul(float(2.0)), effect);
      })();

      const fireInner = new THREE.Mesh(fireCylGeo, fireInnerMat);
      fireInner.scale.set(2.0, 5, 2.0);
      fireInner.position.set(fireX, base.y + 0.1, frontRowZ);
      fireInner.name = 'VFX_FireInner';
      fireInner.castShadow = false;
      fireInner.receiveShadow = false;
      fireInner.frustumCulled = false;
      this.scene.add(fireInner);
      this.levelObjects.push(fireInner);

      // Dark outer smoke cylinder.
      const fireOuterMat = new MeshBasicNodeMaterial();
      fireOuterMat.transparent = true;
      fireOuterMat.side = THREE.DoubleSide;
      fireOuterMat.blending = THREE.NormalBlending;
      fireOuterMat.depthWrite = false;

      fireOuterMat.positionNode = twistedCylinder(positionLocal, float(0.6), float(0.0), float(0.7), mul(time, float(0.35)));

      fireOuterMat.outputNode = Fn(() => {
        const uvVar = uv().toVar();
        // Smoke noise: slower, larger scale
        const nUv = toSkewedUv(
          uvVar.add(vec2(fireTime.mul(float(0.3)), fireTime.negate().mul(float(0.7)))),
          vec2(float(-0.5), float(0)),
        ).mul(vec2(float(3), float(0.5)));
        const n = texture(noiseTex, nUv).b.sub(float(0.3)).div(float(0.4)).clamp();
        const outerFade = min(
          uvVar.y.smoothstep(float(0), float(0.05)),
          uvVar.y.oneMinus().smoothstep(float(0), float(0.3)),
        );
        const alpha = n.mul(outerFade).mul(float(0.55));
        return vec4(vec3(0.05, 0.03, 0.02), alpha);
      })();

      const fireOuter = new THREE.Mesh(fireCylGeo, fireOuterMat);
      fireOuter.scale.set(2.5, 5.5, 2.5);
      fireOuter.position.set(fireX, base.y + 0.1, frontRowZ);
      fireOuter.name = 'VFX_FireOuter';
      fireOuter.castShadow = false;
      fireOuter.receiveShadow = false;
      fireOuter.frustumCulled = false;
      this.scene.add(fireOuter);
      this.levelObjects.push(fireOuter);

      // Ground glow plane (TSL).
      const glowMat = new MeshBasicNodeMaterial();
      glowMat.transparent = true;
      glowMat.blending = THREE.AdditiveBlending;
      glowMat.depthWrite = false;

      glowMat.outputNode = Fn(() => {
        const uvVar = uv().toVar();
        const centered = uvVar.sub(vec2(float(0.5), float(0.5)));
        const dist = centered.length();
        const radial = float(1).sub(dist.mul(float(2))).clamp();
        const n = texture(noiseTex, uvVar.add(vec2(mul(time, float(0.08)), mul(time, float(0.05))))).r;
        const alpha = radial.mul(radial).mul(float(0.5).add(n.mul(float(0.5)))).mul(float(0.8));
        return vec4(vec3(1.0, 0.3, 0.02).mul(float(2.5)), alpha);
      })();

      const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(5, 4), glowMat);
      glowPlane.rotation.x = -Math.PI / 2;
      glowPlane.position.set(fireX, base.y + 0.02, frontRowZ);
      glowPlane.name = 'VFX_FireGlow';
      glowPlane.castShadow = false;
      glowPlane.receiveShadow = false;
      this.scene.add(glowPlane);
      this.levelObjects.push(glowPlane);

      // Fire point light (kept from old code).
      const fireLight = new THREE.PointLight(0xff6622, 15, 14, 2);
      fireLight.position.set(fireX, base.y + 2.0, frontRowZ);
      fireLight.castShadow = false;
      fireLight.name = 'VFX_FireLight';
      this.scene.add(fireLight);
      this.levelObjects.push(fireLight);

      // ── 3. LASER BEAM X-PATTERN (TSL animated pulse) ──────────────────────

      const laserCoreMat = new MeshBasicNodeMaterial();
      laserCoreMat.transparent = true;
      laserCoreMat.blending = THREE.AdditiveBlending;
      laserCoreMat.depthWrite = false;

      laserCoreMat.outputNode = Fn(() => {
        const pulse = mul(add(sin(mul(time, float(6.2))), float(1)), float(0.5));
        const shimmer = mx_fractal_noise_float(mul(uv().y, float(12)).add(mul(time, float(3))), float(1), float(2), float(0.5), float(2));
        const intensity = mul(add(float(0.7), mul(pulse, float(0.3))), add(float(0.8), mul(shimmer, float(0.2))));
        return vec4(mul(vec3(1.0, 0.15, 0.1), mul(intensity, float(5))), intensity);
      })();

      const laserGlowMat = new MeshBasicNodeMaterial();
      laserGlowMat.transparent = true;
      laserGlowMat.blending = THREE.AdditiveBlending;
      laserGlowMat.depthWrite = false;

      laserGlowMat.outputNode = Fn(() => {
        const pulse = mul(add(sin(mul(time, float(6.2))), float(1)), float(0.5));
        const glow = mul(pulse, float(0.6));
        return vec4(mul(vec3(1.0, 0.2, 0.15), mul(glow, float(2.0))), mul(glow, float(0.5)));
      })();

      const laserCylGeo = new THREE.CylinderGeometry(0.05, 0.05, 10, 10);
      const laserGlowGeo = new THREE.CylinderGeometry(0.18, 0.18, 10.2, 10);

      // Beam A (angled one way)
      const laserCoreA = new THREE.Mesh(laserCylGeo, laserCoreMat);
      laserCoreA.position.set(laserX, base.y + 1.8, backRowZ);
      laserCoreA.rotation.set(0, 0, Math.PI * 0.35);
      laserCoreA.castShadow = false;
      laserCoreA.receiveShadow = false;
      laserCoreA.name = 'VFX_LaserA';
      this.scene.add(laserCoreA);
      this.levelObjects.push(laserCoreA);

      const laserGlowA = new THREE.Mesh(laserGlowGeo, laserGlowMat);
      laserGlowA.position.copy(laserCoreA.position);
      laserGlowA.rotation.copy(laserCoreA.rotation);
      laserGlowA.castShadow = false;
      laserGlowA.receiveShadow = false;
      this.scene.add(laserGlowA);
      this.levelObjects.push(laserGlowA);

      // Beam B (crossed the other way)
      const laserCoreB = new THREE.Mesh(laserCylGeo, laserCoreMat);
      laserCoreB.position.set(laserX, base.y + 1.8, backRowZ);
      laserCoreB.rotation.set(0, 0, -Math.PI * 0.35);
      laserCoreB.castShadow = false;
      laserCoreB.receiveShadow = false;
      laserCoreB.name = 'VFX_LaserB';
      this.scene.add(laserCoreB);
      this.levelObjects.push(laserCoreB);

      const laserGlowB = new THREE.Mesh(laserGlowGeo, laserGlowMat);
      laserGlowB.position.copy(laserCoreB.position);
      laserGlowB.rotation.copy(laserCoreB.rotation);
      laserGlowB.castShadow = false;
      laserGlowB.receiveShadow = false;
      this.scene.add(laserGlowB);
      this.levelObjects.push(laserGlowB);

      const laserLight = new THREE.PointLight(0xff3a3a, 12, 14, 2);
      laserLight.position.set(laserX, base.y + 2.0, backRowZ);
      laserLight.castShadow = false;
      laserLight.name = 'VFX_LaserLight';
      this.scene.add(laserLight);
      this.levelObjects.push(laserLight);

      // ── 4. LIGHTNING ARC (dual bolt) ──────────────────────────────────────

      // Main bolt helper: creates a ribbon material with GPU-driven noise displacement
      const createLightningMat = (noiseSpeed: number, noiseScale: number, ribbonWidth: number, amplitude: number) => {
        const mat = new MeshBasicNodeMaterial();
        mat.transparent = true;
        mat.side = THREE.DoubleSide;
        mat.blending = THREE.AdditiveBlending;
        mat.depthWrite = false;

        mat.positionNode = Fn(() => {
          const pos = vec3(positionLocal).toVar();
          const a = pos.x.div(float(ribbonWidth)).add(float(0.5)).clamp();
          const envelope = sin(a.mul(float(Math.PI)));
          const noiseVal = mx_fractal_noise_float(
            pos.x.mul(float(noiseScale)).add(mul(time, float(noiseSpeed))),
            float(3), float(2), float(0.5), float(1),
          );
          pos.y.addAssign(noiseVal.mul(envelope).mul(float(amplitude)));
          return pos;
        })();

        mat.outputNode = Fn(() => {
          const uvVar = uv().toVar();
          const centerFade = float(1).sub(uvVar.y.sub(float(0.5)).abs().mul(float(2)));
          const brightCore = centerFade.smoothstep(float(0), float(0.5));
          const flicker = float(0.6).add(sin(mul(time, float(23))).mul(float(0.4)));
          const alpha = brightCore.mul(flicker);
          const col = mix(vec3(0.3, 0.6, 1.0), vec3(0.9, 0.95, 1.0), brightCore);
          return vec4(col.mul(float(4.0)), alpha);
        })();

        return mat;
      };

      // Main bolt
      const lightningMainMat = createLightningMat(12, 1.5, 8, 1.6);
      const lightningRibbon = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.4, 32, 1), lightningMainMat);
      lightningRibbon.position.set(lightningX, base.y + 2.4, backRowZ);
      lightningRibbon.name = 'VFX_Lightning';
      lightningRibbon.castShadow = false;
      lightningRibbon.receiveShadow = false;
      lightningRibbon.frustumCulled = false;
      this.scene.add(lightningRibbon);
      this.levelObjects.push(lightningRibbon);

      // Secondary thinner bolt (offset timing + smaller)
      const lightningSecMat = createLightningMat(15, 2.0, 6, 1.2);
      const lightningRibbon2 = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.25, 24, 1), lightningSecMat);
      lightningRibbon2.position.set(lightningX, base.y + 1.8, backRowZ + 0.3);
      lightningRibbon2.name = 'VFX_Lightning2';
      lightningRibbon2.castShadow = false;
      lightningRibbon2.receiveShadow = false;
      lightningRibbon2.frustumCulled = false;
      this.scene.add(lightningRibbon2);
      this.levelObjects.push(lightningRibbon2);

      // Lightning point light (CPU flicker kept — just 2 lines in update).
      const lightningLight = new THREE.PointLight(0x88ccff, 10, 14, 2);
      lightningLight.position.set(lightningX, base.y + 2.5, backRowZ);
      lightningLight.castShadow = false;
      lightningLight.name = 'VFX_LightningLight';
      this.scene.add(lightningLight);
      this.levelObjects.push(lightningLight);
      this.vfxLightningLight = lightningLight;

      // ── 5. SCANNER (dual rings + vertical beam) ─────────────────────────

      // Outer scanning ring
      const scanOuterMat = new MeshBasicNodeMaterial();
      scanOuterMat.transparent = true;
      scanOuterMat.side = THREE.DoubleSide;
      scanOuterMat.blending = THREE.AdditiveBlending;
      scanOuterMat.depthWrite = false;

      scanOuterMat.positionNode = Fn(() => {
        const pos = vec3(positionLocal).toVar();
        const osc = sin(mul(time, float(1.5)));
        const t = mul(add(osc, float(1)), float(0.5));
        pos.y.addAssign(mul(t, float(3.2)));
        const scalePulse = add(float(1), mul(sin(mul(t, float(Math.PI))), float(0.15)));
        pos.x.mulAssign(scalePulse);
        pos.z.mulAssign(scalePulse);
        return pos;
      })();

      scanOuterMat.outputNode = Fn(() => {
        const uvVar = uv().toVar();
        const osc = sin(mul(time, float(1.5)));
        const t = osc.add(float(1)).mul(float(0.5));
        const scanLines = sin(uvVar.x.mul(float(120)).add(mul(time, float(5)))).mul(float(0.5)).add(float(0.5));
        const fadeEnvelope = sin(t.mul(float(Math.PI)));
        const alpha = float(0.3).add(fadeEnvelope.mul(float(0.7))).mul(float(0.6).add(scanLines.mul(float(0.4))));
        return vec4(vec3(0.0, 1.0, 1.0).mul(float(2.5)), alpha);
      })();

      const scanRingOuter = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.85, 48), scanOuterMat);
      scanRingOuter.rotation.x = -Math.PI / 2;
      scanRingOuter.position.set(scannerX, base.y + 0.5, frontRowZ);
      scanRingOuter.name = 'VFX_ScannerOuter';
      scanRingOuter.castShadow = false;
      scanRingOuter.receiveShadow = false;
      this.scene.add(scanRingOuter);
      this.levelObjects.push(scanRingOuter);

      // Inner ring (counter-phase, smaller)
      const scanInnerMat = new MeshBasicNodeMaterial();
      scanInnerMat.transparent = true;
      scanInnerMat.side = THREE.DoubleSide;
      scanInnerMat.blending = THREE.AdditiveBlending;
      scanInnerMat.depthWrite = false;

      scanInnerMat.positionNode = Fn(() => {
        const pos = vec3(positionLocal).toVar();
        const osc = sin(mul(time, float(1.5)).add(float(Math.PI)));
        const t = mul(add(osc, float(1)), float(0.5));
        pos.y.addAssign(mul(t, float(3.2)));
        return pos;
      })();

      scanInnerMat.outputNode = Fn(() => {
        const osc = sin(mul(time, float(1.5)).add(float(Math.PI)));
        const t = osc.add(float(1)).mul(float(0.5));
        const fadeEnvelope = sin(t.mul(float(Math.PI)));
        const alpha = mul(fadeEnvelope, float(0.6));
        return vec4(vec3(0.0, 0.8, 1.0).mul(float(2.0)), alpha);
      })();

      const scanRingInner = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 36), scanInnerMat);
      scanRingInner.rotation.x = -Math.PI / 2;
      scanRingInner.position.set(scannerX, base.y + 0.5, frontRowZ);
      scanRingInner.name = 'VFX_ScannerInner';
      scanRingInner.castShadow = false;
      scanRingInner.receiveShadow = false;
      this.scene.add(scanRingInner);
      this.levelObjects.push(scanRingInner);

      // Vertical beam column
      const scanBeamMat = new MeshBasicNodeMaterial();
      scanBeamMat.transparent = true;
      scanBeamMat.blending = THREE.AdditiveBlending;
      scanBeamMat.depthWrite = false;

      scanBeamMat.outputNode = Fn(() => {
        const uvVar = uv().toVar();
        const shimmer = sin(uvVar.y.mul(float(40)).add(mul(time, float(4)))).mul(float(0.3)).add(float(0.7));
        const edgeFade = float(1).sub(uvVar.x.sub(float(0.5)).abs().mul(float(2)));
        const alpha = edgeFade.smoothstep(float(0), float(0.4)).mul(shimmer).mul(float(0.4));
        return vec4(vec3(0.0, 0.9, 1.0).mul(float(2.0)), alpha);
      })();

      const scanBeam = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 5), scanBeamMat);
      scanBeam.position.set(scannerX, base.y + 2.5, frontRowZ);
      scanBeam.name = 'VFX_ScanBeam';
      scanBeam.castShadow = false;
      scanBeam.receiveShadow = false;
      this.scene.add(scanBeam);
      this.levelObjects.push(scanBeam);

      // ── Receiver wall backdrop (unchanged) ────────────────────────────────

      const wallMat = new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.8, metalness: 0.0 });
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(bayWidth - 10, 3.2, 0.25), wallMat);
      receiver.position.set(0, base.y + 1.8, base.z - 6.0);
      receiver.receiveShadow = true;
      receiver.name = 'VFX_Backdrop';
      this.scene.add(receiver);
      this.levelObjects.push(receiver);
      receiver.updateWorldMatrix(true, false);
      this.levelColliders.push(this.colliderFactory.createTrimesh(receiver));

    } catch (err) {
      console.warn('[LevelManager] TSL VFX unavailable, using fallback sprites:', err);
      this.createVfxBayFallback(base, bayWidth);
    }
  }

  /** Legacy sprite-based VFX bay (WebGL fallback). */
  private createVfxBayFallback(base: THREE.Vector3, bayWidth: number): void {
    const halfW = bayWidth * 0.5;
    const fireX = Math.min(10, halfW * 0.37);
    const laserX = Math.min(16, halfW * 0.6);
    const lightningX = 0;
    const scannerX = -Math.min(8, halfW * 0.3);
    const backRowZ = base.z - 3;
    const frontRowZ = base.z + 3;

    // Ground glow plane under fire.
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x110000, emissive: 0xff4400, emissiveIntensity: 1.2, roughness: 0.9, transparent: true, opacity: 0.6,
    });
    const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(5, 4), glowMat);
    glowPlane.rotation.x = -Math.PI / 2;
    glowPlane.position.set(fireX, base.y + 0.02, frontRowZ);
    glowPlane.name = 'VFX_FireGlow';
    glowPlane.receiveShadow = false;
    glowPlane.castShadow = false;
    this.scene.add(glowPlane);
    this.levelObjects.push(glowPlane);

    // Fire point light.
    const fireLight = new THREE.PointLight(0xff6622, 15, 14, 2);
    fireLight.position.set(fireX, base.y + 2.0, frontRowZ);
    fireLight.castShadow = false;
    fireLight.name = 'VFX_FireLight';
    this.scene.add(fireLight);
    this.levelObjects.push(fireLight);

    // Laser bar (emissive).
    const laserMat = new THREE.MeshStandardMaterial({
      color: 0x220000, roughness: 0.2, metalness: 0.2, emissive: 0xff2a2a, emissiveIntensity: 2.6,
    });
    const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 10, 10), laserMat);
    laser.position.set(laserX, base.y + 1.8, backRowZ);
    laser.rotation.z = Math.PI * 0.35;
    laser.castShadow = false;
    laser.receiveShadow = false;
    laser.name = 'VFX_Laser';
    this.scene.add(laser);
    this.levelObjects.push(laser);

    const laserLight = new THREE.PointLight(0xff3a3a, 12, 14, 2);
    laserLight.position.set(laserX, base.y + 2.0, backRowZ);
    laserLight.castShadow = false;
    laserLight.name = 'VFX_LaserLight';
    this.scene.add(laserLight);
    this.levelObjects.push(laserLight);

    // Lightning point light (static fallback).
    const lightningLight = new THREE.PointLight(0x88ccff, 10, 14, 2);
    lightningLight.position.set(lightningX, base.y + 2.5, backRowZ);
    lightningLight.castShadow = false;
    lightningLight.name = 'VFX_LightningLight';
    this.scene.add(lightningLight);
    this.levelObjects.push(lightningLight);

    // Scanner ring (static fallback).
    const scanMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1.5, transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const scanRing = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.85, 48), scanMat);
    scanRing.rotation.x = -Math.PI / 2;
    scanRing.position.set(scannerX, base.y + 0.5, frontRowZ);
    scanRing.name = 'VFX_Scanner';
    this.scene.add(scanRing);
    this.levelObjects.push(scanRing);

    // Receiver wall backdrop.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.8, metalness: 0.0 });
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(bayWidth - 10, 3.2, 0.25), wallMat);
    receiver.position.set(0, base.y + 1.8, base.z - 6.0);
    receiver.receiveShadow = true;
    receiver.name = 'VFX_Backdrop';
    this.scene.add(receiver);
    this.levelObjects.push(receiver);
    receiver.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(receiver));
  }

  private createCircleTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(32, 32, 28, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }
}
