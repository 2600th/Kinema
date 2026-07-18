import { expect, type Page, test } from "@playwright/test";
import { waitForGrounded } from "./helpers/kinema";

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
  await waitForGrounded(page);
}

async function getHealth(page: Page): Promise<HealthState> {
  return page.evaluate(() => window.__KINEMA__.getHealth());
}

async function listHazards(page: Page): Promise<HazardDebugEntry[]> {
  return page.evaluate(() => window.__KINEMA__.listHazards());
}

async function moveToSafeStationSpawn(page: Page): Promise<void> {
  const teleported = await page.evaluate(() => window.__KINEMA__.teleportToReviewSpawn("platformsPhysics"));
  expect(teleported).toBe(true);
  await waitForGrounded(page);
}

test.describe("Procedural Hazards", () => {
  test("spike hazards remove hearts once per contact window and full-reset the station on the last hit", async ({
    page,
  }) => {
    await waitForRuntimeReady(page, "/?station=platformsPhysics");

    const initialHazards = await listHazards(page);
    expect(initialHazards.length).toBeGreaterThanOrEqual(3);
    expect((await getHealth(page)).current).toBe(3);

    await page.evaluate((hazardId) => window.__KINEMA__.teleportToHazard(hazardId), initialHazards[0].id);
    await page.waitForFunction(() => window.__KINEMA__.getHealth().current === 2, undefined, {
      timeout: 10_000,
    });
    await page.waitForFunction(
      () => {
        const health = window.__KINEMA__.getHealth();
        return health.current === 2 && health.invulnerable === true && health.invulnerabilityRemaining > 0;
      },
      undefined,
      { timeout: 10_000 },
    );
    expect((await getHealth(page)).current).toBe(2);

    await moveToSafeStationSpawn(page);
    await page.waitForFunction(() => window.__KINEMA__.getHealth().invulnerable === false, undefined, {
      timeout: 30_000,
    });

    await page.evaluate((hazardId) => window.__KINEMA__.teleportToHazard(hazardId), initialHazards[1].id);
    await page.waitForFunction(() => window.__KINEMA__.getHealth().current === 1, undefined, {
      timeout: 10_000,
    });

    await moveToSafeStationSpawn(page);
    await page.waitForFunction(() => window.__KINEMA__.getHealth().invulnerable === false, undefined, {
      timeout: 30_000,
    });

    await page.evaluate((hazardId) => window.__KINEMA__.teleportToHazard(hazardId), initialHazards[2].id);
    await page.waitForFunction(
      (hazardCount) => {
        const health = window.__KINEMA__.getHealth();
        return (
          health.current === 3 &&
          window.__KINEMA__.getCollectibleCount() === 0 &&
          window.__KINEMA__.listHazards().length === hazardCount
        );
      },
      initialHazards.length,
      { timeout: 30_000 },
    );
    await waitForGrounded(page);
  });

  test("falls consume hearts and lethal falls fully restart the current station run", async ({ page }) => {
    await waitForRuntimeReady(page, "/?station=platformsPhysics");

    const expectedHazardCount = (await listHazards(page)).length;
    expect((await getHealth(page)).current).toBe(3);

    for (const expectedHealth of [2, 1] as const) {
      await page.evaluate(() => window.__KINEMA__.forcePlayerPosition({ x: 0, y: -40, z: 0 }));
      await page.waitForFunction(
        (targetHealth) => window.__KINEMA__.getHealth().current === targetHealth,
        expectedHealth,
        { timeout: 20_000 },
      );
      await waitForGrounded(page);
    }

    await page.evaluate(() => window.__KINEMA__.forcePlayerPosition({ x: 0, y: -40, z: 0 }));
    await page.waitForFunction(
      (hazardCount) => {
        const health = window.__KINEMA__.getHealth();
        return (
          health.current === 3 &&
          window.__KINEMA__.getCollectibleCount() === 0 &&
          window.__KINEMA__.listHazards().length === hazardCount
        );
      },
      expectedHazardCount,
      { timeout: 30_000 },
    );
    await waitForGrounded(page);
  });
});
