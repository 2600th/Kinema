import { test, expect } from '@playwright/test';

const REVIEW_SPAWNS = [
  'entrance',
  'overviewMid',
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
  'overviewEnd',
] as const;

test('procedural review spawns render from reusable review points', async ({ page }) => {
  test.setTimeout(240_000);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/?spawn=entrance', { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(() => !!(window as any).__KINEMA__, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('.loading-screen'), undefined, { timeout: 120_000 });
  await page.waitForTimeout(1500);

  for (const spawn of REVIEW_SPAWNS) {
    const teleported = await page.evaluate((spawnKey) => {
      return (window as any).__KINEMA__?.teleportToReviewSpawn?.(spawnKey) ?? false;
    }, spawn);
    expect(teleported).toBe(true);

    await page.waitForTimeout(1200);

    const playerState = await page.evaluate(() => {
      const k = (window as any).__KINEMA__;
      return k?.player ?? null;
    });
    expect(playerState).not.toBeNull();
    expect(playerState.position.y).toBeGreaterThan(-5);

  }

  const vehicleIds = await page.evaluate(() => {
    return (window as any).__KINEMA__?.listVehicles?.() ?? [];
  });
  expect(vehicleIds).toContain('car-1');
  expect(vehicleIds).toContain('drone-1');

  const carState = await page.evaluate(() => {
    return (window as any).__KINEMA__?.getVehicleState?.('car-1') ?? null;
  });
  expect(carState).not.toBeNull();
  expect(carState.position.y).toBeGreaterThan(-1.2);
  expect(carState.position.y).toBeLessThan(0.2);

  const resetCar = await page.evaluate(() => {
    return (window as any).__KINEMA__?.resetVehicle?.('car-1') ?? false;
  });
  expect(resetCar).toBe(true);
  await page.waitForTimeout(250);

  const resetCarState = await page.evaluate(() => {
    return (window as any).__KINEMA__?.getVehicleState?.('car-1') ?? null;
  });
  expect(resetCarState).not.toBeNull();
  expect(resetCarState.position.y).toBeGreaterThan(-1.2);
  expect(resetCarState.position.y).toBeLessThan(0.2);

  const realErrors = consoleErrors.filter(
    (message) => !message.includes('favicon') && !message.includes('404'),
  );
  expect(realErrors).toHaveLength(0);
});
