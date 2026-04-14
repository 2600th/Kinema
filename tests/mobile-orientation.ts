import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("mobile viewport updates when rotating to landscape", async ({ page }) => {
  test.setTimeout(120_000);

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

  await page.goto("/?station=movement", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__KINEMA__), undefined, { timeout: 60_000 });

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const styles = getComputedStyle(document.documentElement);
        const hint = document.querySelector(".kinema-orientation-hint");
        const rendererCanvas = Array.from(document.querySelectorAll("canvas")).find(
          (canvas) => getComputedStyle(canvas).position === "fixed",
        );
        const rect = rendererCanvas?.getBoundingClientRect();
        return {
          appWidth: styles.getPropertyValue("--app-width").trim(),
          appHeight: styles.getPropertyValue("--app-height").trim(),
          hintOpacity: hint ? getComputedStyle(hint).opacity : null,
          canvasWidth: rect ? Math.round(rect.width) : 0,
          canvasHeight: rect ? Math.round(rect.height) : 0,
        };
      }),
    )
    .toEqual({
      appWidth: "390px",
      appHeight: "844px",
      hintOpacity: "1",
      canvasWidth: 390,
      canvasHeight: 844,
    });

  await page.setViewportSize({ width: 844, height: 390 });

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const styles = getComputedStyle(document.documentElement);
        const hint = document.querySelector(".kinema-orientation-hint");
        const rendererCanvas = Array.from(document.querySelectorAll("canvas")).find(
          (canvas) => getComputedStyle(canvas).position === "fixed",
        );
        const rect = rendererCanvas?.getBoundingClientRect();
        return {
          appWidth: styles.getPropertyValue("--app-width").trim(),
          appHeight: styles.getPropertyValue("--app-height").trim(),
          hintOpacity: hint ? getComputedStyle(hint).opacity : null,
          canvasWidth: rect ? Math.round(rect.width) : 0,
          canvasHeight: rect ? Math.round(rect.height) : 0,
        };
      }),
    )
    .toEqual({
      appWidth: "844px",
      appHeight: "390px",
      hintOpacity: "0",
      canvasWidth: 844,
      canvasHeight: 390,
    });
});
