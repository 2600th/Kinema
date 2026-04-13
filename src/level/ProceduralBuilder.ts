import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COLLISION_GROUP_WORLD } from '@core/constants';
import type { SpawnPointData } from '@core/types';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import { ColliderFactory } from '@physics/ColliderFactory';
import {
  SHOWCASE_LAYOUT,
  SHOWCASE_ENTRANCE_START_Z,
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
import type { AssetLoader } from '@level/AssetLoader';

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
  lastPosition: THREE.Vector3;
  lastRotX: number;
  lastRotY: number;
  linearVelocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
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
  moveAccelX?: number;
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
  vfxDisposeCallbacks: Array<() => void>;
  vfxUpdateCallbacks: Array<(dt: number) => void>;
}

/**
 * Builds the procedural showcase corridor level.
 *
 * Extracted from LevelManager to keep that class focused on orchestration
 * (loading, unloading, runtime updates) while this class owns geometry creation.
 */
export class ProceduralBuilder {
  private static groundGridTextureTemplate: THREE.CanvasTexture | null = null;
  private static floorRoughnessTextureTemplate: THREE.CanvasTexture | null = null;
  private static vfxNoiseTextureTemplate: THREE.CanvasTexture | null = null;
  private static sectionLabelTextureTemplates = new Map<string, THREE.CanvasTexture>();
  private static propTextureTemplates = new Map<string, THREE.CanvasTexture>();

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
  private vfxDisposeCallbacks: Array<() => void> = [];
  private vfxUpdateCallbacks: Array<(dt: number) => void> = [];
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
    private assetLoader?: AssetLoader,
  ) {
    this.colliderFactory = new ColliderFactory(physicsWorld);
  }

  /** Yield control to the browser so CSS animations can paint a frame. */
  private yield(): Promise<void> {
    return new Promise(r => setTimeout(r, 0));
  }

  private progressCallback?: (progress: number) => void;

  /** Yield + report progress (0-1) to the loading screen. */
  private async yieldProgress(progress: number): Promise<void> {
    this.progressCallback?.(progress);
    await this.yield();
  }

  /** Build the procedural showcase corridor and return all created resources. */
  async build(onProgress?: (progress: number) => void): Promise<void> {
    this.progressCallback = onProgress;
    onProgress?.(0.05);
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
      const stationFloorSize = new THREE.Vector3(60, 1, 30);
      const stationFloor = new THREE.Mesh(new THREE.BoxGeometry(stationFloorSize.x, stationFloorSize.y, stationFloorSize.z), floorMat);
      stationFloor.position.set(0, -1.5, stationZ);
      stationFloor.name = 'StationFloor_col';
      stationFloor.receiveShadow = true;
      this.scene.add(stationFloor);
      this.meshes.push(stationFloor);
      this.colliders.push(this.colliderFactory.createFixedCuboid(stationFloor.position, stationFloorSize, 0.7));
    }

    // Broad floor
    if (buildAll) {
    const floorSize = new THREE.Vector3(SHOWCASE_LAYOUT.hall.width, 5, SHOWCASE_LAYOUT.hall.length);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(floorSize.x, floorSize.y, floorSize.z),
      floorMat,
    );
    // WHY: The showcase hall floor surface sits at y=-1.0. If the broad floor
    // also has its top face at y=-1.0, the two coplanar surfaces z-fight and
    // the grid flickers. Keep the broad floor below the hall floor plane.
    floor.position.set(0, -4.0, 0);
    floor.name = 'Floor_col';
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.meshes.push(floor);
    this.colliders.push(this.colliderFactory.createFixedCuboid(floor.position, floorSize, 0.7));
    } // end buildAll broad floor

    await this.yieldProgress(0.1);

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
    // Corridor-only assets are created lazily below so station-filter loads skip the work.
    // Correct texture repeat for corridor aspect ratio (60w x 700l ≈ 1:12).
    // Both grid and roughness maps need proportional repeat so tiles are square in world space.
    const floorRoughnessNoise = buildAll ? this.createFloorRoughnessTexture() : null;
    const corridorAspect = buildAll ? hallLength / hallWidth : 1;
    const hallGridTex = buildAll ? gridTexture.clone() : null;
    hallGridTex?.repeat.set(10, 10 * corridorAspect);
    if (hallGridTex) hallGridTex.needsUpdate = true;
    floorRoughnessNoise?.repeat.set(3, 3 * corridorAspect);
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
    const hallFloorSize = new THREE.Vector3(hallWidth, 0.6, hallLength);
    const hallFloor = new THREE.Mesh(new THREE.BoxGeometry(hallFloorSize.x, hallFloorSize.y, hallFloorSize.z), hallFloorMat);
    hallFloor.position.set(0, -1.3, showcaseCenterZ);
    hallFloor.name = 'ShowcaseFloor_col';
    hallFloor.receiveShadow = true;
    this.scene.add(hallFloor);
    this.meshes.push(hallFloor);
    this.colliders.push(this.colliderFactory.createFixedCuboid(hallFloor.position, hallFloorSize, 0.7));

    const boundaryWallMat = new THREE.MeshStandardMaterial({
      color: 0x7b8aa5,
      roughness: 0.45,
      metalness: 0.08,
    });
    const boundaryWallSize = new THREE.Vector3(0.5, 0.7, hallLength);
    const boundaryEndWallSize = new THREE.Vector3(hallWidth - boundaryWallSize.x * 2, boundaryWallSize.y, boundaryWallSize.x);
    const boundaryWallY = -1.0 + boundaryWallSize.y * 0.5;
    const boundaryEndWallZ = hallLength * 0.5 - boundaryEndWallSize.z * 0.5;
    this.createFixedStaticBox(
      'ShowcaseBoundaryWall_L',
      boundaryWallSize,
      new THREE.Vector3(-hallWidth * 0.5 + boundaryWallSize.x * 0.5, boundaryWallY, showcaseCenterZ),
      new THREE.Euler(),
      boundaryWallMat,
      'showcase-boundary',
    );
    this.createFixedStaticBox(
      'ShowcaseBoundaryWall_R',
      boundaryWallSize,
      new THREE.Vector3(hallWidth * 0.5 - boundaryWallSize.x * 0.5, boundaryWallY, showcaseCenterZ),
      new THREE.Euler(),
      boundaryWallMat,
      'showcase-boundary',
    );
    this.createFixedStaticBox(
      'ShowcaseBoundaryWall_Entrance',
      boundaryEndWallSize,
      new THREE.Vector3(0, boundaryWallY, showcaseCenterZ + boundaryEndWallZ),
      new THREE.Euler(),
      boundaryWallMat,
      'showcase-boundary',
    );
    this.createFixedStaticBox(
      'ShowcaseBoundaryWall_End',
      boundaryEndWallSize,
      new THREE.Vector3(0, boundaryWallY, showcaseCenterZ - boundaryEndWallZ),
      new THREE.Euler(),
      boundaryWallMat,
      'showcase-boundary',
    );

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

    await this.yieldProgress(0.2);

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
      if (i > 0 && i % 2 === 0) await this.yieldProgress(0.25 + (i / bayZ.length) * 0.15);
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
      this.createBayAccessRamps(z, bayWidth, bayTopY, stationColor);

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

    await this.yieldProgress(0.4);

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
        position: new THREE.Vector3(0, 2, showcaseCenterZ + SHOWCASE_ENTRANCE_START_Z),
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

    await this.yieldProgress(0.45);

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
    this.createStepsPhysicsPlayground(zSteps, bayTopY);
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

    await this.yieldProgress(0.55);

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

    await this.yieldProgress(0.6);

    if (isTarget('grab')) {
    this.createSectionLabel(
      'Grab & Pull\nPress F to grab / release',
      new THREE.Vector3(0, 2.55, zGrab),
      10.2,
      2.2,
    );
    const grabbableMat = new THREE.MeshPhysicalMaterial({ color: 0x4fa8d8, roughness: 0.3, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05 });
    this.createDynamicBox('PushCubeS', new THREE.Vector3(0, bayTopY + 0.5, zGrab + 2), new THREE.Vector3(1.0, 1.0, 1.0), grabbableMat, { grabbable: true, grabWeight: 0.85, mass: 18, linearDamping: 0.5, angularDamping: 1.1 });
    this.createDynamicBox('PushCubeM', new THREE.Vector3(0, bayTopY + 0.65, zGrab), new THREE.Vector3(1.3, 1.3, 1.3), grabbableMat, { grabbable: true, grabWeight: 0.6, mass: 30, linearDamping: 0.56, angularDamping: 1.2 });
    this.createDynamicBox('PushCubeL', new THREE.Vector3(0, bayTopY + 0.8, zGrab - 3), new THREE.Vector3(1.6, 1.6, 1.6), grabbableMat, { grabbable: true, grabWeight: 0.4, mass: 46, linearDamping: 0.62, angularDamping: 1.3 });
    this.createDynamicBox('PushCubeTinyA', new THREE.Vector3(3.5, bayTopY + 0.25, zGrab), new THREE.Vector3(0.5, 0.5, 0.5), obstacleMat, { grabbable: false, mass: 7.5, linearDamping: 0.42, angularDamping: 0.9 });
    this.createDynamicBox('PushCubeTinyB', new THREE.Vector3(-3.5, bayTopY + 0.25, zGrab), new THREE.Vector3(0.5, 0.5, 0.5), obstacleMat, { grabbable: false, mass: 7.5, linearDamping: 0.42, angularDamping: 0.9 });
    this.createSpinningToy(new THREE.Vector3(14, 2.5, zGrab - 2), obstacleMat);
    } // end grab

    if (isTarget('throw')) {
    this.createSectionLabel(
      'Pick Up & Throw\nF to pick up \u2022 LMB to throw \u2022 C to drop',
      new THREE.Vector3(0, 3.6, zThrow + 5),
      11.0,
      2.25,
    );

    // ── THROW STATION — CARNIVAL GALLERY ENVIRONMENT ──────────────────────
    //
    // Layout (viewed from above, player spawns at zThrow+4 facing -Z):
    //
    //   zThrow+4   PLAYER SPAWN (facing toward targets)
    //   zThrow+2   ──── Throwing line (glowing floor strip) ────
    //   zThrow+1   ┌──Shelf──┐  Pickup objects on display shelf
    //   zThrow     │         │
    //   zThrow-1   └─────────┘
    //   zThrow-2   ┌─LANE─┬─LANE─┬─LANE─┐  Three target lanes
    //              │Bottle│Brick │ Cans  │
    //   zThrow-3   │      │ Wall │       │
    //   zThrow-4   └──────┴──────┴───────┘
    //   zThrow-5   ═══ BACKDROP WALL (catches debris) ═══
    //
    //   x:  -8 ──── -5 ──── 0 ──── +5 ──── +8

    const targetZ = zThrow - 2.45;
    const throwLineZ = zThrow + 1.7;
    const throwMarkZ = zThrow + 2.45;
    const pickupConsoleZ = zThrow + 2.55;
    const backdropZ = zThrow - 4.35;
    const laneStartZ = throwLineZ - 0.35;
    const laneEndZ = targetZ + 0.9;
    const laneLength = laneStartZ - laneEndZ;
    const laneThemes = [
      { x: -5, color: 0x4aa6ff, glow: 0x77d7ff, name: 'Bottle' },
      { x: 0, color: 0xff7a38, glow: 0xffb066, name: 'Impact' },
      { x: 5, color: 0x54df94, glow: 0x94ffc2, name: 'Can' },
    ] as const;
    const addStaticMesh = (
      mesh: THREE.Mesh,
      name: string,
      withCollider = true,
    ): THREE.Mesh => {
      mesh.name = name;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      if (withCollider) {
        mesh.updateWorldMatrix(true, false);
        this.colliders.push(this.colliderFactory.createTrimesh(mesh));
      }
      return mesh;
    };
    const addFixedCuboidCollider = (
      center: THREE.Vector3,
      size: THREE.Vector3,
      kind = 'throw-station',
    ): void => {
      const body = this.physicsWorld.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z),
      );
      body.userData = { kind };
      const collider = this.physicsWorld.world.createCollider(
        RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
          .setFriction(0.7)
          .setCollisionGroups(COLLISION_GROUP_WORLD),
        body,
      );
      this.bodies.push(body);
      this.colliders.push(collider);
    };

    const throwShellMat = new THREE.MeshPhysicalMaterial({
      color: 0xff6a1a,
      roughness: 0.28,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      emissive: 0x9a3100,
      emissiveIntensity: 0.12,
    });
    const throwPanelMat = new THREE.MeshStandardMaterial({
      color: 0x1f2734,
      roughness: 0.72,
      metalness: 0.18,
    });
    const throwDeckMat = new THREE.MeshStandardMaterial({
      color: 0x2b3240,
      roughness: 0.82,
      metalness: 0.08,
    });
    const throwTrimMat = new THREE.MeshStandardMaterial({
      color: 0x0b141f,
      roughness: 0.24,
      metalness: 0.2,
      emissive: 0x52d6ff,
      emissiveIntensity: 1.65,
    });
    const throwGlowMat = new THREE.MeshStandardMaterial({
      color: 0x090a0d,
      roughness: 0.15,
      metalness: 0.0,
      emissive: 0xff934d,
      emissiveIntensity: 2.2,
    });
    const throwMarkOuterMat = new THREE.MeshStandardMaterial({
      color: 0xff7b2e,
      roughness: 0.28,
      metalness: 0.0,
      emissive: 0xaa3200,
      emissiveIntensity: 0.16,
    });
    throwMarkOuterMat.polygonOffset = true;
    throwMarkOuterMat.polygonOffsetFactor = -2;
    throwMarkOuterMat.polygonOffsetUnits = -4;
    const throwMarkInnerMat = new THREE.MeshStandardMaterial({
      color: 0x263140,
      roughness: 0.72,
      metalness: 0.16,
    });
    throwMarkInnerMat.polygonOffset = true;
    throwMarkInnerMat.polygonOffsetFactor = -3;
    throwMarkInnerMat.polygonOffsetUnits = -5;
    const throwMarkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x151c24,
      roughness: 0.18,
      metalness: 0.0,
      emissive: 0xff964f,
      emissiveIntensity: 1.8,
    });
    throwMarkTrimMat.polygonOffset = true;
    throwMarkTrimMat.polygonOffsetFactor = -4;
    throwMarkTrimMat.polygonOffsetUnits = -6;
    const throwSupportMat = new THREE.MeshStandardMaterial({
      color: 0x637184,
      roughness: 0.4,
      metalness: 0.45,
    });

    const arenaBase = new THREE.Mesh(
      new RoundedBoxGeometry(19.2, 0.18, 10.4, 4, 0.08),
      throwDeckMat,
    );
    arenaBase.position.set(0, bayTopY + 0.09, zThrow - 0.15);
    arenaBase.receiveShadow = true;
    addStaticMesh(arenaBase, 'ThrowArenaBase_col', false);
    addFixedCuboidCollider(new THREE.Vector3(0, bayTopY + 0.09, zThrow - 0.15), new THREE.Vector3(19.2, 0.18, 10.4));

    const centralRunway = new THREE.Mesh(
      new RoundedBoxGeometry(12.2, 0.08, 3.0, 4, 0.05),
      throwPanelMat,
    );
    centralRunway.position.set(0, bayTopY + 0.14, zThrow - 0.75);
    centralRunway.receiveShadow = true;
    addStaticMesh(centralRunway, 'ThrowRunway_col', false);
    addFixedCuboidCollider(new THREE.Vector3(0, bayTopY + 0.14, zThrow - 0.75), new THREE.Vector3(12.2, 0.08, 3.0));

    const throwDiscOuter = new THREE.Mesh(
      new THREE.CircleGeometry(1.65, 40),
      throwMarkOuterMat,
    );
    throwDiscOuter.rotation.x = -Math.PI / 2;
    throwDiscOuter.position.set(0, bayTopY + 0.187, throwMarkZ);
    addStaticMesh(throwDiscOuter, 'ThrowDiscOuter_col', false);

    const throwDiscInner = new THREE.Mesh(
      new THREE.CircleGeometry(1.12, 40),
      throwMarkInnerMat,
    );
    throwDiscInner.rotation.x = -Math.PI / 2;
    throwDiscInner.position.set(0, bayTopY + 0.189, throwMarkZ);
    addStaticMesh(throwDiscInner, 'ThrowDiscInner_col', false);

    const throwDiscRing = new THREE.Mesh(
      new THREE.RingGeometry(1.19, 1.34, 48),
      throwMarkTrimMat,
    );
    throwDiscRing.rotation.x = -Math.PI / 2;
    throwDiscRing.position.set(0, bayTopY + 0.191, throwMarkZ);
    addStaticMesh(throwDiscRing, 'ThrowDiscRing', false);

    const throwLine = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 0.18), throwMarkTrimMat);
    throwLine.rotation.x = -Math.PI / 2;
    throwLine.position.set(0, bayTopY + 0.192, throwLineZ);
    addStaticMesh(throwLine, 'ThrowLine', false);

    const overheadFrame = new THREE.Mesh(
      new RoundedBoxGeometry(18.8, 4.2, 0.34, 4, 0.08),
      throwShellMat,
    );
    overheadFrame.position.set(0, bayTopY + 2.25, backdropZ - 0.04);
    addStaticMesh(overheadFrame, 'ThrowBackdropFrame_col', false);
    addFixedCuboidCollider(new THREE.Vector3(0, bayTopY + 2.25, backdropZ - 0.04), new THREE.Vector3(18.8, 4.2, 0.34));

    const backdropInset = new THREE.Mesh(
      new THREE.BoxGeometry(16.9, 3.25, 0.16),
      throwPanelMat,
    );
    backdropInset.position.set(0, bayTopY + 1.75, backdropZ + 0.08);
    backdropInset.receiveShadow = true;
    addStaticMesh(backdropInset, 'ThrowBackdrop_col', false);
    addFixedCuboidCollider(new THREE.Vector3(0, bayTopY + 1.75, backdropZ + 0.08), new THREE.Vector3(16.9, 3.25, 0.16));

    const backdropHeader = new THREE.Mesh(
      new RoundedBoxGeometry(9.8, 0.48, 0.5, 4, 0.08),
      throwGlowMat,
    );
    backdropHeader.position.set(0, bayTopY + 3.82, backdropZ + 0.12);
    addStaticMesh(backdropHeader, 'ThrowBackdropHeader', false);
    addFixedCuboidCollider(new THREE.Vector3(0, bayTopY + 3.82, backdropZ + 0.12), new THREE.Vector3(9.8, 0.48, 0.5));

    for (const px of [-8.25, 8.25]) {
      const tower = new THREE.Mesh(
        new RoundedBoxGeometry(1.05, 3.2, 1.2, 4, 0.07),
        throwSupportMat,
      );
      tower.position.set(px, bayTopY + 1.62, zThrow - 0.1);
      tower.castShadow = true;
      tower.receiveShadow = true;
      addStaticMesh(tower, `ThrowSideTower_${px < 0 ? 'L' : 'R'}_col`, false);
      addFixedCuboidCollider(new THREE.Vector3(px, bayTopY + 1.62, zThrow - 0.1), new THREE.Vector3(1.05, 3.2, 1.2));

      const towerStrip = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 2.5, 0.14),
        throwTrimMat,
      );
      towerStrip.position.set(px + (px < 0 ? 0.34 : -0.34), bayTopY + 1.7, zThrow + 0.05);
      addStaticMesh(towerStrip, `ThrowSideTowerGlow_${px < 0 ? 'L' : 'R'}`, false);
    }

    const consoleShellMat = new THREE.MeshPhysicalMaterial({
      color: 0xf46b2c,
      roughness: 0.34,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      emissive: 0x6d2500,
      emissiveIntensity: 0.08,
    });
    const consoleTopMat = new THREE.MeshStandardMaterial({
      color: 0x253140,
      roughness: 0.6,
      metalness: 0.25,
    });
    for (const side of [-1, 1]) {
      const consoleX = side * 5.8;
      const console = new THREE.Mesh(
        new RoundedBoxGeometry(4.2, 0.72, 1.85, 4, 0.07),
        consoleShellMat,
      );
      console.position.set(consoleX, bayTopY + 0.36, pickupConsoleZ);
      console.castShadow = true;
      console.receiveShadow = true;
      addStaticMesh(console, `ThrowPickupConsole_${side < 0 ? 'L' : 'R'}_col`, false);
      addFixedCuboidCollider(new THREE.Vector3(consoleX, bayTopY + 0.36, pickupConsoleZ), new THREE.Vector3(4.2, 0.72, 1.85));

      const consoleTop = new THREE.Mesh(
        new THREE.BoxGeometry(3.5, 0.08, 1.18),
        consoleTopMat,
      );
      consoleTop.position.set(consoleX, bayTopY + 0.73, pickupConsoleZ - 0.05);
      addStaticMesh(consoleTop, `ThrowPickupConsoleTop_${side < 0 ? 'L' : 'R'}`, false);

    }

    const pickupPadXs = [-6.65, -5.4, -4.15, 4.15, 5.4, 6.65];
    for (const padX of pickupPadXs) {
      const padBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.48, 0.05, 24),
        throwPanelMat,
      );
      padBase.position.set(padX, bayTopY + 0.73, pickupConsoleZ - 0.44);
      addStaticMesh(padBase, `ThrowPickupPadBase_${padX.toFixed(2)}`, false);

      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24),
        throwTrimMat,
      );
      pad.position.set(padX, bayTopY + 0.77, pickupConsoleZ - 0.44);
      addStaticMesh(pad, `ThrowPickupPad_${padX.toFixed(2)}`, false);
    }

    const propCrateMat = new THREE.MeshStandardMaterial({
      color: 0x4a5568,
      roughness: 0.55,
      metalness: 0.32,
    });
    const propAccentMat = new THREE.MeshStandardMaterial({
      color: 0x131920,
      roughness: 0.18,
      metalness: 0.08,
      emissive: 0xff8a4d,
      emissiveIntensity: 1.2,
    });
    for (const side of [-1, 1]) {
      const propX = side * 8.05;
      const propZ = zThrow - 2.2;

      const crateBase = new THREE.Mesh(
        new RoundedBoxGeometry(1.25, 0.8, 1.05, 3, 0.05),
        propCrateMat,
      );
      crateBase.position.set(propX, bayTopY + 0.4, propZ);
      crateBase.castShadow = true;
      crateBase.receiveShadow = true;
      addStaticMesh(crateBase, `ThrowPropCrateBase_${side < 0 ? 'L' : 'R'}`, false);
      addFixedCuboidCollider(new THREE.Vector3(propX, bayTopY + 0.4, propZ), new THREE.Vector3(1.25, 0.8, 1.05));

      const crateTop = new THREE.Mesh(
        new RoundedBoxGeometry(0.8, 0.52, 0.8, 3, 0.04),
        propCrateMat,
      );
      crateTop.position.set(propX + side * 0.34, bayTopY + 1.06, propZ + 0.14);
      crateTop.castShadow = true;
      crateTop.receiveShadow = true;
      addStaticMesh(crateTop, `ThrowPropCrateTop_${side < 0 ? 'L' : 'R'}`, false);
      addFixedCuboidCollider(new THREE.Vector3(propX + side * 0.34, bayTopY + 1.06, propZ + 0.14), new THREE.Vector3(0.8, 0.52, 0.8));

      for (let i = 0; i < 3; i++) {
        const canister = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.14, 0.58, 12),
          propAccentMat,
        );
        canister.position.set(propX + side * (-0.35 + i * 0.24), bayTopY + 0.3, zThrow + 3.05);
        addStaticMesh(canister, `ThrowPropCanister_${side < 0 ? 'L' : 'R'}_${i}`, false);
      }

    }

    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const decal = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.015, 0.4),
          new THREE.MeshStandardMaterial({
            color: 0x15181d,
            roughness: 0.2,
            metalness: 0.0,
            emissive: i === 1 ? 0xff934d : 0x52d6ff,
            emissiveIntensity: 1.3,
          }),
        );
        decal.position.set(side * 7.4, bayTopY + 0.11, zThrow + 1.15 - i * 1.15);
        decal.rotation.y = side * 0.42;
        addStaticMesh(decal, `ThrowEdgeDecal_${side < 0 ? 'L' : 'R'}_${i}`, false);
      }
    }

    for (const theme of laneThemes) {
      const laneDeck = new THREE.Mesh(
        new RoundedBoxGeometry(3.4, 0.12, laneLength + 1.1, 4, 0.04),
        throwPanelMat,
      );
      laneDeck.position.set(theme.x, bayTopY + 0.13, (laneStartZ + laneEndZ) * 0.5);
      laneDeck.receiveShadow = true;
      addStaticMesh(laneDeck, `ThrowLaneDeck_${theme.name}`, false);

      const laneBorder = new THREE.Mesh(
        new THREE.BoxGeometry(3.05, 0.04, laneLength + 0.4),
        new THREE.MeshStandardMaterial({
          color: 0x0b0d11,
          roughness: 0.18,
          metalness: 0.0,
          emissive: theme.color,
          emissiveIntensity: 1.4,
        }),
      );
      laneBorder.position.set(theme.x, bayTopY + 0.2, (laneStartZ + laneEndZ) * 0.5);
      addStaticMesh(laneBorder, `ThrowLaneBorder_${theme.name}`, false);

      const laneGuide = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.04, laneLength + 0.7),
        throwTrimMat,
      );
      laneGuide.position.set(theme.x, bayTopY + 0.24, (laneStartZ + laneEndZ) * 0.5);
      addStaticMesh(laneGuide, `ThrowLaneGuide_${theme.name}`, false);

      const laneBackboard = new THREE.Mesh(
        new RoundedBoxGeometry(3.1, 2.3, 0.18, 4, 0.06),
        new THREE.MeshStandardMaterial({
          color: 0x202631,
          roughness: 0.7,
          metalness: 0.18,
          emissive: theme.color,
          emissiveIntensity: 0.16,
        }),
      );
      laneBackboard.position.set(theme.x, bayTopY + 1.52, targetZ - 0.95);
      addStaticMesh(laneBackboard, `ThrowLaneBackboard_${theme.name}`, false);
      addFixedCuboidCollider(new THREE.Vector3(theme.x, bayTopY + 1.52, targetZ - 0.95), new THREE.Vector3(3.1, 2.3, 0.18));

      const laneHalo = new THREE.Mesh(
        new RoundedBoxGeometry(2.5, 0.18, 0.16, 4, 0.04),
        new THREE.MeshStandardMaterial({
          color: 0x111317,
          roughness: 0.2,
          metalness: 0.0,
          emissive: theme.glow,
          emissiveIntensity: 2.0,
        }),
      );
      laneHalo.position.set(theme.x, bayTopY + 2.42, targetZ - 0.77);
      addStaticMesh(laneHalo, `ThrowLaneHalo_${theme.name}`, false);

      const accentLight = new THREE.PointLight(theme.glow, theme.x === 0 ? 18 : 12, 9, 2);
      accentLight.position.set(theme.x, bayTopY + 2.65, targetZ - 0.15);
      accentLight.castShadow = false;
      this.scene.add(accentLight);
      this.meshes.push(accentLight);
    }

    const bottlePedestal = new THREE.Mesh(
      new RoundedBoxGeometry(3.2, 0.72, 2.3, 4, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0x305f9a,
        roughness: 0.45,
        metalness: 0.22,
      }),
    );
    bottlePedestal.position.set(-5, bayTopY + 0.36, targetZ);
    bottlePedestal.receiveShadow = true;
    addStaticMesh(bottlePedestal, 'BottlePedestal_col', false);
    addFixedCuboidCollider(new THREE.Vector3(-5, bayTopY + 0.36, targetZ), new THREE.Vector3(3.2, 0.72, 2.3));

    const bottlePedestalTop = new THREE.Mesh(
      new THREE.BoxGeometry(2.55, 0.08, 1.6),
      throwPanelMat,
    );
    bottlePedestalTop.position.set(-5, bayTopY + 0.74, targetZ);
    addStaticMesh(bottlePedestalTop, 'BottlePedestalTop', false);

    const bottleMat = new THREE.MeshStandardMaterial({
      color: 0xf4e2c8,
      roughness: 0.24,
      metalness: 0.05,
    });
    const bottleR = 0.12;
    const bottleH = 0.22;
    const bottleBaseX = -5;
    const bottleTop = bayTopY + 0.74;
    const bottleSpacing = bottleR * 2.8;
    [
      [bottleBaseX - bottleSpacing, bottleBaseX, bottleBaseX + bottleSpacing],
      [bottleBaseX - bottleSpacing * 0.5, bottleBaseX + bottleSpacing * 0.5],
      [bottleBaseX],
    ].forEach((row, rowIdx) => {
      row.forEach((x) => {
        const y = bottleTop + bottleH + rowIdx * bottleH * 2;
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(bottleR * 0.65, bottleR, bottleH * 2, 10),
          bottleMat,
        );
        mesh.position.set(x, y, targetZ);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.meshes.push(mesh);
        const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, targetZ);
        const body = this.physicsWorld.world.createRigidBody(bd);
        body.setLinearDamping(0.18);
        body.setAngularDamping(0.48);
        this.physicsWorld.world.createCollider(
          RAPIER.ColliderDesc.cylinder(bottleH, bottleR)
            .setFriction(0.5)
            .setRestitution(0.15)
            .setMass(0.72)
            .setCollisionGroups(COLLISION_GROUP_WORLD),
          body,
        );
        body.userData = { kind: 'throwable' };
        this.bodies.push(body);
        this.dynamicBodiesArr.push({
          mesh,
          body,
          prevPos: new THREE.Vector3(x, y, targetZ),
          currPos: new THREE.Vector3(x, y, targetZ),
          prevQuat: new THREE.Quaternion(),
          currQuat: new THREE.Quaternion(),
          hasPose: false,
        });
      });
    });

    const impactPedestal = new THREE.Mesh(
      new RoundedBoxGeometry(3.55, 0.78, 2.45, 4, 0.06),
      throwShellMat,
    );
    impactPedestal.position.set(0, bayTopY + 0.39, targetZ);
    impactPedestal.receiveShadow = true;
    addStaticMesh(impactPedestal, 'ImpactPedestal_col', false);
    addFixedCuboidCollider(new THREE.Vector3(0, bayTopY + 0.39, targetZ), new THREE.Vector3(3.55, 0.78, 2.45));

    const impactFace = new THREE.Mesh(
      new THREE.BoxGeometry(2.7, 1.7, 0.1),
      new THREE.MeshStandardMaterial({
        color: 0x31160d,
        roughness: 0.65,
        metalness: 0.1,
        emissive: 0xff7a38,
        emissiveIntensity: 0.18,
      }),
    );
    impactFace.position.set(0, bayTopY + 1.18, targetZ - 0.78);
    addStaticMesh(impactFace, 'ImpactLaneFace', false);

    const targetMat = new THREE.MeshStandardMaterial({
      color: 0xb52e2e,
      roughness: 0.62,
      metalness: 0.04,
      emissive: 0x240707,
      emissiveIntensity: 0.08,
    });
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 6; col++) {
        const brickW = 0.4;
        const brickH = 0.25;
        const brickD = 0.22;
        const xOff = (row % 2 === 0) ? 0 : brickW * 0.5;
        const x = (col - 2.5) * brickW + xOff;
        const y = bayTopY + 0.79 + brickH * 0.5 + row * brickH;
        this.createDynamicBox(
          `Target_${row}_${col}`,
          new THREE.Vector3(x, y, targetZ),
          new THREE.Vector3(brickW, brickH, brickD),
          targetMat,
          { mass: 0.65, linearDamping: 0.35, angularDamping: 0.9 },
        );
      }
    }

    const canPedestal = new THREE.Mesh(
      new RoundedBoxGeometry(3.2, 0.72, 2.3, 4, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0x287653,
        roughness: 0.42,
        metalness: 0.25,
      }),
    );
    canPedestal.position.set(5, bayTopY + 0.36, targetZ);
    canPedestal.receiveShadow = true;
    addStaticMesh(canPedestal, 'CanPedestal_col', false);
    addFixedCuboidCollider(new THREE.Vector3(5, bayTopY + 0.36, targetZ), new THREE.Vector3(3.2, 0.72, 2.3));

    const canPedestalTop = new THREE.Mesh(
      new THREE.BoxGeometry(2.55, 0.08, 1.6),
      throwPanelMat,
    );
    canPedestalTop.position.set(5, bayTopY + 0.74, targetZ);
    addStaticMesh(canPedestalTop, 'CanPedestalTop', false);

    const canMat = new THREE.MeshStandardMaterial({
      color: 0xc8d0d5,
      roughness: 0.22,
      metalness: 0.84,
    });
    const canR = 0.1;
    const canH = 0.14;
    const canBaseX = 5;
    const canTop = bayTopY + 0.74;
    const canSpacing = canR * 2.7;
    [
      [-1.5, -0.5, 0.5, 1.5].map(i => canBaseX + i * canSpacing),
      [-1, 0, 1].map(i => canBaseX + i * canSpacing),
      [-0.5, 0.5].map(i => canBaseX + i * canSpacing),
      [canBaseX],
    ].forEach((row, rowIdx) => {
      row.forEach((x) => {
        const y = canTop + canH + rowIdx * canH * 2;
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(canR, canR, canH * 2, 8),
          canMat,
        );
        mesh.position.set(x, y, targetZ);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.meshes.push(mesh);
        const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, targetZ);
        const body = this.physicsWorld.world.createRigidBody(bd);
        body.setLinearDamping(0.24);
        body.setAngularDamping(0.64);
        this.physicsWorld.world.createCollider(
          RAPIER.ColliderDesc.cylinder(canH, canR)
            .setFriction(0.3)
            .setRestitution(0.35)
            .setMass(0.16)
            .setCollisionGroups(COLLISION_GROUP_WORLD),
          body,
        );
        body.userData = { kind: 'throwable' };
        this.bodies.push(body);
        this.dynamicBodiesArr.push({
          mesh,
          body,
          prevPos: new THREE.Vector3(x, y, targetZ),
          currPos: new THREE.Vector3(x, y, targetZ),
          prevQuat: new THREE.Quaternion(),
          currQuat: new THREE.Quaternion(),
          hasPose: false,
        });
      });
    });
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
    this.createVehicleCrashPlayground(zVehicles, bayTopY);
    } // end vehicles

    await this.yieldProgress(0.7);

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

    await this.yieldProgress(0.75);

    if (isTarget('platformsPhysics')) {
    // Platform stage B: readable physics interactions.
    const boostPadJumpMultiplier = 6.0;
    const boostPlatformMat = new THREE.MeshPhysicalMaterial({
      color: 0x6cf7c9,
      roughness: 0.22,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      emissive: 0x21d19d,
      emissiveIntensity: 0.18,
    });
    const drumPlatformMat = new THREE.MeshPhysicalMaterial({
      color: 0xffd36b,
      roughness: 0.22,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      emissive: 0xffaa1f,
      emissiveIntensity: 0.16,
    });
    this.createFixedStaticBox(
      'BoostPlatformStatic',
      new THREE.Vector3(5.2, 0.28, 5.2),
      new THREE.Vector3(-12, bayTopY + 0.14, zPlatformsPhysics + 2.25),
      new THREE.Euler(),
      boostPlatformMat,
      'boost-platform',
      { jumpBoostMultiplier: boostPadJumpMultiplier, autoBounce: true },
    );
    this.createKinematicDrum(
      'RollingDrum',
      new THREE.Vector3(0, bayTopY + 0.82, zPlatformsPhysics + 2.1),
      1.55,
      9.5,
      'rotateX',
      0.85,
      drumPlatformMat,
    );
    this.createFloatingPlatform(
      'BoostMovingPlatform',
      new THREE.Vector3(4.2, 0.22, 4.2),
      new THREE.Vector3(12, bayTopY + 1.15, zPlatformsPhysics - 2.75),
      floatingPlatformMat,
      { lockX: false, lockY: false, lockZ: true, rotX: true, rotY: false, rotZ: true },
      { minX: 8, maxX: 16, speedX: 2.35 },
      { kind: 'boost-platform', jumpBoostMultiplier: boostPadJumpMultiplier, autoBounce: true },
    );
    this.createSectionLabel(
      'Physics Platforms\nBoost Pad \u2022 Rolling Drum \u2022 Moving Boost Pad',
      new THREE.Vector3(0, 3.6, zPlatformsPhysics + 6.5),
      12.4,
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
    this.createMaterialsPhysicsProps(new THREE.Vector3(0, bayTopY, zMaterials), bayWidth);
    } // end materials

    await this.yieldProgress(0.85);

    if (isTarget('vfx')) {
    // VFX bay.
    this.createSectionLabel(
      'Visual Effects\nDissolve \u2022 Fire & Smoke \u2022 Lightning & Rain \u2022 Glowing Ring',
      new THREE.Vector3(0, 3.2, zVfx + 6),
      11.4,
      2.15,
    );
    await this.createVfxBayV2(new THREE.Vector3(0, bayTopY, zVfx), bayWidth);
    } // end vfx

    if (isTarget('navigation')) {
    // Navigation bay: navmesh + patrol agents.
    this.createSectionLabel(
      'Navigation\nNavMesh \u2022 Crowd Patrol \u2022 N=debug \u2022 T=target',
      new THREE.Vector3(0, 3.2, zNavigation + 6),
      11.4,
      2.25,
    );
    await this.createNavcatBay(zNavigation, bayTopY);
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

    await this.yieldProgress(0.92);

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
    const cached = ProceduralBuilder.groundGridTextureTemplate;
    if (cached) {
      const clone = cached.clone();
      clone.anisotropy = this.maxAnisotropy;
      clone.needsUpdate = true;
      return clone;
    }

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
    ProceduralBuilder.groundGridTextureTemplate = texture;
    const clone = texture.clone();
    clone.anisotropy = this.maxAnisotropy;
    clone.needsUpdate = true;
    return clone;
  }

  /** Procedural noise texture for floor roughness — breaks up flat specularity. */
  private createFloorRoughnessTexture(): THREE.CanvasTexture {
    const cached = ProceduralBuilder.floorRoughnessTextureTemplate;
    if (cached) {
      const clone = cached.clone();
      clone.needsUpdate = true;
      return clone;
    }

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
    ProceduralBuilder.floorRoughnessTextureTemplate = texture;
    const clone = texture.clone();
    clone.needsUpdate = true;
    return clone;
  }

  private createPropTexture(
    key: string,
    draw: (ctx: CanvasRenderingContext2D, size: number) => void,
    repeatX = 1,
    repeatY = 1,
  ): THREE.CanvasTexture {
    const cached = ProceduralBuilder.propTextureTemplates.get(key);
    if (cached) {
      const clone = cached.clone();
      clone.repeat.set(repeatX, repeatY);
      clone.anisotropy = this.maxAnisotropy;
      clone.needsUpdate = true;
      return clone;
    }

    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const fallback = new THREE.CanvasTexture(canvas);
      fallback.needsUpdate = true;
      return fallback;
    }

    draw(ctx, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.maxAnisotropy;
    texture.needsUpdate = true;
    ProceduralBuilder.propTextureTemplates.set(key, texture);

    const clone = texture.clone();
    clone.repeat.set(repeatX, repeatY);
    clone.anisotropy = this.maxAnisotropy;
    clone.needsUpdate = true;
    return clone;
  }

  private createToyBallTexture(
    key: string,
    shell: string,
    accent: string,
    trim: string,
    motif: 'beach' | 'pinball' | 'target' | 'reactor' | 'bubble',
  ): THREE.CanvasTexture {
    return this.createPropTexture(
      key,
      (ctx, size) => {
        const bg = ctx.createRadialGradient(size * 0.36, size * 0.28, size * 0.02, size * 0.5, size * 0.5, size * 0.56);
        bg.addColorStop(0, trim);
        bg.addColorStop(0.28, shell);
        bg.addColorStop(1, '#0d1320');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);

        if (motif === 'beach') {
          const spokes = 6;
          for (let i = 0; i < spokes; i += 1) {
            const start = (Math.PI * 2 * i) / spokes;
            ctx.beginPath();
            ctx.moveTo(size * 0.5, size * 0.5);
            ctx.arc(size * 0.5, size * 0.5, size * 0.6, start, start + Math.PI / spokes);
            ctx.closePath();
            ctx.fillStyle = i % 2 === 0 ? accent : 'rgba(255,255,255,0.12)';
            ctx.fill();
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.38)';
          ctx.lineWidth = 20;
          ctx.beginPath();
          ctx.arc(size * 0.5, size * 0.5, size * 0.25, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (motif === 'pinball') {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 30;
          for (let x = -size * 0.15; x < size * 1.2; x += size * 0.24) {
            ctx.beginPath();
            ctx.moveTo(x, size);
            ctx.lineTo(x + size * 0.3, 0);
            ctx.stroke();
          }
          ctx.fillStyle = trim;
          ctx.beginPath();
          ctx.arc(size * 0.5, size * 0.5, size * 0.12, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.42)';
          ctx.lineWidth = 12;
          ctx.beginPath();
          ctx.arc(size * 0.5, size * 0.5, size * 0.28, -0.2, Math.PI * 1.7);
          ctx.stroke();
        }

        if (motif === 'target') {
          const rings = [0.42, 0.3, 0.19];
          const fills = [accent, 'rgba(255,255,255,0.14)', trim];
          rings.forEach((ring, index) => {
            ctx.fillStyle = fills[index] ?? accent;
            ctx.beginPath();
            ctx.arc(size * 0.5, size * 0.5, size * ring, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.beginPath();
          ctx.arc(size * 0.5, size * 0.5, size * 0.07, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = accent;
          for (let i = 0; i < 4; i += 1) {
            ctx.save();
            ctx.translate(size * 0.5, size * 0.5);
            ctx.rotate((Math.PI * 0.5 * i) + Math.PI * 0.25);
            ctx.beginPath();
            ctx.moveTo(0, -size * 0.43);
            ctx.lineTo(size * 0.04, -size * 0.32);
            ctx.lineTo(-size * 0.04, -size * 0.32);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }

        if (motif === 'reactor') {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          for (let i = 0; i < 8; i += 1) {
            ctx.save();
            ctx.translate(size * 0.5, size * 0.5);
            ctx.rotate((Math.PI * 2 * i) / 8);
            ctx.fillRect(-size * 0.04, -size * 0.38, size * 0.08, size * 0.16);
            ctx.restore();
          }
          ctx.strokeStyle = accent;
          ctx.lineWidth = 18;
          ctx.beginPath();
          ctx.arc(size * 0.5, size * 0.5, size * 0.29, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = trim;
          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.arc(size * 0.5, size * 0.5, size * 0.18, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = trim;
          ctx.beginPath();
          ctx.arc(size * 0.5, size * 0.5, size * 0.08, 0, Math.PI * 2);
          ctx.fill();
        }

        if (motif === 'bubble') {
          ctx.globalAlpha = 0.42;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 12;
          for (let i = 0; i < 3; i += 1) {
            ctx.beginPath();
            ctx.arc(size * (0.42 + i * 0.08), size * (0.46 - i * 0.06), size * (0.18 + i * 0.03), -0.4, Math.PI * 1.45);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          for (let i = 0; i < 7; i += 1) {
            const x = 80 + i * 54;
            const y = 110 + (i % 2) * 70;
            ctx.beginPath();
            ctx.arc(x, y, 16 + (i % 3) * 5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.arc(size * 0.34, size * 0.28, size * 0.1, 0, Math.PI * 2);
        ctx.fill();
      },
      1,
      1,
    );
  }

  private createImpactPanelTexture(
    key: string,
    base: string,
    accent: string,
    glow: string,
    motif: 'crate' | 'bumper' | 'gate',
  ): THREE.CanvasTexture {
    return this.createPropTexture(
      key,
      (ctx, size) => {
        const bg = ctx.createLinearGradient(0, 0, size, size);
        bg.addColorStop(0, base);
        bg.addColorStop(1, '#101722');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);

        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 10;
        ctx.strokeRect(24, 24, size - 48, size - 48);

        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(52, 52, size - 104, size - 104);

        ctx.fillStyle = accent;
        for (const [x, y] of [[52, 52], [size - 96, 52], [52, size - 96], [size - 96, size - 96]]) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 44, y);
          ctx.lineTo(x, y + 44);
          ctx.closePath();
          ctx.fill();
        }

        if (motif === 'crate') {
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 12;
          ctx.beginPath();
          ctx.moveTo(100, 100);
          ctx.lineTo(size - 100, size - 100);
          ctx.moveTo(size - 100, 100);
          ctx.lineTo(100, size - 100);
          ctx.stroke();

          ctx.strokeStyle = glow;
          ctx.lineWidth = 18;
          ctx.strokeRect(size * 0.34, size * 0.34, size * 0.32, size * 0.32);
        }

        if (motif === 'bumper') {
          ctx.strokeStyle = glow;
          ctx.lineWidth = 24;
          ctx.beginPath();
          ctx.arc(size * 0.5, size * 0.5, size * 0.22, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.arc(size * 0.5, size * 0.5, size * 0.34, 0, Math.PI * 2);
          ctx.stroke();
          for (let i = 0; i < 4; i += 1) {
            ctx.save();
            ctx.translate(size * 0.5, size * 0.5);
            ctx.rotate((Math.PI * 0.5 * i) + Math.PI * 0.25);
            ctx.fillStyle = glow;
            ctx.fillRect(-8, -size * 0.37, 16, 74);
            ctx.restore();
          }
        }

        if (motif === 'gate') {
          ctx.fillStyle = glow;
          ctx.globalAlpha = 0.28;
          ctx.fillRect(size * 0.18, 0, size * 0.12, size);
          ctx.fillRect(size * 0.7, 0, size * 0.12, size);
          ctx.globalAlpha = 1;

          ctx.strokeStyle = accent;
          ctx.lineWidth = 22;
          for (let y = -size * 0.2; y < size; y += 110) {
            ctx.beginPath();
            ctx.moveTo(size * 0.18, y + 70);
            ctx.lineTo(size * 0.32, y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(size * 0.68, y + 70);
            ctx.lineTo(size * 0.82, y);
            ctx.stroke();
          }

          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(size * 0.42, 88, size * 0.16, size - 176);
        }
      },
      1.4,
      1.4,
    );
  }

  private registerAnimatedMaterial(mat: THREE.MeshStandardMaterial, baseIntensity: number, speed: number): void {
    this.animatedMaterialsArr.push({ mat, baseIntensity, speed });
  }

  private createShowcasePropMaterial(
    preset: 'frosted-sphere' | 'reactor-sphere' | 'matte-panel' | 'gloss-panel',
    color: number,
    emissive: number,
  ): THREE.MeshPhysicalMaterial {
    switch (preset) {
      case 'frosted-sphere':
        return new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.22,
          metalness: 0.0,
          transmission: 0.76,
          thickness: 0.38,
          ior: 1.26,
          clearcoat: 0.42,
          clearcoatRoughness: 0.16,
          emissive,
          emissiveIntensity: 0.12,
        });
      case 'reactor-sphere':
        return new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.14,
          metalness: 0.08,
          clearcoat: 1.0,
          clearcoatRoughness: 0.05,
          iridescence: 0.28,
          iridescenceIOR: 1.24,
          emissive,
          emissiveIntensity: 0.22,
        });
      case 'matte-panel':
        return new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.72,
          metalness: 0.05,
          clearcoat: 0.14,
          clearcoatRoughness: 0.3,
          emissive,
          emissiveIntensity: 0.12,
        });
      case 'gloss-panel':
      default:
        return new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.28,
          metalness: 0.12,
          clearcoat: 0.9,
          clearcoatRoughness: 0.09,
          emissive,
          emissiveIntensity: 0.16,
        });
    }
  }

  private createDynamicBox(
    name: string,
    position: THREE.Vector3,
    size: THREE.Vector3,
    material: THREE.Material,
    options?: {
      grabbable?: boolean;
      grabWeight?: number;
      mass?: number;
      linearDamping?: number;
      angularDamping?: number;
      friction?: number;
      restitution?: number;
      rotation?: THREE.Euler;
      rounded?: boolean;
      roundness?: number;
    },
  ): void {
    const geometry = options?.rounded
      ? new RoundedBoxGeometry(size.x, size.y, size.z, 4, options.roundness ?? Math.min(size.x, size.y, size.z) * 0.12)
      : new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    if (options?.rotation) {
      mesh.rotation.copy(options.rotation);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${name}_dyn`;
    mesh.userData.grabbable = options?.grabbable === true;
    mesh.userData.debugName = name;
    if (options?.grabWeight != null) mesh.userData.grabWeight = options.grabWeight;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setLinearDamping(options?.linearDamping ?? 0.18)
      .setAngularDamping(options?.angularDamping ?? 0.45)
      .setTranslation(position.x, position.y, position.z);
    if (options?.rotation) {
      const quat = new THREE.Quaternion().setFromEuler(options.rotation);
      bodyDesc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    }
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    body.userData = { kind: 'showcase-prop', name };
    body.enableCcd(true);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setFriction(options?.friction ?? 0.7)
      .setRestitution(options?.restitution ?? 0.05)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    if (options?.mass != null) {
      colliderDesc.setMass(options.mass);
    }
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

  private createDynamicSphere(
    name: string,
    position: THREE.Vector3,
    radius: number,
    material: THREE.Material,
    options?: {
      mass?: number;
      linearDamping?: number;
      angularDamping?: number;
      restitution?: number;
      friction?: number;
    },
  ): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 20), material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${name}_dyn`;
    mesh.userData.debugName = name;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setLinearDamping(options?.linearDamping ?? 0.14)
      .setAngularDamping(options?.angularDamping ?? 0.3)
      .setTranslation(position.x, position.y, position.z);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    body.userData = { kind: 'showcase-prop', name };
    body.enableCcd(true);
    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setFriction(options?.friction ?? 0.64)
      .setRestitution(options?.restitution ?? 0.12)
      .setCollisionGroups(COLLISION_GROUP_WORLD);
    if (options?.mass != null) {
      colliderDesc.setMass(options.mass);
    }
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

  private createStepsPhysicsPlayground(zSteps: number, bayTopY: number): void {
    const rollerBeachMat = this.createShowcasePropMaterial('frosted-sphere', 0x8adfff, 0x5fd3ff);
    const rollerPinballMat = this.createShowcasePropMaterial('reactor-sphere', 0x6f81ff, 0xff72ba);
    const cubeMat = this.createShowcasePropMaterial('gloss-panel', 0x2e475e, 0x78d8ff);
    const slabMat = this.createShowcasePropMaterial('matte-panel', 0x35363c, 0xffab59);
    this.registerAnimatedMaterial(rollerPinballMat, 0.22, 2.2);
    this.registerAnimatedMaterial(cubeMat, 0.16, 1.7);
    this.registerAnimatedMaterial(slabMat, 0.14, 1.9);

    this.createDynamicSphere(
      'StepsRollerA',
      new THREE.Vector3(15.6, bayTopY + 1.3, zSteps + 1.4),
      0.72,
      rollerBeachMat,
      { mass: 9, linearDamping: 0.1, angularDamping: 0.12, restitution: 0.16 },
    );
    this.createDynamicSphere(
      'StepsRollerB',
      new THREE.Vector3(18.5, bayTopY + 1.35, zSteps + 2.5),
      0.62,
      rollerPinballMat,
      { mass: 7.5, linearDamping: 0.1, angularDamping: 0.12, restitution: 0.14 },
    );
    this.createDynamicBox(
      'StepsPanelCube',
      new THREE.Vector3(16.9, bayTopY + 1.05, zSteps + 2.05),
      new THREE.Vector3(1.15, 1.15, 1.15),
      cubeMat,
      { mass: 14, linearDamping: 0.28, angularDamping: 0.82, rounded: true, roundness: 0.16 },
    );
    this.createDynamicBox(
      'StepsSignalSlab',
      new THREE.Vector3(19.2, bayTopY + 1.22, zSteps + 0.7),
      new THREE.Vector3(0.4, 2.05, 1.55),
      slabMat,
      {
        mass: 18,
        linearDamping: 0.42,
        angularDamping: 0.96,
        restitution: 0.08,
        rotation: new THREE.Euler(0, 0.28, 0),
        rounded: true,
        roundness: 0.08,
      },
    );
  }

  private createVehicleCrashPlayground(zVehicles: number, bayTopY: number): void {
    const cubeMat = this.createShowcasePropMaterial('gloss-panel', 0x35516e, 0x86deff);
    const targetSphereMat = this.createShowcasePropMaterial('frosted-sphere', 0x8dd9ff, 0xffbf6e);
    const reactorSphereMat = this.createShowcasePropMaterial('reactor-sphere', 0x6b75ff, 0x8effdf);
    const wallMat = this.createShowcasePropMaterial('matte-panel', 0x39332d, 0xff9d52);
    this.registerAnimatedMaterial(cubeMat, 0.18, 1.8);
    this.registerAnimatedMaterial(targetSphereMat, 0.14, 2.1);
    this.registerAnimatedMaterial(reactorSphereMat, 0.24, 1.9);
    this.registerAnimatedMaterial(wallMat, 0.12, 1.6);

    this.createDynamicBox(
      'CrashCubeA',
      new THREE.Vector3(-2.5, bayTopY + 0.72, zVehicles - 3.4),
      new THREE.Vector3(1.25, 1.25, 1.25),
      cubeMat,
      { mass: 7.5, linearDamping: 0.12, angularDamping: 0.32, friction: 0.32, restitution: 0.16, rounded: true, roundness: 0.18 },
    );
    this.createDynamicBox(
      'CrashCubeB',
      new THREE.Vector3(0.2, bayTopY + 0.62, zVehicles - 6.0),
      new THREE.Vector3(1.05, 1.05, 1.05),
      cubeMat,
      { mass: 5.8, linearDamping: 0.1, angularDamping: 0.28, friction: 0.28, restitution: 0.18, rounded: true, roundness: 0.14 },
    );
    this.createDynamicBox(
      'CrashCubeC',
      new THREE.Vector3(2.9, bayTopY + 0.82, zVehicles - 4.6),
      new THREE.Vector3(1.45, 1.45, 1.45),
      cubeMat,
      { mass: 9.6, linearDamping: 0.14, angularDamping: 0.36, friction: 0.34, restitution: 0.14, rounded: true, roundness: 0.2 },
    );
    this.createDynamicSphere(
      'CrashSphereA',
      new THREE.Vector3(-5.2, bayTopY + 0.74, zVehicles - 7.2),
      0.74,
      targetSphereMat,
      { mass: 3.6, linearDamping: 0.04, angularDamping: 0.06, restitution: 0.42, friction: 0.22 },
    );
    this.createDynamicSphere(
      'CrashSphereB',
      new THREE.Vector3(5.1, bayTopY + 0.88, zVehicles - 8.1),
      0.88,
      reactorSphereMat,
      { mass: 4.8, linearDamping: 0.05, angularDamping: 0.08, restitution: 0.36, friction: 0.24 },
    );
    this.createDynamicBox(
      'CrashWallA',
      new THREE.Vector3(-0.9, bayTopY + 1.16, zVehicles - 9.1),
      new THREE.Vector3(0.42, 2.15, 1.95),
      wallMat,
      {
        mass: 10.5,
        linearDamping: 0.18,
        angularDamping: 0.42,
        friction: 0.36,
        restitution: 0.14,
        rotation: new THREE.Euler(0, 0.34, 0),
        rounded: true,
        roundness: 0.08,
      },
    );
    this.createDynamicBox(
      'CrashWallB',
      new THREE.Vector3(2.8, bayTopY + 1.04, zVehicles - 11.0),
      new THREE.Vector3(0.36, 1.95, 1.5),
      wallMat,
      {
        mass: 8.4,
        linearDamping: 0.16,
        angularDamping: 0.38,
        friction: 0.34,
        restitution: 0.16,
        rotation: new THREE.Euler(0, -0.22, 0),
        rounded: true,
        roundness: 0.07,
      },
    );
  }

  private createMaterialsPhysicsProps(base: THREE.Vector3, bayWidth: number): void {
    const edgeX = Math.max(18, bayWidth * 0.36);
    const glassMat = this.createShowcasePropMaterial('frosted-sphere', 0xbfe9ff, 0x72e7ef);
    const panelMat = this.createShowcasePropMaterial('gloss-panel', 0x5b6070, 0xc698ff);
    const wallMat = this.createShowcasePropMaterial('matte-panel', 0x293445, 0x9de88c);
    this.registerAnimatedMaterial(glassMat, 0.12, 1.4);
    this.registerAnimatedMaterial(panelMat, 0.16, 1.8);
    this.registerAnimatedMaterial(wallMat, 0.12, 1.7);

    this.createDynamicSphere(
      'MaterialsGlassOrb',
      new THREE.Vector3(-edgeX, base.y + 0.78, base.z + 4.35),
      0.78,
      glassMat,
      { mass: 10.5, linearDamping: 0.1, angularDamping: 0.14, restitution: 0.18, friction: 0.3 },
    );
    this.createDynamicBox(
      'MaterialsIridescentCube',
      new THREE.Vector3(edgeX, base.y + 0.82, base.z - 4.25),
      new THREE.Vector3(1.2, 1.2, 1.2),
      panelMat,
      { mass: 18, linearDamping: 0.26, angularDamping: 0.78, rounded: true, roundness: 0.14 },
    );
    this.createDynamicBox(
      'MaterialsSignalWall',
      new THREE.Vector3(edgeX - 1.4, base.y + 1.08, base.z + 4.9),
      new THREE.Vector3(0.38, 2.05, 1.2),
      wallMat,
      {
        mass: 19,
        linearDamping: 0.42,
        angularDamping: 0.98,
        restitution: 0.05,
        rotation: new THREE.Euler(0, -0.32, 0),
        rounded: true,
        roundness: 0.07,
      },
    );
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
    extraUserData?: Record<string, unknown>,
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
    body.userData = {
      kind: 'moving-platform',
      platformLinearVelocity: { x: 0, y: 0, z: 0 },
      platformAngularVelocity: { x: 0, y: 0, z: 0 },
      ...extraUserData,
    };
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
      lastPosition: base.clone(),
      lastRotX: 0,
      lastRotY: 0,
      linearVelocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
    });
  }

  private createBayAccessRamps(
    zCenter: number,
    bayWidth: number,
    bayTopY: number,
    stationColor: number,
  ): void {
    const hallFloorTopY = -1.0;
    const rise = bayTopY - hallFloorTopY;
    const rampRun = 3.1;
    const rampThickness = 0.1;
    const rampAngle = Math.atan2(rise, rampRun);
    const rampCenterY = hallFloorTopY + rise * 0.5 - 0.03;
    const overlap = 0.01;
    const edgeInset = 0.35;
    const longitudinalSize = new THREE.Vector3(bayWidth - edgeInset * 2, rampThickness, rampRun);
    const rampMaterial = new THREE.MeshPhysicalMaterial({
      color: stationColor,
      roughness: 0.24,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      transmission: 0.0,
      thickness: 0.0,
      emissive: stationColor,
      emissiveIntensity: 0.06,
    });

    this.createStaticRamp(
      `ShowcaseBayRamp_N_${zCenter}`,
      longitudinalSize,
      new THREE.Vector3(0, rampCenterY, zCenter + SHOWCASE_LAYOUT.bay.pedestalLength * 0.5 + rampRun * 0.5 - overlap),
      new THREE.Euler(rampAngle, 0, 0),
      rampMaterial,
    );
    this.createStaticRamp(
      `ShowcaseBayRamp_S_${zCenter}`,
      longitudinalSize,
      new THREE.Vector3(0, rampCenterY, zCenter - SHOWCASE_LAYOUT.bay.pedestalLength * 0.5 - rampRun * 0.5 + overlap),
      new THREE.Euler(-rampAngle, 0, 0),
      rampMaterial,
    );
  }

  private createStaticRamp(
    name: string,
    size: THREE.Vector3,
    position: THREE.Vector3,
    rotation: THREE.Euler,
    material: THREE.Material,
  ): void {
    this.createFixedStaticBox(name, size, position, rotation, material, 'showcase-ramp');
  }

  private createFixedStaticBox(
    name: string,
    size: THREE.Vector3,
    position: THREE.Vector3,
    rotation: THREE.Euler,
    material: THREE.Material,
    kind = 'showcase-static',
    extraUserData?: Record<string, unknown>,
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.name = `${name}_col`;
    mesh.position.copy(position);
    mesh.rotation.copy(rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    const quat = new THREE.Quaternion().setFromEuler(rotation);
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    body.userData = { kind, ...extraUserData };
    const collider = this.physicsWorld.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, size.z * 0.5)
        .setFriction(0.8)
        .setCollisionGroups(COLLISION_GROUP_WORLD),
      body,
    );
    this.bodies.push(body);
    this.colliders.push(collider);
  }

  private createFloatingPlatform(
    name: string,
    size: THREE.Vector3,
    position: THREE.Vector3,
    material: THREE.Material,
    lockConfig?: { lockX: boolean; lockY: boolean; lockZ: boolean; rotX: boolean; rotY: boolean; rotZ: boolean },
    movingConfig?: { minX: number; maxX: number; speedX: number },
    extraUserData?: Record<string, unknown>,
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${name}_dyn`;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setCanSleep(false);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    body.userData = {
      kind: 'floating-platform',
      moving: movingConfig != null,
      ...extraUserData,
    };
    body.enableCcd(true);
    body.setLinearDamping(1.8);
    body.setAngularDamping(4.2);
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
      springK: 9.0,
      dampingC: 1.8,
      moveRangeMinX: movingConfig?.minX,
      moveRangeMaxX: movingConfig?.maxX,
      moveSpeedX: movingConfig?.speedX,
      moveDirectionX: movingConfig ? 1 : undefined,
      moveAccelX: movingConfig ? 7.5 : undefined,
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

    const drumSourceMat = material as THREE.MeshPhysicalMaterial;
    const drumMat = new THREE.MeshPhysicalMaterial({
      map: stripeTex,
      roughness: drumSourceMat.roughness,
      metalness: drumSourceMat.metalness,
      clearcoat: drumSourceMat.clearcoat,
      clearcoatRoughness: drumSourceMat.clearcoatRoughness,
      emissive: drumSourceMat.emissive,
      emissiveIntensity: drumSourceMat.emissiveIntensity,
    });

    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 28), drumMat);
    mesh.position.copy(base);
    mesh.rotation.z = Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${name}_col`;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    const startQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(base.x, base.y, base.z)
      .setRotation({ x: startQuat.x, y: startQuat.y, z: startQuat.z, w: startQuat.w });
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);
    body.userData = {
      kind: 'moving-platform',
      platformLinearVelocity: { x: 0, y: 0, z: 0 },
      platformAngularVelocity: { x: 0, y: 0, z: 0 },
    };
    const collider = this.physicsWorld.world.createCollider(
      RAPIER.ColliderDesc.cylinder(length * 0.5, radius)
        .setFriction(0.95)
        .setCollisionGroups(COLLISION_GROUP_WORLD),
      body,
    );

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
      lastPosition: base.clone(),
      lastRotX: 0,
      lastRotY: 0,
      linearVelocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
    });
  }

  /**
   * Navigation showcase bay: creates a dedicated platform, generates a navmesh from it,
   * and spawns patrol agents constrained to the navigation station area.
   */
  private async createNavcatBay(zStation: number, bayTopY: number): Promise<void> {
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
    await this.navMeshManagerRef.generateAsync([navInputMesh, ...obstacles], seedPoint);
    navInputGeo.dispose();

    const navMesh = this.navMeshManagerRef.getNavMesh();
    if (!navMesh) {
      console.warn('[LevelManager] Failed to generate navmesh for navigation bay');
      return;
    }

    const reachableFilter = this.navMeshManagerRef.getReachableFilter();
    this.navPatrolSystemRef = new NavPatrolSystem(this.scene, navMesh, 5, reachableFilter, this.assetLoader);
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
      const sprite = new THREE.Sprite(moteMat);
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
    const textureCacheKey = `${dpr}:${text}`;
    const cachedTexture = ProceduralBuilder.sectionLabelTextureTemplates.get(textureCacheKey);
    if (cachedTexture) {
      const texture = cachedTexture.clone();
      texture.anisotropy = this.maxAnisotropy;
      texture.needsUpdate = true;
      const material = new THREE.SpriteMaterial({
        map: texture,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        opacity: 1,
      });
      material.premultipliedAlpha = false;
      material.blending = THREE.NormalBlending;
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(position);
      sprite.scale.set(scaleX * 0.92, scaleY * 0.9, 1);
      sprite.name = `Label_${text.slice(0, 18)}`;
      sprite.renderOrder = 20;
      this.scene.add(sprite);
      this.meshes.push(sprite);
      return;
    }

    const logicalWidth = 1440;
    const logicalHeight = 420;
    const panelPad = 56;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(logicalWidth * dpr);
    canvas.height = Math.floor(logicalHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const roundedRect = (x: number, y: number, width: number, height: number, radius: number): void => {
      const r = Math.min(radius, width * 0.5, height * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + width, y, x + width, y + height, r);
      ctx.arcTo(x + width, y + height, x, y + height, r);
      ctx.arcTo(x, y + height, x, y, r);
      ctx.arcTo(x, y, x + width, y, r);
      ctx.closePath();
    };

    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    const panelInset = panelPad + 32;
    const panelX = panelInset;
    const panelY = 112;
    const panelW = logicalWidth - panelInset * 2;
    const panelH = logicalHeight - 224;
    const panelRadius = 28;

    ctx.save();
    roundedRect(panelX, panelY, panelW, panelH, panelRadius);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = 'rgba(4, 7, 13, 0.4)';
    ctx.fill();
    ctx.restore();

    const panelGradient = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY + panelH);
    panelGradient.addColorStop(0, 'rgba(20, 29, 44, 0.72)');
    panelGradient.addColorStop(0.42, 'rgba(11, 17, 28, 0.68)');
    panelGradient.addColorStop(1, 'rgba(7, 10, 18, 0.7)');

    roundedRect(panelX, panelY, panelW, panelH, panelRadius);
    ctx.fillStyle = panelGradient;
    ctx.fill();

    ctx.save();
    roundedRect(panelX, panelY, panelW, panelH, panelRadius);
    ctx.clip();

    const sheen = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY + panelH);
    sheen.addColorStop(0, 'rgba(255,255,255,0.1)');
    sheen.addColorStop(0.16, 'rgba(255,255,255,0.035)');
    sheen.addColorStop(0.7, 'rgba(98,230,255,0.02)');
    sheen.addColorStop(1, 'rgba(255,121,186,0.02)');
    ctx.fillStyle = sheen;
    ctx.fillRect(panelX, panelY, panelW, panelH);

    const highlight = ctx.createRadialGradient(
      panelX + panelW * 0.18,
      panelY + panelH * 0.18,
      0,
      panelX + panelW * 0.18,
      panelY + panelH * 0.18,
      panelW * 0.38,
    );
    highlight.addColorStop(0, 'rgba(255,255,255,0.12)');
    highlight.addColorStop(0.32, 'rgba(255,255,255,0.05)');
    highlight.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = highlight;
    ctx.fillRect(panelX, panelY, panelW, panelH);

    const haze = ctx.createRadialGradient(
      panelX + panelW * 0.8,
      panelY + panelH * 0.35,
      0,
      panelX + panelW * 0.8,
      panelY + panelH * 0.35,
      panelW * 0.28,
    );
    haze.addColorStop(0, 'rgba(98,230,255,0.06)');
    haze.addColorStop(0.35, 'rgba(98,230,255,0.024)');
    haze.addColorStop(1, 'rgba(98,230,255,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(panelX, panelY, panelW, panelH);

    const edgeFade = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
    edgeFade.addColorStop(0, 'rgba(255,255,255,0.08)');
    edgeFade.addColorStop(0.12, 'rgba(255,255,255,0.02)');
    edgeFade.addColorStop(0.88, 'rgba(255,255,255,0.015)');
    edgeFade.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.fillStyle = edgeFade;
    ctx.fillRect(panelX, panelY, panelW, panelH);

    const plateGrain = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY);
    plateGrain.addColorStop(0, 'rgba(255,255,255,0.014)');
    plateGrain.addColorStop(0.5, 'rgba(255,255,255,0.004)');
    plateGrain.addColorStop(1, 'rgba(255,255,255,0.014)');
    ctx.fillStyle = plateGrain;
    for (let y = panelY + 14; y < panelY + panelH - 14; y += 10) {
      ctx.fillRect(panelX + 18, y, panelW - 36, 1);
    }
    ctx.restore();

    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const header = lines[0] ?? '';
    const headerMatch = header.match(/^(\S+)\s+(.*)$/);
    const headerCode = headerMatch?.[1] ?? null;
    const headerTitle = headerMatch?.[2] ?? header;
    const bodyLines = lines.slice(1);

    const headerFontPx = 72;
    const bodyFontPx = bodyLines.length > 0 ? 46 : 62;
    const headerLineHeight = headerFontPx * 1.05;
    const bodyLineHeight = bodyFontPx * 1.05;

    // Measure widths to compute a single horizontal scale factor.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const contentX = panelX + 72;
    const availableTextWidth = panelX + panelW - contentX - 72;
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
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 10;

    // Header: draw "code" in accent + title in white.
    ctx.font = `800 ${headerFontPx}px Segoe UI, Arial, sans-serif`;
    if (headerCode) {
      const code = `${headerCode}`;
      const codeWidth = ctx.measureText(`${code}  `).width;
      ctx.fillStyle = '#9ae8f4';
      ctx.fillText(code, 0, startY);
      ctx.fillStyle = '#f7fbff';
      ctx.fillText(`  ${headerTitle}`, codeWidth, startY);
    } else {
      ctx.fillStyle = '#f7fbff';
      ctx.fillText(headerTitle, 0, startY);
    }

    // Body: smaller, slightly muted.
    ctx.shadowBlur = 6;
    ctx.font = `600 ${bodyFontPx}px Segoe UI, Arial, sans-serif`;
    ctx.fillStyle = 'rgba(224, 238, 255, 0.9)';
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
    ProceduralBuilder.sectionLabelTextureTemplates.set(textureCacheKey, texture);
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
    sprite.scale.set(scaleX * 0.92, scaleY * 0.9, 1);
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
      transmission: 1, thickness: 0.35, ior: 1.45,
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
    const cached = ProceduralBuilder.vfxNoiseTextureTemplate;
    if (cached) {
      const clone = cached.clone();
      clone.needsUpdate = true;
      return clone;
    }

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
    ProceduralBuilder.vfxNoiseTextureTemplate = tex;
    const clone = tex.clone();
    clone.needsUpdate = true;
    return clone;
  }

  /** New VFX showcase with 4 demos: dissolve, fire+smoke, lightning+rain, glowing ring. */
  private async createVfxBayV2(base: THREE.Vector3, bayWidth: number): Promise<void> {
    const gen = this.loadGenerationRef.value;
    try {
      const { createVfxShowcase } = await import('@level/VfxShowcase');
      if (this.loadGenerationRef.value !== gen) return;
      const result = await createVfxShowcase(this.scene, base, bayWidth);
      if (this.loadGenerationRef.value !== gen) {
        result.dispose();
        return;
      }
      this.meshes.push(...result.objects);
      this.vfxDisposeCallbacks.push(result.dispose);
      this.vfxUpdateCallbacks.push(result.update);
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
      tornadoEmissiveMat.forceSinglePass = true;

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
      fireInnerMat.forceSinglePass = true;

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
      forceSinglePass: true,
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
      vfxDisposeCallbacks: this.vfxDisposeCallbacks,
      vfxUpdateCallbacks: this.vfxUpdateCallbacks,
    };
  }
}
