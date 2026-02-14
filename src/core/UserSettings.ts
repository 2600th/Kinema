export type GraphicsQuality = 'low' | 'medium' | 'high';
export type AntiAliasingMode = 'smaa' | 'fxaa' | 'taa' | 'none';

export interface UserSettings {
  mouseSensitivity: number;
  invertY: boolean;
  rawMouseInput: boolean;
  gamepadDeadzone: number;
  gamepadCurve: number;
  graphicsQuality: GraphicsQuality;
  aaMode: AntiAliasingMode;
  resolutionScale: number;
  shadowsEnabled: boolean;
  cameraFov: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
}

const STORAGE_KEY = 'kinema.user-settings.v1';
const QUALITY_ORDER: readonly GraphicsQuality[] = ['low', 'medium', 'high'] as const;
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
const MIN_VOLUME = 0;
const MAX_VOLUME = 1;

export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = Object.freeze({
  mouseSensitivity: 0.002,
  invertY: false,
  rawMouseInput: false,
  gamepadDeadzone: 0.12,
  gamepadCurve: 1.4,
  graphicsQuality: 'high',
  aaMode: 'taa',
  resolutionScale: 1,
  shadowsEnabled: true,
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
  const quality = QUALITY_ORDER.includes(value.graphicsQuality as GraphicsQuality)
    ? (value.graphicsQuality as GraphicsQuality)
    : DEFAULT_USER_SETTINGS.graphicsQuality;

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
    graphicsQuality: quality,
    aaMode:
      value.aaMode === 'smaa' || value.aaMode === 'fxaa' || value.aaMode === 'taa' || value.aaMode === 'none'
        ? value.aaMode
        : DEFAULT_USER_SETTINGS.aaMode,
    resolutionScale: clamp(
      Number.isFinite(value.resolutionScale)
        ? (value.resolutionScale as number)
        : DEFAULT_USER_SETTINGS.resolutionScale,
      MIN_RESOLUTION_SCALE,
      MAX_RESOLUTION_SCALE,
    ),
    shadowsEnabled:
      typeof value.shadowsEnabled === 'boolean' ? value.shadowsEnabled : DEFAULT_USER_SETTINGS.shadowsEnabled,
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

  cycleGraphicsQuality(): Readonly<UserSettings> {
    const currentIndex = QUALITY_ORDER.indexOf(this.state.graphicsQuality);
    const nextIndex = (currentIndex + 1) % QUALITY_ORDER.length;
    return this.update({ graphicsQuality: QUALITY_ORDER[nextIndex] });
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

