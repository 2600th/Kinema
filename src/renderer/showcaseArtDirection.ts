import * as THREE from "three";

export type ShowcaseArtDirectionId = "dawn" | "aurora" | "dusk";

export interface ShowcaseSkyStop {
  v: number;
  color: string;
}

export interface ShowcaseArtDirectionProfile {
  id: ShowcaseArtDirectionId;
  label: string;
  stops: readonly ShowcaseSkyStop[];
  fog: { color: string; near: number; far: number };
}

export const DEFAULT_SHOWCASE_ART_DIRECTION_ID: ShowcaseArtDirectionId = "dawn";
export const SHOWCASE_SKY_WIDTH = 512;
export const SHOWCASE_SKY_HEIGHT = 256;
export const SHOWCASE_ENVIRONMENT_INTENSITY = 0.68;
export const SHOWCASE_BACKGROUND_INTENSITY = 1;
export const SHOWCASE_BACKGROUND_BLURRINESS = 0;

export const SHOWCASE_ART_DIRECTIONS: Readonly<Record<ShowcaseArtDirectionId, ShowcaseArtDirectionProfile>> = {
  dawn: {
    id: "dawn",
    label: "Dawn Slate",
    stops: [
      { v: 0, color: "#35414f" },
      { v: 0.44, color: "#71808e" },
      { v: 0.5, color: "#8e99a6" },
      { v: 0.56, color: "#c58f78" },
      { v: 0.72, color: "#40536a" },
      { v: 1, color: "#111827" },
    ],
    fog: { color: "#8e99a6", near: 95, far: 360 },
  },
  aurora: {
    id: "aurora",
    label: "Aurora Lab",
    stops: [
      { v: 0, color: "#314a52" },
      { v: 0.44, color: "#66888a" },
      { v: 0.5, color: "#8fa9aa" },
      { v: 0.56, color: "#b8dccb" },
      { v: 0.72, color: "#245665" },
      { v: 1, color: "#071a2c" },
    ],
    fog: { color: "#8fa9aa", near: 110, far: 400 },
  },
  dusk: {
    id: "dusk",
    label: "Violet Dusk",
    stops: [
      { v: 0, color: "#3e4051" },
      { v: 0.44, color: "#706d80" },
      { v: 0.5, color: "#918b9c" },
      { v: 0.56, color: "#c9868b" },
      { v: 0.72, color: "#59405f" },
      { v: 1, color: "#181129" },
    ],
    fog: { color: "#918b9c", near: 90, far: 330 },
  },
};

export function resolveShowcaseArtDirectionId(value: string | null | undefined): ShowcaseArtDirectionId {
  const normalized = value?.trim().toLowerCase();
  return normalized === "dawn" || normalized === "aurora" || normalized === "dusk"
    ? normalized
    : DEFAULT_SHOWCASE_ART_DIRECTION_ID;
}

export function createShowcaseSkyTexture(profile: ShowcaseArtDirectionProfile): THREE.DataTexture {
  const data = new Uint8Array(SHOWCASE_SKY_WIDTH * SHOWCASE_SKY_HEIGHT * 4);
  const stops = profile.stops.map((stop) => ({ v: stop.v, color: new THREE.Color(stop.color) }));
  const interpolated = new THREE.Color();
  const srgb = { r: 0, g: 0, b: 0 };
  let upperIndex = 1;

  for (let y = 0; y < SHOWCASE_SKY_HEIGHT; y += 1) {
    const v = y / (SHOWCASE_SKY_HEIGHT - 1);
    while (upperIndex < stops.length - 1 && v > stops[upperIndex].v) upperIndex += 1;
    const lower = stops[upperIndex - 1];
    const upper = stops[upperIndex];
    const span = Math.max(upper.v - lower.v, Number.EPSILON);
    const mix = THREE.MathUtils.clamp((v - lower.v) / span, 0, 1);
    interpolated.copy(lower.color).lerp(upper.color, mix).getRGB(srgb, THREE.SRGBColorSpace);
    const red = Math.round(THREE.MathUtils.clamp(srgb.r, 0, 1) * 255);
    const green = Math.round(THREE.MathUtils.clamp(srgb.g, 0, 1) * 255);
    const blue = Math.round(THREE.MathUtils.clamp(srgb.b, 0, 1) * 255);

    for (let x = 0; x < SHOWCASE_SKY_WIDTH; x += 1) {
      const offset = (y * SHOWCASE_SKY_WIDTH + x) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(
    data,
    SHOWCASE_SKY_WIDTH,
    SHOWCASE_SKY_HEIGHT,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = `KinemaShowcaseSky_${profile.id}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function applyShowcaseArtDirection(
  scene: THREE.Scene,
  profile: ShowcaseArtDirectionProfile,
  skyTexture: THREE.DataTexture,
): void {
  scene.background = skyTexture;
  scene.fog = new THREE.Fog(profile.fog.color, profile.fog.near, profile.fog.far);
  scene.environmentIntensity = SHOWCASE_ENVIRONMENT_INTENSITY;
  scene.backgroundIntensity = SHOWCASE_BACKGROUND_INTENSITY;
  scene.backgroundBlurriness = SHOWCASE_BACKGROUND_BLURRINESS;
}
