import * as THREE from "three";
import { getShowcaseBayTopY, getShowcaseStationZ, type ShowcaseStationKey } from "@level/ShowcaseLayout";

export interface CoinPlacement {
  id: string;
  station: ShowcaseStationKey;
  value: number;
  position: THREE.Vector3;
}

interface LocalCoinPlacement {
  readonly offset: readonly [number, number, number];
}

const ROUTE_COIN_HEIGHT = getShowcaseBayTopY() + 1.3;
const REWARD_COIN_HEIGHT = getShowcaseBayTopY() + 2.15;

const STATION_LOCAL_COIN_LAYOUTS: Record<ShowcaseStationKey, readonly LocalCoinPlacement[]> = {
  steps: [
    { offset: [14, ROUTE_COIN_HEIGHT, 8] },
    { offset: [14, ROUTE_COIN_HEIGHT, 5] },
    { offset: [14, ROUTE_COIN_HEIGHT + 0.15, 2] },
    { offset: [10.5, REWARD_COIN_HEIGHT, -0.5] },
    { offset: [17.5, REWARD_COIN_HEIGHT, -2.5] },
  ],
  slopes: [
    { offset: [-16, ROUTE_COIN_HEIGHT, 7.5] },
    { offset: [-16, ROUTE_COIN_HEIGHT + 0.2, 4] },
    { offset: [-16, ROUTE_COIN_HEIGHT + 0.35, 0.5] },
    { offset: [-12.5, REWARD_COIN_HEIGHT - 0.15, -2] },
    { offset: [-19.5, REWARD_COIN_HEIGHT + 0.1, -3.5] },
  ],
  movement: [
    { offset: [-16, ROUTE_COIN_HEIGHT, 8.5] },
    { offset: [-16, ROUTE_COIN_HEIGHT + 0.15, 5.4] },
    { offset: [-16, ROUTE_COIN_HEIGHT + 0.3, 2.4] },
    { offset: [-12.5, REWARD_COIN_HEIGHT, 0] },
    { offset: [-19.5, REWARD_COIN_HEIGHT + 0.25, -3.2] },
  ],
  doubleJump: [
    { offset: [14, ROUTE_COIN_HEIGHT, 8] },
    { offset: [14, ROUTE_COIN_HEIGHT + 0.2, 5] },
    { offset: [14, ROUTE_COIN_HEIGHT + 0.45, 2.2] },
    { offset: [10.5, REWARD_COIN_HEIGHT + 0.45, -1.5] },
    { offset: [17.5, REWARD_COIN_HEIGHT + 0.7, -4.2] },
  ],
  grab: [
    { offset: [14, ROUTE_COIN_HEIGHT, 8] },
    { offset: [14, ROUTE_COIN_HEIGHT, 5] },
    { offset: [14, ROUTE_COIN_HEIGHT + 0.1, 2] },
    { offset: [10.5, REWARD_COIN_HEIGHT, -0.8] },
    { offset: [17.5, REWARD_COIN_HEIGHT, -3] },
  ],
  throw: [
    { offset: [-14, ROUTE_COIN_HEIGHT, 8.5] },
    { offset: [-14, ROUTE_COIN_HEIGHT, 5.4] },
    { offset: [-14, ROUTE_COIN_HEIGHT + 0.15, 2.1] },
    { offset: [-10.5, REWARD_COIN_HEIGHT, -1.2] },
    { offset: [-17.5, REWARD_COIN_HEIGHT + 0.25, -4.1] },
  ],
  door: [
    { offset: [-14, ROUTE_COIN_HEIGHT, 7.8] },
    { offset: [-14, ROUTE_COIN_HEIGHT, 4.6] },
    { offset: [-14, ROUTE_COIN_HEIGHT + 0.1, 1.4] },
    { offset: [-10.5, REWARD_COIN_HEIGHT - 0.1, -1.8] },
    { offset: [-17.5, REWARD_COIN_HEIGHT + 0.2, -3.4] },
  ],
  vehicles: [
    { offset: [-16, ROUTE_COIN_HEIGHT, 9] },
    { offset: [-16, ROUTE_COIN_HEIGHT, 6] },
    { offset: [-16, ROUTE_COIN_HEIGHT + 0.15, 3] },
    { offset: [-12.5, REWARD_COIN_HEIGHT + 0.2, -1.4] },
    { offset: [-19.5, REWARD_COIN_HEIGHT + 0.2, -5] },
  ],
  platformsMoving: [
    { offset: [-16, ROUTE_COIN_HEIGHT, 8.8] },
    { offset: [-16, ROUTE_COIN_HEIGHT + 0.15, 5.5] },
    { offset: [-16, ROUTE_COIN_HEIGHT + 0.25, 2.2] },
    { offset: [-12.5, REWARD_COIN_HEIGHT + 0.35, -0.8] },
    { offset: [-19.5, REWARD_COIN_HEIGHT + 0.6, -3.8] },
  ],
  platformsPhysics: [
    { offset: [16, ROUTE_COIN_HEIGHT, 8.8] },
    { offset: [16, ROUTE_COIN_HEIGHT + 0.15, 5.5] },
    { offset: [16, ROUTE_COIN_HEIGHT + 0.25, 2.2] },
    { offset: [12.5, REWARD_COIN_HEIGHT + 0.4, -1.2] },
    { offset: [19.5, REWARD_COIN_HEIGHT + 0.55, -4.2] },
  ],
  materials: [
    { offset: [-14, ROUTE_COIN_HEIGHT, 7.8] },
    { offset: [-14, ROUTE_COIN_HEIGHT, 4.6] },
    { offset: [-14, ROUTE_COIN_HEIGHT + 0.1, 1.4] },
    { offset: [-10.5, REWARD_COIN_HEIGHT, -1.6] },
    { offset: [-17.5, REWARD_COIN_HEIGHT + 0.15, -3.2] },
  ],
  vfx: [
    { offset: [14, ROUTE_COIN_HEIGHT, 7.8] },
    { offset: [14, ROUTE_COIN_HEIGHT, 4.8] },
    { offset: [14, ROUTE_COIN_HEIGHT + 0.15, 1.8] },
    { offset: [10.5, REWARD_COIN_HEIGHT + 0.2, -1.6] },
    { offset: [17.5, REWARD_COIN_HEIGHT + 0.45, -4] },
  ],
  navigation: [
    { offset: [-14, ROUTE_COIN_HEIGHT, 8.2] },
    { offset: [-14, ROUTE_COIN_HEIGHT, 5.2] },
    { offset: [-14, ROUTE_COIN_HEIGHT + 0.1, 2.2] },
    { offset: [-10.5, REWARD_COIN_HEIGHT - 0.05, -0.8] },
    { offset: [-17.5, REWARD_COIN_HEIGHT + 0.2, -3.4] },
  ],
  futureA: [
    { offset: [14, ROUTE_COIN_HEIGHT, 10.5] },
    { offset: [14, ROUTE_COIN_HEIGHT, 7.2] },
    { offset: [14, ROUTE_COIN_HEIGHT + 0.15, 4.2] },
    { offset: [10.5, REWARD_COIN_HEIGHT + 0.1, 0.2] },
    { offset: [17.5, REWARD_COIN_HEIGHT + 0.25, -3.2] },
  ],
};

function toWorldPosition(station: ShowcaseStationKey, offset: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(offset[0], offset[1], getShowcaseStationZ(station) + offset[2]);
}

export function getProceduralCoinPlacements(station?: ShowcaseStationKey | null): CoinPlacement[] {
  const stations = station ? [station] : (Object.keys(STATION_LOCAL_COIN_LAYOUTS) as ShowcaseStationKey[]);
  const placements: CoinPlacement[] = [];

  for (const stationKey of stations) {
    const localPlacements = STATION_LOCAL_COIN_LAYOUTS[stationKey];
    localPlacements.forEach((entry, index) => {
      placements.push({
        id: `${stationKey}-coin-${index + 1}`,
        station: stationKey,
        value: 1,
        position: toWorldPosition(stationKey, entry.offset),
      });
    });
  }

  return placements;
}
