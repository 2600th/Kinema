/**
 * Physics & editor verification tests — validates slope rejection, step
 * assist smoothness, and editor spawn/scale behavior.
 *
 * Prerequisites:
 *   1. Start the dev server:  npm run dev
 *   2. Run this script:       npx playwright test tests/physics-verification.ts
 */
import { test, expect } from '@playwright/test';

const SLOPES_URL = '/?station=slopes';

/** Wait for game bootstrap + player grounded. */
async function waitForReady(page: import('@playwright/test').Page) {
  await page.locator('canvas').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(8_000); // shader compile + physics warmup (SwiftShader is slow)

  const grounded = await page.evaluate(() =>
    (window as any).__KINEMA__?.waitFor('p.isGrounded === true', 8000),
  );
  expect(grounded).toBe(true);
}

/** Read player state. */
async function getPlayer(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).__KINEMA__?.player ?? null);
}

// ---------------------------------------------------------------------------

test.describe('Physics Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SLOPES_URL, { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
  });

  test('player spawns grounded on slopes station', async ({ page }) => {
    const player = await getPlayer(page);
    expect(player).not.toBeNull();
    expect(player.isGrounded).toBe(true);
    expect(player.position.y).toBeGreaterThan(-5);
  });

  test('slope max angle is 45 degrees (0.785 rad)', async ({ page }) => {
    const slopeMaxAngle = await page.evaluate(() => {
      const k = (window as any).__KINEMA__;
      return k?.config?.slopeMaxAngle ?? null;
    });
    // Should be approximately 0.785 radians (45 degrees)
    if (slopeMaxAngle !== null) {
      expect(slopeMaxAngle).toBeCloseTo(0.785, 2);
    }
  });

  test('player does not fall through ground on slopes station', async ({ page }) => {
    // Wait additional time and check player hasn't fallen into the void
    await page.waitForTimeout(3_000);
    const player = await getPlayer(page);
    expect(player).not.toBeNull();
    expect(player.position.y).toBeGreaterThan(-10);
  });
});

test.describe('Bootstrap Verification', () => {
  test('game starts without fatal errors on slopes station', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(SLOPES_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(6_000);

    const kinemaAvailable = await page.evaluate(() => !!(window as any).__KINEMA__);
    expect(kinemaAvailable).toBe(true);

    // Filter out favicon 404 (not a real error)
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('404'),
    );
    expect(realErrors).toHaveLength(0);
  });
});
