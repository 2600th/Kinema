import * as THREE from 'three';
import type { SpawnPointData } from '@core/types';

export const SHOWCASE_LAYOUT = {
  centerZ: 0,
  hall: {
    width: 60,
    // Long enough to host multiple feature bays + reserved space.
    length: 700,
  },
  bay: {
    // Bay pedestals are shallow stages placed on top of the hall floor.
    // Keep these numbers in one place so both procedural geometry and runtime
    // interactables can align consistently.
    pedestalY: -0.85,
    pedestalHeight: 0.35,
    pedestalLength: 14,
    // Total bay visual width is (hallWidth - widthInset).
    widthInset: 6,
  },
  stations: {
    steps: 170,
    slopes: 140,
    movement: 110, // ladder + crouch + rope
    doubleJump: 80,
    grab: 50,
    throw: 20,
    door: -10,
    vehicles: -40,
    platformsMoving: -80,
    platformsPhysics: -120,
    materials: -160,
    vfx: -200,
    navigation: -240,
    // Reserved empty stage near the corridor end for future features.
    futureA: -270,
  },
} as const;

export type ShowcaseStationKey = keyof typeof SHOWCASE_LAYOUT.stations;
export type ShowcaseReviewSpawnKey = ShowcaseStationKey | 'entrance' | 'overviewMid' | 'overviewEnd';

// Corridor order from entrance (positive Z) to end wall (negative Z).
export const SHOWCASE_STATION_ORDER: ShowcaseStationKey[] = [
  'steps',
  'slopes',
  'movement',
  'doubleJump',
  'grab',
  'throw',
  'door',
  'vehicles',
  'platformsMoving',
  'platformsPhysics',
  'materials',
  'vfx',
  'navigation',
  'futureA',
];

export const STATION_SPAWN_OVERRIDES: Partial<Record<ShowcaseStationKey, {
  offset?: [number, number, number];
  rotation?: [number, number, number];
}>> = {
  steps:            { offset: [0, 0, 2] },
  slopes:           { offset: [0, 0, 2] },
  movement:         { offset: [4, 0, 2] },
  doubleJump:       { offset: [0, 0, 4] },
  grab:             { offset: [0, 0, 2] },
  throw:            { offset: [0, 0, 4] },
  door:             { offset: [0, 0, 4] },
  vehicles:         { offset: [0, 0, 4] },
  platformsMoving:  { offset: [0, 1, 2] },
  platformsPhysics: { offset: [0, 1, 2] },
  materials:        { offset: [0, 0, 2] },
  vfx:              { offset: [0, 0, 2] },
  navigation:       { offset: [0, 0, 4] },
  futureA:          { offset: [0, 0, 4] },
};

export function getShowcaseStationZ(key: ShowcaseStationKey): number {
  return SHOWCASE_LAYOUT.centerZ + SHOWCASE_LAYOUT.stations[key];
}

export function getShowcaseBayTopY(): number {
  return SHOWCASE_LAYOUT.bay.pedestalY + SHOWCASE_LAYOUT.bay.pedestalHeight * 0.5;
}

export interface ShowcaseReviewSpawn {
  key: ShowcaseReviewSpawnKey;
  label: string;
  station: ShowcaseStationKey | null;
  offset: [number, number, number];
  rotation: [number, number, number];
  cameraYaw: number;
  cameraPitch: number;
}

const REVIEW_GROUND_Y = getShowcaseBayTopY() + 0.325;

export const PROCEDURAL_REVIEW_SPAWNS: Record<ShowcaseReviewSpawnKey, ShowcaseReviewSpawn> = {
  entrance: {
    key: 'entrance',
    label: 'Corridor Entrance',
    station: null,
    offset: [0, REVIEW_GROUND_Y, SHOWCASE_LAYOUT.hall.length * 0.5 - 162],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.1,
  },
  overviewMid: {
    key: 'overviewMid',
    label: 'Mid Corridor Overview',
    station: null,
    offset: [6, REVIEW_GROUND_Y, 44],
    rotation: [0, Math.PI * 0.82, 0],
    cameraYaw: -0.18,
    cameraPitch: -0.12,
  },
  overviewEnd: {
    key: 'overviewEnd',
    label: 'Deep Corridor Overview',
    station: null,
    offset: [-6, REVIEW_GROUND_Y, -168],
    rotation: [0, 0.12, 0],
    cameraYaw: 0.12,
    cameraPitch: -0.12,
  },
  steps: {
    key: 'steps',
    label: 'Steps Bay',
    station: 'steps',
    offset: [0, REVIEW_GROUND_Y, 9.5],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.18,
  },
  slopes: {
    key: 'slopes',
    label: 'Slopes Bay',
    station: 'slopes',
    offset: [0, REVIEW_GROUND_Y, 9.2],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.2,
  },
  movement: {
    key: 'movement',
    label: 'Movement Bay',
    station: 'movement',
    offset: [0, REVIEW_GROUND_Y, 10.4],
    rotation: [0, 0.08, 0],
    cameraYaw: 0.08,
    cameraPitch: -0.2,
  },
  doubleJump: {
    key: 'doubleJump',
    label: 'Double Jump Bay',
    station: 'doubleJump',
    offset: [-2.5, REVIEW_GROUND_Y, 9.2],
    rotation: [0, 0.12, 0],
    cameraYaw: 0.12,
    cameraPitch: -0.26,
  },
  grab: {
    key: 'grab',
    label: 'Grab Bay',
    station: 'grab',
    offset: [0, REVIEW_GROUND_Y, 9.0],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.18,
  },
  throw: {
    key: 'throw',
    label: 'Throw Bay',
    station: 'throw',
    offset: [0, REVIEW_GROUND_Y, 8.9],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.2,
  },
  door: {
    key: 'door',
    label: 'Door Bay',
    station: 'door',
    offset: [0, REVIEW_GROUND_Y, 9.0],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.18,
  },
  vehicles: {
    key: 'vehicles',
    label: 'Vehicles Bay',
    station: 'vehicles',
    offset: [0, REVIEW_GROUND_Y, 9.4],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.17,
  },
  platformsMoving: {
    key: 'platformsMoving',
    label: 'Moving Platforms Bay',
    station: 'platformsMoving',
    offset: [-4.5, REVIEW_GROUND_Y, 13.2],
    rotation: [0, 0.12, 0],
    cameraYaw: 0.12,
    cameraPitch: -0.16,
  },
  platformsPhysics: {
    key: 'platformsPhysics',
    label: 'Physics Platforms Bay',
    station: 'platformsPhysics',
    offset: [5, REVIEW_GROUND_Y, 13.2],
    rotation: [0, -0.08, 0],
    cameraYaw: -0.08,
    cameraPitch: -0.16,
  },
  materials: {
    key: 'materials',
    label: 'Materials Bay',
    station: 'materials',
    offset: [0, REVIEW_GROUND_Y, 8.8],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.18,
  },
  vfx: {
    key: 'vfx',
    label: 'VFX Bay',
    station: 'vfx',
    offset: [0, REVIEW_GROUND_Y, 8.8],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.22,
  },
  navigation: {
    key: 'navigation',
    label: 'Navigation Bay',
    station: 'navigation',
    offset: [0, REVIEW_GROUND_Y, 9.1],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.18,
  },
  futureA: {
    key: 'futureA',
    label: 'Future Bay',
    station: 'futureA',
    offset: [0, REVIEW_GROUND_Y, 11.8],
    rotation: [0, 0, 0],
    cameraYaw: 0,
    cameraPitch: -0.18,
  },
};

export const PROCEDURAL_REVIEW_SPAWN_ORDER: ShowcaseReviewSpawnKey[] = [
  'entrance',
  'overviewMid',
  'steps',
  'slopes',
  'movement',
  'doubleJump',
  'grab',
  'throw',
  'door',
  'vehicles',
  'platformsMoving',
  'platformsPhysics',
  'materials',
  'vfx',
  'navigation',
  'futureA',
  'overviewEnd',
];

export interface ResolvedReviewSpawn {
  key: ShowcaseReviewSpawnKey;
  label: string;
  spawn: SpawnPointData;
  cameraYaw: number;
  cameraPitch: number;
}

export function resolveProceduralReviewSpawn(
  key: string,
): ResolvedReviewSpawn | null {
  const reviewSpawn = PROCEDURAL_REVIEW_SPAWNS[key as ShowcaseReviewSpawnKey];
  if (!reviewSpawn) return null;

  const baseZ = reviewSpawn.station ? getShowcaseStationZ(reviewSpawn.station) : 0;
  const [x, y, z] = reviewSpawn.offset;
  const [rx, ry, rz] = reviewSpawn.rotation;

  return {
    key: reviewSpawn.key,
    label: reviewSpawn.label,
    spawn: {
      position: new THREE.Vector3(x, y, baseZ + z),
      rotation: new THREE.Euler(rx, ry, rz),
    },
    cameraYaw: reviewSpawn.cameraYaw,
    cameraPitch: reviewSpawn.cameraPitch,
  };
}

