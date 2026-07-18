import { expect, test } from "@playwright/test";
import { waitForGrounded, waitForKinema, waitForLoadingGone } from "./helpers/kinema";

test("pause overlay click returns focus to gameplay and restores pointer lock", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 15_000 });
  await waitForKinema(page);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    const original = canvas.requestPointerLock.bind(canvas);
    (window as any).__POINTER_LOCK_DEBUG__ = [];
    canvas.requestPointerLock = ((...args: unknown[]) => {
      (window as any).__POINTER_LOCK_DEBUG__.push({
        type: "request",
        options: args[0] ?? null,
      });
      try {
        const result = original(args[0] as PointerLockOptions | undefined);
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>)
            .then(() => {
              (window as any).__POINTER_LOCK_DEBUG__.push({ type: "resolved" });
            })
            .catch((error: unknown) => {
              (window as any).__POINTER_LOCK_DEBUG__.push({ type: "rejected", message: String(error) });
            });
        }
        return result;
      } catch (error) {
        (window as any).__POINTER_LOCK_DEBUG__.push({ type: "thrown", message: String(error) });
        throw error;
      }
    }) as typeof canvas.requestPointerLock;
  });
  await page.getByRole("button", { name: "Play" }).click();
  await waitForLoadingGone(page);
  await waitForGrounded(page);

  await page.mouse.click(960, 540);
  await page.waitForTimeout(1_000);
  let pointerLockDebug = await page.evaluate(() => (window as any).__POINTER_LOCK_DEBUG__ ?? []);
  const initialRequestCount = pointerLockDebug.filter((entry: { type: string }) => entry.type === "request").length;
  expect(initialRequestCount).toBeGreaterThanOrEqual(1);

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
  });
  await expect(page.locator(".menu-overlay.active")).toBeVisible();
  await expect(page.getByText("Paused")).toBeVisible();

  await page.evaluate(() => {
    document.querySelector(".menu-overlay.active")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForFunction(() => !document.querySelector(".menu-overlay")?.classList.contains("active"), undefined, {
    timeout: 15_000,
  });
  await page.waitForTimeout(1_000);
  pointerLockDebug = await page.evaluate(() => (window as any).__POINTER_LOCK_DEBUG__ ?? []);
  const requestCountAfterResume = pointerLockDebug.filter((entry: { type: string }) => entry.type === "request").length;
  expect(requestCountAfterResume).toBeGreaterThan(initialRequestCount);
});
