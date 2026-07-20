/**
 * Visual-regression anchors generated and compared on Playwright's configured
 * Chromium SwiftShader path (WebGPURenderer on its WebGL2 backend).
 */
import { expect, test } from "@playwright/test";
import { PROCEDURAL_REVIEW_SPAWNS } from "../src/level/ShowcaseLayout";
import { waitForGrounded, waitForKinema, waitForLoadingGone } from "./helpers/kinema";

const REVIEW_ANCHORS = [PROCEDURAL_REVIEW_SPAWNS.steps, PROCEDURAL_REVIEW_SPAWNS.materials] as const;
const CAPTURE_OPTIONS = {
  animations: "disabled",
  maxDiffPixelRatio: 0.02,
  scale: "css",
  timeout: 60_000,
} as const;
const ANIMATED_VFX_CAPTURE_OPTIONS = {
  ...CAPTURE_OPTIONS,
  // GPU-time shader nodes and render-rate particles intentionally keep moving after simulation freeze.
  maxDiffPixelRatio: 0.05,
} as const;

async function freezeForCapture(
  page: import("@playwright/test").Page,
  expectedBackend = "WebGPU (WebGL2 backend)",
): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await window.__KINEMA__.freezeForCapture();
  });
  const state = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const cssWidth = canvas?.getBoundingClientRect().width ?? 0;
    return {
      backend: window.__KINEMA__.getRendererDebugFlags().activeBackend,
      fontsReady: document.fonts.check('16px "Outfit"'),
      pixelRatio: canvas && cssWidth > 0 ? canvas.width / cssWidth : 0,
      profile: window.__KINEMA__.getGraphicsProfile(),
    };
  });
  expect(state.fontsReady).toBe(true);
  expect(state.profile).toBe("performance");
  expect(state.pixelRatio).toBeCloseTo(1, 2);
  expect(state.backend).toBe(expectedBackend);
}

async function getCanvasAntialias(page: import("@playwright/test").Page): Promise<boolean | null> {
  return page.locator("canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return canvas.getContext("webgl2")?.getContextAttributes()?.antialias ?? null;
  });
}

test("main menu matches its visual baseline", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKinema(page);
  await expect(page.locator(".menu-screen.active")).toBeVisible();
  await freezeForCapture(page);

  await expect(page).toHaveScreenshot("main-menu.png", {
    ...CAPTURE_OPTIONS,
    mask: [page.locator(".menu-version")],
  });
});

for (const anchor of REVIEW_ANCHORS) {
  test(`${anchor.label} matches its visual baseline`, async ({ page }) => {
    await page.goto(`/?station=${anchor.key}`, { waitUntil: "domcontentloaded" });
    await waitForKinema(page);
    await waitForLoadingGone(page);
    await waitForGrounded(page);

    const teleported = await page.evaluate((key) => window.__KINEMA__.teleportToReviewSpawn(key), anchor.key);
    expect(teleported).toBe(true);
    await waitForGrounded(page);
    await freezeForCapture(page);

    await expect(page).toHaveScreenshot(`${anchor.key}.png`, CAPTURE_OPTIONS);
  });
}

const VFX_PARITY_OBJECTS = ["StationFloor_col", "ShowcaseBay0_col", "ShowcaseBayAccent0", "VFX_StationSign"] as const;

const VFX_RENDERER_PATHS = [
  {
    backend: "WebGPU (WebGL2 backend)",
    label: "default",
    query: "station=vfx",
  },
  {
    backend: "WebGPU (WebGL2 backend)",
    label: "forced-webgpu-webgl2",
    query: "station=vfx&forceWebGPUWebGL=1",
  },
  {
    backend: "WebGLRenderer",
    label: "bare-compat-webgl",
    query: "station=vfx&forceCompat=1&compatPost=0",
  },
] as const;

test.describe("VFX renderer-path parity", () => {
  test.describe.configure({ mode: "serial" });
  let referenceObjects: unknown = null;

  for (const rendererPath of VFX_RENDERER_PATHS) {
    test(`${rendererPath.label} keeps the VFX station visible`, async ({ page }) => {
      await page.goto(`/?${rendererPath.query}`, { waitUntil: "domcontentloaded" });
      await waitForKinema(page);
      await waitForLoadingGone(page);
      await waitForGrounded(page);

      const teleported = await page.evaluate(() => window.__KINEMA__.teleportToReviewSpawn("vfx"));
      expect(teleported).toBe(true);
      await waitForGrounded(page);
      await freezeForCapture(page, rendererPath.backend);

      const parityObjects = await page.evaluate((names) => {
        const round = (value: number) => Math.round(value * 1_000) / 1_000;
        return names.map((name) => {
          const state = window.__KINEMA__.getLevelObjectState(name);
          if (!state) return null;
          return {
            name: state.name,
            position: {
              x: round(state.position.x),
              y: round(state.position.y),
              z: round(state.position.z),
            },
            size: {
              x: round(state.size.x),
              y: round(state.size.y),
              z: round(state.size.z),
            },
            visible: state.visible,
          };
        });
      }, VFX_PARITY_OBJECTS);

      expect(parityObjects).not.toContain(null);
      expect(parityObjects.every((state) => state?.visible && state.size.x > 0 && state.size.y > 0)).toBe(true);
      expect(parityObjects).toEqual(referenceObjects ?? parityObjects);
      referenceObjects = parityObjects;

      await expect(page).toHaveScreenshot(`vfx-${rendererPath.label}.png`, ANIMATED_VFX_CAPTURE_OPTIONS);
    });
  }

  test("compatibility AA follows the immutable compatPost feature gate", async ({ page }) => {
    await page.goto("/?forceCompat=1", { waitUntil: "domcontentloaded" });
    await waitForKinema(page);

    expect(await getCanvasAntialias(page)).toBe(true);
    expect(await page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().activeBackend)).toBe("WebGLRenderer");

    await page.goto("/?forceCompat=1&compatPost=0", { waitUntil: "domcontentloaded" });
    await waitForKinema(page);

    expect(await getCanvasAntialias(page)).toBe(false);
  });
});
