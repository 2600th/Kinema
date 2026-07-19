import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultKeyboardBindings,
  DEFAULT_KEYBOARD_BINDINGS,
  type KeyboardBindings,
} from "../input/InputBindings";
import { DEFAULT_USER_SETTINGS, USER_SETTINGS_RANGES, UserSettingsStore } from "./UserSettings";

class LocalStorageMock implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    const value = this.store.get(key);
    return value ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

const STORAGE_KEY = "kinema.user-settings.v1";

function saveSettings(value: unknown): void {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

describe("UserSettingsStore", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: new LocalStorageMock(),
      writable: true,
      configurable: true,
    });
  });

  it("loads defaults when storage is empty", () => {
    const settings = UserSettingsStore.load();
    expect(settings.value).toEqual(DEFAULT_USER_SETTINGS);
    expect(settings.value).toMatchObject({
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
      keyboardBindings: DEFAULT_KEYBOARD_BINDINGS,
    });
  });

  it("exports the ranges and steps used by settings controls", () => {
    expect(USER_SETTINGS_RANGES).toEqual({
      mouseSensitivity: { min: 0.0005, max: 0.01, step: 0.0001 },
      gamepadDeadzone: { min: 0.02, max: 0.4, step: 0.01 },
      gamepadCurve: { min: 0.6, max: 3, step: 0.1 },
      cameraFov: { min: 50, max: 90, step: 1 },
      gamepadLookSensitivity: { min: 6, max: 30, step: 1 },
      touchLookSensitivity: { min: 1, max: 8, step: 0.25 },
      resolutionScale: { min: 0.5, max: 1, step: 0.05 },
      envRotationDegrees: { min: -180, max: 180, step: 1 },
      casStrength: { min: 0, max: 1, step: 0.05 },
      cameraEffectsIntensity: { min: 0, max: 1, step: 0.05 },
      damageFlashIntensity: { min: 0, max: 1, step: 0.05 },
      masterVolume: { min: 0, max: 1, step: 0.01 },
      musicVolume: { min: 0, max: 1, step: 0.01 },
      sfxVolume: { min: 0, max: 1, step: 0.01 },
    });
  });

  it("persists updates and clamps invalid ranges", () => {
    const settings = UserSettingsStore.load();
    settings.update({
      mouseSensitivity: 999,
      cameraFov: 10,
      invertY: true,
      rawMouseInput: true,
      gamepadDeadzone: 1,
      gamepadCurve: 0.1,
      gamepadLookSensitivity: 100,
      touchLookSensitivity: -10,
      cameraEffectsIntensity: -1,
      damageFlashIntensity: 5,
      graphicsProfile: "performance",
    });

    const loaded = UserSettingsStore.load();
    expect(loaded.value.invertY).toBe(true);
    expect(loaded.value.rawMouseInput).toBe(true);
    expect(loaded.value.graphicsProfile).toBe("performance");
    expect(loaded.value.mouseSensitivity).toBeLessThanOrEqual(0.01);
    expect(loaded.value.cameraFov).toBeGreaterThanOrEqual(50);
    expect(loaded.value.gamepadDeadzone).toBeLessThanOrEqual(0.4);
    expect(loaded.value.gamepadCurve).toBeGreaterThanOrEqual(0.6);
    expect(loaded.value.gamepadLookSensitivity).toBe(30);
    expect(loaded.value.touchLookSensitivity).toBe(1);
    expect(loaded.value.cameraEffectsIntensity).toBe(0);
    expect(loaded.value.damageFlashIntensity).toBe(1);
  });

  it.each([
    [
      "performance",
      {
        postProcessingEnabled: true,
        ssaoEnabled: false,
        ssrEnabled: false,
        bloomEnabled: false,
        vignetteEnabled: false,
        lutEnabled: true,
      },
    ],
    [
      "balanced",
      {
        postProcessingEnabled: true,
        ssaoEnabled: true,
        ssrEnabled: false,
        bloomEnabled: true,
        vignetteEnabled: true,
        lutEnabled: true,
      },
    ],
    [
      "cinematic",
      {
        postProcessingEnabled: true,
        ssaoEnabled: true,
        ssrEnabled: true,
        bloomEnabled: true,
        vignetteEnabled: true,
        lutEnabled: true,
      },
    ],
  ] as const)("fills missing legacy post flags from the %s profile", (graphicsProfile, expected) => {
    saveSettings({ graphicsProfile });

    expect(UserSettingsStore.load().value).toMatchObject(expected);
  });

  it("preserves explicit post booleans and repairs only invalid values", () => {
    saveSettings({
      graphicsProfile: "cinematic",
      postProcessingEnabled: false,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: false,
      lutEnabled: "false",
    });

    expect(UserSettingsStore.load().value).toMatchObject({
      postProcessingEnabled: false,
      ssaoEnabled: false,
      ssrEnabled: false,
      bloomEnabled: false,
      vignetteEnabled: false,
      lutEnabled: true,
    });
  });

  it("falls back malformed preferences and clamps new sensitivity ranges", () => {
    saveSettings({
      reducedMotion: "sometimes",
      sprintMode: "press",
      crouchMode: "toggle",
      gamepadLookSensitivity: -50,
      touchLookSensitivity: 99,
      cameraEffectsIntensity: "high",
      damageFlashIntensity: -2,
    });

    expect(UserSettingsStore.load().value).toMatchObject({
      reducedMotion: "system",
      sprintMode: "hold",
      crouchMode: "toggle",
      gamepadLookSensitivity: 6,
      touchLookSensitivity: 8,
      cameraEffectsIntensity: 1,
      damageFlashIntensity: 0,
    });
  });

  it("sanitizes saved keyboard bindings before exposing them", () => {
    saveSettings({
      keyboardBindings: {
        moveForward: ["KeyZ", "ArrowUp"],
        jump: ["KeyZ"],
        interact: ["Escape"],
      },
    });

    const bindings = UserSettingsStore.load().value.keyboardBindings;
    const allCodes = Object.values(bindings).flat();
    expect(new Set(allCodes).size).toBe(allCodes.length);
    expect(bindings.interact).toEqual(["KeyF"]);
  });

  it("isolates nested bindings across defaults, store inputs, returns, and value reads", () => {
    const settings = UserSettingsStore.load();
    const patchBindings = createDefaultKeyboardBindings();
    const updated = settings.update({ keyboardBindings: patchBindings });
    const firstRead = settings.value;
    const secondRead = settings.value;

    expect(firstRead.keyboardBindings).not.toBe(secondRead.keyboardBindings);
    expect(firstRead.keyboardBindings.moveForward).not.toBe(secondRead.keyboardBindings.moveForward);
    expect(firstRead.keyboardBindings.moveForward).not.toBe(DEFAULT_USER_SETTINGS.keyboardBindings.moveForward);

    patchBindings.moveForward[0] = "KeyZ";
    (updated.keyboardBindings as KeyboardBindings).jump[0] = "KeyX";
    (firstRead.keyboardBindings as KeyboardBindings).crouch[0] = "KeyV";

    expect(settings.value.keyboardBindings).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    expect(DEFAULT_USER_SETTINGS.keyboardBindings).toEqual(DEFAULT_KEYBOARD_BINDINGS);
  });

  it("cycles graphics profiles in order", () => {
    const settings = UserSettingsStore.load();
    settings.update({ graphicsProfile: "performance" });
    expect(settings.cycleGraphicsProfile().graphicsProfile).toBe("balanced");
    expect(settings.cycleGraphicsProfile().graphicsProfile).toBe("cinematic");
    expect(settings.cycleGraphicsProfile().graphicsProfile).toBe("performance");
  });
});
