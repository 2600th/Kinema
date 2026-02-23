/**
 * Visual check script - captures screenshots and validates game UI state.
 *
 * WebGPU canvas can only be screenshotted once per page load in headless mode.
 * We verify DOM overlays (menus, HUD) and check for bootstrap errors.
 *
 * Prerequisites:
 *   1. Start the dev server:  npm run dev
 *   2. Run this script:       npx playwright test tests/visual-check.ts
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirnameSelf = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirnameSelf, "screenshots");
const BASE_URL = "http://localhost:5173";

test("main menu renders correctly with no bootstrap errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(3_000);

  // Screenshot of main menu
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "01-main-menu.png"),
    fullPage: true,
  });

  // Verify main menu UI elements
  await expect(page.locator("text=Kinema")).toBeVisible();
  await expect(page.locator("text=Play")).toBeVisible();
  await expect(page.locator("text=Settings")).toBeVisible();
  await expect(page.locator("text=Quit")).toBeVisible();

  // No Vite error overlay
  const viteError = await page.locator("vite-error-overlay").count();
  expect(viteError).toBe(0);

  // No fatal bootstrap errors
  const fatalErrors = consoleErrors.filter(
    (e) => e.includes("Fatal") || e.includes("Uncaught"),
  );
  expect(fatalErrors).toHaveLength(0);
});

test("settings menu tabs are accessible", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(2_000);

  await page.locator("text=Settings").click();
  await page.waitForTimeout(500);

  // Verify settings tabs exist (no screenshot due to WebGPU canvas limitation)
  // Use role locators to avoid strict-mode violations from duplicate text
  await expect(page.getByRole("button", { name: "Controls" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Graphics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Audio" })).toBeVisible();
});
