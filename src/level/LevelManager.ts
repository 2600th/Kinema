import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { Disposable, SpawnPointData } from '@core/types';
import { COLLISION_GROUP_WORLD } from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { ColliderFactory } from '@physics/ColliderFactory';
import { AssetLoader } from './AssetLoader';
import { MeshParser } from './MeshParser';
import { LevelValidator } from './LevelValidator';

const _lightGoalPos = new THREE.Vector3();
const _lightGoalTarget = new THREE.Vector3();

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
  private spawnPoint: SpawnPointData = {
    position: new THREE.Vector3(0, 2, 0),
  };
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

  /** Load a level by name. 'procedural' generates a test level. */
  async load(name: string): Promise<void> {
    // Unload current level first
    if (this.currentLevelName) {
      this.unload();
    }

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
    this.currentLevelName = null;

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
          const sensor = this.colliderFactory.createSensor(entry.mesh);
          this.levelColliders.push(sensor);
          const parentBody = sensor.parent();
          if (parentBody) {
            this.levelBodies.push(parentBody);
          }
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
    floor.position.set(0, -3.5, 0);
    floor.name = 'Floor_col';
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.levelObjects.push(floor);
    floor.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(floor));

    // Rough plane section
    const roughPlane = new THREE.Mesh(new THREE.BoxGeometry(22, 1, 22), obstacleMat);
    roughPlane.position.set(10, -1.2, 10);
    roughPlane.rotation.set(-0.08, 0.12, 0.06);
    roughPlane.name = 'RoughPlane_col';
    roughPlane.receiveShadow = true;
    this.scene.add(roughPlane);
    this.levelObjects.push(roughPlane);
    roughPlane.updateWorldMatrix(true, false);
    this.levelColliders.push(this.colliderFactory.createTrimesh(roughPlane));

    // Slope lane: ~23.5, 43.1, 62.7 degrees
    const slopeAngles = [23.5, 43.1, 62.7];
    slopeAngles.forEach((deg, i) => {
      const slope = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, 14), slopeMat);
      slope.position.set(-6.5 - i * 3.5, 0.6 + i * 0.65, 10);
      slope.rotation.x = -(deg * Math.PI) / 180;
      slope.name = `Slope${Math.round(deg)}_col`;
      slope.receiveShadow = true;
      this.scene.add(slope);
      this.levelObjects.push(slope);
      slope.updateWorldMatrix(true, false);
      this.levelColliders.push(this.colliderFactory.createTrimesh(slope));
    });
    this.createSectionLabel('23.5 Deg', new THREE.Vector3(-6.5, 3.1, 10), 2.5, 0.95);
    this.createSectionLabel('43.1 Deg', new THREE.Vector3(-10, 4.6, 10), 2.5, 0.95);
    this.createSectionLabel('62.7 Deg', new THREE.Vector3(-13.5, 7.1, 10), 2.5, 0.95);

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
    addStep('Step0_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(0, -0.93, 5));
    addStep('Step1_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(0, -0.93, 6));
    addStep('Step2_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(0, -0.93, 7));
    addStep('Step3_col', new THREE.Vector3(4, 0.14, 0.55), new THREE.Vector3(0, -0.93, 8));
    addStep('Step4_col', new THREE.Vector3(4, 0.2, 4), new THREE.Vector3(0, -0.9, 11));
    this.createSectionLabel('Steps (autostep lane)', new THREE.Vector3(0, 1.4, 6.8), 3.6, 1.2);
    this.createStaircase(new THREE.Vector3(7.5, -1.0, 6.0), 10, 0.14, 0.78, 4.8, stepMat);
    this.createSectionLabel('Staircase test', new THREE.Vector3(7.5, 3.4, 10.4), 3.0, 1.05);
    this.createLadder('MainLadder', new THREE.Vector3(10.8, -0.9, 12.0), 4.2, obstacleMat);
    this.createSectionLabel('Ladder climb test', new THREE.Vector3(10.8, 4.5, 12.1), 3.0, 1.05);

    // Rigid body obstacle cluster.
    this.createDynamicBox('PushCubeS', new THREE.Vector3(15, 0, 0), new THREE.Vector3(1, 1, 1), obstacleMat);
    this.createDynamicBox('PushCubeM', new THREE.Vector3(15, 0, -2), new THREE.Vector3(1.5, 1.5, 1.5), obstacleMat);
    this.createDynamicBox('PushCubeL', new THREE.Vector3(15, 0, -5), new THREE.Vector3(2, 2, 2), obstacleMat);
    this.createDynamicBox('PushCubeTinyA', new THREE.Vector3(15, 1, 2), new THREE.Vector3(0.5, 0.5, 0.5), obstacleMat);
    this.createDynamicBox('PushCubeTinyB', new THREE.Vector3(15.1, 0, 2), new THREE.Vector3(0.5, 0.5, 0.5), obstacleMat);
    this.createSectionLabel('mass: 1', new THREE.Vector3(15, 1.9, 0), 2.0, 0.85);
    this.createSectionLabel('mass: 3.375', new THREE.Vector3(15, 2.4, -2), 2.2, 0.9);
    this.createSectionLabel('mass: 8', new THREE.Vector3(15, 2.8, -5), 2.0, 0.85);
    this.createSpinningToy(new THREE.Vector3(15, 5, -10), obstacleMat);
    this.createSectionLabel('mass: 1.24', new THREE.Vector3(15, 2.1, -10), 2.0, 0.85);

    // Kinematic platform suite.
    this.createKinematicPlatform(
      'SideMovePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(-12, -0.5, -10),
      'x',
      0.5,
      5,
      kinematicPlatformMat,
    );
    this.createKinematicPlatform(
      'ElevatePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(-25, 2, 0),
      'yRotate',
      0.5,
      2,
      kinematicPlatformMat,
    );
    this.createKinematicPlatform(
      'RotatePlatform',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(-25, -0.5, -10),
      'rotateY',
      0.5,
      0,
      kinematicPlatformMat,
    );
    this.createSectionLabel('Kinematic Moving Platform', new THREE.Vector3(-12, 3.2, -10), 4.2, 1.25);
    this.createSectionLabel('Kinematic Elevating Platform', new THREE.Vector3(-25, 3.3, 0), 4.4, 1.25);
    this.createSectionLabel('Kinematic Rotating Platform', new THREE.Vector3(-25, 3.2, -10), 4.3, 1.25);
    // Floating platform set (same behavior pattern as FloatingPlatform.jsx).
    this.createFloatingPlatform(
      'FloatingPlatformA',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(0, 5, -10),
      floatingPlatformMat,
    );
    this.createFloatingPlatform(
      'FloatingPlatformB',
      new THREE.Vector3(5, 0.2, 5),
      new THREE.Vector3(7, 5, -10),
      floatingPlatformMat,
      { lockX: true, lockY: false, lockZ: true, rotX: false, rotY: true, rotZ: false },
    );
    this.createFloatingPlatform(
      'FloatingMovingPlatform',
      new THREE.Vector3(2.5, 0.2, 2.5),
      new THREE.Vector3(0, 5, -17),
      floatingPlatformMat,
      undefined,
      { minX: -5, maxX: 10, speedX: 2 },
    );
    this.createSectionLabel('Floating Platform push to move', new THREE.Vector3(-1.4, 8.0, -10), 4.4, 1.3);
    this.createSectionLabel('Floating Platform push to rotate', new THREE.Vector3(8.4, 8.0, -10), 4.6, 1.3);
    this.createSectionLabel('Floating & Moving Platform', new THREE.Vector3(0, 8.0, -17), 4.2, 1.25);
    this.createKinematicDrum(
      'RotatingDrum',
      new THREE.Vector3(-15, -1, -15),
      1.0,
      10.0,
      'rotateX',
      0.5,
      kinematicPlatformMat,
    );
    this.createSectionLabel('Kinematic Rotating Drum', new THREE.Vector3(-15, 3.2, -15), 4.2, 1.2);

    this.spawnPoint = { position: new THREE.Vector3(0, 2.0, 0) };
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
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(panelPad, 86, logicalWidth - panelPad * 2, logicalHeight - 172);
    ctx.strokeStyle = 'rgba(20, 20, 24, 0.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(panelPad, 86, logicalWidth - panelPad * 2, logicalHeight - 172);
    const baseFontPx = 84;
    ctx.font = `700 ${baseFontPx}px Segoe UI, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const availableTextWidth = logicalWidth - panelPad * 2 - 64;
    const textWidth = Math.max(1, ctx.measureText(text).width);
    const scaleFactor = Math.min(1, availableTextWidth / textWidth);
    ctx.save();
    ctx.translate(logicalWidth / 2, logicalHeight / 2);
    ctx.scale(scaleFactor, 1);
    ctx.fillStyle = '#101014';
    ctx.shadowColor = 'rgba(255,255,255,0.35)';
    ctx.shadowBlur = 1.2;
    ctx.fillText(text, 0, 0);
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
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(4096, 4096);
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
  }

  dispose(): void {
    this.unload();
    this.assetLoader.clearAll();
  }
}
