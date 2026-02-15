import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { Disposable, SpawnPointData } from '@core/types';
import type { GraphicsProfile } from '@core/UserSettings';
import { COLLISION_GROUP_WORLD } from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { ColliderFactory } from '@physics/ColliderFactory';
import {
  SHOWCASE_LAYOUT,
  SHOWCASE_STATION_ORDER,
  getShowcaseBayTopY,
  getShowcaseStationZ,
} from '@level/ShowcaseLayout';
import { AssetLoader } from './AssetLoader';
import { MeshParser } from './MeshParser';
import { LevelValidator } from './LevelValidator';

const _lightGoalPos = new THREE.Vector3();
const _lightGoalTarget = new THREE.Vector3();
const DEFAULT_SPAWN_Y = 2;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

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
  private vfxBillboards: Array<{
    sprite: THREE.Sprite;
    origin: THREE.Vector3;
    kind: 'smoke' | 'fire';
    riseSpeed: number;
    maxRise: number;
    baseScale: number;
    phase: number;
  }> = [];
  private vfxLaser: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; baseEmissive: number } | null = null;
  private vfxLightning: { line: THREE.Line; base: THREE.Vector3; segments: number } | null = null;
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
  private textureAnisotropy = 8;

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

  /** Unload all current level resources. */
  unload(): void {
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

    // Lightweight VFX bay: smoke/fire billboards.
    for (const fx of this.vfxBillboards) {
      const t = (this.simTime * fx.riseSpeed + fx.phase) % 1;
      fx.sprite.position.set(
        fx.origin.x,
        fx.origin.y + t * fx.maxRise,
        fx.origin.z,
      );
      const fade = fx.kind === 'smoke'
        ? (1 - t) * 0.55
        : (1 - t) * 0.85;
      fx.sprite.material.opacity = Math.max(0, fade);
      const s = fx.baseScale * (fx.kind === 'smoke' ? 1 + t * 1.6 : 1 + t * 0.9);
      fx.sprite.scale.set(s, s, 1);
    }

    // Laser pulse.
    if (this.vfxLaser) {
      const pulse = 0.55 + 0.45 * Math.sin(this.simTime * 6.2);
      this.vfxLaser.mat.emissiveIntensity = this.vfxLaser.baseEmissive + pulse * 2.2;
    }

    // Lightning jitter.
    if (this.vfxLightning) {
      const geo = this.vfxLightning.line.geometry as THREE.BufferGeometry;
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const { base, segments } = this.vfxLightning;
      for (let i = 0; i <= segments; i += 1) {
        const a = i / segments;
        const x = base.x + a * 6;
        const y = base.y + 2.4 + Math.sin(this.simTime * 9.0 + i * 1.7) * 0.35;
        const z = base.z + Math.sin(this.simTime * 7.0 + i * 2.2) * 0.35;
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
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
      color: 0xffffff,
      map: gridTexture,
      roughness: 0.95,
      metalness: 0.0,
    });
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xffb6c1, roughness: 0.85 });
    const slopeMat = new THREE.MeshStandardMaterial({ color: 0x98fb98, roughness: 0.9 });
    const obstacleMat = new THREE.MeshStandardMaterial({ color: 0xb0c4de, roughness: 0.8 });
    const kinematicPlatformMat = new THREE.MeshStandardMaterial({ color: 0xffe4b5, roughness: 0.85 });
    const floatingPlatformMat = new THREE.MeshStandardMaterial({ color: 0xb0c4de, roughness: 0.72 });

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
    const hallFloorMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.88, metalness: 0.02 });
    // Show a readable ground grid in normal play mode too.
    hallFloorMat.map = gridTexture;
    hallFloorMat.needsUpdate = true;
    // Keep corridor walls non-metallic to avoid SSR "sparkle" on rough surfaces.
    const hallWallMat = new THREE.MeshStandardMaterial({ color: 0x20232a, roughness: 0.78, metalness: 0.0 });
    const bayMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.68, metalness: 0.0 });

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
    const wallHeight = 9;
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
    const ceilingY = -1.0 + wallHeight - 0.45;
    bayZ.forEach((z, i) => {
      const panelMat = new THREE.MeshStandardMaterial({
        color: 0x14161c,
        roughness: 0.45,
        metalness: 0.05,
        emissive: 0xffc27a,
        emissiveIntensity: 0.55,
      });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(bayWidth - 6, 0.08, 2.6), panelMat);
      panel.position.set(0, ceilingY, z);
      panel.name = `ShowcaseCeilingPanel${i}`;
      panel.castShadow = false;
      panel.receiveShadow = false;
      this.scene.add(panel);
      this.levelObjects.push(panel);

      const light = new THREE.PointLight(0xffe2bf, 22, 18, 2);
      light.position.set(0, ceilingY - 0.25, z);
      light.castShadow = false;
      light.name = `ShowcaseBayLight${i}`;
      this.scene.add(light);
      this.levelObjects.push(light);
    });

    // Spawn the player at the corridor entrance.
    this.spawnPoint = {
      position: new THREE.Vector3(0, 2, showcaseCenterZ + hallLength / 2 - 6),
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
    const zFutureA = getShowcaseStationZ('futureA');
    const zFutureB = getShowcaseStationZ('futureB');

    // Rough plane section (materials + footing). Kept inside the showcase corridor.
    const roughPlane = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 14), obstacleMat);
    roughPlane.position.set(12, bayTopY + 0.5, zSteps + 2);
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
      '0.B  Slopes\nUI test: Debug (`) shows grounded + speed changes',
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
      '0.A  Steps & Autostep\nUI test: Debug (`) shows grounded + speed changes',
      new THREE.Vector3(0, 2.0, zSteps + 3),
      8.4,
      1.75,
    );
    this.createStaircase(new THREE.Vector3(8, bayTopY, zSteps - 6), 10, 0.14, 0.78, 4.8, stepMat);

    // Combined movement bay: ladder + crouch + rope in a single platform stage.
    this.createLadder('MainLadder', new THREE.Vector3(14, bayTopY, zMovement), 4.2, obstacleMat);
    this.createCrouchCourse(new THREE.Vector3(0, bayTopY, zMovement), obstacleMat);
    this.createSectionLabel(
      '0.C  Movement bay\nLadder • Crouch tunnel • Rope\nUI test: Debug (`) shows state changes',
      new THREE.Vector3(0, 3.0, zMovement + 6),
      11.2,
      2.25,
    );
    this.createDoubleJumpCourse(new THREE.Vector3(-6, bayTopY, zDoubleJump), stepMat);
    this.createSectionLabel(
      '0.E  Double jump\nUI test: Debug (`) shows state air/jump',
      new THREE.Vector3(-2, 4.9, zDoubleJump),
      7.6,
      1.65,
    );

    // Showcase cluster (physics interactions + vehicles). Kept away from the moving platform suites.
    this.createSectionLabel(
      '1.A  Grab & Pull\nPress E to grab/release\nUI test: hold bar + prompts stay responsive',
      new THREE.Vector3(0, 2.55, zGrab),
      10.2,
      2.2,
    );
    this.createSectionLabel(
      '1.B  Pick Up & Throw\nE to pick up • LMB to throw • C to drop\nUI test: Impact toast on hard hit',
      new THREE.Vector3(0, 2.55, zThrow),
      11.0,
      2.25,
    );
    this.createSectionLabel(
      '1.C  Door / Beacon\nPress E near objects\nUI test: interaction highlight + prompts',
      new THREE.Vector3(0, 2.55, zDoor),
      10.2,
      2.15,
    );
    this.createSectionLabel(
      '1.D  Vehicles\nE to enter/exit\nUI test: HUD + camera behavior changes',
      new THREE.Vector3(0, 2.55, zVehicles),
      9.2,
      2.05,
    );
    // Rope signage is included in the movement bay label above.

    const grabbableMat = new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.55, metalness: 0.05 });
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
      new THREE.Vector3(-12, bayTopY + 0.1, zPlatformsMoving + 6),
      'x',
      0.5,
      5,
      kinematicPlatformMat,
    );
    this.createKinematicPlatform(
      'ElevatePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(0, bayTopY + 2.2, zPlatformsMoving + 6),
      'yRotate',
      0.5,
      2,
      kinematicPlatformMat,
    );
    this.createKinematicPlatform(
      'RotatePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(12, bayTopY + 0.1, zPlatformsMoving + 6),
      'rotateY',
      0.5,
      0,
      kinematicPlatformMat,
    );
    this.createSectionLabel(
      '2.A  Moving platforms\nUI test: Debug (`) shows speed + grounded toggles',
      new THREE.Vector3(0, 3.6, zPlatformsMoving + 8),
      9.2,
      1.9,
    );

    // Platform stage B: dynamic/pushable platforms + rotating drum (single bay).
    this.createFloatingPlatform(
      'FloatingPlatformA',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(-10, bayTopY + 1.2, zPlatformsPhysics + 6),
      floatingPlatformMat,
    );
    this.createFloatingPlatform(
      'FloatingPlatformB',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(10, bayTopY + 1.2, zPlatformsPhysics + 6),
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
      new THREE.Vector3(0, bayTopY + 1.0, zPlatformsPhysics - 6),
      1.0,
      10.0,
      'rotateX',
      0.5,
      kinematicPlatformMat,
    );
    this.createSectionLabel(
      '2.B  Pushable / physics platforms\nUI test: Throw objects at platforms; watch stability',
      new THREE.Vector3(0, 3.6, zPlatformsPhysics + 8),
      11.4,
      2.05,
    );

    // Materials bay.
    this.createSectionLabel(
      '3.A  Materials\nGlass • Metal • Rough • Emissive',
      new THREE.Vector3(0, 3.2, zMaterials + 6),
      9.2,
      1.9,
    );
    this.createMaterialsBay(new THREE.Vector3(0, bayTopY, zMaterials), bayWidth, obstacleMat);

    // VFX bay.
    this.createSectionLabel(
      '3.B  VFX\nSmoke • Fire • Laser • Lightning',
      new THREE.Vector3(0, 3.2, zVfx + 6),
      9.2,
      1.9,
    );
    this.createVfxBay(new THREE.Vector3(0, bayTopY, zVfx), bayWidth);

    // Reserved empty bays for future additions (keep pedestals but no gameplay objects).
    this.createSectionLabel('2.A  Reserved bay\n(keep empty for future demos)', new THREE.Vector3(0, 2.5, zFutureA), 8.8, 2.0);
    this.createSectionLabel('2.B  Reserved bay\n(keep empty for future demos)', new THREE.Vector3(0, 2.5, zFutureB), 8.8, 2.0);

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
    ctx.fillStyle = '#dceeff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const majorStep = 256;
    const minorStep = 64;

    // Draw crisp, tileable lines:
    // - avoid drawing outside the canvas bounds (no `<= width`),
    // - draw on pixel centers for stable mipmaps,
    // - then copy border pixels ("wrap pad") so RepeatWrapping is seamless.
    ctx.save();
    ctx.translate(0.5, 0.5);

    ctx.strokeStyle = 'rgba(80, 98, 120, 0.22)';
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

    ctx.strokeStyle = 'rgba(62, 78, 98, 0.55)';
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
    // Slightly more transparent so the panel reads as "overlay" instead of a solid quad.
    ctx.fillStyle = 'rgba(18, 19, 24, 0.72)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = 'rgba(255, 170, 50, 0.86)';
    ctx.lineWidth = 8;
    ctx.strokeRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
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
      ctx.fillStyle = '#ffb24a';
      ctx.fillText(code, 0, startY);
      ctx.fillStyle = '#f3f6ff';
      ctx.fillText(`  ${headerTitle}`, codeWidth, startY);
    } else {
      ctx.fillStyle = '#f3f6ff';
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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.32);
    ambientLight.name = '__kinema_ambient';
    this.scene.add(ambientLight);
    this.levelObjects.push(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xd7e8ff, 0x8a95aa, 0.28);
    hemiLight.name = '__kinema_hemilight';
    this.scene.add(hemiLight);
    this.levelObjects.push(hemiLight);

    // Warm key light for friendlier materials.
    const dirLight = new THREE.DirectionalLight(0xfff2d6, 2.7);
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
    const rowZ = base.z + 1.5;
    const xSpan = Math.max(8, bayWidth - 12);
    const spacing = xSpan / 5;
    const startX = -xSpan / 2 + spacing * 0.5;

    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xbfe9ff,
      roughness: 0.05,
      metalness: 0,
      transmission: 1,
      thickness: 0.35,
      ior: 1.45,
      transparent: true,
      opacity: 0.7,
    });
    const mirror = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.02,
      metalness: 1,
    });
    const rough = new THREE.MeshStandardMaterial({
      color: 0xb4b4b4,
      roughness: 0.95,
      metalness: 0,
    });
    const metallic = new THREE.MeshStandardMaterial({
      color: 0x9aa7b0,
      roughness: 0.18,
      metalness: 1,
    });
    const emissive = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.55,
      metalness: 0.05,
      emissive: 0x35ff8d,
      emissiveIntensity: 0.65,
    });
    this.animatedMaterials.push({ mat: emissive, baseIntensity: 0.65, speed: 2.2 });

    const samples: Array<{ name: string; mat: THREE.Material; shape: 'sphere' | 'box' }> = [
      { name: 'Glass', mat: glass, shape: 'box' },
      { name: 'Mirror', mat: mirror, shape: 'box' },
      { name: 'Rough', mat: rough, shape: 'sphere' },
      { name: 'Metal', mat: metallic, shape: 'sphere' },
      { name: 'Emissive (animated)', mat: emissive, shape: 'box' },
    ];

    samples.forEach((s, i) => {
      const x = startX + i * spacing;
      const y = base.y + 1.05;
      const z = rowZ;
      const geom =
        s.shape === 'sphere'
          ? new THREE.SphereGeometry(0.8, 22, 18)
          : new THREE.BoxGeometry(1.6, 1.6, 1.6);
      const mesh = new THREE.Mesh(geom, s.mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `MatSample_${s.name}`;
      this.scene.add(mesh);
      this.levelObjects.push(mesh);
      mesh.updateWorldMatrix(true, false);
      this.levelColliders.push(this.colliderFactory.createTrimesh(mesh));
    });

    // Backplate to catch reflections.
    this.createStaticColliderBox(
      'MaterialsBackplate_col',
      new THREE.Vector3(bayWidth - 10, 3.5, 0.25),
      new THREE.Vector3(base.x, base.y + 2.0, base.z - 5.8),
      fallbackMaterial,
    );
  }

  private createVfxBay(base: THREE.Vector3, bayWidth: number): void {
    const smokeTex = this.createBillboardTexture('#cfd6e6', 0.85);
    const fireTex = this.createBillboardTexture('#ff7a1a', 0.92);
    const smokeMat = new THREE.SpriteMaterial({
      map: smokeTex,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false,
      // NOTE: Avoid CustomBlending here.
      // WHY: WebGPU's material pipeline support for per-channel CustomBlending has been inconsistent.
      // NormalBlending + premultipliedAlpha provides stable results across WebGL and WebGPU.
      blending: THREE.NormalBlending,
    });
    // NOTE: Use straight alpha.
    // WHY: WebGPU SpriteMaterial can behave as if premultiplied-alpha is ignored, producing dark "black" edges.
    smokeMat.premultipliedAlpha = false;
    const fireMat = new THREE.SpriteMaterial({
      map: fireTex,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    fireMat.premultipliedAlpha = false;

    const leftX = -Math.min(14, bayWidth * 0.32);
    const rightX = Math.min(14, bayWidth * 0.32);

    // Smoke column.
    for (let i = 0; i < 10; i += 1) {
      const sprite = new THREE.Sprite(smokeMat.clone());
      sprite.renderOrder = 5;
      sprite.position.set(leftX, base.y + 0.6, base.z + 2.4);
      sprite.scale.set(2.4, 2.4, 1);
      sprite.name = `VFX_Smoke_${i}`;
      this.scene.add(sprite);
      this.levelObjects.push(sprite);
      this.vfxBillboards.push({
        sprite,
        origin: sprite.position.clone(),
        kind: 'smoke',
        riseSpeed: 0.25,
        maxRise: 4.8,
        baseScale: 2.2,
        phase: i / 10,
      });
    }

    // Fire column.
    for (let i = 0; i < 9; i += 1) {
      const sprite = new THREE.Sprite(fireMat.clone());
      sprite.renderOrder = 6;
      sprite.position.set(rightX, base.y + 0.55, base.z + 2.4);
      sprite.scale.set(2.0, 2.0, 1);
      sprite.name = `VFX_Fire_${i}`;
      this.scene.add(sprite);
      this.levelObjects.push(sprite);
      this.vfxBillboards.push({
        sprite,
        origin: sprite.position.clone(),
        kind: 'fire',
        riseSpeed: 0.38,
        maxRise: 3.6,
        baseScale: 1.8,
        phase: i / 9,
      });
    }

    // Laser bar (emissive) down the bay.
    const laserMat = new THREE.MeshStandardMaterial({
      color: 0x220000,
      roughness: 0.2,
      metalness: 0.2,
      emissive: 0xff2a2a,
      emissiveIntensity: 2.6,
    });
    const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 10, 10), laserMat);
    laser.position.set(0, base.y + 1.2, base.z - 2.2);
    laser.rotation.z = Math.PI / 2;
    laser.castShadow = false;
    laser.receiveShadow = false;
    laser.name = 'VFX_Laser';
    this.scene.add(laser);
    this.levelObjects.push(laser);
    this.vfxLaser = { mesh: laser, mat: laserMat, baseEmissive: 2.6 };

    const laserLight = new THREE.PointLight(0xff3a3a, 10, 12, 2);
    laserLight.position.copy(laser.position);
    laserLight.position.y += 0.4;
    laserLight.castShadow = false;
    laserLight.name = 'VFX_LaserLight';
    this.scene.add(laserLight);
    this.levelObjects.push(laserLight);

    // Lightning polyline (emissive line).
    const segments = 10;
    const points = new Float32Array((segments + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.95 }),
    );
    line.position.set(-3, 0, base.z - 5.2);
    line.name = 'VFX_Lightning';
    this.scene.add(line);
    this.levelObjects.push(line);
    this.vfxLightning = { line, base: new THREE.Vector3(line.position.x, base.y, line.position.z), segments };

    // Small receiver wall to improve visibility.
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

  private createBillboardTexture(coreHex: string, alpha: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.CanvasTexture(canvas);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    // Use rgba() strings for broad browser compatibility (avoid 8-digit hex edge cases).
    const rgb = hexToRgb(coreHex) ?? { r: 255, g: 255, b: 255 };
    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 120);
    grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},1)`);
    grad.addColorStop(0.45, `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.max(0, Math.min(1, alpha))})`);
    grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add some cheap noise.
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const a = img.data[i + 3];
      if (a === 0) continue;
      const n = (Math.sin(i * 0.0123) + Math.sin(i * 0.0431)) * 0.5;
      // Only perturb alpha where the sprite already exists; prevents faint full-quad backgrounds.
      img.data[i + 3] = Math.max(0, Math.min(255, a + n * 20 * (a / 255)));
    }
    ctx.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Avoid mipmap bleed on soft alpha gradients.
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = this.textureAnisotropy;
    // NOTE: Keep straight alpha; WebGPU blending is more consistent this way for CanvasTexture billboards.
    tex.premultiplyAlpha = false;
    tex.needsUpdate = true;
    return tex;
  }
}
