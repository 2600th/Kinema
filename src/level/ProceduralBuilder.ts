import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COLLISION_GROUP_WORLD } from '@core/constants';
import type { SpawnPointData } from '@core/types';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { ColliderFactory } from '@physics/ColliderFactory';
import {
  SHOWCASE_LAYOUT,
  SHOWCASE_STATION_ORDER,
  STATION_SPAWN_OVERRIDES,
  getShowcaseBayTopY,
  getShowcaseStationZ,
  type ShowcaseStationKey,
} from '@level/ShowcaseLayout';
import { GrassEffect } from '@level/GrassEffect';
import { SparkleParticles } from '@level/SparkleParticles';
import { createBush, createTree, createRock, createFlower, scatterProps } from '@level/ProceduralProps';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { NavMeshManager } from '@navigation/NavMeshManager';
import { NavPatrolSystem } from '@navigation/NavPatrolSystem';
import { NavDebugOverlay } from '@navigation/NavDebugOverlay';

// ---------------------------------------------------------------------------
// Result type returned to LevelManager after a procedural build.
// ---------------------------------------------------------------------------

export interface MovingPlatformEntry {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  base: THREE.Vector3;
  mode: 'x' | 'y' | 'rotateY' | 'rotateX' | 'xy' | 'yRotate';
  speed: number;
  amplitude: number;
  rotationOffset: THREE.Euler;
}

export interface FloatingPlatformEntry {
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
}

export interface DynamicBodyEntry {
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  currQuat: THREE.Quaternion;
  hasPose: boolean;
}

export interface AnimatedMaterialEntry {
  mat: THREE.MeshStandardMaterial;
  baseIntensity: number;
  speed: number;
}

export interface DustMoteEntry {
  sprite: THREE.Sprite;
  origin: THREE.Vector3;
  speed: number;
  phase: number;
}

export interface ProceduralBuildResult {
  meshes: THREE.Object3D[];
  colliders: RAPIER.Collider[];
  bodies: RAPIER.RigidBody[];
  movingPlatforms: MovingPlatformEntry[];
  floatingPlatforms: FloatingPlatformEntry[];
  dynamicBodies: DynamicBodyEntry[];
  ladderZones: THREE.Box3[];
  animatedMaterials: AnimatedMaterialEntry[];
  dustMotes: DustMoteEntry[];
  sparkleParticles: SparkleParticles | null;
  vfxNoiseTexture: THREE.CanvasTexture | null;
  vfxLightningLight: THREE.PointLight | null;
  spawnPoint: SpawnPointData;
  navMeshManager: NavMeshManager | null;
  navPatrolSystem: NavPatrolSystem | null;
  navDebugOverlay: NavDebugOverlay | null;
}

/**
 * Builds the procedural showcase corridor level.
 *
 * Extracted from LevelManager to keep that class focused on orchestration
 * (loading, unloading, runtime updates) while this class owns geometry creation.
 */
export class ProceduralBuilder {
  // Accumulator arrays populated during build and returned as ProceduralBuildResult.
  private meshes: THREE.Object3D[] = [];
  private colliders: RAPIER.Collider[] = [];
  private bodies: RAPIER.RigidBody[] = [];
  private movingPlatformsArr: MovingPlatformEntry[] = [];
  private floatingPlatformsArr: FloatingPlatformEntry[] = [];
  private dynamicBodiesArr: DynamicBodyEntry[] = [];
  private ladderZonesArr: THREE.Box3[] = [];
  private animatedMaterialsArr: AnimatedMaterialEntry[] = [];
  private dustMotesArr: DustMoteEntry[] = [];
  private vfxNoiseTextureRef: THREE.CanvasTexture | null = null;
  private vfxLightningLightRef: THREE.PointLight | null = null;
  private spawnPointData: SpawnPointData = { position: new THREE.Vector3(0, 2, 0) };
  private navMeshManagerRef: NavMeshManager | null = null;
  private navPatrolSystemRef: NavPatrolSystem | null = null;
  private navDebugOverlayRef: NavDebugOverlay | null = null;

  private colliderFactory: ColliderFactory;

  constructor(
    private scene: THREE.Scene,
    private physicsWorld: PhysicsWorld,
    private maxAnisotropy: number,
    private loadGenerationRef: { value: number },
    private stationFilterKey: ShowcaseStationKey | null,
  ) {
    this.colliderFactory = new ColliderFactory(physicsWorld);
  }

  /** Yield control to the browser so CSS animations can paint a frame. */
  private yield(): Promise<void> {
    return new Promise(r => setTimeout(r, 0));
  }

  /** Build the procedural showcase corridor and return all created resources. */
  async build(): Promise<void> {
    const gridTexture = this.createGroundGridTexture();
    // ── Astro Bot-inspired bright, plastic-toy palette — all clearcoat for premium look ──
    const floorMat = new THREE.MeshPhysicalMaterial({
      color: 0xe8ecf0,
      map: gridTexture,
      roughness: 0.25,
      metalness: 0.0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
    });
    const stepMat = new THREE.MeshPhysicalMaterial({ color: 0x00a2ff, roughness: 0.35, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05, emissive: 0x0066cc, emissiveIntensity: 0.1 });
    const slopeMat = new THREE.MeshPhysicalMaterial({ color: 0x33cc33, roughness: 0.35, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05 });
    const obstacleMat = new THREE.MeshPhysicalMaterial({ color: 0xff3366, roughness: 0.3, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.1, emissive: 0xff1144, emissiveIntensity: 0.08 });
    const kinematicPlatformMat = new THREE.MeshPhysicalMaterial({ color: 0xffd700, roughness: 0.25, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05 });
    const floatingPlatformMat = new THREE.MeshPhysicalMaterial({ color: 0x00cccc, roughness: 0.3, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.1 });

    // Station filter: when set, only build the target station + a minimal floor.
    const buildAll = this.stationFilterKey === null;
    const isTarget = (key: ShowcaseStationKey): boolean => buildAll || this.stationFilterKey === key;

    if (!buildAll) {
      // Minimal floor so the player doesn't fall through
      const stationZ = getShowcaseStationZ(this.stationFilterKey!);
      const stationFloor = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 30), floorMat);
      stationFloor.position.set(0, -1.5, stationZ);
      stationFloor.name = 'StationFloor_col';
      stationFloor.receiveShadow = true;
      this.scene.add(stationFloor);
      this.meshes.push(stationFloor);
      stationFloor.updateWorldMatrix(true, false);
      this.colliders.push(this.colliderFactory.createTrimesh(stationFloor));
    }

    // Broad floor
    if (buildAll) {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(300, 5, 300), floorMat);
    // WHY: The showcase hall floor surface sits at y=-1.0. If the broad floor
    // also has its top face at y=-1.0, the two coplanar surfaces z-fight and
    // the grid flickers. Keep the broad floor below the hall floor plane.
    floor.position.set(0, -4.0, 0);
    floor.name = 'Floor_col';
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.meshes.push(floor);
    floor.updateWorldMatrix(true, false);
    this.colliders.push(this.colliderFactory.createTrimesh(floor));
    } // end buildAll broad floor

    await this.yield(); // let loading screen animate

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
    const floorRoughnessNoise = this.createFloorRoughnessTexture();
    // Correct texture repeat for corridor aspect ratio (60w x 700l ≈ 1:12).
    // Both grid and roughness maps need proportional repeat so tiles are square in world space.
    const corridorAspect = hallLength / hallWidth;
    const hallGridTex = gridTexture.clone();
    hallGridTex.repeat.set(10, 10 * corridorAspect);
    hallGridTex.needsUpdate = true;
    floorRoughnessNoise.repeat.set(3, 3 * corridorAspect);
    // Bright white clearcoat floor — shiny Astro Bot toybox plastic.
    const hallFloorMat = new THREE.MeshPhysicalMaterial({
      color: 0xf0f4f8,
      roughness: 0.2,
      metalness: 0.0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
    });
    hallFloorMat.map = hallGridTex;
    hallFloorMat.roughnessMap = floorRoughnessNoise;
    hallFloorMat.needsUpdate = true;
    // (Walls removed — open-air design. hallWallMat no longer needed.)
    // Bay material is now per-station themed (see stationColors array below).

    // Walls removed — open-air floating walkway design.

    // Corridor structure (skip in single-station mode)
    if (buildAll) {
    const hallFloor = new THREE.Mesh(new THREE.BoxGeometry(hallWidth, 0.6, hallLength), hallFloorMat);
    hallFloor.position.set(0, -1.3, showcaseCenterZ);
    hallFloor.name = 'ShowcaseFloor_col';
    hallFloor.receiveShadow = true;
    this.scene.add(hallFloor);
    this.meshes.push(hallFloor);
    hallFloor.updateWorldMatrix(true, false);
    this.colliders.push(this.colliderFactory.createTrimesh(hallFloor));

    // ── Astro Bot-style: open-air floating walkway with rounded edge rails ──
    // No walls, no ribs, no beams — just clean rounded borders on the floor edges.
    // Thick chunky rounded rails — Astro Bot "safe bumper" aesthetic.
    const railMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    });
    const railRadius = 0.5;

    // Left edge rail — thick capsule-style bumper
    const leftRail = new THREE.Mesh(
      new THREE.CapsuleGeometry(railRadius, hallLength, 6, 12),
      railMat,
    );
    leftRail.rotation.x = Math.PI / 2; // align along Z
    leftRail.position.set(-hallWidth / 2, -0.7, showcaseCenterZ);
    leftRail.name = 'WalkwayRail_L';
    leftRail.castShadow = true;
    leftRail.receiveShadow = true;
    this.scene.add(leftRail);
    this.meshes.push(leftRail);
    leftRail.updateWorldMatrix(true, false);
    this.colliders.push(this.colliderFactory.createTrimesh(leftRail));

    // Right edge rail
    const rightRail = leftRail.clone();
    rightRail.position.set(hallWidth / 2, -0.8, showcaseCenterZ);
    rightRail.name = 'WalkwayRail_R';
    this.scene.add(rightRail);
    this.meshes.push(rightRail);
    rightRail.updateWorldMatrix(true, false);
    this.colliders.push(this.colliderFactory.createTrimesh(rightRail));

    // Thin side skirt below the floor for visual thickness (like a floating platform)
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x8090a0, roughness: 0.5, metalness: 0.1 });
    const leftSkirt = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 1.2, hallLength),
      skirtMat,
    );
    leftSkirt.position.set(-hallWidth / 2 + 0.15, -1.6, showcaseCenterZ);
    leftSkirt.name = 'WalkwaySkirt_L';
    this.scene.add(leftSkirt);
    this.meshes.push(leftSkirt);

    const rightSkirt = leftSkirt.clone();
    rightSkirt.position.set(hallWidth / 2 - 0.15, -1.6, showcaseCenterZ);
    rightSkirt.name = 'WalkwaySkirt_R';
    this.scene.add(rightSkirt);
    this.meshes.push(rightSkirt);

    // ── Floating sparkle particles throughout the corridor ──
    const sparkles = new SparkleParticles({
      count: 400,
      areaWidth: hallWidth - 4,
      areaHeight: 14,
      areaDepth: hallLength - 20,
      position: new THREE.Vector3(0, 6, showcaseCenterZ),
    });
    this.scene.add(sparkles.points);
    this.meshes.push(sparkles.points);
    // Store sparkles for update in fixedUpdate
    (this as unknown as { _sparkles?: SparkleParticles })._sparkles = sparkles;
    } // end buildAll corridor structure

    await this.yield(); // let loading screen animate

    // ── Per-station Astro Bot color theme palette ──
    const stationColors: number[] = [
      0x00a2ff, // steps — sky blue
      0x33cc33, // slopes — green
      0xffcc66, // movement — warm yellow
      0xff3399, // doubleJump — hot pink
      0x00ffff, // grab — cyan
      0xff6600, // throw — orange
      0x9900ff, // door — purple
      0xffd700, // vehicles — gold
      0x00b3b3, // platformsMoving — teal
      0xe63900, // platformsPhysics — red
      0x00e680, // materials — emerald
      0x4b0082, // vfx — indigo
      0xc0c0c0, // navigation — silver
      0xffdf00, // futureA — bright yellow
    ];

    // Bay pedestals: all in normal mode, single target in station mode.
    const stationKeys = buildAll ? SHOWCASE_STATION_ORDER : [this.stationFilterKey!];
    const bayZ = stationKeys.map((k) => getShowcaseStationZ(k));
    for (let i = 0; i < bayZ.length; i++) {
      const z = bayZ[i];
      if (i > 0 && i % 2 === 0) await this.yield(); // yield every 2 stations
      // Per-station colored pedestal — MeshPhysicalMaterial with clearcoat for premium plastic.
      const stationColorIdx = SHOWCASE_STATION_ORDER.indexOf(stationKeys[i] ?? stationKeys[0]);
      const stationColor = stationColors[stationColorIdx] ?? 0xe8ecf4;
      const stationBayMat = new THREE.MeshPhysicalMaterial({
        color: stationColor,
        roughness: 0.2,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        transmission: 0.15,
        thickness: 0.5,
        emissive: stationColor,
        emissiveIntensity: 0.08,
      });
      // Rounded box for soft toy-like edges that catch specular highlights.
      const pedestal = new THREE.Mesh(
        new RoundedBoxGeometry(bayWidth, bayPedestalHeight, bayLength, 4, 0.06),
        stationBayMat,
      );
      pedestal.position.set(0, bayPedestalY, z);
      pedestal.receiveShadow = true;
      pedestal.name = `ShowcaseBay${i}_col`;
      this.scene.add(pedestal);
      this.meshes.push(pedestal);
      pedestal.updateWorldMatrix(true, false);
      this.colliders.push(this.colliderFactory.createTrimesh(pedestal));

      // Emissive accent edge — glowing strip around the pedestal top edge for bloom.
      // Subtle emissive accent — gentle bloom glow.
      const accentMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: stationColor,
        emissiveIntensity: 2.0,
        roughness: 0.0,
        metalness: 0.0,
      });
      const accentRing = new THREE.Mesh(
        new THREE.BoxGeometry(bayWidth + 0.2, 0.06, bayLength + 0.2),
        accentMat,
      );
      accentRing.position.set(0, bayTopY + 0.03, z);
      accentRing.name = `ShowcaseBayAccent${i}`;
      this.scene.add(accentRing);
      this.meshes.push(accentRing);

      // Add grass + organic props on green-themed stations.
      // Props are placed on the OUTER EDGES of the pedestal to avoid overlapping
      // station obstacles (steps, slopes, etc.) which occupy the center.
      if (buildAll && (stationColorIdx === 1 || stationColorIdx === 10 || stationColorIdx === 12)) {
        // Grass only on outer edges — two side strips, not full center.
        const edgeDepth = 3;
        for (const side of [-1, 1]) {
          const grass = new GrassEffect({
            width: bayWidth - 6,
            depth: edgeDepth,
            bladeCount: 400,
            bladeHeight: 0.35,
            bladeWidth: 0.06,
            position: new THREE.Vector3(0, bayTopY + 0.01, z + side * (bayLength / 2 - edgeDepth / 2 - 0.5)),
            windSpeed: 1.2,
            windStrength: 0.2,
          });
          this.scene.add(grass.mesh);
          this.meshes.push(grass.mesh);
        }

        // Bushes along the LEFT and RIGHT edges only (high |X|), avoiding center obstacles.
        for (const xSide of [-1, 1]) {
          const bushes = scatterProps(
            () => createBush(0.7, 0x3daa5f),
            3, 8, bayLength - 4,
            new THREE.Vector3(xSide * (bayWidth / 2 - 6), bayTopY + 0.2, z),
            { minScale: 0.5, maxScale: 1.0 },
          );
          this.scene.add(bushes);
          this.meshes.push(bushes);
        }

        // Trees at the far corners only (high |X| AND |Z|).
        const treePositions = [
          new THREE.Vector3(-bayWidth / 2 + 5, bayTopY, z + bayLength / 2 - 2),
          new THREE.Vector3(bayWidth / 2 - 5, bayTopY, z - bayLength / 2 + 2),
        ];
        for (const tPos of treePositions) {
          const tree = createTree(2.0, 0x28a745, 0x8b6914);
          tree.position.copy(tPos);
          const s = 0.7 + Math.random() * 0.3;
          tree.scale.setScalar(s);
          this.scene.add(tree);
          this.meshes.push(tree as unknown as THREE.Object3D);
        }

        // Flowers along the front edge strip only.
        const flowers = scatterProps(
          () => createFlower(0.4, [0xff69b4, 0xffcc00, 0xff6b6b, 0x69b4ff][Math.floor(Math.random() * 4)]),
          8, bayWidth - 10, 2,
          new THREE.Vector3(0, bayTopY, z + bayLength / 2 - 1.5),
          { minScale: 0.5, maxScale: 0.9 },
        );
        this.scene.add(flowers);
        this.meshes.push(flowers);
      }

      // Rocks on non-green stations — placed at far corners, not edges.
      if (buildAll && stationColorIdx !== 1 && stationColorIdx !== 10 && stationColorIdx !== 12) {
        const rockPositions = [
          new THREE.Vector3(-bayWidth / 2 + 4, bayTopY + 0.08, z + bayLength / 2 - 2),
          new THREE.Vector3(bayWidth / 2 - 4, bayTopY + 0.08, z - bayLength / 2 + 2),
        ];
        for (const rPos of rockPositions) {
          const rock = createRock(0.35, [0xaab2bd, 0x95a5a6, 0x7f8c8d][Math.floor(Math.random() * 3)]);
          rock.position.copy(rPos);
          rock.rotation.y = Math.random() * Math.PI * 2;
          this.scene.add(rock);
          this.meshes.push(rock);
        }
      }
    }

    await this.yield();

    // Open-air corridor: no ceiling panels. Use low-height lamp posts instead
    // for per-station accent lighting that doesn't float in the sky.
    for (let i = 0; i < bayZ.length; i++) {
      const z = bayZ[i];
      const stationColorIdx = SHOWCASE_STATION_ORDER.indexOf(stationKeys[i] ?? stationKeys[0]);
      const stationColor = stationColors[stationColorIdx] ?? 0xffffff;

      // Low lamp post at each station — sits on the pedestal edge.
      const postMat = new THREE.MeshStandardMaterial({ color: 0x606878, roughness: 0.4, metalness: 0.3 });
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.5, 8), postMat);
      post.position.set(-bayWidth / 2 + 2, bayTopY + 1.75, z);
      post.castShadow = true;
      post.name = `StationLamp${i}`;
      this.scene.add(post);
      this.meshes.push(post);

      // Glowing lamp head
      const lampMat = new THREE.MeshStandardMaterial({
        color: stationColor,
        emissive: stationColor,
        emissiveIntensity: 1.0,
        roughness: 0.1,
      });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), lampMat);
      lamp.position.set(-bayWidth / 2 + 2, bayTopY + 3.7, z);
      lamp.name = `StationLampHead${i}`;
      this.scene.add(lamp);
      this.meshes.push(lamp);

      // Warm point light from the lamp
      const light = new THREE.PointLight(stationColor, 30, 20, 2);
      light.position.set(-bayWidth / 2 + 2, bayTopY + 3.5, z);
      light.castShadow = false;
      light.name = `StationLampLight${i}`;
      this.scene.add(light);
      this.meshes.push(light);
    }

    // Spawn point: near corridor entrance in full mode, near target station in station mode.
    if (buildAll) {
      this.spawnPointData = {
        position: new THREE.Vector3(0, 2, showcaseCenterZ + hallLength / 2 - 160),
        rotation: new THREE.Euler(0, Math.PI, 0),
      };
    } else {
      const targetZ = getShowcaseStationZ(this.stationFilterKey!);
      const override = STATION_SPAWN_OVERRIDES[this.stationFilterKey!];
      const ox = override?.offset?.[0] ?? 0;
      const oy = override?.offset?.[1] ?? 0;
      const oz = override?.offset?.[2] ?? 0;
      const rot = override?.rotation
        ? new THREE.Euler(override.rotation[0], override.rotation[1], override.rotation[2])
        : new THREE.Euler(0, Math.PI, 0);
      this.spawnPointData = {
        position: new THREE.Vector3(ox, 2 + oy, targetZ + 10 + oz),
        rotation: rot,
      };
    }

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

    await this.yield(); // let loading screen animate

    // --- Per-station geometry (gated by isTarget) ---

    if (isTarget('steps')) {
    // Rough plane section (materials + footing). Kept inside the showcase corridor.
    const roughPlane = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 10), obstacleMat);
    roughPlane.position.set(20, bayTopY + 0.3, zSteps + 2);
    roughPlane.rotation.set(-0.08, 0.12, 0.06);
    roughPlane.name = 'RoughPlane_col';
    roughPlane.receiveShadow = true;
    this.scene.add(roughPlane);
    this.meshes.push(roughPlane);
    roughPlane.updateWorldMatrix(true, false);
    this.colliders.push(this.colliderFactory.createTrimesh(roughPlane));

    // Step series
    const addStep = (name: string, size: THREE.Vector3, pos: THREE.Vector3) => {
      const step = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), stepMat);
      step.position.copy(pos);
      step.name = name;
      step.receiveShadow = true;
      this.scene.add(step);
      this.meshes.push(step);
      step.updateWorldMatrix(true, false);
      this.colliders.push(this.colliderFactory.createTrimesh(step));
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
    } // end steps

    if (isTarget('slopes')) {
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
      this.meshes.push(slope);
      slope.updateWorldMatrix(true, false);
      this.colliders.push(this.colliderFactory.createTrimesh(slope));
    });
    this.createSectionLabel(
      'Slopes\n23.5\u00B0 \u2022 43.1\u00B0 \u2022 62.7\u00B0',
      new THREE.Vector3(0, 3.6, zSlopes + 6),
      7.2,
      1.55,
    );
    } // end slopes

    await this.yield(); // let loading screen animate

    if (isTarget('movement')) {
    // Combined movement bay: ladder + crouch + rope in a single platform stage.
    this.createLadder('MainLadder', new THREE.Vector3(14, bayTopY, zMovement), 4.2, obstacleMat);
    this.createCrouchCourse(new THREE.Vector3(0, bayTopY, zMovement), obstacleMat);
    this.createSectionLabel(
      'Movement\nW/S climb \u2022 C crouch \u2022 Space jump off rope',
      new THREE.Vector3(0, 3.0, zMovement + 6),
      11.2,
      2.25,
    );
    } // end movement

    if (isTarget('doubleJump')) {
    this.createDoubleJumpCourse(new THREE.Vector3(-6, bayTopY, zDoubleJump), stepMat);
    this.createSectionLabel(
      'Double Jump\nSpace \u2022 Multi-tier jump platforms',
      new THREE.Vector3(-2, 4.9, zDoubleJump),
      7.6,
      1.65,
    );
    } // end doubleJump

    await this.yield(); // let loading screen animate

    if (isTarget('grab')) {
    this.createSectionLabel(
      'Grab & Pull\nPress F to grab / release',
      new THREE.Vector3(0, 2.55, zGrab),
      10.2,
      2.2,
    );
    const grabbableMat = new THREE.MeshPhysicalMaterial({ color: 0x4fa8d8, roughness: 0.3, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05 });
    this.createDynamicBox('PushCubeS', new THREE.Vector3(0, bayTopY + 0.5, zGrab + 2), new THREE.Vector3(1, 1, 1), grabbableMat, { grabbable: true });
    this.createDynamicBox('PushCubeM', new THREE.Vector3(0, bayTopY + 0.75, zGrab), new THREE.Vector3(1.5, 1.5, 1.5), grabbableMat, { grabbable: true });
    this.createDynamicBox('PushCubeL', new THREE.Vector3(0, bayTopY + 1.0, zGrab - 3), new THREE.Vector3(2, 2, 2), grabbableMat, { grabbable: true });
    this.createDynamicBox('PushCubeTinyA', new THREE.Vector3(3.5, bayTopY + 0.25, zGrab), new THREE.Vector3(0.5, 0.5, 0.5), obstacleMat, { grabbable: false });
    this.createDynamicBox('PushCubeTinyB', new THREE.Vector3(-3.5, bayTopY + 0.25, zGrab), new THREE.Vector3(0.5, 0.5, 0.5), obstacleMat, { grabbable: false });
    this.createSpinningToy(new THREE.Vector3(14, 2.5, zGrab - 2), obstacleMat);
    } // end grab

    if (isTarget('throw')) {
    this.createSectionLabel(
      'Pick Up & Throw\nF to pick up \u2022 LMB to throw \u2022 C to drop',
      new THREE.Vector3(0, 2.55, zThrow),
      11.0,
      2.25,
    );
    } // end throw

    if (isTarget('door')) {
    this.createSectionLabel(
      'Door & Beacon\nPress F near objects',
      new THREE.Vector3(0, 2.55, zDoor),
      10.2,
      2.15,
    );
    } // end door

    if (isTarget('vehicles')) {
    this.createSectionLabel(
      'Vehicles\nF to enter / exit \u2022 E/Q altitude (drone)',
      new THREE.Vector3(0, 2.55, zVehicles),
      9.2,
      2.05,
    );
    } // end vehicles

    await this.yield(); // let loading screen animate

    if (isTarget('platformsMoving')) {
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
    } // end platformsMoving

    await this.yield(); // let loading screen animate

    if (isTarget('platformsPhysics')) {
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
    // Drum offset in Z to avoid blocking the floating moving platform on X axis.
    this.createKinematicDrum(
      'RotatingDrum',
      new THREE.Vector3(0, bayTopY + 0.8, zPlatformsPhysics + 2),
      1.5,
      14.0,
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
    } // end platformsPhysics

    if (isTarget('materials')) {
    // Materials bay.
    this.createSectionLabel(
      'Materials\nGlass \u2022 Mirror \u2022 Copper \u2022 Ceramic \u2022 Emissive\nRough \u2022 Metal \u2022 Brushed \u2022 Iridescent \u2022 Lava',
      new THREE.Vector3(0, 3.2, zMaterials + 6),
      11.4,
      2.45,
    );
    this.createMaterialsBay(new THREE.Vector3(0, bayTopY, zMaterials), bayWidth, obstacleMat);
    } // end materials

    await this.yield(); // let loading screen animate

    if (isTarget('vfx')) {
    // VFX bay.
    this.createSectionLabel(
      'Visual Effects\nDissolve \u2022 Fire & Smoke \u2022 Lightning & Rain \u2022 Glowing Ring',
      new THREE.Vector3(0, 3.2, zVfx + 6),
      11.4,
      2.15,
    );
    void this.createVfxBayV2(new THREE.Vector3(0, bayTopY, zVfx), bayWidth);
    } // end vfx

    if (isTarget('navigation')) {
    // Navigation bay: navmesh + patrol agents.
    this.createSectionLabel(
      'Navigation\nNavMesh \u2022 Crowd Patrol \u2022 N=debug \u2022 T=target',
      new THREE.Vector3(0, 3.2, zNavigation + 6),
      11.4,
      2.25,
    );
    this.createNavcatBay(zNavigation, bayTopY);
    } // end navigation

    if (isTarget('futureA')) {
    // Reserved bay with "under construction" visual treatment.
    this.createSectionLabel('Reserved\nFuture demos', new THREE.Vector3(0, 2.5, zFutureA), 8.8, 2.0);

    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.9 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    const barrierGeo = new THREE.BoxGeometry(1.2, 1.0, 0.4);
    const barrierPositions = [0, -4, 4];
    barrierPositions.forEach((xOff, i) => {
      const mat = i % 2 === 0 ? yellowMat : darkMat;
      const barrier = new THREE.Mesh(barrierGeo, mat);
      barrier.position.set(xOff, bayTopY + 0.5, zFutureA);
      barrier.castShadow = true;
      barrier.receiveShadow = true;
      barrier.name = `FutureA_barrier_${i}`;
      this.scene.add(barrier);
      this.meshes.push(barrier);
    });
    } // end futureA

    await this.yield(); // let loading screen animate

    // --- Visual polish (skip in single-station mode) ---
    // Open-air design: only floor-level decorations, no wall/ceiling references.
    if (buildAll) {
    this.addFloorCenterline(hallLength, showcaseCenterZ);
    this.addDustMotes(hallWidth, hallLength, showcaseCenterZ);
    this.addHeroSpotlights(bayZ, bayPedestalY);
    } // end buildAll visual polish

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
    // Bright white-blue tile floor — Astro Bot toybox aesthetic.
    ctx.fillStyle = '#e4eaf0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Subtle light-blue/white checkerboard for playful tile rhythm.
    const tileSize = 256;
    for (let ty = 0; ty < canvas.height; ty += tileSize) {
      for (let tx = 0; tx < canvas.width; tx += tileSize) {
        const checker = ((tx / tileSize) + (ty / tileSize)) % 2 === 0;
        ctx.fillStyle = checker ? 'rgba(220, 235, 250, 0.5)' : 'rgba(200, 215, 235, 0.35)';
        ctx.fillRect(tx + 2, ty + 2, tileSize - 4, tileSize - 4);
      }
    }

    const majorStep = 256;
    const minorStep = 64;

    // Draw crisp, tileable lines:
    // - avoid drawing outside the canvas bounds (no `<= width`),
    // - draw on pixel centers for stable mipmaps,
    // - then copy border pixels ("wrap pad") so RepeatWrapping is seamless.
    ctx.save();
    ctx.translate(0.5, 0.5);

    ctx.strokeStyle = 'rgba(180, 195, 210, 0.25)';
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

    ctx.strokeStyle = 'rgba(160, 180, 200, 0.35)';
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
    texture.anisotropy = this.maxAnisotropy;
    texture.needsUpdate = true;
    return texture;
  }

  /** Procedural noise texture for floor roughness — breaks up flat specularity. */
  private createFloorRoughnessTexture(): THREE.CanvasTexture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const d = img.data;
    // Low-frequency isotropic noise for subtle roughness variation.
    // Avoids high-frequency aliasing at grazing camera angles.
    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = (i / size) | 0;
      // Low-frequency broad strokes (no aliasing at distance)
      const n1 = Math.sin(x * 0.03 + y * 0.025) * Math.cos(y * 0.03 - x * 0.02) * 0.15;
      const n2 = Math.sin(x * 0.07 + 1.7) * Math.cos(y * 0.07 + 2.3) * 0.08;
      const noise = 0.7 + n1 + n2; // ~0.55 – 0.85 range, gentle variation
      const v = Math.max(0, Math.min(255, (noise * 255) | 0));
      const idx = i * 4;
      d[idx] = v;
      d[idx + 1] = v;
      d[idx + 2] = v;
      d[idx + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 6);
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = true;
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
    this.meshes.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    body.enableCcd(true);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setFriction(0.7)
      .setRestitution(0.05)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

    this.bodies.push(body);
    this.colliders.push(collider);
    this.dynamicBodiesArr.push({
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
      this.meshes.push(step);
      step.updateWorldMatrix(true, false);
      this.colliders.push(this.colliderFactory.createTrimesh(step));
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
      this.meshes.push(arch);
      const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), archMat);
      sideL.position.set(base.x - 1.4, base.y + 0.75, base.z + zOffset);
      this.scene.add(sideL);
      this.meshes.push(sideL);
      const sideR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), archMat);
      sideR.position.set(base.x + 1.4, base.y + 0.75, base.z + zOffset);
      this.scene.add(sideR);
      this.meshes.push(sideR);
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
    this.meshes.push(mesh);
    mesh.updateWorldMatrix(true, false);
    this.colliders.push(this.colliderFactory.createTrimesh(mesh));
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
    this.meshes.push(leftRail, rightRail);

    const rungCount = Math.max(4, Math.floor(height / 0.45));
    for (let i = 0; i < rungCount; i++) {
      const rung = new THREE.Mesh(rungGeom, material);
      rung.position.set(base.x, base.y + 0.4 + i * (height - 0.7) / (rungCount - 1), base.z);
      rung.castShadow = true;
      rung.receiveShadow = true;
      rung.name = `${name}_rung_${i}`;
      this.scene.add(rung);
      this.meshes.push(rung);
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
    this.bodies.push(ladderBody);
    this.colliders.push(ladderCollider);

    const ladderZone = new THREE.Box3(
      new THREE.Vector3(base.x - 1.1, base.y - 0.2, base.z - 0.9),
      new THREE.Vector3(base.x + 1.1, base.y + height + 0.4, base.z + 0.9),
    );
    this.ladderZonesArr.push(ladderZone);
  }

  private createSpinningToy(position: THREE.Vector3, material: THREE.Material): void {
    // Truncated cone visual (cylinderGeometry [2.5, 0.2, 0.5]).
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 0.2, 0.5, 24), material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'SpinningToy_dyn';
    this.scene.add(mesh);
    this.meshes.push(mesh);

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

    this.bodies.push(body);
    this.colliders.push(stemCollider);
    this.colliders.push(ballCollider);
    this.dynamicBodiesArr.push({
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
    this.meshes.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(base.x, base.y, base.z);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setFriction(0.8)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

    this.bodies.push(body);
    this.colliders.push(collider);
    this.movingPlatformsArr.push({
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
    this.meshes.push(mesh);

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

    this.bodies.push(body);
    this.colliders.push(collider);
    this.dynamicBodiesArr.push({
      mesh,
      body,
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
      hasPose: false,
    });
    this.floatingPlatformsArr.push({
      mesh,
      body,
      rayLength: 2.5,
      floatingDistance: 1.2,
      springK: 3.5,
      dampingC: 0.4,
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
    _material: THREE.Material,
  ): void {
    // Procedural striped texture so rotation is visually obvious.
    const stripeCanvas = document.createElement('canvas');
    stripeCanvas.width = 256;
    stripeCanvas.height = 256;
    const sctx = stripeCanvas.getContext('2d')!;
    const stripeCount = 8;
    const stripeH = stripeCanvas.height / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      sctx.fillStyle = i % 2 === 0 ? '#ff4444' : '#ffffff';
      sctx.fillRect(0, i * stripeH, stripeCanvas.width, stripeH);
    }
    const stripeTex = new THREE.CanvasTexture(stripeCanvas);
    stripeTex.wrapS = THREE.RepeatWrapping;
    stripeTex.wrapT = THREE.RepeatWrapping;
    stripeTex.needsUpdate = true;

    const drumMat = new THREE.MeshPhysicalMaterial({
      map: stripeTex,
      roughness: 0.3,
      metalness: 0.0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.1,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24), drumMat);
    mesh.position.copy(base);
    mesh.rotation.z = Math.PI / 2; // align drum
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${name}_col`;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(base.x, base.y, base.z)
      .setRotation(new RAPIER.Quaternion(0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)));
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cylinder(length / 2, radius)
      .setFriction(0.8)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

    this.bodies.push(body);
    this.colliders.push(collider);
    this.movingPlatformsArr.push({
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
    const platformDepth = 12; // fits within bay pedestal (bayLength = 14)
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
    this.meshes.push(navPlatform);

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
      this.meshes.push(mesh);
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
      this.colliders.push(this.colliderFactory.createTrimesh(obs));
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

    // Generate navmesh from padded platform + all obstacles.
    // Seed the flood fill at the platform center so disconnected obstacle-top
    // regions are pruned before any agents spawn.
    const seedPoint = new THREE.Vector3(0, surfaceY, zStation);
    this.navMeshManagerRef = new NavMeshManager();
    this.navMeshManagerRef.generate([navInputMesh, ...obstacles], seedPoint);
    navInputGeo.dispose();

    const navMesh = this.navMeshManagerRef.getNavMesh();
    if (!navMesh) {
      console.warn('[LevelManager] Failed to generate navmesh for navigation bay');
      return;
    }

    const reachableFilter = this.navMeshManagerRef.getReachableFilter();
    this.navPatrolSystemRef = new NavPatrolSystem(this.scene, navMesh, 5, reachableFilter);
    this.navDebugOverlayRef = new NavDebugOverlay(this.scene, this.navMeshManagerRef);
  }

  // ---------------------------------------------------------------------------
  // Visual polish helpers
  // ---------------------------------------------------------------------------

  /** Glowing cyan centerline running the full corridor length — Astro Bot guide light. */
  private addFloorCenterline(hallLength: number, centerZ: number): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x00e5ff,
      emissiveIntensity: 1.5,
      roughness: 0.0,
    });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, hallLength), mat);
    strip.position.set(0, -0.97, centerZ);
    strip.name = 'FloorCenterline';
    strip.receiveShadow = false;
    strip.castShadow = false;
    this.scene.add(strip);
    this.meshes.push(strip);
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
      this.meshes.push(sprite);
      this.dustMotesArr.push({
        sprite,
        origin: sprite.position.clone(),
        speed: 0.3 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
      });
    }
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
      this.meshes.push(light);
      this.meshes.push(light.target);
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
    texture.anisotropy = this.maxAnisotropy;
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
    this.meshes.push(sprite);
  }

  private createMaterialsBay(base: THREE.Vector3, bayWidth: number, _fallbackMaterial: THREE.Material): void {
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
    this.animatedMaterialsArr.push({ mat: emissiveGreen, baseIntensity: 1.8, speed: 2.2 });

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
    this.animatedMaterialsArr.push({ mat: lava, baseIntensity: 2.5, speed: 1.6 });

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
        this.meshes.push(mesh);
        mesh.updateWorldMatrix(true, false);
        this.colliders.push(this.colliderFactory.createTrimesh(mesh));
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
    this.meshes.push(greenLight);

    // Point light near lava (orange glow)
    const lavaX = startX + 4 * spacing;
    const lavaLight = new THREE.PointLight(0xff6622, 10, 10, 2);
    lavaLight.position.set(lavaX, base.y + 2.0, backZ);
    lavaLight.castShadow = false;
    lavaLight.name = 'MatLight_Lava';
    this.scene.add(lavaLight);
    this.meshes.push(lavaLight);

    // Backplate removed — open-air design, no walls.
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

  /** New VFX showcase with 4 demos: dissolve, fire+smoke, lightning+rain, glowing ring. */
  private async createVfxBayV2(base: THREE.Vector3, bayWidth: number): Promise<void> {
    const gen = this.loadGenerationRef.value;
    try {
      const { createVfxShowcase } = await import('@level/VfxShowcase');
      if (this.loadGenerationRef.value !== gen) return;
      const objects = await createVfxShowcase(this.scene, base, bayWidth);
      this.meshes.push(...objects);
    } catch (err) {
      console.warn('[ProceduralBuilder] VFX showcase V2 failed, falling back to legacy:', err);
      // Fall back to old VFX bay
      await this.createVfxBay(base, bayWidth);
    }
  }

  /** @deprecated Legacy VFX bay — kept as fallback if TSL imports fail. */
  private async createVfxBay(base: THREE.Vector3, bayWidth: number): Promise<void> {
    const gen = this.loadGenerationRef.value;
    // Try TSL GPU-driven path; fall back to legacy sprites if unavailable.
    try {
      const { MeshBasicNodeMaterial } = await import('three/webgpu');
      const {
        Fn, time, uv, positionLocal, vec3, vec4, vec2, float, sin, cos, mul, add, mix, min, atan,
        texture, color, PI, TWO_PI, luminance,
      } = await import('three/tsl');
      const { mx_fractal_noise_float } = await import('three/tsl');

      // Guard: if a new load/unload happened while awaiting imports, bail out
      if (this.loadGenerationRef.value !== gen) {
        console.log('[LevelManager] VFX bay creation aborted — level changed during import');
        return;
      }

      // Shared noise texture (NoColorSpace — raw data, not sRGB).
      this.vfxNoiseTextureRef = this.createNoiseTexture();
      this.vfxNoiseTextureRef.colorSpace = THREE.NoColorSpace;
      const noiseTex = this.vfxNoiseTextureRef;

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
      this.meshes.push(tornadoInner);

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
      this.meshes.push(tornadoOuter);

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
      this.meshes.push(tornadoFloor);

      // Tornado point light
      const tornadoLight = new THREE.PointLight(0xff6b2d, 12, 16, 2);
      tornadoLight.position.set(tornadoX, base.y + 3.0, backRowZ);
      tornadoLight.castShadow = false;
      tornadoLight.name = 'VFX_TornadoLight';
      this.scene.add(tornadoLight);
      this.meshes.push(tornadoLight);

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
      this.meshes.push(fireInner);

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
      this.meshes.push(fireOuter);

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
      this.meshes.push(glowPlane);

      // Fire point light (kept from old code).
      const fireLight = new THREE.PointLight(0xff6622, 15, 14, 2);
      fireLight.position.set(fireX, base.y + 2.0, frontRowZ);
      fireLight.castShadow = false;
      fireLight.name = 'VFX_FireLight';
      this.scene.add(fireLight);
      this.meshes.push(fireLight);

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
      this.meshes.push(laserCoreA);

      const laserGlowA = new THREE.Mesh(laserGlowGeo, laserGlowMat);
      laserGlowA.position.copy(laserCoreA.position);
      laserGlowA.rotation.copy(laserCoreA.rotation);
      laserGlowA.castShadow = false;
      laserGlowA.receiveShadow = false;
      this.scene.add(laserGlowA);
      this.meshes.push(laserGlowA);

      // Beam B (crossed the other way)
      const laserCoreB = new THREE.Mesh(laserCylGeo, laserCoreMat);
      laserCoreB.position.set(laserX, base.y + 1.8, backRowZ);
      laserCoreB.rotation.set(0, 0, -Math.PI * 0.35);
      laserCoreB.castShadow = false;
      laserCoreB.receiveShadow = false;
      laserCoreB.name = 'VFX_LaserB';
      this.scene.add(laserCoreB);
      this.meshes.push(laserCoreB);

      const laserGlowB = new THREE.Mesh(laserGlowGeo, laserGlowMat);
      laserGlowB.position.copy(laserCoreB.position);
      laserGlowB.rotation.copy(laserCoreB.rotation);
      laserGlowB.castShadow = false;
      laserGlowB.receiveShadow = false;
      this.scene.add(laserGlowB);
      this.meshes.push(laserGlowB);

      const laserLight = new THREE.PointLight(0xff3a3a, 12, 14, 2);
      laserLight.position.set(laserX, base.y + 2.0, backRowZ);
      laserLight.castShadow = false;
      laserLight.name = 'VFX_LaserLight';
      this.scene.add(laserLight);
      this.meshes.push(laserLight);

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
      this.meshes.push(lightningRibbon);

      // Secondary thinner bolt (offset timing + smaller)
      const lightningSecMat = createLightningMat(15, 2.0, 6, 1.2);
      const lightningRibbon2 = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.25, 24, 1), lightningSecMat);
      lightningRibbon2.position.set(lightningX, base.y + 1.8, backRowZ + 0.3);
      lightningRibbon2.name = 'VFX_Lightning2';
      lightningRibbon2.castShadow = false;
      lightningRibbon2.receiveShadow = false;
      lightningRibbon2.frustumCulled = false;
      this.scene.add(lightningRibbon2);
      this.meshes.push(lightningRibbon2);

      // Lightning point light (CPU flicker kept — just 2 lines in update).
      const lightningLight = new THREE.PointLight(0x88ccff, 10, 14, 2);
      lightningLight.position.set(lightningX, base.y + 2.5, backRowZ);
      lightningLight.castShadow = false;
      lightningLight.name = 'VFX_LightningLight';
      this.scene.add(lightningLight);
      this.meshes.push(lightningLight);
      this.vfxLightningLightRef = lightningLight;

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
      this.meshes.push(scanRingOuter);

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
      this.meshes.push(scanRingInner);

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
      this.meshes.push(scanBeam);

      // Backdrop removed — open-air design.

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
    this.meshes.push(glowPlane);

    // Fire point light.
    const fireLight = new THREE.PointLight(0xff6622, 15, 14, 2);
    fireLight.position.set(fireX, base.y + 2.0, frontRowZ);
    fireLight.castShadow = false;
    fireLight.name = 'VFX_FireLight';
    this.scene.add(fireLight);
    this.meshes.push(fireLight);

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
    this.meshes.push(laser);

    const laserLight = new THREE.PointLight(0xff3a3a, 12, 14, 2);
    laserLight.position.set(laserX, base.y + 2.0, backRowZ);
    laserLight.castShadow = false;
    laserLight.name = 'VFX_LaserLight';
    this.scene.add(laserLight);
    this.meshes.push(laserLight);

    // Lightning point light (static fallback).
    const lightningLight = new THREE.PointLight(0x88ccff, 10, 14, 2);
    lightningLight.position.set(lightningX, base.y + 2.5, backRowZ);
    lightningLight.castShadow = false;
    lightningLight.name = 'VFX_LightningLight';
    this.scene.add(lightningLight);
    this.meshes.push(lightningLight);

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
    this.meshes.push(scanRing);

    // Backdrop removed — open-air design.
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


  /** Collect all created resources into a result object for LevelManager. */
  getResult(): ProceduralBuildResult {
    return {
      meshes: this.meshes,
      colliders: this.colliders,
      bodies: this.bodies,
      movingPlatforms: this.movingPlatformsArr,
      floatingPlatforms: this.floatingPlatformsArr,
      dynamicBodies: this.dynamicBodiesArr,
      ladderZones: this.ladderZonesArr,
      animatedMaterials: this.animatedMaterialsArr,
      dustMotes: this.dustMotesArr,
      sparkleParticles: (this as unknown as { _sparkles?: SparkleParticles })._sparkles ?? null,
      vfxNoiseTexture: this.vfxNoiseTextureRef,
      vfxLightningLight: this.vfxLightningLightRef,
      spawnPoint: this.spawnPointData,
      navMeshManager: this.navMeshManagerRef,
      navPatrolSystem: this.navPatrolSystemRef,
      navDebugOverlay: this.navDebugOverlayRef,
    };
  }
}
