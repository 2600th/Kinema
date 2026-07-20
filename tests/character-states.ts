import { expect, type Page, test } from "@playwright/test";
import type { LevelDataV2, SerializedObjectV2 } from "../src/editor/LevelSerializer";
import { getShowcaseBayTopY, getShowcaseStationZ } from "../src/level/ShowcaseLayout";
import { getPlayer, waitForGrounded, waitForKinema } from "./helpers/kinema";

const MOVEMENT_STATION_URL = "/?station=movement";
const MOVEMENT_GROUND_Y = getShowcaseBayTopY() + 0.325;
const MOVEMENT_ROPE_Z = getShowcaseStationZ("movement") + 2;
const ROPE_APPROACH = { x: -14, y: MOVEMENT_GROUND_Y, z: MOVEMENT_ROPE_Z };
const SAFE_GROUND = { x: 4, y: MOVEMENT_GROUND_Y, z: MOVEMENT_ROPE_Z };
const LADDER_APPROACH = { x: 14, y: getShowcaseBayTopY() + 1.1, z: getShowcaseStationZ("movement") + 0.65 };
const GROUNDED_STATES = ["idle", "move", "land"];
const STEP_LEVEL_KEY = "kinema_level_step-assist-regression";
const STEP_LEVEL_NAME = "Step Assist Regression";

function staticBox(
  id: string,
  position: [number, number, number],
  scale: [number, number, number],
): SerializedObjectV2 {
  return {
    id,
    name: id,
    parentId: null,
    source: { type: "primitive", primitive: "box" },
    transform: { position, rotation: [0, 0, 0], scale },
    physics: { type: "static" },
  };
}

const STEP_ASSIST_LEVEL: LevelDataV2 = {
  version: 2,
  name: STEP_LEVEL_NAME,
  created: "2026-07-18T00:00:00.000Z",
  modified: "2026-07-18T00:00:00.000Z",
  spawnPoint: { position: [0, 2, 1.5], rotation: [0, 0, 0] },
  objects: [
    staticBox("StepFloor", [0, -0.1, -3], [16, 0.2, 16]),
    staticBox("Step020", [-4, 0.1, -4], [2.5, 0.2, 9]),
    staticBox("Step028", [0, 0.14, -4], [2.5, 0.28, 9]),
    staticBox("Step035", [4, 0.175, -4], [2.5, 0.35, 9]),
  ],
};

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

    const jumpLifecycle = await page.evaluate(async () => {
      const k = window.__KINEMA__;
      k.simulateJump();
      const detachedInAir = await k.waitFor("!p.ropeAttached && p.state !== 'rope' && !p.isGrounded", 1_500);
      let accidentalAirJump = k.player.state === "airJump";
      for (let frame = 0; frame < 3 && !accidentalAirJump; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        accidentalAirJump = k.player.state === "airJump";
      }
      const airborneBeforeSecondJump = !k.player.isGrounded;
      if (!accidentalAirJump && airborneBeforeSecondJump) {
        k.simulateJump();
      }
      const retainedAirJump = await k.waitFor("p.state === 'airJump'", 1_000);
      return { detachedInAir, accidentalAirJump, airborneBeforeSecondJump, retainedAirJump };
    });
    expect(jumpLifecycle.detachedInAir).toBe(true);
    expect(jumpLifecycle.accidentalAirJump).toBe(false);
    expect(jumpLifecycle.airborneBeforeSecondJump).toBe(true);
    expect(jumpLifecycle.retainedAirJump).toBe(true);
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

  test("landing accepts crouch within 100ms of the land state", async ({ page }) => {
    const result = await page.evaluate(async (ground) => {
      const k = window.__KINEMA__;
      k.forcePlayerPosition({ ...ground, y: ground.y + 3.5 });
      const becameAirborne = await k.waitFor("!p.isGrounded", 2_000);
      const landedHard = await k.waitFor("p.state === 'land'", 5_000);
      k.simulateVehicleInput({ crouch: true, crouchPressed: true }, 12);
      const transitionFrames = await new Promise<number | null>((resolve) => {
        let frames = 0;
        const sample = () => {
          frames++;
          if (k.player.state === "crouch") {
            resolve(frames);
            return;
          }
          if (frames >= 60) {
            resolve(null);
            return;
          }
          requestAnimationFrame(sample);
        };
        sample();
      });
      return { becameAirborne, landedHard, transitionFrames };
    }, SAFE_GROUND);

    expect(result.becameAirborne).toBe(true);
    expect(result.landedHard).toBe(true);
    // Six 60 Hz simulation opportunities are the 100 ms responsiveness budget.
    expect(result.transitionFrames).not.toBeNull();
    expect(result.transitionFrames ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(6);
  });

  test("ladder entry and climb speed preserve analog magnitude", async ({ page }) => {
    await page.evaluate(() => window.__KINEMA__.clearInteractionEvents());
    const sample = async (moveY: number) =>
      page.evaluate(
        async ({ position, axis }) => {
          const k = window.__KINEMA__;
          k.clearSimulatedInput();
          k.teleportPlayer(position);
          await k.waitFor("p.isGrounded && p.state === 'idle'", 5_000);
          k.simulateMove(0, axis, 24);
          const targetVelocity = Math.abs(axis) > 0.15 ? Math.max(-1, Math.min(1, axis)) * 2.6 : 0;
          const climbed = await k.waitFor(`p.state === 'climb' && Math.abs(p.vy - ${targetVelocity}) < 0.08`, 750);
          return { climbed, player: k.player };
        },
        { position: LADDER_APPROACH, axis: moveY },
      );

    const belowEntryGate = await sample(0.14);
    expect(belowEntryGate.climbed).toBe(false);

    const lowAnalog = await sample(0.16);
    expect(lowAnalog.climbed).toBe(true);
    expect(lowAnalog.player.velocity.y).toBeCloseTo(0.16 * 2.6, 1);

    const halfAnalog = await sample(0.5);
    const fullAnalog = await sample(1);
    expect(halfAnalog.climbed).toBe(true);
    expect(fullAnalog.climbed).toBe(true);
    expect(halfAnalog.player.velocity.y).toBeCloseTo(1.3, 1);
    expect(fullAnalog.player.velocity.y).toBeCloseTo(2.6, 1);
    expect(fullAnalog.player.velocity.y).toBeGreaterThan(halfAnalog.player.velocity.y * 1.8);
    const ladderEvents = await page.evaluate(() => window.__KINEMA__.getInteractionEvents());
    expect(ladderEvents.some((event) => event.type === "player:ladderAttached")).toBe(true);
    expect(ladderEvents.some((event) => event.type === "player:ladderReleased")).toBe(true);
  });
});

test.describe("Character step assist", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ key, name, level }) => {
        localStorage.setItem(
          "kinema_level_index",
          JSON.stringify([{ key, name, modified: level.modified, objectCount: level.objects.length }]),
        );
        localStorage.setItem(key, JSON.stringify(level));
      },
      { key: STEP_LEVEL_KEY, name: STEP_LEVEL_NAME, level: STEP_ASSIST_LEVEL },
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKinema(page);
    await page.getByRole("button", { name: "Level Select", exact: true }).click();
    const card = page.locator(".menu-level-card").filter({ hasText: STEP_LEVEL_NAME });
    await card.getByRole("button", { name: "Play", exact: true }).click();
    await page.locator(".loading-screen").waitFor({ state: "hidden", timeout: 60_000 });
    await waitForGrounded(page);
  });

  test("walks 0.20m, runs 0.28m, and remains blocked by 0.35m ledges", async ({ page }) => {
    test.setTimeout(180_000);
    await page.evaluate(() => window.__KINEMA__.clearInteractionEvents());
    const exerciseLedge = async (x: number, sprint: boolean) =>
      page.evaluate(
        async ({ laneX, run }) => {
          const k = window.__KINEMA__;
          k.clearSimulatedInput();
          k.teleportPlayer({ x: laneX, y: 2, z: 1.5 });
          await k.waitFor("p.isGrounded && p.state === 'idle'", 5_000);
          k.setCameraLook(0, 0);
          const startY = k.player.position.y;
          let minZ = k.player.position.z;
          let maxY = startY;
          k.simulateVehicleInput({ moveY: 1, sprint: run }, 36);
          await new Promise<void>((resolve) => {
            let frames = 0;
            const sampleFrame = () => {
              frames++;
              minZ = Math.min(minZ, k.player.position.z);
              maxY = Math.max(maxY, k.player.position.y);
              if (frames >= 42) {
                resolve();
                return;
              }
              requestAnimationFrame(sampleFrame);
            };
            sampleFrame();
          });
          k.clearSimulatedInput();
          return { minZ, rise: maxY - startY };
        },
        { laneX: x, run: sprint },
      );

    const step028 = await exerciseLedge(0, true);
    expect(step028.minZ).toBeLessThan(0);
    expect(step028.rise).toBeGreaterThan(0.18);

    const step035 = await exerciseLedge(4, true);
    expect(step035.minZ).toBeGreaterThan(0.1);

    const step020 = await exerciseLedge(-4, false);
    expect(step020.minZ).toBeLessThan(0);
    expect(step020.rise).toBeGreaterThan(0.12);
    const sprintStarts = await page.evaluate(
      () => window.__KINEMA__.getInteractionEvents().filter((event) => event.type === "player:sprintStarted").length,
    );
    expect(sprintStarts).toBe(2);
  });
});
