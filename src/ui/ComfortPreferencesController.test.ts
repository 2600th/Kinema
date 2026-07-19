import { describe, expect, it, vi } from "vitest";
import { ComfortPreferencesController } from "./ComfortPreferencesController";

class FakeMediaQueryList {
  matches: boolean;
  readonly addEventListener = vi.fn((_type: "change", listener: (event: { matches: boolean }) => void) => {
    this.listener = listener;
  });
  readonly removeEventListener = vi.fn((_type: "change", listener: (event: { matches: boolean }) => void) => {
    if (this.listener === listener) this.listener = null;
  });
  private listener: ((event: { matches: boolean }) => void) | null = null;

  constructor(matches: boolean) {
    this.matches = matches;
  }

  emit(matches: boolean): void {
    this.matches = matches;
    this.listener?.({ matches });
  }
}

function createHarness(osReduced: boolean) {
  const media = new FakeMediaQueryList(osReduced);
  const camera = { setEffectsIntensity: vi.fn() };
  const hud = { setDamageFlashIntensity: vi.fn() };
  const rootState = new Map<string, string>();
  const root = {
    setAttribute: vi.fn((name: string, value: string) => rootState.set(name, value)),
  };
  const matchMedia = vi.fn(() => media);
  const controller = new ComfortPreferencesController({ camera, hud, root, matchMedia });
  return { controller, media, camera, hud, root, rootState, matchMedia };
}

describe("ComfortPreferencesController", () => {
  it.each([
    ["system", false, "normal", 0.65],
    ["system", true, "reduce", 0],
    ["on", false, "reduce", 0],
    ["on", true, "reduce", 0],
    ["off", false, "normal", 0.65],
    ["off", true, "normal", 0.65],
  ] as const)("resolves %s with OS reduced=%s", (preference, osReduced, rootValue, cameraValue) => {
    const { controller, camera, hud, rootState } = createHarness(osReduced);

    controller.apply({
      cameraEffectsIntensity: 0.65,
      damageFlashIntensity: 0.4,
      reducedMotion: preference,
    });

    expect(hud.setDamageFlashIntensity).toHaveBeenCalledExactlyOnceWith(0.4);
    expect(camera.setEffectsIntensity).toHaveBeenCalledExactlyOnceWith(cameraValue);
    expect(rootState.get("data-reduced-motion")).toBe(rootValue);
  });

  it("follows live OS changes only while System is selected", () => {
    const { controller, media, camera, rootState } = createHarness(false);
    controller.apply({ cameraEffectsIntensity: 0.75, damageFlashIntensity: 1, reducedMotion: "system" });

    media.emit(true);
    expect(camera.setEffectsIntensity).toHaveBeenLastCalledWith(0);
    expect(rootState.get("data-reduced-motion")).toBe("reduce");

    controller.setReducedMotion("on");
    camera.setEffectsIntensity.mockClear();
    media.emit(false);
    expect(camera.setEffectsIntensity).not.toHaveBeenCalled();

    controller.setReducedMotion("off");
    camera.setEffectsIntensity.mockClear();
    media.emit(true);
    expect(camera.setEffectsIntensity).not.toHaveBeenCalled();
  });

  it("keeps the latest camera slider while reduced and restores it when normal", () => {
    const { controller, camera } = createHarness(false);
    controller.apply({ cameraEffectsIntensity: 0.8, damageFlashIntensity: 1, reducedMotion: "on" });

    controller.setCameraEffectsIntensity(0.35);
    expect(camera.setEffectsIntensity).toHaveBeenLastCalledWith(0);

    controller.setReducedMotion("off");
    expect(camera.setEffectsIntensity).toHaveBeenLastCalledWith(0.35);
  });

  it("creates one media query listener and removes it on dispose", () => {
    const { controller, media, matchMedia } = createHarness(false);

    controller.apply({ cameraEffectsIntensity: 1, damageFlashIntensity: 1, reducedMotion: "system" });
    controller.setReducedMotion("on");
    controller.setReducedMotion("system");
    controller.apply({ cameraEffectsIntensity: 0.5, damageFlashIntensity: 0.5, reducedMotion: "system" });

    expect(matchMedia).toHaveBeenCalledExactlyOnceWith("(prefers-reduced-motion: reduce)");
    expect(media.addEventListener).toHaveBeenCalledTimes(1);
    controller.dispose();
    controller.dispose();
    expect(media.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("sanitizes invalid modes and intensity inputs", () => {
    const { controller, camera, hud, rootState } = createHarness(true);

    controller.apply({
      cameraEffectsIntensity: Number.NaN,
      damageFlashIntensity: Number.POSITIVE_INFINITY,
      reducedMotion: "sometimes" as never,
    });

    expect(hud.setDamageFlashIntensity).toHaveBeenLastCalledWith(1);
    expect(camera.setEffectsIntensity).toHaveBeenLastCalledWith(0);
    expect(rootState.get("data-reduced-motion")).toBe("reduce");

    controller.setReducedMotion("off");
    controller.setCameraEffectsIntensity(-2);
    controller.setDamageFlashIntensity(4);
    expect(camera.setEffectsIntensity).toHaveBeenLastCalledWith(0);
    expect(hud.setDamageFlashIntensity).toHaveBeenLastCalledWith(1);
  });
});
