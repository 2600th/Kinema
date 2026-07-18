import { expect, type Page, test } from "@playwright/test";
import { waitForGrounded, waitForLoadingGone } from "./helpers/kinema";

const PROFILE_SEQUENCE = Array.from({ length: 5 }, () => ["cinematic", "balanced"] as const).flat();
const RENDERING_DIAGNOSTIC = /WGSL|ShaderModule|Destroyed texture|Invalid/i;

async function waitForRenderedFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test("runtime graphics profiles rebuild without rendering lifecycle errors", async ({ page }) => {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/?station=materials", { waitUntil: "domcontentloaded" });
  await waitForLoadingGone(page);
  await waitForGrounded(page);
  const activeBackend = await page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().activeBackend);
  expect(activeBackend).toMatch(/^WebGPU/);
  expect(await page.evaluate(() => window.__KINEMA__.setGraphicsProfile("balanced"))).toBe("balanced");
  await waitForRenderedFrames(page);

  for (const profile of PROFILE_SEQUENCE) {
    const returnedProfile = await page.evaluate((nextProfile) => {
      return window.__KINEMA__.setGraphicsProfile(nextProfile);
    }, profile);
    expect(returnedProfile).toBe(profile);

    await waitForRenderedFrames(page);

    const effectiveProfile = await page.evaluate(() => {
      return window.__KINEMA__.getRendererDebugFlags().graphicsProfile;
    });
    expect(effectiveProfile).toBe(profile);
  }

  // A same-profile request still queues the lighting resource boundary. On
  // true WebGPU this drains the tenth transition's rendered work before we
  // inspect asynchronously delivered validation diagnostics.
  expect(await page.evaluate(() => window.__KINEMA__.setGraphicsProfile("balanced"))).toBe("balanced");
  await page.waitForTimeout(250);

  // Keep this assertion active: only true-WebGPU hardware can prove the
  // ShadowDepthTexture lifecycle fix; CI documents WebGPU-on-WebGL2 safety.
  const renderingDiagnostics = consoleMessages.filter((message) => RENDERING_DIAGNOSTIC.test(message));
  expect(renderingDiagnostics).toEqual([]);
  expect(pageErrors).toEqual([]);
});
