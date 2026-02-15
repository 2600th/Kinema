import { describe, it, expect, beforeEach } from 'vitest';
import { UserSettingsStore, DEFAULT_USER_SETTINGS } from './UserSettings';

class LocalStorageMock implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
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

describe('UserSettingsStore', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new LocalStorageMock(),
      writable: true,
      configurable: true,
    });
  });

  it('loads defaults when storage is empty', () => {
    const settings = UserSettingsStore.load();
    expect(settings.value).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('persists updates and clamps invalid ranges', () => {
    const settings = UserSettingsStore.load();
    settings.update({
      mouseSensitivity: 999,
      cameraFov: 10,
      invertY: true,
      rawMouseInput: true,
      gamepadDeadzone: 1,
      gamepadCurve: 0.1,
      graphicsProfile: 'performance',
    });

    const loaded = UserSettingsStore.load();
    expect(loaded.value.invertY).toBe(true);
    expect(loaded.value.rawMouseInput).toBe(true);
    expect(loaded.value.graphicsProfile).toBe('performance');
    expect(loaded.value.mouseSensitivity).toBeLessThanOrEqual(0.01);
    expect(loaded.value.cameraFov).toBeGreaterThanOrEqual(50);
    expect(loaded.value.gamepadDeadzone).toBeLessThanOrEqual(0.4);
    expect(loaded.value.gamepadCurve).toBeGreaterThanOrEqual(0.6);
  });

  it('cycles graphics profiles in order', () => {
    const settings = UserSettingsStore.load();
    settings.update({ graphicsProfile: 'performance' });
    expect(settings.cycleGraphicsProfile().graphicsProfile).toBe('balanced');
    expect(settings.cycleGraphicsProfile().graphicsProfile).toBe('cinematic');
    expect(settings.cycleGraphicsProfile().graphicsProfile).toBe('performance');
  });
});

