export type LutPresetFormat = "cube" | "3dl" | "image";

export interface LutPreset {
  name: string;
  file: string;
  format: LutPresetFormat;
}

export interface EnvironmentPreset {
  name: string;
  file: string | null;
}

export const LUT_PRESETS: ReadonlyArray<LutPreset> = [
  { name: "Bourbon 64", file: "Bourbon 64.CUBE", format: "cube" },
  { name: "Chemical 168", file: "Chemical 168.CUBE", format: "cube" },
  { name: "Clayton 33", file: "Clayton 33.CUBE", format: "cube" },
  { name: "Cubicle 99", file: "Cubicle 99.CUBE", format: "cube" },
  { name: "Remy 24", file: "Remy 24.CUBE", format: "cube" },
  { name: "Presetpro-Cinematic", file: "Presetpro-Cinematic.3dl", format: "3dl" },
  { name: "NeutralLUT", file: "NeutralLUT.png", format: "image" },
  { name: "B&WLUT", file: "B&WLUT.png", format: "image" },
  { name: "NightLUT", file: "NightLUT.png", format: "image" },
  { name: "lut", file: "lut.3dl", format: "3dl" },
  { name: "lut_v2", file: "lut_v2.3dl", format: "3dl" },
];

export const LUT_NAMES: readonly string[] = LUT_PRESETS.map((preset) => preset.name);

export const ENV_PRESETS: ReadonlyArray<EnvironmentPreset> = [
  { name: "Room Environment", file: null },
  { name: "Sunrise", file: "blouberg_sunrise_2_1k.hdr" },
  { name: "Partly Cloudy", file: "kloofendal_48d_partly_cloudy_1k.hdr" },
  { name: "Venice Sunset", file: "venice_sunset_1k.hdr" },
  { name: "Royal Esplanade", file: "royal_esplanade_1k.hdr" },
  { name: "Studio", file: "studio_small_09_1k.hdr" },
  { name: "Night", file: "moonless_golf_1k.hdr" },
];

export const ENV_NAMES: readonly string[] = ENV_PRESETS.map((preset) => preset.name);
