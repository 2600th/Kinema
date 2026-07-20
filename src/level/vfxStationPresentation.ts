const ADVANCED_VFX_STATION_LABEL =
  "Visual Effects\nDissolve \u2022 Fire & Smoke \u2022 Lightning & Rain \u2022 Glowing Ring";
const COMPATIBILITY_VFX_STATION_LABEL =
  "Compatibility VFX\nTornado \u2022 Fire \u2022 Lasers \u2022 Lightning Ribbons \u2022 Scanner";

export function getVfxStationLabel(supportsAdvancedGpuEffects: boolean): string {
  return supportsAdvancedGpuEffects ? ADVANCED_VFX_STATION_LABEL : COMPATIBILITY_VFX_STATION_LABEL;
}
