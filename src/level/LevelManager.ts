import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { Disposable, SpawnPointData } from '@core/types';
import type { GraphicsQuality } from '@core/UserSettings';
import { COLLISION_GROUP_WORLD } from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { ColliderFactory } from '@physics/ColliderFactory';
import { SHOWCASE_LAYOUT, getShowcaseStationZ } from '@level/ShowcaseLayout';
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
  }> = [];
  private ladderZones: THREE.Box3[] = [];
  private simTime = 0;
  private dirLight: THREE.DirectionalLight | null = null;
  private dirLightTarget: THREE.Object3D | null = null;
  private dirLightHelper: THREE.DirectionalLightHelper | null = null;
  private shadowCameraHelper: THREE.CameraHelper | null = null;
  private lightDebugEnabled = false;
  private shadowsEnabled = true;
  private graphicsQuality: GraphicsQuality = 'high';
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
    return this.dynamicBodies;
  }

  /** Read-only list of level visuals for editor selection. */
  getLevelObjects(): ReadonlyArray<THREE.Object3D> {
    return this.levelObjects;
  }

  /** Allows runtime quality changes to update shadow map budgets. */
  setGraphicsQuality(quality: GraphicsQuality): void {
    this.graphicsQuality = quality;
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

  setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    if (this.dirLight) {
      this.dirLight.castShadow = enabled;
      this.dirLight.shadow.autoUpdate = enabled;
      this.dirLight.shadow.needsUpdate = enabled;
    }
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

    // Sync visual meshes for dynamic rigid bodies.
    for (const item of this.dynamicBodies) {
      const p = item.body.translation();
      const r = item.body.rotation();
      item.mesh.position.set(p.x, p.y, p.z);
      item.mesh.quaternion.set(r.x, r.y, r.z, r.w);
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
    this.dirLightHelper?.update();
    this.shadowCameraHelper?.update();
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
    // Reflective surface for SSR verification: low roughness, high metalness
    const ssrTestMat = new THREE.MeshStandardMaterial({
      color: 0x8899aa,
      roughness: 0.15,
      metalness: 0.85,
    });

    // Broad floor
    const floor = new THREE.Mesh(new THREE.BoxGeometry(300, 5, 300), floorMat);
    floor.position.set(0, -3.5, 0);
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
    const hallFloorMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.88, metalness: 0.02 });
    const hallWallMat = new THREE.MeshStandardMaterial({ color: 0x20232a, roughness: 0.7, metalness: 0.05 });
    const bayMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.6, metalness: 0.05 });

    const hallFloor = new THREE.Mesh(new THREE.BoxGeometry(hallWidth, 0.6, hallLength), hallFloorMat);
    hallFloor.position.set(0, -1.3, showcaseCenterZ);
    hallFloor.name = 'ShowcaseFloor_col';
    hallFloor.receiveShadow = true;
    this.scene.add(hallFloor);
    this.levelObjects.push(hallFloor);
    hallFloor.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(hallFloor));

    const wallThickness = 0.6;
    const wallHeight = 7;
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

    // Bay pedestals (grid stations) along the corridor.
    const bayZ = [
      getShowcaseStationZ('steps'),
      getShowcaseStationZ('slopes'),
      getShowcaseStationZ('ladder'),
      getShowcaseStationZ('crouch'),
      getShowcaseStationZ('doubleJump'),
      getShowcaseStationZ('grab'),
      getShowcaseStationZ('throw'),
      getShowcaseStationZ('door'),
      getShowcaseStationZ('vehicles'),
      getShowcaseStationZ('rope'),
      getShowcaseStationZ('platforms'),
    ];
    bayZ.forEach((z, i) => {
      const pedestal = new THREE.Mesh(new THREE.BoxGeometry(hallWidth - 6, 0.35, 14), bayMat);
      pedestal.position.set(0, -0.85, z);
      pedestal.receiveShadow = true;
      pedestal.name = `ShowcaseBay${i}_col`;
      this.scene.add(pedestal);
      this.levelObjects.push(pedestal);
      pedestal.updateWorldMatrix(true, false);
      this.levelColliders.push(this.colliderFactory.createTrimesh(pedestal));
    });

    // Spawn the player at the corridor entrance.
    this.spawnPoint = {
      position: new THREE.Vector3(0, 2, showcaseCenterZ + hallLength / 2 - 6),
      rotation: new THREE.Euler(0, Math.PI, 0),
    };

    // Station Z coordinates used below.
    const zSteps = getShowcaseStationZ('steps');
    const zSlopes = getShowcaseStationZ('slopes');
    const zLadder = getShowcaseStationZ('ladder');
    const zCrouch = getShowcaseStationZ('crouch');
    const zDoubleJump = getShowcaseStationZ('doubleJump');
    const zGrab = getShowcaseStationZ('grab');
    const zThrow = getShowcaseStationZ('throw');
    const zDoor = getShowcaseStationZ('door');
    const zVehicles = getShowcaseStationZ('vehicles');
    const zRope = getShowcaseStationZ('rope');
    const zPlatforms = getShowcaseStationZ('platforms');

    // Rough plane section (materials + footing). Kept inside the showcase corridor.
    const roughPlane = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 14), obstacleMat);
    roughPlane.position.set(12, -1.2, zSteps + 2);
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
      const slope = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, 14), slopeMat);
      slope.position.set(-12 - i * 3.5, 0.6 + i * 0.65, zSlopes);
      slope.rotation.x = -(deg * Math.PI) / 180;
      slope.name = `Slope${Math.round(deg)}_col`;
      slope.receiveShadow = true;
      this.scene.add(slope);
      this.levelObjects.push(slope);
      slope.updateWorldMatrix(true, false);
      this.levelColliders.push(this.colliderFactory.createTrimesh(slope));
    });
    this.createSectionLabel('0.B  Slopes', new THREE.Vector3(0, 3.4, zSlopes + 6), 4.0, 1.2);
    this.createSectionLabel('23.5°', new THREE.Vector3(-12, 3.1, zSlopes), 2.2, 0.9);
    this.createSectionLabel('43.1°', new THREE.Vector3(-15.5, 4.6, zSlopes), 2.2, 0.9);
    this.createSectionLabel('62.7°', new THREE.Vector3(-19, 7.1, zSlopes), 2.2, 0.9);

    // SSR test: reflective panel just above floor on the far side of the slopes (enable SSR in debug panel to see reflections)
    const ssrTestPlane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), ssrTestMat);
    ssrTestPlane.position.set(12, -0.85, zSlopes + 8);
    ssrTestPlane.rotation.x = -Math.PI / 2;
    ssrTestPlane.name = 'SSR_test_reflective';
    ssrTestPlane.receiveShadow = true;
    this.scene.add(ssrTestPlane);
    this.levelObjects.push(ssrTestPlane);
    ssrTestPlane.updateWorldMatrix(true, false);
    this.createSectionLabel('SSR reflection test', new THREE.Vector3(12, 1.2, zSlopes + 8), 3.1, 0.95);

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
    addStep('Step0_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(-8, -0.93, zSteps - 6));
    addStep('Step1_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(-8, -0.93, zSteps - 5));
    addStep('Step2_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(-8, -0.93, zSteps - 4));
    addStep('Step3_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(-8, -0.93, zSteps - 3));
    addStep('Step4_col', new THREE.Vector3(4, 0.2, 4), new THREE.Vector3(-8, -0.9, zSteps));
    this.createSectionLabel('0.A  Steps & Autostep', new THREE.Vector3(0, 1.8, zSteps + 3), 6.2, 1.6);
    this.createStaircase(new THREE.Vector3(8, -1.0, zSteps - 6), 10, 0.14, 0.78, 4.8, stepMat);
    this.createSectionLabel('Staircase', new THREE.Vector3(8, 3.4, zSteps - 2), 2.6, 1.0);
    this.createLadder('MainLadder', new THREE.Vector3(14, -0.9, zLadder), 4.2, obstacleMat);
    this.createSectionLabel('0.C  Ladder', new THREE.Vector3(14, 4.5, zLadder + 0.1), 3.2, 1.1);
    // Legacy rope label replaced by the showcase labels below.
    this.createCrouchCourse(new THREE.Vector3(0, -1.0, zCrouch), obstacleMat);
    this.createSectionLabel('0.D  Crouch tunnel\nHold C', new THREE.Vector3(0, 2.15, zCrouch), 5.0, 1.45);
    this.createDoubleJumpCourse(new THREE.Vector3(-6, -1.0, zDoubleJump), stepMat);
    this.createSectionLabel('0.E  Double jump', new THREE.Vector3(-2, 4.7, zDoubleJump), 4.4, 1.35);

    // Showcase cluster (physics interactions + vehicles). Kept away from the moving platform suites.
    this.createSectionLabel('1.A  Grab & Pull\nPress E to grab/release', new THREE.Vector3(0, 2.3, zGrab), 7.6, 1.85);
    this.createSectionLabel('1.B  Pick Up & Throw\nE to pick up • LMB to throw • C to drop', new THREE.Vector3(0, 2.3, zThrow), 8.4, 1.95);
    this.createSectionLabel('1.C  Door / Beacon\nPress E near objects', new THREE.Vector3(0, 2.3, zDoor), 7.6, 1.85);
    this.createSectionLabel('1.D  Vehicles\nE to enter/exit', new THREE.Vector3(0, 2.3, zVehicles), 6.8, 1.75);
    this.createSectionLabel('1.E  Physics Rope\nPress E to attach', new THREE.Vector3(-10, 6.2, zRope), 6.8, 1.75);

    const grabbableMat = new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.55, metalness: 0.05 });
    this.createDynamicBox('PushCubeS', new THREE.Vector3(0, 0, zGrab + 2), new THREE.Vector3(1, 1, 1), grabbableMat, { grabbable: true });
    this.createDynamicBox('PushCubeM', new THREE.Vector3(0, 0, zGrab), new THREE.Vector3(1.5, 1.5, 1.5), grabbableMat, { grabbable: true });
    this.createDynamicBox('PushCubeL', new THREE.Vector3(0, 0, zGrab - 3), new THREE.Vector3(2, 2, 2), grabbableMat, { grabbable: true });
    this.createDynamicBox('PushCubeTinyA', new THREE.Vector3(3.5, 0, zGrab), new THREE.Vector3(0.5, 0.5, 0.5), obstacleMat, { grabbable: false });
    this.createDynamicBox('PushCubeTinyB', new THREE.Vector3(-3.5, 0, zGrab), new THREE.Vector3(0.5, 0.5, 0.5), obstacleMat, { grabbable: false });
    this.createSectionLabel('mass: 1', new THREE.Vector3(0, 2.0, zGrab + 2), 2.0, 0.85);
    this.createSectionLabel('mass: 3.4', new THREE.Vector3(0, 2.45, zGrab), 2.0, 0.85);
    this.createSectionLabel('mass: 8', new THREE.Vector3(0, 2.9, zGrab - 3), 2.0, 0.85);
    this.createSpinningToy(new THREE.Vector3(14, 2.5, zGrab - 2), obstacleMat);
    this.createSectionLabel('Dynamic toy', new THREE.Vector3(14, 2.1, zGrab - 2), 2.6, 0.95);

    // Kinematic platform suite.
    this.createKinematicPlatform(
      'SideMovePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(-12, -0.5, zPlatforms + 6),
      'x',
      0.5,
      5,
      kinematicPlatformMat,
    );
    this.createKinematicPlatform(
      'ElevatePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(0, 2, zPlatforms + 6),
      'yRotate',
      0.5,
      2,
      kinematicPlatformMat,
    );
    this.createKinematicPlatform(
      'RotatePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(12, -0.5, zPlatforms + 6),
      'rotateY',
      0.5,
      0,
      kinematicPlatformMat,
    );
    this.createSectionLabel('0.F  Moving platforms', new THREE.Vector3(0, 3.4, zPlatforms + 14), 6.2, 1.6);
    this.createSectionLabel('Move', new THREE.Vector3(-12, 3.2, zPlatforms + 6), 2.4, 0.95);
    this.createSectionLabel('Elevate', new THREE.Vector3(0, 3.3, zPlatforms + 6), 2.8, 0.95);
    this.createSectionLabel('Rotate', new THREE.Vector3(12, 3.2, zPlatforms + 6), 2.6, 0.95);
    // Floating platform set (same behavior pattern as FloatingPlatform.jsx).
    this.createFloatingPlatform(
      'FloatingPlatformA',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(-8, 5, zPlatforms - 8),
      floatingPlatformMat,
    );
    this.createFloatingPlatform(
      'FloatingPlatformB',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(8, 5, zPlatforms - 8),
      floatingPlatformMat,
      { lockX: true, lockY: false, lockZ: true, rotX: false, rotY: true, rotZ: false },
    );
    this.createFloatingPlatform(
      'FloatingMovingPlatform',
      new THREE.Vector3(2.5, 0.2, 2.5),
      new THREE.Vector3(0, 5, zPlatforms - 18),
      floatingPlatformMat,
      undefined,
      { minX: -5, maxX: 10, speedX: 2 },
    );
    this.createSectionLabel('Floating (push)', new THREE.Vector3(-8, 8.0, zPlatforms - 8), 3.6, 1.1);
    this.createSectionLabel('Floating (rotate)', new THREE.Vector3(8, 8.0, zPlatforms - 8), 3.9, 1.1);
    this.createSectionLabel('Floating + moving', new THREE.Vector3(0, 8.0, zPlatforms - 18), 3.8, 1.1);
    this.createKinematicDrum(
      'RotatingDrum',
      new THREE.Vector3(0, -1, zPlatforms - 26),
      1.0,
      10.0,
      'rotateX',
      0.5,
      kinematicPlatformMat,
    );
    this.createSectionLabel('Rotating drum', new THREE.Vector3(0, 3.2, zPlatforms - 26), 3.6, 1.1);

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
    ctx.fillStyle = '#d8ecff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const majorStep = 256;
    const minorStep = 64;
    ctx.strokeStyle = 'rgba(106, 118, 134, 0.36)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += minorStep) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += minorStep) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(88, 99, 115, 0.62)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= canvas.width; x += majorStep) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += majorStep) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
      ctx.stroke();
    }

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
    this.dynamicBodies.push({ mesh, body });
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
    this.dynamicBodies.push({ mesh, body });
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
    this.dynamicBodies.push({ mesh, body });
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
    ctx.fillStyle = 'rgba(18, 19, 24, 0.92)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = 'rgba(255, 170, 50, 0.92)';
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
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = this.textureAnisotropy;
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map: texture,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(scaleX, scaleY, 1);
    sprite.name = `Label_${text.slice(0, 18)}`;
    this.scene.add(sprite);
    this.levelObjects.push(sprite);
  }

  private addLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    ambientLight.name = '__kinema_ambient';
    this.scene.add(ambientLight);
    this.levelObjects.push(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xd7e8ff, 0x8a95aa, 0.22);
    hemiLight.name = '__kinema_hemilight';
    this.scene.add(hemiLight);
    this.levelObjects.push(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 3.0);
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
    if (this.graphicsQuality === 'low') return 1024;
    if (this.graphicsQuality === 'medium') return 2048;
    return 4096;
  }

  private applyDirectionalLightQuality(): void {
    if (!this.dirLight) return;
    this.dirLight.castShadow = this.shadowsEnabled;
    this.dirLight.shadow.autoUpdate = this.shadowsEnabled;
    if (!this.shadowsEnabled) return;
    const size = this.getShadowMapSize();
    this.dirLight.shadow.mapSize.set(size, size);
    this.dirLight.shadow.needsUpdate = true;
    this.shadowCameraHelper?.update();
  }

  private ensureLightHelpers(): void {
    if (!this.dirLight) return;
    if (!this.dirLightHelper) {
      this.dirLightHelper = new THREE.DirectionalLightHelper(this.dirLight, 2.2, 0xffcc66);
      this.scene.add(this.dirLightHelper);
    }
    if (!this.shadowCameraHelper) {
      this.shadowCameraHelper = new THREE.CameraHelper(this.dirLight.shadow.camera);
      this.scene.add(this.shadowCameraHelper);
    }
  }

  private removeLightHelpers(): void {
    if (this.dirLightHelper) {
      this.scene.remove(this.dirLightHelper);
      this.dirLightHelper.dispose();
      this.dirLightHelper = null;
    }
    if (this.shadowCameraHelper) {
      this.scene.remove(this.shadowCameraHelper);
      this.shadowCameraHelper.dispose();
      this.shadowCameraHelper = null;
    }
  }

  dispose(): void {
    this.unload();
    this.assetLoader.clearAll();
  }
}
