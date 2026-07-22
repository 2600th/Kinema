import { expect, test } from "@playwright/test";
import { waitForGrounded, waitForKinema, waitForLoadingGone } from "./helpers/kinema";

test.use({ hasTouch: false, isMobile: false });

async function pressEscape(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
  });
}

async function openDirectRun(page: import("@playwright/test").Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.locator("canvas[data-engine]").waitFor({ state: "visible", timeout: 60_000 });
  await waitForKinema(page);
  await waitForLoadingGone(page);
  await waitForGrounded(page);
  await expect(page.locator(".menu-overlay.active")).toHaveCount(0);
}

test("pause overlay click returns focus to gameplay and restores pointer lock", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const engineCanvas = page.locator("canvas[data-engine]");
  await engineCanvas.waitFor({ state: "visible", timeout: 15_000 });
  await waitForKinema(page);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  const touchToggle = page.getByRole("checkbox", { name: "Touch controls", exact: true });
  if (await touchToggle.count()) await touchToggle.uncheck();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.locator(".loading-screen").waitFor({ state: "hidden", timeout: 120_000 });
  await waitForGrounded(page);
  await expect(page.locator(".touch-controls-container")).toHaveAttribute("aria-hidden", "true");

  await engineCanvas.click({ force: true, position: { x: 960, y: 540 } });
  await expect
    .poll(() => page.evaluate(() => document.pointerLockElement?.matches("canvas[data-engine]") ?? false), {
      timeout: 15_000,
    })
    .toBe(true);

  await pressEscape(page);
  await expect(page.locator(".menu-overlay.active")).toBeVisible();
  const pausedHeading = page.getByRole("heading", { name: "Paused", exact: true });
  await expect(pausedHeading).toBeVisible();

  await pausedHeading.click();
  await expect(page.locator(".menu-overlay.active")).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => document.pointerLockElement?.matches("canvas[data-engine]") ?? false), {
      timeout: 15_000,
    })
    .toBe(true);
});

test("station direct entry supports pause, settings, help, Escape close, and resume", async ({ page }, testInfo) => {
  await openDirectRun(page, "/?station=steps");

  await pressEscape(page);
  await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();
  await expect(page.locator(".menu-screen.active")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("station-direct-pause.png") });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.locator(".menu-screen.active")).toHaveCount(1);
  await pressEscape(page);
  await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Controls & Help", exact: true })).toBeVisible();
  await expect(page.locator(".menu-screen.active")).toHaveCount(1);
  await pressEscape(page);
  await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.locator(".menu-overlay.active")).toHaveCount(0);
  await pressEscape(page);
  await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();
  await pressEscape(page);
  await expect(page.locator(".menu-overlay.active")).toHaveCount(0);
});

test("compat station direct entry can pause and resume", async ({ page }) => {
  await openDirectRun(page, "/?station=steps&forceWebGL=1");

  await pressEscape(page);
  await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();
  await expect(page.locator(".menu-screen.active")).toHaveCount(1);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.locator(".menu-overlay.active")).toHaveCount(0);
});

test("spawn direct entry returns from pause to one standard main-menu root", async ({ page }) => {
  await openDirectRun(page, "/?spawn=steps");

  await pressEscape(page);
  await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Main Menu", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kinema", exact: true })).toBeVisible();
  await expect(page.locator(".menu-screen.active")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("audio lifecycle survives repeated pause, editor, and tab visibility transitions", async ({
  page,
  context,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });

  await openDirectRun(page, "/?station=steps");
  await page.mouse.click(960, 540);

  for (let cycle = 0; cycle < 10; cycle++) {
    await pressEscape(page);
    await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).hover();
    await page.getByRole("button", { name: "Resume", exact: true }).hover();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.locator(".menu-overlay.active")).toHaveCount(0);
  }

  for (let cycle = 0; cycle < 3; cycle++) {
    await page.evaluate(() => window.__KINEMA__.openEditor());
    await expect.poll(() => page.evaluate(() => window.__KINEMA__.isEditorActive())).toBe(true);
    await page.evaluate(() => window.__KINEMA__.closeEditor());
    await expect.poll(() => page.evaluate(() => window.__KINEMA__.isEditorActive())).toBe(false);
  }

  await page.evaluate(() => {
    (window as Window & { __AUDIO_VISIBILITY__?: string[] }).__AUDIO_VISIBILITY__ = [];
    document.addEventListener("visibilitychange", () => {
      (window as Window & { __AUDIO_VISIBILITY__?: string[] }).__AUDIO_VISIBILITY__?.push(document.visibilityState);
    });
  });
  const backgroundPage = await context.newPage();
  await backgroundPage.goto("about:blank");
  await backgroundPage.bringToFront();
  await page.waitForTimeout(250);
  await page.bringToFront();
  await page.waitForTimeout(250);
  await backgroundPage.close();

  const visibilityTransitions = await page.evaluate(
    () => (window as Window & { __AUDIO_VISIBILITY__?: string[] }).__AUDIO_VISIBILITY__ ?? [],
  );
  await testInfo.attach("audio-lifecycle-observation.json", {
    body: JSON.stringify({ runtimeErrors, visibilityTransitions }, null, 2),
    contentType: "application/json",
  });

  expect(runtimeErrors).toEqual([]);
});
