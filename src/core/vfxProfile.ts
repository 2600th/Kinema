import type { GraphicsProfile } from "./UserSettings";

const VFX_DENSITY_BY_PROFILE: Readonly<Record<GraphicsProfile, number>> = {
  performance: 0.35,
  balanced: 0.65,
  cinematic: 1,
};

export interface AmbientVfxCounts {
  readonly sparkles: number;
  readonly motes: number;
  readonly grassPerStrip: number;
  readonly rain: number;
  readonly embers: number;
  readonly orbit: number;
}

const AUTHORED_AMBIENT_VFX_COUNTS: AmbientVfxCounts = {
  sparkles: 400,
  motes: 60,
  grassPerStrip: 400,
  rain: 200,
  embers: 40,
  orbit: 100,
};

export function getVfxDensity(profile: GraphicsProfile): number {
  return VFX_DENSITY_BY_PROFILE[profile];
}

export function scaleVfxCount(authoredCount: number, profile: GraphicsProfile): number {
  const count = Math.max(0, Math.floor(authoredCount));
  if (count === 0) return 0;
  return Math.max(1, Math.round(count * getVfxDensity(profile)));
}

export function getAmbientVfxCounts(profile: GraphicsProfile): AmbientVfxCounts {
  return {
    sparkles: scaleVfxCount(AUTHORED_AMBIENT_VFX_COUNTS.sparkles, profile),
    motes: scaleVfxCount(AUTHORED_AMBIENT_VFX_COUNTS.motes, profile),
    grassPerStrip: scaleVfxCount(AUTHORED_AMBIENT_VFX_COUNTS.grassPerStrip, profile),
    rain: scaleVfxCount(AUTHORED_AMBIENT_VFX_COUNTS.rain, profile),
    embers: scaleVfxCount(AUTHORED_AMBIENT_VFX_COUNTS.embers, profile),
    orbit: scaleVfxCount(AUTHORED_AMBIENT_VFX_COUNTS.orbit, profile),
  };
}
