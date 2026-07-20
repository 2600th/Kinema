import { expect, type Page, test } from "@playwright/test";
import { getShowcaseBayTopY, getShowcaseStationZ } from "../src/level/ShowcaseLayout";
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

const CHECKPOINT_POSITION = {
  x: 10,
  y: getShowcaseBayTopY() + 0.12,
  z: getShowcaseStationZ("door"),
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
  test("lethal damage recovers at an active checkpoint without reloading or losing coins", async ({ page }) => {
    test.setTimeout(420_000);
    await waitForRuntimeReady(page, "/?spawn=entrance");
    await page.evaluate(() => window.__KINEMA__.setGraphicsProfile("performance"));
    expect(await page.evaluate(() => window.__KINEMA__.getActiveCheckpoint())).toBeNull();

    await page.evaluate((position) => window.__KINEMA__.teleportPlayer(position), CHECKPOINT_POSITION);
    await expect
      .poll(() => page.evaluate(() => window.__KINEMA__.getActiveCheckpoint()), { timeout: 20_000 })
      .toMatchObject({ id: "showcase-checkpoint", position: CHECKPOINT_POSITION });

    const firstCoinId = await page.evaluate(() => window.__KINEMA__.listCollectibles()[0]?.id ?? null);
    expect(firstCoinId).not.toBeNull();
    await page.evaluate((id) => window.__KINEMA__.teleportToCollectible(id as string), firstCoinId);
    await page.waitForFunction(() => window.__KINEMA__.getCollectibleCount() === 1, undefined, {
      timeout: 20_000,
    });

    const hazards = await listHazards(page);
    expect(hazards.length).toBeGreaterThanOrEqual(3);
    for (const [index, hazard] of hazards.slice(0, 3).entries()) {
      await page.evaluate((hazardId) => window.__KINEMA__.teleportToHazard(hazardId), hazard.id);
      if (index < 2) {
        await page.waitForFunction(
          (expectedHealth) => window.__KINEMA__.getHealth().current === expectedHealth,
          2 - index,
          { timeout: 20_000 },
        );
        await moveToSafeStationSpawn(page);
        await page.waitForFunction(() => window.__KINEMA__.getHealth().invulnerable === false, undefined, {
          timeout: 90_000,
        });
      }
    }

    await page.waitForFunction(
      (checkpoint) => {
        const health = window.__KINEMA__.getHealth();
        const player = window.__KINEMA__.player.position;
        return (
          health.current === health.max &&
          health.invulnerable &&
          window.__KINEMA__.getCollectibleCount() === 1 &&
          Math.hypot(player.x - checkpoint.x, player.y - checkpoint.y, player.z - checkpoint.z) < 1.5
        );
      },
      CHECKPOINT_POSITION,
      { timeout: 30_000 },
    );
    expect(await page.evaluate(() => window.__KINEMA__.getCollectibleTotal())).toBe(70);
    expect(await page.evaluate(() => window.__KINEMA__.listCollectibles().length)).toBe(69);
    await expect(page.locator(".collectible-count")).toHaveText("1/70");
    await expect(page.locator(".hud-status-card", { hasText: "Respawned" })).toBeVisible();
  });

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
    const deathEffect = page.locator(".iris-container");
    await expect(deathEffect).toBeVisible({ timeout: 10_000 });
    await expect(deathEffect).toHaveCSS("z-index", "1100");
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

  test("renders the tokenized death iris and particle layers", async ({ page }, testInfo) => {
    await waitForRuntimeReady(page, "/?station=platformsPhysics");

    await page.evaluate(async () => {
      const [{ EventBus }, { DeathEffect }] = await Promise.all([
        import("/src/core/EventBus.ts"),
        import("/src/ui/components/DeathEffect.ts"),
      ]);
      const originalSetTimeout = window.setTimeout;
      window.setTimeout = (() => 0) as typeof window.setTimeout;
      const effect = new DeathEffect(new EventBus());
      void effect.play();
      (effect as unknown as { burstParticles(): void }).burstParticles();
      window.setTimeout = originalSetTimeout;

      const mask = document.querySelector<HTMLElement>(".iris-mask");
      if (mask) {
        mask.style.transition = "none";
        mask.style.setProperty("--iris-size", "36%");
      }
      const icon = document.querySelector<HTMLElement>(".iris-icon");
      if (icon) {
        icon.style.opacity = "1";
        icon.style.transform = "translate(-50%, -50%) scale(1)";
      }
    });

    const deathEffect = page.locator(".iris-container");
    const particles = page.locator('#ui-overlay > div[style*="deathParticleBurst"]');
    await expect(deathEffect).toHaveCSS("z-index", "1100");
    await expect(particles).toHaveCount(14);
    await expect(particles.first()).toHaveCSS("z-index", "1101");
    await expect(particles.nth(0)).toHaveCSS("background-color", "rgb(255, 121, 186)");
    await expect(particles.nth(1)).toHaveCSS("background-color", "rgb(123, 108, 255)");
    await expect(particles.nth(2)).toHaveCSS("background-color", "rgb(98, 230, 255)");
    await page.screenshot({ path: testInfo.outputPath("kin024-death-effect.png") });
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
