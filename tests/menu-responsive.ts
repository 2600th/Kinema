import { expect, test } from "@playwright/test";

const EVIDENCE_DIR = "docs/audits/evidence";

async function expectVisibleFocusRing(locator: import("@playwright/test").Locator): Promise<void> {
  const outline = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.outlineColor,
      focusVisible: element.matches(":focus-visible"),
      offset: style.outlineOffset,
      style: style.outlineStyle,
      width: style.outlineWidth,
    };
  });

  expect(outline).toEqual({
    color: "rgb(98, 230, 255)",
    focusVisible: true,
    offset: "2px",
    style: "solid",
    width: "2px",
  });
}

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

      if (viewport.hasTouch) {
        const touchControls = page.locator(".touch-controls-container");
        await expect(touchControls).toHaveAttribute("aria-hidden", "true", { timeout: 60_000 });
        await expect(touchControls).toHaveAttribute("inert", "");
      }

      const layout = await page.evaluate(() => {
        const screen = document.querySelector(".menu-screen.active") as HTMLElement | null;
        const title = document.querySelector(".menu-title") as HTMLElement | null;
        const lastButton = document.querySelector(
          ".menu-screen.active .menu-button:last-of-type",
        ) as HTMLElement | null;
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

test.describe("menu accessibility", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("keeps visible keyboard focus inside named dialogs and restores the invoker", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const mainDialog = page.locator('[role="dialog"][aria-labelledby="menu-main-title"]');
    await expect(mainDialog).toBeVisible({ timeout: 60_000 });
    await expect(mainDialog).toHaveAccessibleName("Kinema");
    await expect(mainDialog).toHaveAttribute("aria-modal", "true");
    await expect(mainDialog).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByRole("button", { name: "Play" })).toBeFocused();

    await page.keyboard.press("Tab");
    const levelSelectButton = page.getByRole("button", { name: "Level Select" });
    await expect(levelSelectButton).toBeFocused();
    await expectVisibleFocusRing(levelSelectButton);
    await page.screenshot({ path: `${EVIDENCE_DIR}/22-focus-menu-button.png` });

    const settingsButton = page.getByRole("button", { name: "Settings" });
    await settingsButton.focus();
    await page.keyboard.press("Enter");

    const settingsDialog = page.locator('[role="dialog"][aria-labelledby="menu-settings-title"]');
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog).toHaveAccessibleName("Settings");
    await expect(mainDialog).toHaveAttribute("aria-hidden", "true");
    await expect(mainDialog).toHaveAttribute("inert", "");
    await expect(settingsDialog).not.toHaveAttribute("inert", "");
    await expect.poll(() => settingsDialog.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");

    const controlsTab = page.getByRole("button", { name: "Controls" });
    await expect(controlsTab).toBeFocused();
    await expect(controlsTab).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("slider", { name: /Mouse sensitivity/ })).toBeVisible();
    await expectVisibleFocusRing(controlsTab);
    await page.screenshot({ path: `${EVIDENCE_DIR}/23-focus-menu-tab.png` });

    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Back" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(controlsTab).toBeFocused();

    const firstCheckbox = page.getByRole("checkbox", { name: "Invert Y" });
    await firstCheckbox.focus();
    await expectVisibleFocusRing(firstCheckbox);
    await page.screenshot({ path: `${EVIDENCE_DIR}/24-focus-menu-checkbox.png` });

    const graphicsTab = page.getByRole("button", { name: "Graphics" });
    await graphicsTab.focus();
    await page.keyboard.press("Enter");
    await expect(graphicsTab).toHaveAttribute("aria-pressed", "true");
    await expect(controlsTab).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("combobox", { name: "Graphics profile" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(settingsDialog).not.toHaveClass(/\bactive\b/);
    await expect(settingsDialog).toHaveAttribute("aria-hidden", "true");
    await expect(mainDialog).toHaveAttribute("aria-hidden", "false");
    await expect(settingsButton).toBeFocused();
  });

  test("keeps hidden HUD content out of the accessibility tree and exposes polite status regions", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog", { name: "Kinema" })).toBeVisible({ timeout: 60_000 });

    await expect(page.locator("#hud-prompt")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#hud-hold")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#hud-objective")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".hud-collectible-chip")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".hud-health-chip")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".kinema-orientation-hint")).toHaveAttribute("aria-hidden", "true");

    await expect(page.locator("#hud-status-lane")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator("#hud-status-lane")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#hud-objective")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator(".hud-collectible-chip")).toHaveAttribute("aria-label", "Collectibles: 0");
    await expect(page.locator(".hud-health-chip")).toHaveAttribute("aria-label", "Health: 3 of 3 hearts");
  });
});
