import { expect, type Page, test } from "@playwright/test";
import { DEFAULT_PLAYER_CONFIG } from "../src/core/constants";
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

const BACK_CHECKPOINT_POSITION = {
  x: 18,
  y: getShowcaseBayTopY() + 0.12,
  z: getShowcaseStationZ("vfx") - 15,
};
const BOOST_PAD_CONTACT_CLEARANCE = 0.01;

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
  test("lethal damage recovers at the back-half checkpoint without reloading or losing coins", async ({ page }) => {
    test.setTimeout(420_000);
    await waitForRuntimeReady(page, "/?spawn=entrance");
    await page.evaluate(() => window.__KINEMA__.setGraphicsProfile("performance"));
    expect(await page.evaluate(() => window.__KINEMA__.getActiveCheckpoint())).toBeNull();

    await page.evaluate((position) => window.__KINEMA__.teleportPlayer(position), BACK_CHECKPOINT_POSITION);
    await expect
      .poll(() => page.evaluate(() => window.__KINEMA__.getActiveCheckpoint()), { timeout: 20_000 })
      .toMatchObject({ id: "showcase-checkpoint-back", position: BACK_CHECKPOINT_POSITION });

    const firstCoinId = await page.evaluate(() => window.__KINEMA__.listCollectibles()[0]?.id ?? null);
    expect(firstCoinId).not.toBeNull();
    expect(await page.evaluate((id) => window.__KINEMA__.teleportToCollectible(id as string), firstCoinId)).toBe(true);
    await page.waitForFunction(
      (id) => !window.__KINEMA__.listCollectibles().some((coin) => coin.id === id),
      firstCoinId,
      { timeout: 20_000 },
    );
    const collectedBeforeDeath = await page.evaluate(() => window.__KINEMA__.getCollectibleCount());
    expect(collectedBeforeDeath).toBeGreaterThan(0);

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
      ({ checkpoint, expectedCollectibleCount }) => {
        const health = window.__KINEMA__.getHealth();
        const player = window.__KINEMA__.player.position;
        return (
          health.current === health.max &&
          health.invulnerable &&
          window.__KINEMA__.getCollectibleCount() === expectedCollectibleCount &&
          Math.hypot(player.x - checkpoint.x, player.y - checkpoint.y, player.z - checkpoint.z) < 1.5
        );
      },
      { checkpoint: BACK_CHECKPOINT_POSITION, expectedCollectibleCount: collectedBeforeDeath },
      { timeout: 30_000 },
    );
    expect(await page.evaluate(() => window.__KINEMA__.getCollectibleTotal())).toBe(70);
    expect(await page.evaluate(() => window.__KINEMA__.listCollectibles().length)).toBe(70 - collectedBeforeDeath);
    await expect(page.locator(".collectible-count")).toHaveText(`${collectedBeforeDeath}/70`);
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
      await expect(page.locator(".iris-container")).toHaveCount(0);
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
    await expect(page.locator(".iris-container")).toHaveCount(0);
  });

  test("the physics boost arc stays inside the raised station boundary", async ({ page }) => {
    test.setTimeout(240_000);
    await waitForRuntimeReady(page, "/?station=platformsPhysics");
    await page.evaluate(() => window.__KINEMA__.setGraphicsProfile("performance"));

    const geometry = await page.evaluate(() => ({
      boost: window.__KINEMA__.getLevelObjectState("BoostPlatformStatic_col"),
      boundary: window.__KINEMA__.getLevelObjectState("StationBoundaryWall_L_col"),
    }));
    expect(geometry.boost).not.toBeNull();
    expect(geometry.boundary).not.toBeNull();
    if (!geometry.boost || !geometry.boundary) throw new Error("Physics boost safety geometry was not loaded");
    expect(geometry.boundary.size.y).toBeGreaterThanOrEqual(1.2);

    const launch = await page.evaluate(
      async ({ boost, boundary, capsuleExtent, contactClearance }) => {
        const k = window.__KINEMA__;
        const innerWallX = boundary.position.x + boundary.size.x * 0.5;
        const outerWallX = boundary.position.x - boundary.size.x * 0.5;
        const launchStartY = boost.position.y + boost.size.y * 0.5 + capsuleExtent + contactClearance;
        k.setCameraLook(0, Math.PI / 2);
        k.startPlayerMotionCapture();
        k.simulateMove(0, 1, 600);
        k.teleportPlayer({
          x: boost.position.x,
          y: launchStartY,
          z: boost.position.z,
        });

        return new Promise<{
          crossedOuterWallPlane: boolean;
          finalGrounded: boolean;
          health: number;
          launched: boolean;
          maxVerticalVelocity: number;
          maxY: number;
          minX: number;
          samples: number;
          timedOut: boolean;
        }>((resolve) => {
          const startedAt = performance.now();
          let crossedOuterWallPlane = false;
          let launched = false;

          const sample = () => {
            const player = k.player;
            launched ||= player.velocity.y > 5 || player.position.y > launchStartY + 0.25;
            crossedOuterWallPlane ||= player.position.x < outerWallX;
            const reachedBoundary = player.position.x < innerWallX + 1;
            const completed = launched && reachedBoundary && player.isGrounded && Math.abs(player.velocity.x) < 0.1;
            const timedOut = performance.now() - startedAt > 30_000;
            if (completed || crossedOuterWallPlane || timedOut) {
              k.clearSimulatedInput();
              const motion = k.stopPlayerMotionCapture();
              resolve({
                crossedOuterWallPlane: crossedOuterWallPlane || motion.minX < outerWallX,
                finalGrounded: player.isGrounded,
                health: k.getHealth().current,
                launched,
                maxVerticalVelocity: motion.maxVerticalVelocity,
                maxY: motion.maxY,
                minX: motion.minX,
                samples: motion.samples,
                timedOut,
              });
              return;
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      },
      {
        ...(geometry as {
          boost: NonNullable<typeof geometry.boost>;
          boundary: NonNullable<typeof geometry.boundary>;
        }),
        contactClearance: BOOST_PAD_CONTACT_CLEARANCE,
        capsuleExtent: DEFAULT_PLAYER_CONFIG.capsuleHalfHeight + DEFAULT_PLAYER_CONFIG.capsuleRadius,
      },
    );

    const launchEvidence = JSON.stringify(launch);
    expect(launch.timedOut, launchEvidence).toBe(false);
    expect(launch.launched, launchEvidence).toBe(true);
    expect(launch.maxVerticalVelocity, launchEvidence).toBeGreaterThan(20);
    expect(launch.maxY, launchEvidence).toBeGreaterThan(2);
    expect(launch.crossedOuterWallPlane, launchEvidence).toBe(false);
    expect(launch.finalGrounded, launchEvidence).toBe(true);
    expect(launch.health, launchEvidence).toBe(3);
  });
});
