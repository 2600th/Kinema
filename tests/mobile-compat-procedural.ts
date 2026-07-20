import { expect, test } from "@playwright/test";
import { waitForGrounded, waitForKinema, waitForLoadingGone } from "./helpers/kinema";

const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.0.0 Mobile/15E148 Safari/604.1";

test.use({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
});

test("iPhone-like compatibility renderer loads the full procedural level without runtime errors", async ({ page }) => {
  test.setTimeout(120_000);

  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => {
    runtimeErrors.push(String(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });

  await page.addInitScript((userAgent) => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => userAgent,
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "iPhone",
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5,
    });
  }, IPHONE_USER_AGENT);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKinema(page);

  const fallbackToast = page.locator(".renderer-fallback-toast");
  await expect(fallbackToast).toBeVisible();
  await expect(fallbackToast).toHaveAttribute("role", "status");
  await expect(fallbackToast).toHaveAttribute("aria-live", "polite");
  await expect(fallbackToast).toHaveText("Compatibility renderer active — some effects reduced");
  await expect(page.locator("#renderer-status-badge")).toHaveText(/^WebGL · /);
  await expect(fallbackToast).toBeHidden({ timeout: 5_000 });

  await expect(page.getByRole("button", { name: /^play$/i })).toBeVisible();
  await page.getByRole("button", { name: /^play$/i }).click();
  await waitForLoadingGone(page);
  await waitForGrounded(page);
  await expect(fallbackToast).toBeHidden();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window.__KINEMA__;
          return {
            backend: api.getRendererDebugFlags().activeBackend,
            compatibilityPostActive: api.getRendererDebugFlags().compatibilityPostActive,
            lut: api.getRendererDebugFlags().lutEnabled,
            vignette: api.getRendererDebugFlags().vignetteEnabled,
            vfxScanner: api.getLevelObjectState("VFX_Scanner"),
            navPlatform: api.getLevelObjectState("NavPlatform"),
            futureBarrier: api.getLevelObjectState("FutureA_barrier_0"),
          };
        }),
      { timeout: 60_000 },
    )
    .toMatchObject({
      backend: "WebGLRenderer",
      compatibilityPostActive: true,
      lut: true,
      vignette: false,
      vfxScanner: { visible: true },
      navPlatform: { visible: true },
      futureBarrier: { visible: true },
    });

  expect(runtimeErrors).toEqual([]);
});

test("compatibility post p95 stays within the measured mobile proxy budget", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const origin = baseURL ?? "http://localhost:5173";

  async function measurePath(compatibilityPostEnabled: boolean) {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
      userAgent: IPHONE_USER_AGENT,
    });
    const page = await context.newPage();
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { configurable: true, get: () => "iPhone" });
      Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 5 });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    const suffix = compatibilityPostEnabled ? "" : "&compatPost=0";
    await page.goto(`${origin}/?station=vfx&forceCompat=1${suffix}`, { waitUntil: "domcontentloaded" });
    await waitForKinema(page);
    await waitForLoadingGone(page);
    await waitForGrounded(page);
    await page.evaluate(() => window.__KINEMA__.setGraphicsProfile("balanced"));
    await expect
      .poll(() => page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().compatibilityPostActive))
      .toBe(compatibilityPostEnabled);

    await page.evaluate(() => window.__KINEMA__.resetFrameStats());
    await page.waitForFunction(() => window.__KINEMA__.getFrameStats().samples >= 300, undefined, { timeout: 60_000 });

    const windows = [];
    for (let windowIndex = 0; windowIndex < 3; windowIndex++) {
      await page.evaluate(() => window.__KINEMA__.resetFrameStats());
      await page.waitForFunction(() => window.__KINEMA__.getFrameStats().samples >= 300, undefined, {
        timeout: 60_000,
      });
      windows.push(await page.evaluate(() => window.__KINEMA__.getFrameStats()));
    }
    await context.close();
    return { compatibilityPostEnabled, cpuThrottleRate: 4, windows, runtimeErrors };
  }

  const bare = await measurePath(false);
  const enabled = await measurePath(true);
  const medianP95 = (windows: Array<{ p95: number }>) =>
    [...windows].map((entry) => entry.p95).sort((a, b) => a - b)[Math.floor(windows.length / 2)];
  const observation = {
    environment: "Chromium SwiftShader mobile proxy; not Safari hardware certification",
    bare,
    enabled,
    bareMedianP95: medianP95(bare.windows),
    enabledMedianP95: medianP95(enabled.windows),
  };
  await testInfo.attach("compat-post-mobile-proxy.json", {
    body: JSON.stringify(observation, null, 2),
    contentType: "application/json",
  });
  console.info(`[compat-post-mobile-proxy] ${JSON.stringify(observation)}`);

  expect(bare.runtimeErrors).toEqual([]);
  expect(enabled.runtimeErrors).toEqual([]);
  expect(observation.enabledMedianP95).toBeLessThanOrEqual(observation.bareMedianP95 * 1.1);
});
