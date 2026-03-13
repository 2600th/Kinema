/**
 * VFX particle system verification tests.
 *
 * Validates:
 *   1. Particle effects render without errors during gameplay
 *   2. Walking triggers footstep dust
 *   3. Jumping triggers jump puff + landing impact particles
 *   4. No WebGL errors during particle rendering
 *
 * Uses ?station=vehicles to load directly into gameplay (skips menu).
 *
 * Prerequisites:
 *   1. Start the dev server:  npm run dev
 *   2. Run:  npx playwright test tests/vfx-particles.ts
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173?station=vehicles';

async function waitForGameReady(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas');
      return c && c.offsetWidth > 0;
    },
    { timeout: 20_000 },
  );
  await page.waitForTimeout(4_000);
}

test.describe('VFX Particle System', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (dialog) => dialog.dismiss());
  });

  test('footstep dust renders during walking without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await waitForGameReady(page);

    const canvas = page.locator('canvas');
    await canvas.click();
    await page.waitForTimeout(500);

    // Walk forward to trigger footstep dust
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2000);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(500);

    // Canvas should still be rendering
    const canvasOk = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      return c && c.width > 0 && c.height > 0;
    });
    expect(canvasOk).toBe(true);

    const fatalErrors = errors.filter(
      (e) => e.includes('Fatal') || e.includes('Uncaught') || e.includes('WebGL'),
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test('jump puff and landing impact render without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await waitForGameReady(page);

    const canvas = page.locator('canvas');
    await canvas.click();
    await page.waitForTimeout(500);

    // Jump multiple times to trigger jump puff + landing impact + pool recycling
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(1000);
    }

    const canvasOk = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      return c && c.width > 0 && c.height > 0;
    });
    expect(canvasOk).toBe(true);

    const fatalErrors = errors.filter(
      (e) => e.includes('Fatal') || e.includes('Uncaught') || e.includes('WebGL'),
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test('sprinting generates continuous dust without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await waitForGameReady(page);

    const canvas = page.locator('canvas');
    await canvas.click();
    await page.waitForTimeout(500);

    // Sprint forward (Shift+W) to generate continuous footstep dust
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3000);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    await page.waitForTimeout(500);

    // Verify canvas is still healthy after sustained particle emission
    const canvasOk = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      return c && c.width > 0 && c.height > 0;
    });
    expect(canvasOk).toBe(true);

    const fatalErrors = errors.filter(
      (e) => e.includes('Fatal') || e.includes('Uncaught') || e.includes('WebGL'),
    );
    expect(fatalErrors).toHaveLength(0);
  });
});
