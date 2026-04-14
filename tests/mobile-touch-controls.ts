import { test, expect } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("mobile touch controls stay active without pointer lock and can trigger a jump", async ({ page }) => {
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

  await page.goto("/?station=movement", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__KINEMA__), undefined, { timeout: 60_000 });

  await expect(page.locator(".touch-zone--left")).toBeVisible();
  await expect(page.locator(".touch-zone--right")).toBeVisible();
  await expect(page.locator(".touch-btn--jump")).toBeVisible();

  const grounded = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 10_000));
  expect(grounded).toBe(true);
  await expect.poll(async () => page.evaluate(() => document.pointerLockElement === null)).toBe(true);

  await page.locator(".touch-btn--jump").tap();

  const jumped = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.vy > 0.5 && p.state !== 'idle'", 4_000));
  expect(jumped).toBe(true);
  await expect.poll(async () => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});
