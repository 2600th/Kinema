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
const coin = (offset: readonly [number, number, number]): LocalCoinPlacement => ({ offset });

const STATION_LOCAL_COIN_LAYOUTS: Record<ShowcaseStationKey, readonly LocalCoinPlacement[]> = {
  steps: [
    coin([-8, ROUTE_COIN_HEIGHT, -5.6]),
    coin([-8, ROUTE_COIN_HEIGHT + 0.2, -3.9]),
    coin([-8, ROUTE_COIN_HEIGHT + 0.38, -2.1]),
    coin([8, REWARD_COIN_HEIGHT + 0.25, -1.6]),
    coin([8, REWARD_COIN_HEIGHT + 0.9, 1.2]),
  ],
  slopes: [
    coin([-10, ROUTE_COIN_HEIGHT + 0.25, 4.0]),
    coin([0, ROUTE_COIN_HEIGHT + 0.7, 2.8]),
    coin([10, ROUTE_COIN_HEIGHT + 1.15, 1.2]),
    coin([10, REWARD_COIN_HEIGHT + 0.55, -1.9]),
    coin([0, REWARD_COIN_HEIGHT + 0.85, -3.2]),
  ],
  movement: [
    coin([-12.4, REWARD_COIN_HEIGHT + 0.95, 2.6]),
    coin([0, ROUTE_COIN_HEIGHT + 0.15, 5.8]),
    coin([0, ROUTE_COIN_HEIGHT + 0.25, -5.8]),
    coin([8, ROUTE_COIN_HEIGHT + 0.4, -0.2]),
    coin([14, REWARD_COIN_HEIGHT + 1.2, -1.6]),
  ],
  doubleJump: [
    coin([-6, ROUTE_COIN_HEIGHT + 0.2, 0]),
    coin([-2.8, ROUTE_COIN_HEIGHT + 1.05, 0]),
    coin([0.3, REWARD_COIN_HEIGHT + 1.55, 0]),
    coin([4.2, REWARD_COIN_HEIGHT + 2.35, 0]),
    coin([8.1, REWARD_COIN_HEIGHT + 2.95, -0.2]),
  ],
  grab: [
    coin([0, ROUTE_COIN_HEIGHT + 0.35, 2]),
    coin([0, ROUTE_COIN_HEIGHT + 0.5, 0]),
    coin([0, ROUTE_COIN_HEIGHT + 0.75, -3]),
    coin([3.5, ROUTE_COIN_HEIGHT + 0.2, 0]),
    coin([14, REWARD_COIN_HEIGHT + 0.75, -2]),
  ],
  throw: [
    coin([-5.4, ROUTE_COIN_HEIGHT + 0.25, 2.2]),
    coin([0, ROUTE_COIN_HEIGHT + 0.35, 2.45]),
    coin([5.4, ROUTE_COIN_HEIGHT + 0.25, 2.2]),
    coin([0, REWARD_COIN_HEIGHT + 0.15, -0.6]),
    coin([0, REWARD_COIN_HEIGHT + 0.55, -2.7]),
  ],
  door: [
    coin([0, ROUTE_COIN_HEIGHT, 5.2]),
    coin([0, ROUTE_COIN_HEIGHT + 0.1, 2.4]),
    coin([2, ROUTE_COIN_HEIGHT + 0.25, 0.5]),
    coin([4, REWARD_COIN_HEIGHT + 0.35, 0]),
    coin([0, REWARD_COIN_HEIGHT + 0.5, -2.8]),
  ],
  vehicles: [
    coin([-10, REWARD_COIN_HEIGHT + 1.15, 0]),
    coin([-4, ROUTE_COIN_HEIGHT + 0.55, 0.8]),
    coin([3.5, ROUTE_COIN_HEIGHT + 0.4, -0.4]),
    coin([10, REWARD_COIN_HEIGHT + 0.75, 0]),
    coin([14.5, REWARD_COIN_HEIGHT + 1.1, -2.6]),
  ],
  platformsMoving: [
    coin([-12, ROUTE_COIN_HEIGHT + 0.35, 3]),
    coin([0, REWARD_COIN_HEIGHT + 1.25, 3]),
    coin([12, ROUTE_COIN_HEIGHT + 0.45, 3]),
    coin([6, REWARD_COIN_HEIGHT + 0.45, -1.4]),
    coin([16, REWARD_COIN_HEIGHT + 0.65, -3.8]),
  ],
  platformsPhysics: [
    coin([-11, ROUTE_COIN_HEIGHT + 0.4, 2.25]),
    coin([0, REWARD_COIN_HEIGHT + 0.15, 2.1]),
    coin([8.5, REWARD_COIN_HEIGHT + 0.75, -2.75]),
    coin([12.6, REWARD_COIN_HEIGHT + 0.95, -2.75]),
    coin([15.6, REWARD_COIN_HEIGHT + 0.45, -4.6]),
  ],
  materials: [
    coin([-16.8, ROUTE_COIN_HEIGHT + 1.25, 0.9]),
    coin([-8.4, ROUTE_COIN_HEIGHT + 1.35, -0.1]),
    coin([0, ROUTE_COIN_HEIGHT + 1.45, 0.9]),
    coin([8.4, ROUTE_COIN_HEIGHT + 1.55, -0.1]),
    coin([16.8, REWARD_COIN_HEIGHT + 1.45, 0.9]),
  ],
  vfx: [
    coin([-15, ROUTE_COIN_HEIGHT + 0.65, 0]),
    coin([-5, REWARD_COIN_HEIGHT + 0.15, 0]),
    coin([0, REWARD_COIN_HEIGHT + 0.65, 0]),
    coin([5, REWARD_COIN_HEIGHT + 0.15, 0]),
    coin([15, ROUTE_COIN_HEIGHT + 0.65, 0]),
  ],
  navigation: [
    coin([-10, ROUTE_COIN_HEIGHT + 0.1, 4.6]),
    coin([-2.5, ROUTE_COIN_HEIGHT + 0.1, 4.0]),
    coin([3.5, ROUTE_COIN_HEIGHT + 0.15, 0.8]),
    coin([8, ROUTE_COIN_HEIGHT + 0.25, -2.2]),
    coin([8.5, REWARD_COIN_HEIGHT + 0.25, -5.2]),
  ],
  futureA: [
    coin([-12, ROUTE_COIN_HEIGHT, 5]),
    coin([-6, ROUTE_COIN_HEIGHT + 0.1, 2.2]),
    coin([0, REWARD_COIN_HEIGHT, -0.8]),
    coin([6, ROUTE_COIN_HEIGHT + 0.2, 2.2]),
    coin([12, REWARD_COIN_HEIGHT + 0.2, -3.4]),
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
