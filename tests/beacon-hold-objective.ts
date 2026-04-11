import { expect, test } from "@playwright/test";

test("objective beacon requires a full hold and shows charge feedback", async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  await page.goto("/?station=door", { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as any).__KINEMA__), undefined, { timeout: 60_000 });
  await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 60_000));

  await page.evaluate(() => {
    (window as any).__KINEMA__.teleportPlayer({ x: 4, y: 0.325, z: -8.4 });
    (window as any).__KINEMA__.setCameraLook(-0.08, 0);
  });

  const prompt = page.locator("#hud-prompt");
  await expect(prompt).toContainText("Activate Beacon");

  await page.evaluate(() => {
    (window as any).__KINEMA__.simulateHoldInteract(320);
  });

  await page.waitForFunction(() => {
    const el = document.getElementById("hud-hold");
    const progress = Number.parseFloat(el?.style.getPropertyValue("--hold-progress") || "0");
    return el?.classList.contains("is-visible") && progress > 0.08 && progress < 1;
  }, undefined, { timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("beacon-charge-mid.png") });

  await page.evaluate(() => {
    (window as any).__KINEMA__.clearSimulatedInput();
  });

  await page.waitForFunction(() => {
    const el = document.getElementById("hud-hold");
    return !el?.classList.contains("is-visible") && document.getElementById("hud-prompt")?.textContent?.includes("Hold F");
  }, undefined, { timeout: 12_000 });

  await page.evaluate(() => {
    (window as any).__KINEMA__.simulateHoldInteract(720);
  });

  await page.waitForFunction(() => {
    const hold = document.getElementById("hud-hold");
    const promptText = document.getElementById("hud-prompt")?.textContent ?? "";
    return !hold?.classList.contains("is-visible") && promptText.includes("Beacon online");
  }, undefined, { timeout: 90_000 });

  await expect(prompt).toContainText("Beacon online");
  await page.screenshot({ path: testInfo.outputPath("beacon-charge-complete.png") });
});
