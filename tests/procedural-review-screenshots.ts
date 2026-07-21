import { expect, test } from "@playwright/test";
import { SHOWCASE_BOUNDARY_HEIGHT, SHOWCASE_GROUNDED_SPAWN_Y } from "../src/level/ShowcaseLayout";
import { waitForKinema, waitForLoadingGone } from "./helpers/kinema";

const REVIEW_SPAWNS = [
  "entrance",
  "overviewMid",
  "steps",
  "slopes",
  "movement",
  "doubleJump",
  "grab",
  "throw",
  "door",
  "vehicles",
  "platformsMoving",
  "platformsPhysics",
  "materials",
  "vfx",
  "navigation",
  "futureA",
  "overviewEnd",
] as const;
const REVIEW_PROFILE = "balanced" as const;

test("procedural review spawns render from reusable review points", async ({ page }, testInfo) => {
  test.setTimeout(720_000);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/?spawn=entrance", { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 15_000 });
  await waitForKinema(page);
  await waitForLoadingGone(page);
  expect(await page.evaluate((profile) => window.__KINEMA__.setGraphicsProfile(profile), REVIEW_PROFILE)).toBe(
    REVIEW_PROFILE,
  );

  const firstInteractivePlayer = await page.evaluate(() => window.__KINEMA__.player);
  expect(firstInteractivePlayer.isGrounded).toBe(true);
  expect(firstInteractivePlayer.position.y).toBeGreaterThanOrEqual(SHOWCASE_GROUNDED_SPAWN_Y - 0.05);
  expect(firstInteractivePlayer.position.y).toBeLessThan(0.5);

  const corridorState = await page.evaluate(() => {
    const k = window.__KINEMA__;
    return {
      entrance: k?.getLevelObjectState?.("ShowcaseBoundaryWall_Entrance_col") ?? null,
      exit: k?.getLevelObjectState?.("ShowcaseBoundaryWall_End_col") ?? null,
      leftTrim: k?.getLevelObjectState?.("ShowcaseBoundaryWall_LTrim") ?? null,
      endTrim: k?.getLevelObjectState?.("ShowcaseBoundaryWall_EndTrim") ?? null,
      landmark: k?.getLevelObjectState?.("ShowcaseEndLandmark") ?? null,
      landmarkCore: k?.getLevelObjectState?.("ShowcaseEndLandmarkCore") ?? null,
      landmarkCrown: k?.getLevelObjectState?.("ShowcaseEndLandmarkCrown") ?? null,
      slopesWayfinding: k?.getLevelObjectState?.("Wayfinding_slopes") ?? null,
      movementWayfinding: k?.getLevelObjectState?.("Wayfinding_movement") ?? null,
    };
  });
  expect(corridorState.entrance).not.toBeNull();
  expect(corridorState.exit).not.toBeNull();
  expect(corridorState.leftTrim).not.toBeNull();
  expect(corridorState.endTrim).not.toBeNull();
  expect(corridorState.landmark).not.toBeNull();
  expect(corridorState.landmark?.position.x).toBeGreaterThan(20);
  expect(corridorState.landmark?.size.x).toBeGreaterThan(20);
  expect(corridorState.landmark?.size.y).toBeGreaterThan(65);
  expect(corridorState.landmarkCore?.material?.emissive).not.toBeNull();
  expect(corridorState.landmarkCrown?.material?.emissive).not.toBeNull();
  expect(corridorState.slopesWayfinding?.labelText).toBe("Slopes");
  expect(corridorState.movementWayfinding?.labelText).toBe("Movement");
  expect(corridorState.slopesWayfinding?.position.x).toBeGreaterThan(10);
  expect(corridorState.movementWayfinding?.position.x).toBeLessThan(-10);
  if (!corridorState.entrance || !corridorState.exit || !corridorState.leftTrim || !corridorState.endTrim) {
    throw new Error("Corridor perimeter treatment was not loaded");
  }
  expect(corridorState.entrance.position.z).toBeGreaterThan(250);
  expect(corridorState.exit.position.z).toBeLessThan(-250);
  expect(corridorState.entrance.size.x).toBeGreaterThan(58);
  expect(corridorState.entrance.size.y).toBeCloseTo(SHOWCASE_BOUNDARY_HEIGHT);
  expect(corridorState.leftTrim.size.x).toBeLessThan(0.2);
  expect(corridorState.endTrim.size.y).toBeLessThanOrEqual(0.11);
  expect(Math.abs(corridorState.entrance.position.x)).toBeLessThan(0.1);
  expect(Math.abs(corridorState.exit.position.x)).toBeLessThan(0.1);

  for (const [index, spawn] of REVIEW_SPAWNS.entries()) {
    const teleported = await page.evaluate((spawnKey) => {
      return window.__KINEMA__.teleportToReviewSpawn?.(spawnKey) ?? false;
    }, spawn);
    expect(teleported).toBe(true);

    const playerState = await page.evaluate(() => {
      const k = window.__KINEMA__;
      return k?.player ?? null;
    });
    expect(playerState).not.toBeNull();
    expect(playerState.position.y).toBeGreaterThan(-5);

    await page.evaluate(async (profile) => {
      await document.fonts.ready;
      await window.__KINEMA__.freezeForCapture();
      await window.__KINEMA__.setGraphicsProfile(profile);
    }, REVIEW_PROFILE);
    await expect
      .poll(() => page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().graphicsProfile), {
        timeout: 60_000,
      })
      .toBe(REVIEW_PROFILE);
    await expect(page.locator("#renderer-status-badge")).toHaveText(/ · balanced$/);
    await page.screenshot({
      path: testInfo.outputPath(`${String(index + 1).padStart(2, "0")}-${spawn}.png`),
    });
  }

  const vehicleIds = await page.evaluate(() => {
    return window.__KINEMA__.listVehicles?.() ?? [];
  });
  expect(vehicleIds).toContain("car-1");
  expect(vehicleIds).toContain("drone-1");

  const carState = await page.evaluate(() => {
    return window.__KINEMA__.getVehicleState?.("car-1") ?? null;
  });
  expect(carState).not.toBeNull();
  if (!carState) throw new Error("Car state was not available");
  expect(carState.position.y).toBeGreaterThan(-1.2);
  expect(carState.position.y).toBeLessThan(0.2);

  const resetCar = await page.evaluate(() => {
    return window.__KINEMA__.resetVehicle?.("car-1") ?? false;
  });
  expect(resetCar).toBe(true);
  await page.waitForTimeout(250);

  const resetCarState = await page.evaluate(() => {
    return window.__KINEMA__.getVehicleState?.("car-1") ?? null;
  });
  expect(resetCarState).not.toBeNull();
  if (!resetCarState) throw new Error("Reset car state was not available");
  expect(resetCarState.position.y).toBeGreaterThan(-1.2);
  expect(resetCarState.position.y).toBeLessThan(0.2);

  const knownToneSchedulingError = "Start time must be strictly greater than previous start time";
  const realErrors = consoleErrors.filter((message) => !message.includes(knownToneSchedulingError));
  expect(realErrors).toHaveLength(0);
});
