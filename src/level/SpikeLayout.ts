import * as THREE from "three";
import { getShowcaseBayTopY, getShowcaseStationZ, type ShowcaseStationKey } from "@level/ShowcaseLayout";

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

const STATION_LOCAL_SPIKES: Partial<Record<ShowcaseStationKey, readonly LocalSpikePlacement[]>> = {
  steps: [
    { offset: [-8, HAZARD_Y, 1.1], size: [4.6, 1.2, 1.6], accentColor: 0x00d8ff },
    { offset: [7.8, HAZARD_Y, -1.8], size: [4.8, 1.2, 1.6], accentColor: 0xff7a38 },
  ],
  slopes: [
    { offset: [-10, HAZARD_Y, 9.5], size: [5.4, 1.2, 1.5], accentColor: 0x00d8ff },
    { offset: [0, HAZARD_Y, 9.9], size: [5.4, 1.2, 1.5], accentColor: 0xff59c7 },
    { offset: [10, HAZARD_Y, 10.3], size: [5.4, 1.2, 1.5], accentColor: 0xffa142 },
  ],
  doubleJump: [
    { offset: [-1.2, HAZARD_Y, 0], size: [4.2, 1.2, 3.8], accentColor: 0xff59c7 },
    { offset: [4.6, HAZARD_Y, 0], size: [4.2, 1.2, 3.8], accentColor: 0x00d8ff },
  ],
  platformsMoving: [
    { offset: [-12, HAZARD_Y, 3], size: [5.8, 1.2, 4.4], accentColor: 0x00d8ff },
    { offset: [0, HAZARD_Y, 3], size: [5.8, 1.2, 4.4], accentColor: 0xff59c7 },
    { offset: [12, HAZARD_Y, 3], size: [5.8, 1.2, 4.4], accentColor: 0xffa142 },
  ],
  platformsPhysics: [
    { offset: [-11, HAZARD_Y, 2.25], size: [5.8, 1.2, 4.2], accentColor: 0x00d8ff },
    { offset: [0, HAZARD_Y, 2.1], size: [8.4, 1.2, 3.6], accentColor: 0xff59c7 },
    { offset: [10.5, HAZARD_Y, -2.75], size: [8.6, 1.2, 3.8], accentColor: 0xffa142 },
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
