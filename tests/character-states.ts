import { expect, type Page, test } from "@playwright/test";
import { getShowcaseBayTopY, getShowcaseStationZ } from "../src/level/ShowcaseLayout";
import { getPlayer, waitForGrounded, waitForKinema } from "./helpers/kinema";

const MOVEMENT_STATION_URL = "/?station=movement";
const MOVEMENT_GROUND_Y = getShowcaseBayTopY() + 0.325;
const MOVEMENT_ROPE_Z = getShowcaseStationZ("movement") + 2;
const ROPE_APPROACH = { x: -14, y: MOVEMENT_GROUND_Y, z: MOVEMENT_ROPE_Z };
const SAFE_GROUND = { x: 4, y: MOVEMENT_GROUND_Y, z: MOVEMENT_ROPE_Z };
const GROUNDED_STATES = ["idle", "move", "land"];

async function openMovementStation(page: Page): Promise<void> {
  await page.goto(MOVEMENT_STATION_URL, { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
  await waitForKinema(page);
  await waitForGrounded(page);
}

async function attachToRope(page: Page): Promise<void> {
  await page.evaluate((position) => window.__KINEMA__.teleportPlayer(position), ROPE_APPROACH);
  await waitForGrounded(page);
  await page.evaluate(() => window.__KINEMA__.simulateHoldInteract(1));
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.player.ropeAttached)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.player.state)).toBe("rope");
}

async function expectGroundedOutsideRope(page: Page): Promise<void> {
  const settledAndStayedReleased = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const deadline = performance.now() + 15_000;
        const validGroundedStates = ["idle", "move", "land"];
        let firstGroundedAt: number | null = null;
        let sawValidGroundedState = false;
        const check = () => {
          const now = performance.now();
          const state = window.__KINEMA__.player;
          if (state.isGrounded) {
            firstGroundedAt ??= now;
            if (state.ropeAttached || state.state === "rope") {
              resolve(false);
              return;
            }
            if (validGroundedStates.includes(state.state)) {
              sawValidGroundedState = true;
            }
            if (now - firstGroundedAt >= 1_500) {
              resolve(sawValidGroundedState);
              return;
            }
          }
          if (now >= deadline) {
            resolve(false);
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      }),
  );
  expect(settledAndStayedReleased).toBe(true);
  const player = await getPlayer(page);
  expect(player.isGrounded).toBe(true);
  expect(player.ropeAttached).toBe(false);
  expect(GROUNDED_STATES).toContain(player.state);
}

test.describe("Character traversal states", () => {
  test.beforeEach(async ({ page }) => {
    await openMovementStation(page);
  });

  test("jumping from a rope releases rope state through landing and walking", async ({ page }) => {
    await attachToRope(page);

    await page.evaluate(() => window.__KINEMA__.simulateJump());
    const detachedInAir = await page.evaluate(() =>
      window.__KINEMA__.waitFor("!p.ropeAttached && p.state !== 'rope' && !p.isGrounded", 1_500),
    );
    expect(detachedInAir).toBe(true);
    const accidentalAirJump = await page.evaluate(() => window.__KINEMA__.waitFor("p.state === 'airJump'", 350));
    expect(accidentalAirJump).toBe(false);

    await page.evaluate(() => window.__KINEMA__.simulateJump());
    const retainedAirJump = await page.evaluate(() => window.__KINEMA__.waitFor("p.state === 'airJump'", 1_000));
    expect(retainedAirJump).toBe(true);
    await expectGroundedOutsideRope(page);

    const before = await getPlayer(page);
    await page.evaluate(() => window.__KINEMA__.simulateMove(1, 0, 45));
    await expect
      .poll(async () => {
        const current = await getPlayer(page);
        return Math.hypot(current.position.x - before.position.x, current.position.z - before.position.z);
      })
      .toBeGreaterThan(0.25);
    const after = await getPlayer(page);
    expect(after.state).not.toBe("rope");
    expect(Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z)).toBeGreaterThan(
      0.25,
    );
  });

  test("crouch-drop and forced spawn both release the rope state", async ({ page }) => {
    await attachToRope(page);

    await page.evaluate(() => window.__KINEMA__.simulateCrouch());
    const dropped = await page.evaluate(() =>
      window.__KINEMA__.waitFor("!p.ropeAttached && p.state !== 'rope'", 1_500),
    );
    expect(dropped).toBe(true);
    await expectGroundedOutsideRope(page);

    await attachToRope(page);
    await page.evaluate((position) => window.__KINEMA__.teleportPlayer(position), SAFE_GROUND);
    await expectGroundedOutsideRope(page);
  });
});
