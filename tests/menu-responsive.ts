import { expect, test } from "@playwright/test";
import type { GamepadMenuAction } from "../src/core/types";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "../src/core/UserSettings";
import { getShowcaseBayTopY, getShowcaseStationZ } from "../src/level/ShowcaseLayout";
import { waitForGrounded } from "./helpers/kinema";

const EVIDENCE_DIR = "docs/audits/evidence";
const SETTINGS_STORAGE_KEY = "kinema.user-settings.v1";
const DOOR_PROMPT_POSITION = {
  x: 4,
  y: getShowcaseBayTopY() + 0.325,
  z: getShowcaseStationZ("door"),
};

test.describe.configure({ mode: "serial" });

declare global {
  interface Window {
    __KINEMA__: import("../src/core/KinemaDebugApi").KinemaDebugApi;
  }
}

async function simulateGamepadMenuInput(
  page: import("@playwright/test").Page,
  action: GamepadMenuAction,
): Promise<void> {
  await page.evaluate((input) => window.__KINEMA__.simulateGamepadMenuInput(input), action);
}

async function pressUntilFocused(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
  key: string,
  maxSteps = 40,
): Promise<void> {
  for (let step = 0; step < maxSteps; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

async function gamepadUntilFocused(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
  action: GamepadMenuAction,
  maxSteps = 40,
): Promise<void> {
  for (let step = 0; step < maxSteps; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await simulateGamepadMenuInput(page, action);
  }
  await expect(target).toBeFocused();
}

async function expectVisibleFocusRing(locator: import("@playwright/test").Locator): Promise<void> {
  const outline = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.outlineColor,
      focusVisible: element.matches(":focus-visible"),
      gamepadFocus: element.closest(".menu-overlay")?.classList.contains("is-gamepad-navigation") ?? false,
      offset: style.outlineOffset,
      style: style.outlineStyle,
      width: style.outlineWidth,
    };
  });

  expect(outline.focusVisible || outline.gamepadFocus).toBe(true);
  expect(outline.color).toBe("rgb(98, 230, 255)");
  expect(outline.offset).toBe("2px");
  expect(outline.style).toBe("solid");
  expect(outline.width).toBe("2px");
}

async function seedSettings(page: import("@playwright/test").Page, patch: Partial<UserSettings>): Promise<void> {
  await page.addInitScript(
    ({ storageKey, value }) => {
      if (sessionStorage.getItem("kinema-playwright-settings-seeded")) return;
      localStorage.setItem(storageKey, JSON.stringify(value));
      sessionStorage.setItem("kinema-playwright-settings-seeded", "true");
    },
    { storageKey: SETTINGS_STORAGE_KEY, value: { ...DEFAULT_USER_SETTINGS, ...patch } },
  );
}

async function openSettings(page: import("@playwright/test").Page, url = "/"): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("dialog", { name: "Kinema" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

async function readStoredSettings(page: import("@playwright/test").Page): Promise<UserSettings> {
  return page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) ?? "null"), SETTINGS_STORAGE_KEY);
}

async function setSlider(
  page: import("@playwright/test").Page,
  name: RegExp,
  value: number,
): Promise<import("@playwright/test").Locator> {
  const slider = page.getByRole("slider", { name });
  await slider.fill(String(value));
  await expect(slider).toHaveValue(String(value));
  return slider;
}

function bindingRow(page: import("@playwright/test").Page, action: string) {
  return page.locator(".binding-row", { has: page.locator(".binding-action", { hasText: action }) });
}

function formatSliderValue(value: number, step: number): string {
  const decimals = step < 0.01 ? (step < 0.001 ? 4 : 3) : 2;
  return value.toFixed(decimals);
}

test.describe("KIN-020 settings journeys", () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test("persists requested graphics effects and keeps profile overrides sticky", async ({ page }) => {
    await seedSettings(page, {
      graphicsProfile: "cinematic",
      postProcessingEnabled: true,
      ssaoEnabled: true,
      ssrEnabled: false,
      bloomEnabled: true,
      vignetteEnabled: true,
      lutEnabled: true,
    });
    await openSettings(page);
    await page.getByRole("button", { name: "Graphics" }).click();

    await expect(page.getByRole("combobox", { name: "Graphics profile" })).toHaveValue("cinematic");
    for (const [name, checked] of [
      ["Post-processing", true],
      ["SSAO", true],
      ["SSR", false],
      ["Bloom", true],
      ["Vignette", true],
      ["LUT", true],
    ] as const) {
      await expect(page.getByRole("checkbox", { name })).toBeChecked({ checked });
    }

    await expect.poll(() => page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().ssrEnabled)).toBe(false);
    const profile = page.getByRole("combobox", { name: "Graphics profile" });
    await profile.selectOption("performance");
    await profile.selectOption("cinematic");
    await expect(page.getByRole("checkbox", { name: "SSR" })).not.toBeChecked();
    await expect.poll(async () => (await readStoredSettings(page)).ssrEnabled).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().ssrEnabled)).toBe(false);

    const ssao = page.getByRole("checkbox", { name: "SSAO" });
    await ssao.uncheck();
    await expect.poll(async () => (await readStoredSettings(page)).ssaoEnabled).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().ssaoEnabled)).toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog", { name: "Kinema" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Graphics" }).click();
    await expect(page.getByRole("checkbox", { name: "SSAO" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "SSR" })).not.toBeChecked();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const flags = window.__KINEMA__.getRendererDebugFlags();
          return { ssao: flags.ssaoEnabled, ssr: flags.ssrEnabled };
        }),
      )
      .toEqual({ ssao: false, ssr: false });
  });

  test("keeps requested post effects visible but unavailable in plain compatibility mode", async ({ page }) => {
    await seedSettings(page, {
      postProcessingEnabled: true,
      ssaoEnabled: true,
      ssrEnabled: true,
      bloomEnabled: true,
      vignetteEnabled: true,
      lutEnabled: true,
    });
    await openSettings(page, "/?forceCompat=1");
    await page.getByRole("button", { name: "Graphics" }).click();

    const expectedUnsupported = ["Post-processing", "SSAO", "SSR", "Bloom", "Vignette", "LUT"];
    for (const name of expectedUnsupported) {
      const checkbox = page.getByRole("checkbox", { name });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeDisabled();
      await expect(
        checkbox.locator("xpath=ancestor::div[contains(@class,'menu-field')]").locator(".menu-field-help"),
      ).toBeVisible();
    }

    await expect
      .poll(() =>
        page.evaluate(() => {
          const flags = window.__KINEMA__.getRendererDebugFlags();
          return {
            backend: flags.activeBackend,
            post: flags.postProcessingEnabled,
            ssao: flags.ssaoEnabled,
            ssr: flags.ssrEnabled,
            bloom: flags.bloomEnabled,
            vignette: flags.vignetteEnabled,
            lut: flags.lutEnabled,
          };
        }),
      )
      .toEqual({
        backend: "WebGLRenderer",
        post: false,
        ssao: false,
        ssr: false,
        bloom: false,
        vignette: false,
        lut: false,
      });
  });

  test("exposes exact slider contracts and persists corrected and KIN-020 endpoints", async ({ page }) => {
    await openSettings(page);

    const contracts = [
      ["Mouse sensitivity", { min: 0.0005, max: 0.01, step: 0.0001 }],
      ["Camera FOV", { min: 50, max: 90, step: 1 }],
      ["Gamepad deadzone", { min: 0.02, max: 0.4, step: 0.01 }],
      ["Gamepad curve", { min: 0.6, max: 3, step: 0.1 }],
      ["Camera effects intensity", { min: 0, max: 1, step: 0.05 }],
      ["Damage flash intensity", { min: 0, max: 1, step: 0.05 }],
      ["Gamepad look sensitivity", { min: 6, max: 30, step: 1 }],
      ["Touch look sensitivity", { min: 1, max: 8, step: 0.25 }],
    ] as const;
    const graphicsContracts = [
      ["Resolution scale", { min: 0.5, max: 1, step: 0.05 }],
      ["Environment rotation", { min: -180, max: 180, step: 1 }],
      ["CAS strength", { min: 0, max: 1, step: 0.05 }],
    ] as const;
    const audioContracts = [
      ["Master volume", { min: 0, max: 1, step: 0.01 }],
      ["Music volume", { min: 0, max: 1, step: 0.01 }],
      ["SFX volume", { min: 0, max: 1, step: 0.01 }],
    ] as const;

    const assertContracts = async (
      entries: readonly (readonly [string, { min: number; max: number; step: number }])[],
    ) => {
      for (const [name, range] of entries) {
        const slider = page.getByRole("slider", { name: new RegExp(`^${name}:`) });
        await expect(slider).toHaveAttribute("min", String(range.min));
        await expect(slider).toHaveAttribute("max", String(range.max));
        await expect(slider).toHaveAttribute("step", String(range.step));
      }
    };
    await assertContracts(contracts);
    await page.getByRole("button", { name: "Graphics" }).click();
    await assertContracts(graphicsContracts);
    await page.getByRole("button", { name: "Audio" }).click();
    await assertContracts(audioContracts);
    await page.getByRole("button", { name: "Controls" }).click();

    const endpointCases = [
      ["Mouse sensitivity", "mouseSensitivity", { min: 0.0005, max: 0.01, step: 0.0001 }],
      ["Camera FOV", "cameraFov", { min: 50, max: 90, step: 1 }],
      ["Gamepad deadzone", "gamepadDeadzone", { min: 0.02, max: 0.4, step: 0.01 }],
      ["Gamepad look sensitivity", "gamepadLookSensitivity", { min: 6, max: 30, step: 1 }],
      ["Touch look sensitivity", "touchLookSensitivity", { min: 1, max: 8, step: 0.25 }],
      ["Camera effects intensity", "cameraEffectsIntensity", { min: 0, max: 1, step: 0.05 }],
      ["Damage flash intensity", "damageFlashIntensity", { min: 0, max: 1, step: 0.05 }],
    ] as const;
    for (const endpointName of ["min", "max"] as const) {
      for (const [name, key, range] of endpointCases) {
        const endpoint = range[endpointName];
        const sliderName = new RegExp(`^${name}:`);
        const slider = await setSlider(page, sliderName, endpoint);
        await expect(slider).toHaveAccessibleName(`${name}: ${formatSliderValue(endpoint, range.step)}`);
        await expect.poll(async () => (await readStoredSettings(page))[key]).toBe(endpoint);
      }

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Kinema" })).toBeVisible();
      await page.getByRole("button", { name: "Settings" }).click();
      for (const [name, , range] of endpointCases) {
        const endpoint = range[endpointName];
        const slider = page.getByRole("slider", { name: new RegExp(`^${name}:`) });
        await expect(slider).toHaveValue(String(endpoint));
        await expect(slider).toHaveAccessibleName(`${name}: ${formatSliderValue(endpoint, range.step)}`);
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("dialog", { name: "Kinema" })).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: "Settings" }).click();
      for (const [name, , range] of endpointCases) {
        const endpoint = range[endpointName];
        const slider = page.getByRole("slider", { name: new RegExp(`^${name}:`) });
        await expect(slider).toHaveValue(String(endpoint));
        await expect(slider).toHaveAccessibleName(`${name}: ${formatSliderValue(endpoint, range.step)}`);
      }
    }

    await expect(page.locator(".hud-damage-overlay")).toHaveCSS("--damage-flash-intensity", "1");
  });

  test("remaps, swaps, cancels, resets, and updates the live interaction prompt", async ({ page }) => {
    test.setTimeout(180_000);
    await openSettings(page);
    const status = page.getByRole("status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    for (const action of [
      "Move forward",
      "Move backward",
      "Move left",
      "Move right",
      "Jump",
      "Interact",
      "Crouch",
      "Sprint",
    ]) {
      await expect(page.getByRole("button", { name: `Rebind ${action}`, exact: true })).toHaveCount(1);
    }
    await expect(page.getByRole("button", { name: "Reset bindings", exact: true })).toHaveCount(1);
    for (const [name, value] of [
      ["Camera effects intensity", "1.00"],
      ["Damage flash intensity", "1.00"],
      ["Gamepad look sensitivity", "18.00"],
      ["Touch look sensitivity", "4.00"],
    ] as const) {
      await expect(page.getByRole("slider", { name: `${name}: ${value}`, exact: true })).toHaveCount(1);
    }
    for (const name of ["Reduced motion", "Sprint mode", "Crouch mode"]) {
      await expect(page.getByRole("combobox", { name, exact: true })).toHaveCount(1);
    }
    const interactButton = page.getByRole("button", { name: "Rebind Interact" });

    await interactButton.click();
    await expect(page.getByRole("button", { name: /Capturing Interact/ })).toHaveText("Press a key...");
    await expect(status).toHaveText("Listening for Interact. Escape cancels.");
    await page.keyboard.press("KeyZ");
    await expect(status).toHaveText("Interact set to Z.");
    await expect(bindingRow(page, "Interact").locator("kbd")).toHaveText("Z");
    await expect.poll(async () => (await readStoredSettings(page)).keyboardBindings.interact[0]).toBe("KeyZ");
    await expect(interactButton).toBeFocused();

    await interactButton.click();
    await page.keyboard.press("Space");
    await expect(bindingRow(page, "Interact").locator("kbd")).toHaveText("Space");
    await expect(bindingRow(page, "Jump").locator("kbd")).toHaveText("Z");
    let stored = await readStoredSettings(page);
    expect(new Set(Object.values(stored.keyboardBindings).flat()).size).toBe(
      Object.values(stored.keyboardBindings).flat().length,
    );

    await interactButton.click();
    await page.keyboard.press("KeyE");
    await expect(status).toHaveText("E is reserved. Choose another key.");
    await expect(page.getByRole("button", { name: /Capturing Interact/ })).toHaveText("Press a key...");
    await page.keyboard.press("Escape");
    await expect(status).toHaveText("Cancelled Interact rebinding.");
    await expect(interactButton).toBeFocused();

    await page.getByRole("button", { name: "Reset bindings" }).click();
    await expect(status).toHaveText("Keyboard bindings reset to defaults.");
    stored = await readStoredSettings(page);
    expect(stored.keyboardBindings).toEqual(DEFAULT_USER_SETTINGS.keyboardBindings);

    await interactButton.click();
    await page.keyboard.press("KeyZ");
    await expect(bindingRow(page, "Interact").locator("kbd")).toHaveText("Z");

    const controlsSection = page.locator(".menu-section.active");
    await bindingRow(page, "Move forward").scrollIntoViewIfNeeded();
    await expect(bindingRow(page, "Sprint")).toBeVisible();
    await interactButton.focus();
    await expectVisibleFocusRing(interactButton);
    await controlsSection.evaluate((section) => {
      const children = Array.from(section.children) as HTMLElement[];
      const first = children.findIndex((child) => child.textContent === "Keyboard Remapping");
      const last = children.findIndex((child) => child.classList.contains("binding-status"));
      children.forEach((child, index) => {
        if (index < first || index > last) child.style.display = "none";
      });
      children[last].style.position = "relative";
      children[last].style.zIndex = "1";
      (section as HTMLElement).style.maxHeight = "none";
      (section as HTMLElement).style.overflow = "visible";
      (section as HTMLElement).style.paddingBottom = "48px";
    });
    await page.evaluate(() => document.fonts.ready);
    await controlsSection.evaluate(async (section) => {
      await Promise.all(
        section.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    await controlsSection.screenshot({ path: `${EVIDENCE_DIR}/27-settings-remap.png` });

    await page.goto("/?station=door", { waitUntil: "domcontentloaded" });
    await page.locator(".loading-screen").waitFor({ state: "hidden", timeout: 180_000 });
    await page.waitForFunction(() => Boolean(window.__KINEMA__));
    await waitForGrounded(page);
    await page.evaluate((position) => {
      window.__KINEMA__.teleportPlayer(position);
      window.__KINEMA__.setCameraLook(-0.08, 0);
    }, DOOR_PROMPT_POSITION);
    await expect(page.locator("#hud-prompt")).toContainText("Hold Z to Activate Beacon", { timeout: 30_000 });
  });

  test("cleans capture on tab switch and supports controller remap and comfort navigation", async ({ page }) => {
    await openSettings(page);
    const status = page.getByRole("status");
    const interactButton = page.getByRole("button", { name: "Rebind Interact" });
    await interactButton.click();
    const crouchButton = page.getByRole("button", { name: "Rebind Crouch", exact: true });
    await pressUntilFocused(page, crouchButton, "Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Capturing Crouch/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(status).toHaveText("Cancelled Crouch rebinding.");

    await interactButton.click();
    const resetBindings = page.getByRole("button", { name: "Reset bindings", exact: true });
    await pressUntilFocused(page, resetBindings, "Tab");
    await page.keyboard.press("Space");
    await expect(status).toHaveText("Keyboard bindings reset to defaults.");

    await interactButton.click();
    const graphicsTab = page.getByRole("button", { name: "Graphics" });
    await pressUntilFocused(page, graphicsTab, "Tab");
    await page.keyboard.press("Enter");
    await expect(graphicsTab).toBeFocused();
    await page.keyboard.press("KeyZ");

    await page.getByRole("button", { name: "Controls" }).click();
    await expect(bindingRow(page, "Interact").locator("kbd")).toHaveText("F");
    await interactButton.click();
    await page.keyboard.press("KeyZ");
    await expect(bindingRow(page, "Interact").locator("kbd")).toHaveText("Z");

    const controlsTab = page.getByRole("button", { name: "Controls" });
    await controlsTab.focus();
    const forwardRebind = page.getByRole("button", { name: "Rebind Move forward" });
    await gamepadUntilFocused(page, forwardRebind, "down");
    await expectVisibleFocusRing(forwardRebind);
    await simulateGamepadMenuInput(page, "activate");
    await expect(page.getByRole("button", { name: /Capturing Move forward/ })).toBeFocused();
    await page.keyboard.press("KeyX");
    await expect(bindingRow(page, "Move forward").locator("kbd")).toHaveText("X");

    const cameraEffects = page.getByRole("slider", { name: /^Camera effects intensity:/ });
    await gamepadUntilFocused(page, cameraEffects, "down");
    await expect(page.locator(".menu-overlay")).toHaveClass(/is-gamepad-navigation/);
    const before = Number(await cameraEffects.inputValue());
    await simulateGamepadMenuInput(page, "left");
    await expect.poll(async () => Number(await cameraEffects.inputValue())).toBeLessThan(before);
  });

  test("resolves reduced motion and applies comfort slider state to the real HUD", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSettings(page);
    const root = page.locator("html");
    const reducedMotion = page.getByRole("combobox", { name: "Reduced motion" });
    const controlsSection = page.locator(".menu-section.active");
    await expect(root).toHaveAttribute("data-reduced-motion", "reduce");
    await expect(reducedMotion).toHaveValue("system");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await reducedMotion.selectOption("on");
    await expect(root).toHaveAttribute("data-reduced-motion", "reduce");
    await expect(controlsSection).toHaveCSS("animation-name", "none");
    await expect.poll(async () => (await readStoredSettings(page)).reducedMotion).toBe("on");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(root).toHaveAttribute("data-reduced-motion", "reduce", { timeout: 60_000 });
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(reducedMotion).toHaveValue("on");

    const cameraEffects = await setSlider(page, /^Camera effects intensity:/, 0);
    await expect(root).toHaveAttribute("data-reduced-motion", "reduce");
    await expect.poll(async () => (await readStoredSettings(page)).cameraEffectsIntensity).toBe(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await reducedMotion.selectOption("off");
    await expect(root).toHaveAttribute("data-reduced-motion", "normal");
    await expect(controlsSection).toHaveCSS("animation-name", "fadeIn");
    await expect.poll(async () => (await readStoredSettings(page)).reducedMotion).toBe("off");
    await expect(cameraEffects).toHaveValue("0");

    const damageFlash = page.getByRole("slider", { name: /^Damage flash intensity:/ });
    await damageFlash.fill("0");
    await expect(page.locator(".hud-damage-overlay")).toHaveCSS("--damage-flash-intensity", "0");
    await damageFlash.fill("1");
    await expect(page.locator(".hud-damage-overlay")).toHaveCSS("--damage-flash-intensity", "1");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(root).toHaveAttribute("data-reduced-motion", "normal", { timeout: 60_000 });
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("combobox", { name: "Reduced motion" })).toHaveValue("off");
    await expect(page.getByRole("slider", { name: /^Camera effects intensity:/ })).toHaveValue("0");
    await expect(page.getByRole("slider", { name: /^Damage flash intensity:/ })).toHaveValue("1");

    await page.getByRole("combobox", { name: "Reduced motion" }).selectOption("on");
    await page.getByRole("slider", { name: /^Camera effects intensity:/ }).fill("0");
    await page.getByRole("slider", { name: /^Damage flash intensity:/ }).fill("1");
    await page.getByRole("heading", { name: "Comfort" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("slider", { name: /^Touch look sensitivity:/ })).toBeVisible();
    await controlsSection.evaluate((section) => {
      const children = Array.from(section.children) as HTMLElement[];
      const first = children.findIndex((child) => child.textContent === "Comfort");
      children.forEach((child, index) => {
        if (index < first) child.style.display = "none";
      });
      (section as HTMLElement).style.maxHeight = "none";
      (section as HTMLElement).style.overflow = "visible";
    });
    await controlsSection.screenshot({ path: `${EVIDENCE_DIR}/26-settings-comfort.png` });
  });

  test("shows full damage feedback and suppresses zero-intensity hazard flashes", async ({ page }) => {
    test.setTimeout(180_000);
    await seedSettings(page, { damageFlashIntensity: 1, reducedMotion: "off" });

    const triggerFirstHazard = async () => {
      await page.goto("/?station=platformsPhysics", { waitUntil: "domcontentloaded" });
      await page.locator(".loading-screen").waitFor({ state: "hidden", timeout: 180_000 });
      await waitForGrounded(page);
      const hazardId = await page.evaluate(() => window.__KINEMA__.listHazards()[0]?.id ?? null);
      expect(hazardId).not.toBeNull();
      await page.evaluate((id) => window.__KINEMA__.teleportToHazard(id as string), hazardId);
      await page.waitForFunction(() => window.__KINEMA__.getHealth().current === 2, undefined, {
        timeout: 30_000,
      });
    };

    await triggerFirstHazard();
    const damageOverlay = page.locator(".hud-damage-overlay");
    await expect(damageOverlay).toHaveClass(/is-hit/);
    await expect(damageOverlay).toHaveCSS("--damage-flash-intensity", "1");
    await expect(damageOverlay).toHaveCSS("--damage-flash-outer-duration", "2500ms");
    expect(await damageOverlay.evaluate((element) => getComputedStyle(element, "::before").animationName)).toContain(
      "hud-damage",
    );

    await openSettings(page);
    await setSlider(page, /^Damage flash intensity:/, 0);
    await expect(page.locator(".hud-damage-overlay")).toHaveCSS("--damage-flash-intensity", "0");
    await triggerFirstHazard();
    await expect(page.locator(".hud-damage-overlay")).not.toHaveClass(/is-hit/);
  });
});

const VIEWPORTS = [
  { name: "iphone-landscape", width: 844, height: 390, isMobile: true, hasTouch: true },
  { name: "tiny-portrait", width: 320, height: 568, isMobile: true, hasTouch: true },
  { name: "desktop-short", width: 1280, height: 620, isMobile: false, hasTouch: false },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`main menu responsive layout: ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
    });

    test("main menu content stays reachable within the menu card", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".menu-screen.active", { timeout: 60_000 });

      if (viewport.hasTouch) {
        const touchControls = page.locator(".touch-controls-container");
        await expect(touchControls).toHaveAttribute("aria-hidden", "true", { timeout: 60_000 });
        await expect(touchControls).toHaveAttribute("inert", "");
      }

      const layout = await page.evaluate(() => {
        const screen = document.querySelector(".menu-screen.active") as HTMLElement | null;
        const title = document.querySelector(".menu-title") as HTMLElement | null;
        const lastButton = document.querySelector(
          ".menu-screen.active .menu-button:last-of-type",
        ) as HTMLElement | null;
        const version = document.querySelector(".menu-version") as HTMLElement | null;

        const rect = (element: Element | null) => {
          if (!element) return null;
          const bounds = element.getBoundingClientRect();
          return {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            width: bounds.width,
            height: bounds.height,
          };
        };

        const screenRect = rect(screen);
        const titleRect = rect(title);
        const initialLastButtonRect = rect(lastButton);
        const initialVersionRect = rect(version);

        const bottomReachableInitially = Boolean(
          screenRect &&
            initialLastButtonRect &&
            initialVersionRect &&
            initialLastButtonRect.bottom <= screenRect.bottom &&
            initialVersionRect.bottom <= screenRect.bottom,
        );

        if (screen) {
          screen.scrollTop = screen.scrollHeight;
        }

        const scrolledLastButtonRect = rect(lastButton);
        const scrolledVersionRect = rect(version);
        const scrolledScreenRect = rect(screen);

        const bottomReachableAfterScroll = Boolean(
          scrolledScreenRect &&
            scrolledLastButtonRect &&
            scrolledVersionRect &&
            scrolledLastButtonRect.bottom <= scrolledScreenRect.bottom + 1 &&
            scrolledVersionRect.bottom <= scrolledScreenRect.bottom + 1,
        );

        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          screen: screenRect,
          title: titleRect,
          initialLastButton: initialLastButtonRect,
          initialVersion: initialVersionRect,
          scrollable: Boolean(screen && screen.scrollHeight > screen.clientHeight),
          bottomReachableInitially,
          bottomReachableAfterScroll,
        };
      });

      expect(layout.screen).not.toBeNull();
      expect(layout.title).not.toBeNull();
      expect(layout.screen!.left).toBeGreaterThanOrEqual(0);
      expect(layout.screen!.top).toBeGreaterThanOrEqual(0);
      expect(layout.screen!.right).toBeLessThanOrEqual(layout.viewport.width);
      expect(layout.screen!.bottom).toBeLessThanOrEqual(layout.viewport.height);
      expect(layout.bottomReachableInitially || layout.scrollable).toBe(true);
      expect(layout.bottomReachableAfterScroll).toBe(true);
    });
  });
}

test.describe("menu accessibility", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("loads the shared palette and menu stacking tokens before application styles", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const mainDialog = page.getByRole("dialog", { name: "Kinema" });
    await expect(mainDialog).toBeVisible({ timeout: 60_000 });

    const styles = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const menu = document.querySelector<HTMLElement>(".menu-overlay.active");
      return {
        accent: root.getPropertyValue("--k-accent").trim(),
        accentHover: root.getPropertyValue("--k-accent-hover").trim(),
        accentCyan: root.getPropertyValue("--k-accent-cyan").trim(),
        bodyFont: root.getPropertyValue("--k-font-body").replace(/\s+/g, " ").trim(),
        menuZ: menu ? getComputedStyle(menu).zIndex : null,
      };
    });

    expect(styles).toEqual({
      accent: "#7b6cff",
      accentHover: "#ff79ba",
      accentCyan: "#62e6ff",
      bodyFont:
        '"Outfit", "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      menuZ: "1200",
    });
  });

  test("keeps visible keyboard focus inside named dialogs and restores the invoker", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const mainDialog = page.locator('[role="dialog"][aria-labelledby="menu-main-title"]');
    await expect(mainDialog).toBeVisible({ timeout: 60_000 });
    await expect(mainDialog).toHaveAccessibleName("Kinema");
    await expect(mainDialog).toHaveAttribute("aria-modal", "true");
    await expect(mainDialog).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByRole("button", { name: "Play" })).toBeFocused();

    await page.keyboard.press("Tab");
    const levelSelectButton = page.getByRole("button", { name: "Level Select" });
    await expect(levelSelectButton).toBeFocused();
    await expectVisibleFocusRing(levelSelectButton);
    await page.screenshot({ path: `${EVIDENCE_DIR}/22-focus-menu-button.png` });

    const settingsButton = page.getByRole("button", { name: "Settings" });
    await settingsButton.focus();
    await page.keyboard.press("Enter");

    const settingsDialog = page.locator('[role="dialog"][aria-labelledby="menu-settings-title"]');
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog).toHaveAccessibleName("Settings");
    await expect(mainDialog).toHaveAttribute("aria-hidden", "true");
    await expect(mainDialog).toHaveAttribute("inert", "");
    await expect(settingsDialog).not.toHaveAttribute("inert", "");
    await expect.poll(() => settingsDialog.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");

    const controlsTab = page.getByRole("button", { name: "Controls" });
    await expect(controlsTab).toBeFocused();
    await expect(controlsTab).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("slider", { name: /Mouse sensitivity/ })).toBeVisible();
    await expectVisibleFocusRing(controlsTab);
    await page.screenshot({ path: `${EVIDENCE_DIR}/23-focus-menu-tab.png` });

    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(controlsTab).toBeFocused();

    const firstCheckbox = page.getByRole("checkbox", { name: "Invert Y" });
    await firstCheckbox.focus();
    await expectVisibleFocusRing(firstCheckbox);
    await page.screenshot({ path: `${EVIDENCE_DIR}/24-focus-menu-checkbox.png` });

    const graphicsTab = page.getByRole("button", { name: "Graphics" });
    await graphicsTab.focus();
    await page.keyboard.press("Enter");
    await expect(graphicsTab).toHaveAttribute("aria-pressed", "true");
    await expect(controlsTab).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("combobox", { name: "Graphics profile" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(settingsDialog).not.toHaveClass(/\bactive\b/);
    await expect(settingsDialog).toHaveAttribute("aria-hidden", "true");
    await expect(mainDialog).toHaveAttribute("aria-hidden", "false");
    await expect(settingsButton).toBeFocused();
  });

  test("completes the menu, settings, play, pause, and resume journey with simulated gamepad input", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog", { name: "Kinema" })).toBeVisible({ timeout: 60_000 });

    await page.getByRole("heading", { name: "Kinema" }).click();
    await simulateGamepadMenuInput(page, "down");
    await expect(page.getByRole("button", { name: "Play" })).toBeFocused();
    await expectVisibleFocusRing(page.getByRole("button", { name: "Play" }));
    await simulateGamepadMenuInput(page, "down");
    await expect(page.getByRole("button", { name: "Level Select" })).toBeFocused();
    await simulateGamepadMenuInput(page, "down");
    await expect(page.getByRole("button", { name: "Create Level" })).toBeFocused();
    await simulateGamepadMenuInput(page, "down");
    const settingsButton = page.getByRole("button", { name: "Settings" });
    await expect(settingsButton).toBeFocused();
    await expectVisibleFocusRing(settingsButton);
    await page.screenshot({ path: `${EVIDENCE_DIR}/25-focus-menu-gamepad.png` });

    await simulateGamepadMenuInput(page, "activate");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Controls" })).toBeFocused();

    await simulateGamepadMenuInput(page, "down");
    await simulateGamepadMenuInput(page, "down");
    await simulateGamepadMenuInput(page, "down");
    const sensitivity = page.getByRole("slider", { name: /Mouse sensitivity/ });
    await expect(sensitivity).toBeFocused();
    const previousSensitivity = Number(await sensitivity.inputValue());
    await simulateGamepadMenuInput(page, "right");
    await expect.poll(async () => Number(await sensitivity.inputValue())).toBeGreaterThan(previousSensitivity);

    await simulateGamepadMenuInput(page, "back");
    await expect(page.getByRole("dialog", { name: "Kinema" })).toBeVisible();
    await expect(settingsButton).toBeFocused();
    await simulateGamepadMenuInput(page, "up");
    await simulateGamepadMenuInput(page, "up");
    await simulateGamepadMenuInput(page, "up");
    await expect(page.getByRole("button", { name: "Play" })).toBeFocused();
    await simulateGamepadMenuInput(page, "activate");

    await page.locator(".loading-screen").waitFor({ state: "hidden", timeout: 180_000 });
    await simulateGamepadMenuInput(page, "start");
    await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible({ timeout: 30_000 });
    await simulateGamepadMenuInput(page, "start");
    await expect(page.locator(".menu-overlay.active")).toHaveCount(0);
  });

  test("keeps hidden HUD content out of the accessibility tree and exposes polite status regions", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog", { name: "Kinema" })).toBeVisible({ timeout: 60_000 });

    await expect(page.locator("#hud-prompt")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#hud-hold")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#hud-objective")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".hud-collectible-chip")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".hud-health-chip")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".kinema-orientation-hint")).toHaveAttribute("aria-hidden", "true");

    await expect(page.locator("#hud-status-lane")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator("#hud-status-lane")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#hud-objective")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator(".hud-collectible-chip")).toHaveAttribute("aria-label", "Collectibles: 0");
    await expect(page.locator(".hud-health-chip")).toHaveAttribute("aria-label", "Health: 3 of 3 hearts");
  });
});
