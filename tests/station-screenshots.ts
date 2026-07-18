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

for (const station of ALL_STATIONS) {
  test(`station "${station}" loads, player is grounded, and scene renders`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // Navigate to the station
    await page.goto(`/?station=${station}`, { waitUntil: "domcontentloaded" });
    await page.locator("canvas").waitFor({ state: "visible", timeout: 15_000 });

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

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${station}.png`),
      fullPage: true,
    });

    // Filter out favicon 404 (not a real error)
    const realErrors = consoleErrors.filter((e) => !e.includes("favicon") && !e.includes("404"));
    expect(realErrors).toHaveLength(0);
  });
}
