import { expect, test } from "@playwright/test";
import { waitForKinema, waitForLoadingGone } from "./helpers/kinema";

const LANDSCAPE_VIEWPORTS = [
  { width: 844, height: 390 },
  { width: 932, height: 430 },
] as const;

async function emulateIPhoneBrowser(page: import("@playwright/test").Page): Promise<void> {
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
}

for (const viewport of LANDSCAPE_VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height} landscape`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test("keeps every touch button inside the viewport and clear of gameplay HUD", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await emulateIPhoneBrowser(page);
      await page.goto("/?station=movement", { waitUntil: "domcontentloaded" });
      await waitForKinema(page);
      await waitForLoadingGone(page);

      await expect(page.locator(".touch-btn--jump")).toBeVisible();
      await expect(page.locator(".touch-btn--interact")).toBeVisible();
      await expect(page.locator(".touch-btn--crouch")).toBeVisible();
      await expect(page.locator(".touch-btn--sprint")).toBeVisible();
      await expect(page.locator(".hud-collectible-chip")).toBeVisible();
      await expect(page.locator(".hud-health-chip")).toBeVisible();
      await expect(page.locator(".hud-objective-card")).toBeVisible();

      const layout = await page.evaluate(() => {
        type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
        const visibleRects = (selector: string): Array<{ label: string; rect: Rect }> =>
          Array.from(document.querySelectorAll<HTMLElement>(selector))
            .filter((element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
            })
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                label: element.className,
                rect: {
                  left: rect.left,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  width: rect.width,
                  height: rect.height,
                },
              };
            });
        const intersects = (a: Rect, b: Rect) =>
          !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        const touch = visibleRects(".touch-btn");
        const hud = visibleRects(".hud-collectible-chip, .hud-health-chip, .hud-objective-card");
        const zones = visibleRects(".touch-zone--left, .touch-zone--right, .touch-zone--buttons, .touch-zone--sprint");
        const zoneRect = (className: string) => zones.find(({ label }) => label.includes(className))?.rect;
        const leftZone = zoneRect("touch-zone--left");
        const rightZone = zoneRect("touch-zone--right");
        const buttonZone = zoneRect("touch-zone--buttons");
        const sprintZone = zoneRect("touch-zone--sprint");
        const all = [...touch, ...hud, ...zones];
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          touchCount: touch.length,
          hudCount: hud.length,
          outsideViewport: all
            .filter(
              ({ rect }) =>
                rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight,
            )
            .map(({ label }) => label),
          overlaps: touch.flatMap((touchItem) =>
            hud
              .filter((hudItem) => intersects(touchItem.rect, hudItem.rect))
              .map((hudItem) => `${touchItem.label} <-> ${hudItem.label}`),
          ),
          touchZoneOverlaps: {
            buttonsRight: Boolean(buttonZone && rightZone && intersects(buttonZone, rightZone)),
            sprintLeft: Boolean(sprintZone && leftZone && intersects(sprintZone, leftZone)),
          },
          joystickWidths: [leftZone?.width ?? 0, rightZone?.width ?? 0],
        };
      });

      expect(layout.viewport).toEqual(viewport);
      expect(layout.touchCount).toBe(4);
      expect(layout.hudCount).toBe(3);
      expect(layout.outsideViewport).toEqual([]);
      expect(layout.overlaps).toEqual([]);
      expect(layout.touchZoneOverlaps).toEqual({ buttonsRight: false, sprintLeft: false });
      expect(layout.joystickWidths).toHaveLength(2);
      for (const width of layout.joystickWidths) expect(width).toBeGreaterThan(120);
      if (viewport.width === 844) {
        await page.screenshot({ path: testInfo.outputPath("kin023-mobile-landscape.png") });
      }
    });
  });
}

test.describe("editor HUD visibility", () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

  test("hides the complete gameplay HUD while editing and restores its live content", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.goto("/?station=movement", { waitUntil: "domcontentloaded" });
    await waitForKinema(page);
    await waitForLoadingGone(page);

    const before = await page.evaluate(() => ({
      collectibles: document.querySelector(".collectible-count")?.textContent,
      objective: document.querySelector(".hud-objective-text")?.textContent,
    }));
    await expect(page.locator("#hud #hud-prompt")).toHaveCount(1);
    await expect(page.locator("#hud #hud-hold")).toHaveCount(1);
    await expect(page.locator("#hud .hud-objective-region")).toHaveCount(1);
    await expect(page.locator("#hud .hud-crosshair")).toBeVisible();
    await expect(page.locator("#hud .hud-damage-overlay")).toHaveCount(1);
    await page.evaluate(() => window.__KINEMA__.openEditor());
    await expect.poll(() => page.evaluate(() => window.__KINEMA__.isEditorActive())).toBe(true);

    await expect(page.locator(".ke-toolbar")).toHaveCSS("z-index", "10000");

    await expect(page.locator("#hud")).toHaveAttribute("aria-hidden", "true");
    expect(await page.locator("#hud").evaluate((element) => (element as HTMLElement).hidden)).toBe(true);
    await expect(page.locator(".hud-collectible-chip")).toBeHidden();
    await expect(page.locator(".hud-health-chip")).toBeHidden();
    await expect(page.locator("#hud-prompt")).toBeHidden();
    await expect(page.locator(".hud-objective-region")).toBeHidden();
    await expect(page.locator(".hud-crosshair")).toBeHidden();
    await expect(page.locator(".hud-damage-overlay")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("kin023-editor-hud-hidden.png") });

    await page.evaluate(() => window.__KINEMA__.closeEditor());
    await expect.poll(() => page.evaluate(() => window.__KINEMA__.isEditorActive())).toBe(false);
    await expect(page.locator("#hud")).toHaveAttribute("aria-hidden", "false");
    expect(await page.locator("#hud").evaluate((element) => (element as HTMLElement).hidden)).toBe(false);
    await expect(page.locator(".hud-collectible-chip")).toBeVisible();
    await expect(page.locator(".hud-health-chip")).toBeVisible();
    expect(
      await page.evaluate(() => ({
        collectibles: document.querySelector(".collectible-count")?.textContent,
        objective: document.querySelector(".hud-objective-text")?.textContent,
      })),
    ).toEqual(before);
  });
});
