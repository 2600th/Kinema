import { expect, test } from "@playwright/test";
import { waitForGrounded, waitForLoadingGone } from "./helpers/kinema";

const PROFILE_SEQUENCE = ["performance", "balanced", "cinematic", "balanced"] as const;
const RENDERING_DIAGNOSTIC = /WGSL|ShaderModule|Destroyed texture|Invalid/i;

test("runtime graphics profiles rebuild without rendering lifecycle errors", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`);
  });

  await page.goto("/?station=materials", { waitUntil: "domcontentloaded" });
  await waitForLoadingGone(page);
  await waitForGrounded(page);

  for (const profile of PROFILE_SEQUENCE) {
    const returnedProfile = await page.evaluate((nextProfile) => {
      return window.__KINEMA__.setGraphicsProfile(nextProfile);
    }, profile);
    expect(returnedProfile).toBe(profile);

    await page.waitForTimeout(1_000);
    const effectiveProfile = await page.evaluate(() => {
      return window.__KINEMA__.getRendererDebugFlags().graphicsProfile;
    });
    expect(effectiveProfile).toBe(profile);
  }

  // KIN-011 owns the true-WebGPU destroyed ShadowDepthTexture defect. Keep
  // this assertion active so capable local hardware exposes it until fixed.
  const renderingDiagnostics = consoleMessages.filter((message) => RENDERING_DIAGNOSTIC.test(message));
  expect(renderingDiagnostics).toEqual([]);
});
