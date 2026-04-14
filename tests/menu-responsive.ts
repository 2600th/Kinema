import { expect, test } from "@playwright/test";

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

      const layout = await page.evaluate(() => {
        const screen = document.querySelector(".menu-screen.active") as HTMLElement | null;
        const title = document.querySelector(".menu-title") as HTMLElement | null;
        const lastButton = document.querySelector(".menu-screen.active .menu-button:last-of-type") as HTMLElement | null;
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
