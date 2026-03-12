export type GraphicsProfile = 'performance' | 'balanced' | 'cinematic';
export type AntiAliasingMode = 'smaa' | 'fxaa' | 'none';
export type ShadowQualityTier = 'auto' | GraphicsProfile;

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
  cameraFov: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
}

const STORAGE_KEY = 'kinema.user-settings.v1';
const PROFILE_ORDER: readonly GraphicsProfile[] = ['performance', 'balanced', 'cinematic'] as const;
const MIN_MOUSE_SENSITIVITY = 0.0005;
const MAX_MOUSE_SENSITIVITY = 0.01;
const MIN_GAMEPAD_DEADZONE = 0.02;
const MAX_GAMEPAD_DEADZONE = 0.4;
const MIN_GAMEPAD_CURVE = 0.6;
const MAX_GAMEPAD_CURVE = 3.0;
const MIN_CAMERA_FOV = 50;
const MAX_CAMERA_FOV = 90;
const MIN_RESOLUTION_SCALE = 0.5;
const MAX_RESOLUTION_SCALE = 1.0;
const MIN_ENV_ROTATION_DEGREES = -180;
const MAX_ENV_ROTATION_DEGREES = 180;
const MIN_CAS_STRENGTH = 0;
const MAX_CAS_STRENGTH = 1;
const MIN_VOLUME = 0;
const MAX_VOLUME = 1;

export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = Object.freeze({
  mouseSensitivity: 0.002,
  invertY: false,
  rawMouseInput: false,
  gamepadDeadzone: 0.12,
  gamepadCurve: 1.4,
  // Default aims for a good balance of quality and performance out of the box.
  graphicsProfile: 'balanced',
  aaMode: 'smaa',
  resolutionScale: 1,
  shadowsEnabled: true,
  shadowQuality: 'auto',
  envRotationDegrees: 0,
  casEnabled: true,
  casStrength: 0.3,
  cameraFov: 65,
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.7,
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_USER_SETTINGS };
  }
  const value = raw as Partial<UserSettings>;

  const profileFromNewField = (() => {
    const v = (value as Partial<UserSettings> & { graphicsProfile?: unknown }).graphicsProfile;
    return PROFILE_ORDER.includes(v as GraphicsProfile) ? (v as GraphicsProfile) : null;
  })();
  const profileFromLegacyField = (() => {
    // Back-compat: older builds stored graphicsQuality: low|medium|high.
    const legacy = (value as unknown as { graphicsQuality?: unknown }).graphicsQuality;
    if (legacy === 'low') return 'performance' as const;
    if (legacy === 'medium') return 'balanced' as const;
    if (legacy === 'high') return 'cinematic' as const;
    return null;
  })();
  const profile = profileFromNewField ?? profileFromLegacyField ?? DEFAULT_USER_SETTINGS.graphicsProfile;

  return {
    mouseSensitivity: clamp(
      Number.isFinite(value.mouseSensitivity)
        ? (value.mouseSensitivity as number)
        : DEFAULT_USER_SETTINGS.mouseSensitivity,
      MIN_MOUSE_SENSITIVITY,
      MAX_MOUSE_SENSITIVITY,
    ),
    invertY: typeof value.invertY === 'boolean' ? value.invertY : DEFAULT_USER_SETTINGS.invertY,
    rawMouseInput:
      typeof value.rawMouseInput === 'boolean'
        ? value.rawMouseInput
        : DEFAULT_USER_SETTINGS.rawMouseInput,
    gamepadDeadzone: clamp(
      Number.isFinite(value.gamepadDeadzone)
        ? (value.gamepadDeadzone as number)
        : DEFAULT_USER_SETTINGS.gamepadDeadzone,
      MIN_GAMEPAD_DEADZONE,
      MAX_GAMEPAD_DEADZONE,
    ),
    gamepadCurve: clamp(
      Number.isFinite(value.gamepadCurve) ? (value.gamepadCurve as number) : DEFAULT_USER_SETTINGS.gamepadCurve,
      MIN_GAMEPAD_CURVE,
      MAX_GAMEPAD_CURVE,
    ),
    graphicsProfile: profile,
    aaMode: (() => {
      const rawMode = (value as Record<string, unknown>).aaMode;
      // Back-compat: older builds stored 'taa'; map it to deterministic SMAA.
      if (rawMode === 'taa') return 'smaa';
      if (rawMode === 'smaa' || rawMode === 'fxaa' || rawMode === 'none') return rawMode;
      return DEFAULT_USER_SETTINGS.aaMode;
    })(),
    resolutionScale: clamp(
      Number.isFinite(value.resolutionScale)
        ? (value.resolutionScale as number)
        : DEFAULT_USER_SETTINGS.resolutionScale,
      MIN_RESOLUTION_SCALE,
      MAX_RESOLUTION_SCALE,
    ),
    shadowsEnabled:
      typeof value.shadowsEnabled === 'boolean' ? value.shadowsEnabled : DEFAULT_USER_SETTINGS.shadowsEnabled,
    shadowQuality: (() => {
      const rawShadowQuality = (value as Record<string, unknown>).shadowQuality;
      if (
        rawShadowQuality === 'auto'
        || rawShadowQuality === 'performance'
        || rawShadowQuality === 'balanced'
        || rawShadowQuality === 'cinematic'
      ) {
        return rawShadowQuality;
      }
      return DEFAULT_USER_SETTINGS.shadowQuality;
    })(),
    envRotationDegrees: clamp(
      Number.isFinite((value as Record<string, unknown>).envRotationDegrees)
        ? ((value as Record<string, unknown>).envRotationDegrees as number)
        : DEFAULT_USER_SETTINGS.envRotationDegrees,
      MIN_ENV_ROTATION_DEGREES,
      MAX_ENV_ROTATION_DEGREES,
    ),
    casEnabled:
      typeof (value as Record<string, unknown>).casEnabled === 'boolean'
        ? ((value as Record<string, unknown>).casEnabled as boolean)
        : DEFAULT_USER_SETTINGS.casEnabled,
    casStrength: clamp(
      Number.isFinite((value as Record<string, unknown>).casStrength)
        ? ((value as Record<string, unknown>).casStrength as number)
        : DEFAULT_USER_SETTINGS.casStrength,
      MIN_CAS_STRENGTH,
      MAX_CAS_STRENGTH,
    ),
    cameraFov: clamp(
      Number.isFinite(value.cameraFov) ? (value.cameraFov as number) : DEFAULT_USER_SETTINGS.cameraFov,
      MIN_CAMERA_FOV,
      MAX_CAMERA_FOV,
    ),
    masterVolume: clamp(
      Number.isFinite(value.masterVolume) ? (value.masterVolume as number) : DEFAULT_USER_SETTINGS.masterVolume,
      MIN_VOLUME,
      MAX_VOLUME,
    ),
    musicVolume: clamp(
      Number.isFinite(value.musicVolume) ? (value.musicVolume as number) : DEFAULT_USER_SETTINGS.musicVolume,
      MIN_VOLUME,
      MAX_VOLUME,
    ),
    sfxVolume: clamp(
      Number.isFinite(value.sfxVolume) ? (value.sfxVolume as number) : DEFAULT_USER_SETTINGS.sfxVolume,
      MIN_VOLUME,
      MAX_VOLUME,
    ),
  };
}

function getStorage(): Storage | null {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
    return null;
  }
  return globalThis.localStorage ?? null;
}

export class UserSettingsStore {
  private constructor(private state: UserSettings) { }

  static load(): UserSettingsStore {
    const storage = getStorage();
    if (!storage) {
      return new UserSettingsStore({ ...DEFAULT_USER_SETTINGS });
    }

    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (!saved) {
        return new UserSettingsStore({ ...DEFAULT_USER_SETTINGS });
      }
      return new UserSettingsStore(parseSettings(JSON.parse(saved)));
    } catch {
      return new UserSettingsStore({ ...DEFAULT_USER_SETTINGS });
    }
  }

  get value(): Readonly<UserSettings> {
    return this.state;
  }

  update(patch: Partial<UserSettings>): Readonly<UserSettings> {
    this.state = parseSettings({ ...this.state, ...patch });
    this.persist();
    return this.state;
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

