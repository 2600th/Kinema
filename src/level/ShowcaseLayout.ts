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

