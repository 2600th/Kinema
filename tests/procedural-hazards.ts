import { expect, test, type Page } from "@playwright/test";

type HealthState = {
  current: number;
  max: number;
  invulnerable: boolean;
  invulnerabilityRemaining: number;
};

type HazardDebugEntry = {
  id: string;
  station: string;
  position: { x: number; y: number; z: number };
};

async function waitForRuntimeReady(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__KINEMA__), undefined, { timeout: 60_000 });
  const grounded = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 60_000));
  expect(grounded).toBe(true);
}

async function getHealth(page: Page): Promise<HealthState> {
  return page.evaluate(() => (window as any).__KINEMA__.getHealth());
}

async function listHazards(page: Page): Promise<HazardDebugEntry[]> {
  return page.evaluate(() => (window as any).__KINEMA__.listHazards());
}

async function waitUntilGrounded(page: Page, timeoutMs = 20_000): Promise<void> {
  const grounded = await page.evaluate(
    (timeout) => (window as any).__KINEMA__.waitFor("p.isGrounded === true", timeout),
    timeoutMs,
  );
  expect(grounded).toBe(true);
}

async function moveToSafeStationSpawn(page: Page): Promise<void> {
  const teleported = await page.evaluate(() => (window as any).__KINEMA__.teleportToReviewSpawn("platformsPhysics"));
  expect(teleported).toBe(true);
  await waitUntilGrounded(page);
}

test.describe("Procedural Hazards", () => {
  test("spike hazards remove hearts once per contact window and full-reset the station on the last hit", async ({ page }) => {
    await waitForRuntimeReady(page, "/?station=platformsPhysics");

    const initialHazards = await listHazards(page);
    expect(initialHazards.length).toBeGreaterThanOrEqual(3);
    expect((await getHealth(page)).current).toBe(3);

    await page.evaluate((hazardId) => (window as any).__KINEMA__.teleportToHazard(hazardId), initialHazards[0].id);
    await page.waitForFunction(() => (window as any).__KINEMA__.getHealth().current === 2, undefined, { timeout: 10_000 });
    await page.waitForFunction(() => {
      const health = (window as any).__KINEMA__.getHealth();
      return health.current === 2 && health.invulnerable === true && health.invulnerabilityRemaining < 0.6;
    }, undefined, { timeout: 10_000 });
    expect((await getHealth(page)).current).toBe(2);

    await moveToSafeStationSpawn(page);
    await page.waitForFunction(() => (window as any).__KINEMA__.getHealth().invulnerable === false, undefined, {
      timeout: 10_000,
    });

    await page.evaluate((hazardId) => (window as any).__KINEMA__.teleportToHazard(hazardId), initialHazards[1].id);
    await page.waitForFunction(() => (window as any).__KINEMA__.getHealth().current === 1, undefined, { timeout: 10_000 });

    await moveToSafeStationSpawn(page);
    await page.waitForFunction(() => (window as any).__KINEMA__.getHealth().invulnerable === false, undefined, {
      timeout: 10_000,
    });

    await page.evaluate((hazardId) => (window as any).__KINEMA__.teleportToHazard(hazardId), initialHazards[2].id);
    await page.waitForFunction(
      (hazardCount) => {
        const health = (window as any).__KINEMA__.getHealth();
        return (
          health.current === 3 &&
          (window as any).__KINEMA__.getCollectibleCount() === 0 &&
          (window as any).__KINEMA__.listHazards().length === hazardCount
        );
      },
      initialHazards.length,
      { timeout: 30_000 },
    );
    await waitUntilGrounded(page, 30_000);
  });

  test("falls consume hearts and lethal falls fully restart the current station run", async ({ page }) => {
    await waitForRuntimeReady(page, "/?station=platformsPhysics");

    const expectedHazardCount = (await listHazards(page)).length;
    expect((await getHealth(page)).current).toBe(3);

    for (const expectedHealth of [2, 1] as const) {
      await page.evaluate(() => (window as any).__KINEMA__.forcePlayerPosition({ x: 0, y: -40, z: 0 }));
      await page.waitForFunction(
        (targetHealth) => (window as any).__KINEMA__.getHealth().current === targetHealth,
        expectedHealth,
        { timeout: 20_000 },
      );
      await waitUntilGrounded(page, 20_000);
    }

    await page.evaluate(() => (window as any).__KINEMA__.forcePlayerPosition({ x: 0, y: -40, z: 0 }));
    await page.waitForFunction(
      (hazardCount) => {
        const health = (window as any).__KINEMA__.getHealth();
        return (
          health.current === 3 &&
          (window as any).__KINEMA__.getCollectibleCount() === 0 &&
          (window as any).__KINEMA__.listHazards().length === hazardCount
        );
      },
      expectedHazardCount,
      { timeout: 30_000 },
    );
    await waitUntilGrounded(page, 30_000);
  });
});
