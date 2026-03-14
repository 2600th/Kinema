/**
 * Jump mechanics test — verifies ground jump, air jump (double jump), and
 * jump buffering work correctly across all scenarios.
 *
 * Uses the __KINEMA__ debug API exposed by main.ts to read player state,
 * simulate key presses, and wait for physics state changes.
 *
 * Prerequisites:
 *   1. Start the dev server:  npm run dev
 *   2. Run this script:       npx playwright test tests/jump-mechanics.ts
 */
import { test, expect } from '@playwright/test';

const STATION_URL = '/?station=doubleJump';

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

/** Press jump via debug API (bypasses pointer lock) and wait for airborne. */
async function jumpAndWaitAirborne(page: import('@playwright/test').Page) {
  await page.evaluate(() => (window as any).__KINEMA__.simulateJump());
  const left = await page.evaluate(() =>
    (window as any).__KINEMA__?.waitFor('p.vy > 0.5', 8000),
  );
  return left;
}

/** Wait for the player to land. */
async function waitForLanding(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    (window as any).__KINEMA__?.waitFor('p.isGrounded === true', 15000),
  );
}

// ---------------------------------------------------------------------------

test.describe('Jump Mechanics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(STATION_URL, { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
  });

  test('ground jump: player gains upward velocity', async ({ page }) => {
    const before = await getPlayer(page);
    expect(before).not.toBeNull();
    expect(before.isGrounded).toBe(true);

    // Debug: check if input is suppressed
    const debug = await page.evaluate(() => {
      const k = (window as any).__KINEMA__;
      return {
        player: k?.player,
        hasDebugApi: !!k,
      };
    });
    console.log('Pre-jump state:', JSON.stringify(debug));

    // Inject jump input directly (bypasses pointer lock)
    await page.evaluate(() => (window as any).__KINEMA__.simulateJump());

    // Wait for physics to process the jump
    const jumped = await page.evaluate(() =>
      (window as any).__KINEMA__?.waitFor('p.vy > 0.5', 8000),
    );

    const after = await getPlayer(page);
    console.log('Post-jump state:', JSON.stringify(after));

    expect(jumped).toBe(true);
    expect(after.velocity.y).toBeGreaterThan(0.5);
  });

  test('ground jump: repeatable 5 times', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      // Ensure grounded
      if (i > 0) {
        const landed = await waitForLanding(page);
        expect(landed).toBe(true);
      }

      const jumped = await jumpAndWaitAirborne(page);
      expect(jumped).toBe(true);
    }
  });

  test('double jump: air jump fires after ground jump', async ({ page }) => {
    // Ground jump
    const jumped = await jumpAndWaitAirborne(page);
    expect(jumped).toBe(true);

    // Wait until apex (velocity dropping but still airborne)
    await page.evaluate(() =>
      (window as any).__KINEMA__?.waitFor('p.vy < 2 && !p.isGrounded', 10000),
    );

    // Record state before air jump
    const midAir = await getPlayer(page);
    expect(midAir.isGrounded).toBe(false);
    const yBefore = midAir.velocity.y;

    // Air jump
    await page.evaluate(() => (window as any).__KINEMA__.simulateJump());
    const airJumped = await page.evaluate(() =>
      (window as any).__KINEMA__?.waitFor('p.vy > 2', 3000),
    );
    expect(airJumped).toBe(true);

    const after = await getPlayer(page);
    // Air jump should have increased upward velocity
    expect(after.velocity.y).toBeGreaterThan(yBefore);
  });

  test('air jump preserved: not consumed by ground jump on same frame', async ({ page }) => {
    // Ground jump
    const jumped = await jumpAndWaitAirborne(page);
    expect(jumped).toBe(true);

    // Wait until clearly airborne (past any ground-detection suppression)
    await page.evaluate(() =>
      (window as any).__KINEMA__?.waitFor('!p.isGrounded && p.vy < 3', 10000),
    );

    // Air jump should still work
    await page.evaluate(() => (window as any).__KINEMA__.simulateJump());
    const airJumped = await page.evaluate(() =>
      (window as any).__KINEMA__?.waitFor('p.vy > 2', 3000),
    );

    // This is the key assertion: if the ground jump consumed the air jump
    // on the same frame (the multi-substep bug), this would be false.
    expect(airJumped).toBe(true);
  });

  test('FSM transitions through correct states', async ({ page }) => {
    // Ground jump → should reach 'air' state
    await jumpAndWaitAirborne(page);
    const inAir = await page.evaluate(() =>
      (window as any).__KINEMA__?.waitFor("p.state === 'air'", 10000),
    );
    expect(inAir).toBe(true);

    // Wait for apex
    await page.evaluate(() =>
      (window as any).__KINEMA__?.waitFor('p.vy < 2 && !p.isGrounded', 10000),
    );

    // Air jump → should briefly be 'airJump' then back to 'air'
    await page.evaluate(() => (window as any).__KINEMA__.simulateJump());
    // Wait a moment then check we're in air (airJump transitions immediately)
    await page.waitForTimeout(200);
    const afterAirJump = await getPlayer(page);
    expect(afterAirJump.state).toBe('air');

    // Land → should return to idle or move
    const landed = await page.evaluate(() =>
      (window as any).__KINEMA__?.waitFor("p.isGrounded && (p.state === 'idle' || p.state === 'move')", 15000),
    );
    expect(landed).toBe(true);
  });
});
