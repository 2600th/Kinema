/**
 * Station screenshots — loads every showcase station individually and captures
 * a screenshot. Verifies the player spawns on solid ground (not falling) and
 * that the scene has rendered.
 *
 * Prerequisites:
 *   1. Start the dev server:  npm run dev
 *   2. Run this script:       npx playwright test tests/station-screenshots.ts
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirnameSelf = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirnameSelf, 'screenshots', 'stations');

const ALL_STATIONS = [
  'steps',
  'slopes',
  'movement',
  'doubleJump',
  'grab',
  'throw',
  'door',
  'vehicles',
  'platformsMoving',
  'platformsPhysics',
  'materials',
  'vfx',
  'navigation',
  'futureA',
] as const;

for (const station of ALL_STATIONS) {
  test(`station "${station}" loads, player is grounded, and scene renders`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Navigate to the station
    await page.goto(`/?station=${station}`, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').waitFor({ state: 'visible', timeout: 15_000 });

    // Wait for full bootstrap + physics warm-up + rendering
    await page.waitForTimeout(6_000);

    // Check the debug API is available
    const kinemaAvailable = await page.evaluate(() => !!(window as any).__KINEMA__);
    expect(kinemaAvailable).toBe(true);

    // Wait for player to be grounded (max 5s after initial wait)
    const grounded = await page.evaluate(async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const k = (window as any).__KINEMA__;
        if (k?.player?.isGrounded) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    });

    // Verify player is grounded — not falling off the platform
    expect(grounded).toBe(true);

    // Check player Y position is above a reasonable threshold (not in the void)
    const playerState = await page.evaluate(() => {
      const k = (window as any).__KINEMA__;
      return k?.player ?? null;
    });
    expect(playerState).not.toBeNull();
    expect(playerState.position.y).toBeGreaterThan(-5);

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${station}.png`),
      fullPage: true,
    });

    // Filter out favicon 404 (not a real error)
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('404'),
    );
    expect(realErrors).toHaveLength(0);
  });
}
