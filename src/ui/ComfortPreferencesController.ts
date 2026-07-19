import { DEFAULT_USER_SETTINGS, type ReducedMotionPreference, USER_SETTINGS_RANGES } from "@core/UserSettings";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface CameraEffectsTarget {
  setEffectsIntensity(value: number): void;
}

interface DamageFlashTarget {
  setDamageFlashIntensity(value: number): void;
}

interface RootStateTarget {
  setAttribute(name: string, value: string): void;
}

interface MediaQueryChangeEventLike {
  readonly matches: boolean;
}

interface MediaQueryListLike {
  readonly matches: boolean;
  addEventListener?(type: "change", listener: (event: MediaQueryChangeEventLike) => void): void;
  removeEventListener?(type: "change", listener: (event: MediaQueryChangeEventLike) => void): void;
  addListener?(listener: (event: MediaQueryChangeEventLike) => void): void;
  removeListener?(listener: (event: MediaQueryChangeEventLike) => void): void;
}

export interface ComfortPreferences {
  cameraEffectsIntensity: number;
  damageFlashIntensity: number;
  reducedMotion: ReducedMotionPreference;
}

export interface ComfortPreferencesControllerOptions {
  camera: CameraEffectsTarget;
  hud: DamageFlashTarget;
  root: RootStateTarget;
  matchMedia: (query: string) => MediaQueryListLike;
}

export class ComfortPreferencesController {
  private readonly mediaQuery: MediaQueryListLike;
  private cameraEffectsIntensity = DEFAULT_USER_SETTINGS.cameraEffectsIntensity;
  private reducedMotion: ReducedMotionPreference = DEFAULT_USER_SETTINGS.reducedMotion;
  private disposed = false;
  private readonly onMediaQueryChange = (): void => {
    if (this.reducedMotion === "system") this.applyResolvedMotion();
  };

  constructor(private readonly options: ComfortPreferencesControllerOptions) {
    this.mediaQuery = options.matchMedia(REDUCED_MOTION_QUERY);
    if (this.mediaQuery.addEventListener) {
      this.mediaQuery.addEventListener("change", this.onMediaQueryChange);
    } else {
      this.mediaQuery.addListener?.(this.onMediaQueryChange);
    }
  }

  apply(settings: ComfortPreferences): void {
    this.cameraEffectsIntensity = this.sanitizeIntensity(
      settings.cameraEffectsIntensity,
      DEFAULT_USER_SETTINGS.cameraEffectsIntensity,
      "cameraEffectsIntensity",
    );
    const damageFlashIntensity = this.sanitizeIntensity(
      settings.damageFlashIntensity,
      DEFAULT_USER_SETTINGS.damageFlashIntensity,
      "damageFlashIntensity",
    );
    this.reducedMotion = this.sanitizeReducedMotion(settings.reducedMotion);
    this.options.hud.setDamageFlashIntensity(damageFlashIntensity);
    this.applyResolvedMotion();
  }

  setCameraEffectsIntensity(value: number): void {
    this.cameraEffectsIntensity = this.sanitizeIntensity(
      value,
      DEFAULT_USER_SETTINGS.cameraEffectsIntensity,
      "cameraEffectsIntensity",
    );
    this.applyResolvedMotion();
  }

  setDamageFlashIntensity(value: number): void {
    this.options.hud.setDamageFlashIntensity(
      this.sanitizeIntensity(value, DEFAULT_USER_SETTINGS.damageFlashIntensity, "damageFlashIntensity"),
    );
  }

  setReducedMotion(value: ReducedMotionPreference): void {
    this.reducedMotion = this.sanitizeReducedMotion(value);
    this.applyResolvedMotion();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.mediaQuery.removeEventListener) {
      this.mediaQuery.removeEventListener("change", this.onMediaQueryChange);
    } else {
      this.mediaQuery.removeListener?.(this.onMediaQueryChange);
    }
  }

  private applyResolvedMotion(): void {
    const reduced = this.reducedMotion === "on" || (this.reducedMotion === "system" && this.mediaQuery.matches);
    this.options.root.setAttribute("data-reduced-motion", reduced ? "reduce" : "normal");
    this.options.camera.setEffectsIntensity(reduced ? 0 : this.cameraEffectsIntensity);
  }

  private sanitizeIntensity(value: number, fallback: number, key: keyof typeof USER_SETTINGS_RANGES): number {
    if (!Number.isFinite(value)) return fallback;
    const range = USER_SETTINGS_RANGES[key];
    return Math.min(range.max, Math.max(range.min, value));
  }

  private sanitizeReducedMotion(value: ReducedMotionPreference): ReducedMotionPreference {
    return value === "system" || value === "on" || value === "off" ? value : DEFAULT_USER_SETTINGS.reducedMotion;
  }
}
