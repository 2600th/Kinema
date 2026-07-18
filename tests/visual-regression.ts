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

async function freezeForCapture(page: import("@playwright/test").Page): Promise<void> {
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
  expect(state.backend).toBe("WebGPU (WebGL2 backend)");
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
