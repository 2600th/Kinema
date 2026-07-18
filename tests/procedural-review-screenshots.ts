import { expect, test } from "@playwright/test";
import { waitForGrounded, waitForKinema, waitForLoadingGone } from "./helpers/kinema";

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

test("procedural review spawns render from reusable review points", async ({ page }) => {
  test.setTimeout(240_000);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/?spawn=entrance", { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 15_000 });
  await waitForKinema(page);
  await waitForLoadingGone(page);

  const boundaryWalls = await page.evaluate(() => {
    const k = window.__KINEMA__;
    return {
      entrance: k?.getLevelObjectState?.("ShowcaseBoundaryWall_Entrance_col") ?? null,
      exit: k?.getLevelObjectState?.("ShowcaseBoundaryWall_End_col") ?? null,
    };
  });
  expect(boundaryWalls.entrance).not.toBeNull();
  expect(boundaryWalls.exit).not.toBeNull();
  if (!boundaryWalls.entrance || !boundaryWalls.exit) throw new Error("Boundary walls were not loaded");
  expect(boundaryWalls.entrance.position.z).toBeGreaterThan(250);
  expect(boundaryWalls.exit.position.z).toBeLessThan(-250);
  expect(boundaryWalls.entrance.size.x).toBeGreaterThan(58);
  expect(boundaryWalls.entrance.size.y).toBeLessThan(1);
  expect(Math.abs(boundaryWalls.entrance.position.x)).toBeLessThan(0.1);
  expect(Math.abs(boundaryWalls.exit.position.x)).toBeLessThan(0.1);

  for (const spawn of REVIEW_SPAWNS) {
    const teleported = await page.evaluate((spawnKey) => {
      return window.__KINEMA__.teleportToReviewSpawn?.(spawnKey) ?? false;
    }, spawn);
    expect(teleported).toBe(true);

    await waitForGrounded(page);

    const playerState = await page.evaluate(() => {
      const k = window.__KINEMA__;
      return k?.player ?? null;
    });
    expect(playerState).not.toBeNull();
    expect(playerState.position.y).toBeGreaterThan(-5);
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

  const realErrors = consoleErrors.filter((message) => !message.includes("favicon") && !message.includes("404"));
  expect(realErrors).toHaveLength(0);
});
