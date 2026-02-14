export const SHOWCASE_LAYOUT = {
  centerZ: 0,
  hall: {
    width: 44,
    length: 260,
  },
  stations: {
    steps: 90,
    slopes: 70,
    ladder: 50,
    crouch: 30,
    doubleJump: 10,
    grab: -10,
    throw: -30,
    door: -50,
    vehicles: -70,
    rope: -90,
    platforms: -110,
  },
} as const;

export type ShowcaseStationKey = keyof typeof SHOWCASE_LAYOUT.stations;

export function getShowcaseStationZ(key: ShowcaseStationKey): number {
  return SHOWCASE_LAYOUT.centerZ + SHOWCASE_LAYOUT.stations[key];
}

