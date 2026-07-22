/**
 * Station screenshots — loads every showcase station individually and captures
 * a screenshot. Verifies the player spawns on solid ground (not falling) and
 * that the scene has rendered.
 *
 * Prerequisites:
 *   1. Start the dev server:  npm run dev
 *   2. Run this script:       npx playwright test tests/station-screenshots.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { getPlayer, waitForGrounded, waitForKinema } from "./helpers/kinema";

const __filename = fileURLToPath(import.meta.url);
const __dirnameSelf = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirnameSelf, "screenshots", "stations");
// page.screenshot() throws if the target directory does not exist (clean checkout).
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const ALL_STATIONS = [
  "steps",
  "slopes",
  "movement",
  "doubleJump",
  "grab",
  "throw",
  "door",
  "vehicles",
  "platformsMoving",
  "platformsPhysics",
  "materials",
  "vfx",
  "navigation",
  "futureA",
] as const;

async function expectNavigationPatrol(page: import("@playwright/test").Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.getNavAgentStates().length)).toBeGreaterThan(0);
  const before = await page.evaluate(() => window.__KINEMA__.getNavAgentStates());
  await page.waitForTimeout(3_000);
  const after = await page.evaluate(() => window.__KINEMA__.getNavAgentStates());
  const afterById = new Map(after.map((agent) => [agent.id, agent.position]));
  const maxDisplacement = Math.max(
    ...before.map((agent) => {
      const next = afterById.get(agent.id);
      if (!next) return 0;
      return Math.hypot(next.x - agent.position.x, next.y - agent.position.y, next.z - agent.position.z);
    }),
  );
  expect(maxDisplacement).toBeGreaterThan(0.5);
}

async function exerciseNavigationDebugKeys(page: import("@playwright/test").Page): Promise<void> {
  const before = await page.evaluate(() => window.__KINEMA__.getNavigationDebugState());
  expect(before.overlayAvailable).toBe(true);
  expect(before.targetAvailable).toBe(true);
  await page.keyboard.press("n");
  await expect
    .poll(() => page.evaluate(() => window.__KINEMA__.getNavigationDebugState().overlayVisible))
    .toBe(!before.overlayVisible);
  await page.keyboard.press("n");
  await expect
    .poll(() => page.evaluate(() => window.__KINEMA__.getNavigationDebugState().overlayVisible))
    .toBe(before.overlayVisible);
  await page.keyboard.press("t");
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.getNavigationDebugState().targetMode)).toBe(true);
  await page.keyboard.press("t");
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.getNavigationDebugState().targetMode)).toBe(false);
}

for (const station of ALL_STATIONS) {
  test(`station "${station}" loads, player is grounded, and scene renders`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // Navigate to the station
    await page.goto(`/?station=${station}`, { waitUntil: "domcontentloaded" });
    await page.locator("canvas[data-engine]").waitFor({ state: "visible", timeout: 15_000 });

    // Condition-based bootstrap wait — a fixed wall-clock wait flakes on slow
    // CI workers (SwiftShader bootstrap can exceed it under load).
    await waitForKinema(page);

    // Check the debug API is available
    const kinemaAvailable = await page.evaluate(() => !!window.__KINEMA__);
    expect(kinemaAvailable).toBe(true);

    // Wait for player to be grounded. __KINEMA__ appears early in bootstrap
    // (before the station finishes loading), so this poll carries the level
    // load + spawn + settle budget — keep it generous.
    await waitForGrounded(page);

    // Verify player is grounded — not falling off the platform

    // Check player Y position is above a reasonable threshold (not in the void)
    const playerState = await getPlayer(page);
    expect(playerState).not.toBeNull();
    expect(playerState.position.y).toBeGreaterThan(-5);

    const isolatedFrame = await page.evaluate(() => ({
      camera: window.__KINEMA__.getCameraPose(),
      entrance: window.__KINEMA__.getLevelObjectState("StationBoundaryWall_Entrance_col"),
      player: window.__KINEMA__.player,
    }));
    expect(isolatedFrame.entrance).not.toBeNull();
    if (!isolatedFrame.entrance) throw new Error("Isolated station entrance perimeter was not loaded");
    const entranceInnerFaceZ = isolatedFrame.entrance.position.z - isolatedFrame.entrance.size.z * 0.5;
    expect(isolatedFrame.player.position.z).toBeLessThan(entranceInnerFaceZ);
    expect(isolatedFrame.camera.position.z).toBeLessThan(entranceInnerFaceZ);

    if (station === "navigation") {
      await page.evaluate(() => window.__KINEMA__.setCameraLook(-0.08, 0));
      await expectNavigationPatrol(page);
      await page.evaluate(() => window.__KINEMA__.freezeForCapture());
    }

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${station}.png`),
      fullPage: true,
    });

    if (station === "navigation") {
      await exerciseNavigationDebugKeys(page);
    }

    // Filter out favicon 404 (not a real error)
    const realErrors = consoleErrors.filter((e) => !e.includes("favicon") && !e.includes("404"));
    expect(realErrors).toHaveLength(0);
  });
}

test('station "navigation" patrols with the compatibility renderer', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/?station=navigation&forceWebGL=1", { waitUntil: "domcontentloaded" });
  await page.locator("canvas[data-engine]").waitFor({ state: "visible", timeout: 15_000 });
  await waitForKinema(page);
  await waitForGrounded(page);
  await page.evaluate(() => window.__KINEMA__.setCameraLook(-0.08, 0));
  await expectNavigationPatrol(page);
  await page.evaluate(() => window.__KINEMA__.freezeForCapture());
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "navigation-compat.png"),
    fullPage: true,
  });
  await exerciseNavigationDebugKeys(page);

  const realErrors = consoleErrors.filter((e) => !e.includes("favicon") && !e.includes("404"));
  expect(realErrors).toHaveLength(0);
});

test("full showcase navigation debug keys stay wired", async ({ page }) => {
  await page.goto("/?spawn=navigation", { waitUntil: "domcontentloaded" });
  await waitForKinema(page);
  await waitForGrounded(page);
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.getNavAgentStates().length)).toBeGreaterThan(0);
  await exerciseNavigationDebugKeys(page);
});
