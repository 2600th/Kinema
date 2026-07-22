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

test("matched compatibility post p95 stays within the measured mobile proxy budget", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(1_200_000);
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

    await page.evaluate(() => window.__KINEMA__.resetFrameStats());
    const measuredAt = performance.now();
    await page.waitForFunction(() => window.__KINEMA__.getFrameStats().samples >= 300, undefined, {
      timeout: 60_000,
    });
    const frameWindow = await page.evaluate(() => window.__KINEMA__.getFrameStats());
    const measurementMs = performance.now() - measuredAt;
    await context.close();
    return { compatibilityPostEnabled, cpuThrottleRate: 4, frameWindow, measurementMs, runtimeErrors };
  }

  const pairOrders = [
    [false, true],
    [true, false],
    [true, false],
    [false, true],
  ] as const;
  type Measurement = Awaited<ReturnType<typeof measurePath>>;
  const pairs: Array<{
    order: (typeof pairOrders)[number];
    bare: Measurement;
    enabled: Measurement;
    ratio: number;
  }> = [];
  for (const order of pairOrders) {
    const measurements = [await measurePath(order[0]), await measurePath(order[1])];
    const bare = measurements.find((measurement) => !measurement.compatibilityPostEnabled);
    const enabled = measurements.find((measurement) => measurement.compatibilityPostEnabled);
    if (!bare || !enabled) throw new Error("Matched compatibility measurement pair was incomplete.");
    pairs.push({ order, bare, enabled, ratio: enabled.frameWindow.p95 / bare.frameWindow.p95 });
  }
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const midpoint = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
  };
  const medianPairwiseRatio = median(pairs.map((pair) => pair.ratio));
  const observation = {
    environment: "Chromium SwiftShader mobile proxy; not Safari hardware certification",
    method: "four fresh matched pairs; balanced AB/BA/BA/AB order; one warmup and one measurement per arm",
    pairs,
    medianPairwiseRatio,
  };
  await testInfo.attach("compat-post-mobile-proxy.json", {
    body: JSON.stringify(observation, null, 2),
    contentType: "application/json",
  });
  console.info(`[compat-post-mobile-proxy] ${JSON.stringify(observation)}`);

  for (const measurement of pairs.flatMap((pair) => [pair.bare, pair.enabled])) {
    expect(measurement.runtimeErrors).toEqual([]);
    expect(Number.isFinite(measurement.frameWindow.p95)).toBe(true);
    expect(measurement.frameWindow.samples).toBeGreaterThanOrEqual(300);
  }
  expect(medianPairwiseRatio).toBeLessThanOrEqual(1.1);
});
