import { expect, test } from "@playwright/test";
import { waitForGrounded, waitForKinema } from "./helpers/kinema";

async function startProceduralRun(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.locator(".loading-screen").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(".loading-screen").waitFor({ state: "hidden", timeout: 120_000 });
  await waitForGrounded(page);
}

async function openEditor(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => window.__KINEMA__.openEditor());
  await page.waitForFunction(() => window.__KINEMA__.isEditorActive(), undefined, { timeout: 60_000 });
}

async function placeBlock(page: import("@playwright/test").Page): Promise<void> {
  await page.locator(".ke-brush-item").filter({ hasText: "Block" }).click();
  await page.locator("canvas").evaluate(async (canvas: HTMLCanvasElement) => {
    const bounds = canvas.getBoundingClientRect();
    const clientX = bounds.left + bounds.width * 0.5;
    const clientY = bounds.top + bounds.height * 0.6;
    canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX, clientY }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX, clientY }));
  });
}

test("play-test cannot survive a main-menu transition and soft-brick the next run", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    localStorage.setItem("kinema.user-settings.v1", JSON.stringify({ graphicsProfile: "performance" }));
    Object.defineProperty(HTMLCanvasElement.prototype, "requestPointerLock", {
      configurable: true,
      value: undefined,
    });
  });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKinema(page);
  await startProceduralRun(page);
  await openEditor(page);

  const initialObjectCount = await page.evaluate(() => window.__KINEMA__.getEditorObjectCount());
  await placeBlock(page);
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(initialObjectCount + 1);
  await expect(page.locator(".ke-tree-row-selected")).toHaveCount(1);

  await page.evaluate(() => window.__KINEMA__.startPlayTest());
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isPlayTesting())).toBe(true);
  await expect(page.locator(".ke-playtest-bar")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Main Menu", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Main Menu", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kinema", exact: true })).toBeVisible();
  await expect(page.locator(".menu-screen.active")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Resume", exact: true }).locator("..")).not.toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isPlayTesting())).toBe(false);
  await expect(page.locator(".ke-playtest-bar")).toHaveCount(0);

  await startProceduralRun(page);
  await expect(page.locator(".ke-playtest-bar")).toHaveCount(0);
  expect(await page.evaluate(() => window.__KINEMA__.isPlayTesting())).toBe(false);

  await page.keyboard.press("F1");
  await page.waitForFunction(() => window.__KINEMA__.isEditorActive(), undefined, { timeout: 60_000 });
  await expect(page.locator(".ke-toolbar")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("editor-reopened-second-run.png") });

  const secondRunObjectCount = await page.evaluate(() => window.__KINEMA__.getEditorObjectCount());
  const cameraBeforeStop = await page.evaluate(() => window.__KINEMA__.getCameraPose());
  await page.evaluate(() => window.__KINEMA__.startPlayTest());
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isPlayTesting())).toBe(true);
  await page.evaluate(() => window.__KINEMA__.stopPlayTest());
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isEditorActive())).toBe(true);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(secondRunObjectCount);
  expect(await page.evaluate(() => window.__KINEMA__.getCameraPose())).toEqual(cameraBeforeStop);
  await expect(page.locator(".ke-playtest-bar")).toHaveCount(0);
  await expect(page.locator(".ke-tree-row-selected")).toHaveCount(0);
  await expect(page.getByText("No selection", { exact: true })).toBeVisible();

  const realErrors = errors.filter((message) => !message.includes("favicon") && !message.includes("404"));
  expect(realErrors).toEqual([]);
});
