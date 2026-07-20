import { expect, test } from "@playwright/test";
import { waitForGrounded, waitForKinema, waitForLoadingGone } from "./helpers/kinema";

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

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () =>
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.0.0 Mobile/15E148 Safari/604.1",
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "iPhone",
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5,
    });
  });

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
            vfxScanner: api.getLevelObjectState("VFX_Scanner"),
            navPlatform: api.getLevelObjectState("NavPlatform"),
            futureBarrier: api.getLevelObjectState("FutureA_barrier_0"),
          };
        }),
      { timeout: 60_000 },
    )
    .toMatchObject({
      backend: "WebGLRenderer",
      vfxScanner: { visible: true },
      navPlatform: { visible: true },
      futureBarrier: { visible: true },
    });

  expect(runtimeErrors).toEqual([]);
});
