import { getShowcaseBayTopY, getShowcaseStationZ, type ShowcaseStationKey } from "@level/ShowcaseLayout";
import * as THREE from "three";

export interface SpikePlacement {
  id: string;
  station: ShowcaseStationKey;
  position: THREE.Vector3;
  size: THREE.Vector3;
  rotationY: number;
  accentColor: number;
}

interface LocalSpikePlacement {
  readonly offset: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly rotationY?: number;
  readonly accentColor: number;
}

const HAZARD_Y = getShowcaseBayTopY() + 0.06;
const spike = (
  offset: readonly [number, number, number],
  size: readonly [number, number, number],
  accentColor: number,
  rotationY = 0,
): LocalSpikePlacement => ({
  offset,
  size,
  rotationY,
  accentColor,
});

const STATION_LOCAL_SPIKES: Partial<Record<ShowcaseStationKey, readonly LocalSpikePlacement[]>> = {
  steps: [
    spike([-2.6, HAZARD_Y, -2.5], [3.4, 1.2, 2.0], 0x00d8ff),
    spike([12.2, HAZARD_Y, 2.8], [4.0, 1.2, 1.5], 0xff7a38),
  ],
  slopes: [
    spike([-10, HAZARD_Y, -4.2], [4.2, 1.2, 1.4], 0x00d8ff),
    spike([0, HAZARD_Y, -3.8], [4.2, 1.2, 1.4], 0xff59c7),
    spike([10, HAZARD_Y, -3.4], [4.2, 1.2, 1.4], 0xffa142),
  ],
  doubleJump: [
    spike([-0.8, HAZARD_Y, 3.25], [12.4, 1.2, 1.3], 0xff59c7),
    spike([-0.8, HAZARD_Y, -3.25], [10.8, 1.2, 1.3], 0x00d8ff),
  ],
  platformsMoving: [spike([6, HAZARD_Y, 3], [4.6, 1.2, 4.0], 0xffa142)],
  platformsPhysics: [
    spike([-4.8, HAZARD_Y, -4.2], [3.4, 1.2, 1.8], 0x00d8ff),
    spike([4.8, HAZARD_Y, 5.8], [2.4, 1.2, 1.6], 0xff59c7),
    spike([-17.5, HAZARD_Y, -1.4], [3.0, 1.2, 1.8], 0xffa142),
  ],
};

function toWorldPosition(station: ShowcaseStationKey, offset: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(offset[0], offset[1], getShowcaseStationZ(station) + offset[2]);
}

export function getProceduralSpikePlacements(station?: ShowcaseStationKey | null): SpikePlacement[] {
  const stations = station ? [station] : (Object.keys(STATION_LOCAL_SPIKES) as ShowcaseStationKey[]);
  const placements: SpikePlacement[] = [];

  for (const stationKey of stations) {
    const localPlacements = STATION_LOCAL_SPIKES[stationKey] ?? [];
    localPlacements.forEach((entry, index) => {
      placements.push({
        id: `${stationKey}-spike-${index + 1}`,
        station: stationKey,
        position: toWorldPosition(stationKey, entry.offset),
        size: new THREE.Vector3(entry.size[0], entry.size[1], entry.size[2]),
        rotationY: entry.rotationY ?? 0,
        accentColor: entry.accentColor,
      });
    });
  }

  return placements;
}
