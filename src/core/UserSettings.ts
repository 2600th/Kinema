import { DEFAULT_KEYBOARD_BINDINGS, type KeyboardBindings, sanitizeKeyboardBindings } from "../input/InputBindings";

export type GraphicsProfile = "performance" | "balanced" | "cinematic";
export type AntiAliasingMode = "smaa" | "fxaa" | "none";
export type ShadowQualityTier = "auto" | GraphicsProfile;
export type ReducedMotionPreference = "system" | "on" | "off";
export type InputActivationMode = "hold" | "toggle";

export interface UserSettings {
  mouseSensitivity: number;
  invertY: boolean;
  rawMouseInput: boolean;
  gamepadDeadzone: number;
  gamepadCurve: number;
  graphicsProfile: GraphicsProfile;
  aaMode: AntiAliasingMode;
  resolutionScale: number;
  shadowsEnabled: boolean;
  shadowQuality: ShadowQualityTier;
  envRotationDegrees: number;
  casEnabled: boolean;
  casStrength: number;
  postProcessingEnabled: boolean;
  ssaoEnabled: boolean;
  ssrEnabled: boolean;
  bloomEnabled: boolean;
  vignetteEnabled: boolean;
  lutEnabled: boolean;
  cameraEffectsIntensity: number;
  damageFlashIntensity: number;
  reducedMotion: ReducedMotionPreference;
  sprintMode: InputActivationMode;
  crouchMode: InputActivationMode;
  gamepadLookSensitivity: number;
  touchLookSensitivity: number;
  keyboardBindings: KeyboardBindings;
  cameraFov: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
}

const STORAGE_KEY = "kinema.user-settings.v1";
const PROFILE_ORDER: readonly GraphicsProfile[] = ["performance", "balanced", "cinematic"] as const;
const POST_DEFAULTS_BY_PROFILE: Readonly<
  Record<
    GraphicsProfile,
    Pick<
      UserSettings,
      "postProcessingEnabled" | "ssaoEnabled" | "ssrEnabled" | "bloomEnabled" | "vignetteEnabled" | "lutEnabled"
    >
  >
> = Object.freeze({
  performance: Object.freeze({
    postProcessingEnabled: true,
    ssaoEnabled: false,
    ssrEnabled: false,
    bloomEnabled: false,
    vignetteEnabled: false,
    lutEnabled: true,
  }),
  balanced: Object.freeze({
    postProcessingEnabled: true,
    ssaoEnabled: true,
    ssrEnabled: false,
    bloomEnabled: true,
    vignetteEnabled: true,
    lutEnabled: true,
  }),
  cinematic: Object.freeze({
    postProcessingEnabled: true,
    ssaoEnabled: true,
    ssrEnabled: true,
    bloomEnabled: true,
    vignetteEnabled: true,
    lutEnabled: true,
  }),
});

export interface UserSettingRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const USER_SETTINGS_RANGES = Object.freeze({
  mouseSensitivity: Object.freeze({ min: 0.0005, max: 0.01, step: 0.0001 }),
  gamepadDeadzone: Object.freeze({ min: 0.02, max: 0.4, step: 0.01 }),
  gamepadCurve: Object.freeze({ min: 0.6, max: 3, step: 0.1 }),
  cameraFov: Object.freeze({ min: 50, max: 90, step: 1 }),
  gamepadLookSensitivity: Object.freeze({ min: 6, max: 30, step: 1 }),
  touchLookSensitivity: Object.freeze({ min: 1, max: 8, step: 0.25 }),
  resolutionScale: Object.freeze({ min: 0.5, max: 1, step: 0.05 }),
  envRotationDegrees: Object.freeze({ min: -180, max: 180, step: 1 }),
  casStrength: Object.freeze({ min: 0, max: 1, step: 0.05 }),
  cameraEffectsIntensity: Object.freeze({ min: 0, max: 1, step: 0.05 }),
  damageFlashIntensity: Object.freeze({ min: 0, max: 1, step: 0.05 }),
  masterVolume: Object.freeze({ min: 0, max: 1, step: 0.01 }),
  musicVolume: Object.freeze({ min: 0, max: 1, step: 0.01 }),
  sfxVolume: Object.freeze({ min: 0, max: 1, step: 0.01 }),
}) satisfies Readonly<Record<string, UserSettingRange>>;

export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = Object.freeze({
  mouseSensitivity: 0.002,
  invertY: false,
  rawMouseInput: false,
  gamepadDeadzone: 0.12,
  gamepadCurve: 1.4,
  // Default aims for a good balance of quality and performance out of the box.
  graphicsProfile: "balanced",
  aaMode: "fxaa",
  resolutionScale: 1,
  shadowsEnabled: true,
  shadowQuality: "auto",
  envRotationDegrees: 0,
  casEnabled: false,
  casStrength: 0.2,
  postProcessingEnabled: true,
  ssaoEnabled: true,
  ssrEnabled: false,
  bloomEnabled: true,
  vignetteEnabled: true,
  lutEnabled: true,
  cameraEffectsIntensity: 1,
  damageFlashIntensity: 1,
  reducedMotion: "system",
  sprintMode: "hold",
  crouchMode: "hold",
  gamepadLookSensitivity: 18,
  touchLookSensitivity: 4,
  keyboardBindings: DEFAULT_KEYBOARD_BINDINGS as KeyboardBindings,
  cameraFov: 65,
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.7,
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneSettings(settings: Readonly<UserSettings>): UserSettings {
  return {
    ...settings,
    keyboardBindings: sanitizeKeyboardBindings(settings.keyboardBindings),
  };
}

function parseSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== "object") {
    return cloneSettings(DEFAULT_USER_SETTINGS);
  }
  const value = raw as Partial<UserSettings>;
  const record = value as Record<string, unknown>;

  const profileFromNewField = (() => {
    const v = (value as Partial<UserSettings> & { graphicsProfile?: unknown }).graphicsProfile;
    return PROFILE_ORDER.includes(v as GraphicsProfile) ? (v as GraphicsProfile) : null;
  })();
  const profileFromLegacyField = (() => {
    // Back-compat: older builds stored graphicsQuality: low|medium|high.
    const legacy = (value as unknown as { graphicsQuality?: unknown }).graphicsQuality;
    if (legacy === "low") return "performance" as const;
    if (legacy === "medium") return "balanced" as const;
    if (legacy === "high") return "cinematic" as const;
    return null;
  })();
  const profile = profileFromNewField ?? profileFromLegacyField ?? DEFAULT_USER_SETTINGS.graphicsProfile;

  return {
    mouseSensitivity: clamp(
      Number.isFinite(value.mouseSensitivity)
        ? (value.mouseSensitivity as number)
        : DEFAULT_USER_SETTINGS.mouseSensitivity,
      USER_SETTINGS_RANGES.mouseSensitivity.min,
      USER_SETTINGS_RANGES.mouseSensitivity.max,
    ),
    invertY: typeof value.invertY === "boolean" ? value.invertY : DEFAULT_USER_SETTINGS.invertY,
    rawMouseInput: typeof value.rawMouseInput === "boolean" ? value.rawMouseInput : DEFAULT_USER_SETTINGS.rawMouseInput,
    gamepadDeadzone: clamp(
      Number.isFinite(value.gamepadDeadzone)
        ? (value.gamepadDeadzone as number)
        : DEFAULT_USER_SETTINGS.gamepadDeadzone,
      USER_SETTINGS_RANGES.gamepadDeadzone.min,
      USER_SETTINGS_RANGES.gamepadDeadzone.max,
    ),
    gamepadCurve: clamp(
      Number.isFinite(value.gamepadCurve) ? (value.gamepadCurve as number) : DEFAULT_USER_SETTINGS.gamepadCurve,
      USER_SETTINGS_RANGES.gamepadCurve.min,
      USER_SETTINGS_RANGES.gamepadCurve.max,
    ),
    graphicsProfile: profile,
    aaMode: (() => {
      const rawMode = record.aaMode;
      // Back-compat: older builds stored 'taa'; map it to deterministic SMAA.
      if (rawMode === "taa") return "smaa";
      if (rawMode === "smaa" || rawMode === "fxaa" || rawMode === "none") return rawMode;
      return DEFAULT_USER_SETTINGS.aaMode;
    })(),
    resolutionScale: clamp(
      Number.isFinite(value.resolutionScale)
        ? (value.resolutionScale as number)
        : DEFAULT_USER_SETTINGS.resolutionScale,
      USER_SETTINGS_RANGES.resolutionScale.min,
      USER_SETTINGS_RANGES.resolutionScale.max,
    ),
    shadowsEnabled:
      typeof value.shadowsEnabled === "boolean" ? value.shadowsEnabled : DEFAULT_USER_SETTINGS.shadowsEnabled,
    shadowQuality: (() => {
      const rawShadowQuality = record.shadowQuality;
      if (
        rawShadowQuality === "auto" ||
        rawShadowQuality === "performance" ||
        rawShadowQuality === "balanced" ||
        rawShadowQuality === "cinematic"
      ) {
        return rawShadowQuality;
      }
      return DEFAULT_USER_SETTINGS.shadowQuality;
    })(),
    envRotationDegrees: clamp(
      Number.isFinite(record.envRotationDegrees)
        ? (record.envRotationDegrees as number)
        : DEFAULT_USER_SETTINGS.envRotationDegrees,
      USER_SETTINGS_RANGES.envRotationDegrees.min,
      USER_SETTINGS_RANGES.envRotationDegrees.max,
    ),
    casEnabled: typeof record.casEnabled === "boolean" ? record.casEnabled : DEFAULT_USER_SETTINGS.casEnabled,
    casStrength: clamp(
      Number.isFinite(record.casStrength) ? (record.casStrength as number) : DEFAULT_USER_SETTINGS.casStrength,
      USER_SETTINGS_RANGES.casStrength.min,
      USER_SETTINGS_RANGES.casStrength.max,
    ),
    postProcessingEnabled:
      typeof record.postProcessingEnabled === "boolean"
        ? record.postProcessingEnabled
        : POST_DEFAULTS_BY_PROFILE[profile].postProcessingEnabled,
    ssaoEnabled:
      typeof record.ssaoEnabled === "boolean" ? record.ssaoEnabled : POST_DEFAULTS_BY_PROFILE[profile].ssaoEnabled,
    ssrEnabled:
      typeof record.ssrEnabled === "boolean" ? record.ssrEnabled : POST_DEFAULTS_BY_PROFILE[profile].ssrEnabled,
    bloomEnabled:
      typeof record.bloomEnabled === "boolean" ? record.bloomEnabled : POST_DEFAULTS_BY_PROFILE[profile].bloomEnabled,
    vignetteEnabled:
      typeof record.vignetteEnabled === "boolean"
        ? record.vignetteEnabled
        : POST_DEFAULTS_BY_PROFILE[profile].vignetteEnabled,
    lutEnabled:
      typeof record.lutEnabled === "boolean" ? record.lutEnabled : POST_DEFAULTS_BY_PROFILE[profile].lutEnabled,
    cameraEffectsIntensity: clamp(
      Number.isFinite(record.cameraEffectsIntensity)
        ? (record.cameraEffectsIntensity as number)
        : DEFAULT_USER_SETTINGS.cameraEffectsIntensity,
      USER_SETTINGS_RANGES.cameraEffectsIntensity.min,
      USER_SETTINGS_RANGES.cameraEffectsIntensity.max,
    ),
    damageFlashIntensity: clamp(
      Number.isFinite(record.damageFlashIntensity)
        ? (record.damageFlashIntensity as number)
        : DEFAULT_USER_SETTINGS.damageFlashIntensity,
      USER_SETTINGS_RANGES.damageFlashIntensity.min,
      USER_SETTINGS_RANGES.damageFlashIntensity.max,
    ),
    reducedMotion:
      record.reducedMotion === "system" || record.reducedMotion === "on" || record.reducedMotion === "off"
        ? record.reducedMotion
        : DEFAULT_USER_SETTINGS.reducedMotion,
    sprintMode:
      record.sprintMode === "hold" || record.sprintMode === "toggle"
        ? record.sprintMode
        : DEFAULT_USER_SETTINGS.sprintMode,
    crouchMode:
      record.crouchMode === "hold" || record.crouchMode === "toggle"
        ? record.crouchMode
        : DEFAULT_USER_SETTINGS.crouchMode,
    gamepadLookSensitivity: clamp(
      Number.isFinite(record.gamepadLookSensitivity)
        ? (record.gamepadLookSensitivity as number)
        : DEFAULT_USER_SETTINGS.gamepadLookSensitivity,
      USER_SETTINGS_RANGES.gamepadLookSensitivity.min,
      USER_SETTINGS_RANGES.gamepadLookSensitivity.max,
    ),
    touchLookSensitivity: clamp(
      Number.isFinite(record.touchLookSensitivity)
        ? (record.touchLookSensitivity as number)
        : DEFAULT_USER_SETTINGS.touchLookSensitivity,
      USER_SETTINGS_RANGES.touchLookSensitivity.min,
      USER_SETTINGS_RANGES.touchLookSensitivity.max,
    ),
    keyboardBindings: sanitizeKeyboardBindings(record.keyboardBindings),
    cameraFov: clamp(
      Number.isFinite(value.cameraFov) ? (value.cameraFov as number) : DEFAULT_USER_SETTINGS.cameraFov,
      USER_SETTINGS_RANGES.cameraFov.min,
      USER_SETTINGS_RANGES.cameraFov.max,
    ),
    masterVolume: clamp(
      Number.isFinite(value.masterVolume) ? (value.masterVolume as number) : DEFAULT_USER_SETTINGS.masterVolume,
      USER_SETTINGS_RANGES.masterVolume.min,
      USER_SETTINGS_RANGES.masterVolume.max,
    ),
    musicVolume: clamp(
      Number.isFinite(value.musicVolume) ? (value.musicVolume as number) : DEFAULT_USER_SETTINGS.musicVolume,
      USER_SETTINGS_RANGES.musicVolume.min,
      USER_SETTINGS_RANGES.musicVolume.max,
    ),
    sfxVolume: clamp(
      Number.isFinite(value.sfxVolume) ? (value.sfxVolume as number) : DEFAULT_USER_SETTINGS.sfxVolume,
      USER_SETTINGS_RANGES.sfxVolume.min,
      USER_SETTINGS_RANGES.sfxVolume.max,
    ),
  };
}

function getStorage(): Storage | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }
  return globalThis.localStorage ?? null;
}

export class UserSettingsStore {
  private constructor(private state: UserSettings) {}

  static load(): UserSettingsStore {
    const storage = getStorage();
    if (!storage) {
      return new UserSettingsStore(cloneSettings(DEFAULT_USER_SETTINGS));
    }

    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (!saved) {
        return new UserSettingsStore(cloneSettings(DEFAULT_USER_SETTINGS));
      }
      return new UserSettingsStore(parseSettings(JSON.parse(saved)));
    } catch {
      return new UserSettingsStore(cloneSettings(DEFAULT_USER_SETTINGS));
    }
  }

  get value(): Readonly<UserSettings> {
    return cloneSettings(this.state);
  }

  update(patch: Partial<UserSettings>): Readonly<UserSettings> {
    this.state = parseSettings({ ...this.state, ...patch });
    this.persist();
    return cloneSettings(this.state);
  }

  adjustMouseSensitivity(delta: number): Readonly<UserSettings> {
    return this.update({ mouseSensitivity: this.state.mouseSensitivity + delta });
  }

  cycleGraphicsProfile(): Readonly<UserSettings> {
    const currentIndex = PROFILE_ORDER.indexOf(this.state.graphicsProfile);
    const nextIndex = (currentIndex + 1) % PROFILE_ORDER.length;
    return this.update({ graphicsProfile: PROFILE_ORDER[nextIndex] });
  }

  private persist(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore persistence failures (private mode, quota, etc.)
    }
  }
}
