import { expect, test, type Page } from "@playwright/test";

type VehicleState = {
  id: string;
  active: boolean;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  debug?: unknown;
};

async function waitForVehiclesStationReady(page: Page): Promise<void> {
  await page.goto("/?station=vehicles", { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__KINEMA__), undefined, { timeout: 60_000 });
  const grounded = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 60_000));
  expect(grounded).toBe(true);
}

async function getVehicleState(page: Page, id: string): Promise<VehicleState> {
  const state = await page.evaluate((vehicleId) => (window as any).__KINEMA__.getVehicleState(vehicleId), id);
  expect(state).not.toBeNull();
  return state as VehicleState;
}

async function enterVehicle(page: Page, id: string): Promise<void> {
  const entered = await page.evaluate((vehicleId) => (window as any).__KINEMA__.enterVehicle(vehicleId), id);
  expect(entered).toBe(true);
  await page.waitForFunction(
    (vehicleId) => {
      const state = (window as any).__KINEMA__.getVehicleState(vehicleId);
      return Boolean(state?.active);
    },
    id,
    { timeout: 10_000 },
  );
}

async function exitActiveVehicle(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ interactPressed: true }, 8));
  await page.waitForFunction(
    () => {
      const ids: string[] = (window as any).__KINEMA__.listVehicles();
      return ids.every((id) => !(window as any).__KINEMA__.getVehicleState(id)?.active);
    },
    undefined,
    { timeout: 10_000 },
  );
}

test.describe("Vehicle Controllers", () => {
  test("vehicles station exposes expected runtime ids", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    const ids = await page.evaluate(() => (window as any).__KINEMA__.listVehicles());
    expect(ids).toContain("car-1");
    expect(ids).toContain("drone-1");
  });

  test("car entry activates controller and reverse input moves the vehicle", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "car-1");

    const before = await getVehicleState(page, "car-1");
    await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ moveY: -1 }, 90));

    await page.waitForFunction(
      () => {
        const s = (window as any).__KINEMA__.getVehicleState("car-1");
        if (!s) return false;
        const speed = Math.hypot(s.velocity.x, s.velocity.z);
        return speed > 0.05;
      },
      undefined,
      { timeout: 10_000 },
    );

    const after = await getVehicleState(page, "car-1");
    const moved = Math.hypot(
      after.position.x - before.position.x,
      after.position.z - before.position.z,
    );
    const speed = Math.hypot(after.velocity.x, after.velocity.z);
    expect(after.active).toBe(true);
    expect(speed).toBeGreaterThan(0.05);
    expect(moved).toBeGreaterThan(0.005);
  });

  test("vehicle exit clears active state and player regains grounded control", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "car-1");
    await exitActiveVehicle(page);

    const grounded = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 10_000));
    expect(grounded).toBe(true);

    const moved = await page.evaluate(async () => {
      const k = (window as any).__KINEMA__;
      const before = k.player.position;
      k.simulateMove(0, 1, 60);
      const ok = await k.waitFor("Math.hypot(p.vx, p.vz) > 0.35", 8_000);
      const after = k.player.position;
      return {
        ok,
        delta: Math.hypot(after.x - before.x, after.z - before.z),
      };
    });

    expect(moved.ok).toBe(true);
    expect(moved.delta).toBeGreaterThan(0.15);
  });

  test("drone entry activates drone and forward input produces motion", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "drone-1");

    const before = await getVehicleState(page, "drone-1");
    await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ moveY: 1, sprint: true }, 90));

    await page.waitForFunction(
      () => {
        const s = (window as any).__KINEMA__.getVehicleState("drone-1");
        if (!s) return false;
        const speed = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
        return speed > 0.2;
      },
      undefined,
      { timeout: 10_000 },
    );

    const after = await getVehicleState(page, "drone-1");
    const moved = Math.hypot(
      after.position.x - before.position.x,
      after.position.y - before.position.y,
      after.position.z - before.position.z,
    );
    const speed = Math.hypot(after.velocity.x, after.velocity.y, after.velocity.z);
    expect(after.active).toBe(true);
    expect(speed).toBeGreaterThan(0.2);
    expect(moved).toBeGreaterThan(0.05);
  });
});
