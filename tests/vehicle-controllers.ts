import { expect, test, type Page } from "@playwright/test";

type VehicleState = {
  id: string;
  active: boolean;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  debug?: {
    groundedWheelCount?: number;
    frontGroundedWheelCount?: number;
    rearGroundedWheelCount?: number;
    groundedTraction?: number;
    wheelSuspensionLengths?: number[];
    wheelForwardImpulses?: number[];
    wheelSideImpulses?: number[];
    wheelSuspensionForces?: number[];
    averageSuspensionCompression?: number;
    averageSuspensionForce?: number;
    suspensionOffset?: number;
    verticalVelocity?: number;
    forwardSpeed?: number;
    lateralSpeed?: number;
    steerAngle?: number;
    headingYaw?: number;
    yawRate?: number;
    driveImpulseMagnitude?: number;
    contactPushImpulse?: number;
    contactPushCarDrag?: number;
    activeContactPushBodies?: number;
  };
};

function shortestAngleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

type DynamicBodyState = {
  name: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
};

type VehicleSteeringTrace = {
  enabled: boolean;
  autoLog: boolean;
  label: string;
  capacity: number;
  sampleCount: number;
  incidentSampleCapacity: number;
  incidentSampleCount: number;
  incidentCount: number;
  samples: Array<{
    frame: number;
    input: { moveX: number; moveY: number };
    command: { physicsSteerAngle: number };
    state: {
      groundedWheelCount: number;
      frontGroundedWheelCount: number;
      rearGroundedWheelCount: number;
      forwardSpeed: number;
      yawRate: number;
    };
    derived: {
      driveMode: "forward" | "reverse" | "coast";
      expectedYawSign: number;
      actualYawSign: number;
      yawAgreement: boolean;
      suspectedForwardSteerLoss: boolean;
    };
  }>;
  incidentSamples: Array<{
    frame: number;
    input: { moveX: number; moveY: number };
    command: { physicsSteerAngle: number };
    state: {
      groundedWheelCount: number;
      frontGroundedWheelCount: number;
      rearGroundedWheelCount: number;
      forwardSpeed: number;
      yawRate: number;
    };
    derived: {
      driveMode: "forward" | "reverse" | "coast";
      expectedYawSign: number;
      actualYawSign: number;
      yawAgreement: boolean;
      suspectedForwardSteerLoss: boolean;
    };
  }>;
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

async function getDynamicBodyState(page: Page, name: string): Promise<DynamicBodyState> {
  const state = await page.evaluate((bodyName) => (window as any).__KINEMA__.getDynamicBodyState(bodyName), name);
  expect(state).not.toBeNull();
  return state as DynamicBodyState;
}

async function getVehicleSteeringTrace(page: Page, id: string): Promise<VehicleSteeringTrace> {
  const trace = await page.evaluate((vehicleId) => (window as any).__KINEMA__.getVehicleSteeringDebug(vehicleId), id);
  expect(trace).not.toBeNull();
  return trace as VehicleSteeringTrace;
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

  test("car steering debug trace captures forward steering samples", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "car-1");

    const enabled = await page.evaluate(() =>
      (window as any).__KINEMA__.enableVehicleSteeringDebug("car-1", {
        capacity: 120,
        autoLog: false,
        label: "playwright-forward-turn",
      }),
    );
    expect(enabled?.enabled).toBe(true);

    await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ moveY: 0.75, moveX: -1 }, 120));
    await page.waitForTimeout(2200);

    const trace = await getVehicleSteeringTrace(page, "car-1");
    expect(trace.enabled).toBe(true);
    expect(trace.label).toBe("playwright-forward-turn");
    expect(trace.sampleCount).toBeGreaterThanOrEqual(3);
    const activeForwardTurnSamples = trace.samples.filter((sample) =>
      sample.derived.driveMode === "forward"
      && sample.input.moveX < -0.9
      && sample.input.moveY > 0.7
      && Math.abs(sample.command.physicsSteerAngle) > 0.01
      && sample.state.groundedWheelCount >= 2,
    );

    expect(activeForwardTurnSamples.length).toBeGreaterThan(0);
    expect(activeForwardTurnSamples.some((sample) => sample.state.rearGroundedWheelCount > 0)).toBe(true);
    expect(
      activeForwardTurnSamples
        .filter((sample) => sample.derived.actualYawSign !== 0)
        .every((sample) => sample.derived.yawAgreement),
    ).toBe(true);
    expect(activeForwardTurnSamples.some((sample) =>
      sample.derived.suspectedForwardSteerLoss
      && sample.state.frontGroundedWheelCount > 0
      && sample.state.rearGroundedWheelCount === 0,
    )).toBe(false);

    await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ moveX: 0, moveY: 0 }, 240));
    await page.waitForTimeout(2200);

    const lateTrace = await getVehicleSteeringTrace(page, "car-1");
    expect(lateTrace.enabled).toBe(true);
    expect(lateTrace.incidentSampleCount).toBe(lateTrace.incidentSamples.length);
    expect(lateTrace.incidentSampleCount).toBeLessThanOrEqual(lateTrace.incidentSampleCapacity);
    expect(lateTrace.incidentCount).toBeGreaterThanOrEqual(lateTrace.incidentSampleCount);
    expect(lateTrace.incidentCount).toBe(0);
    expect(lateTrace.incidentSampleCount).toBe(0);
  });

  test("car stays planted while driving straight on the vehicles station", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "car-1");

    const metrics = await page.evaluate(async () => {
      const k = (window as any).__KINEMA__;
      k.simulateVehicleInput({ moveY: -1 }, 220);

      const samples: Array<{
        y: number;
        grounded: number;
        traction: number;
        compression: number;
        verticalVelocity: number;
        lateralSpeed: number;
      }> = [];

      const start = performance.now();
      while (performance.now() - start < 3200) {
        const state = k.getVehicleState("car-1");
        const debug = state?.debug ?? {};
        samples.push({
          y: state.position.y,
          grounded: debug.groundedWheelCount ?? 0,
          traction: debug.groundedTraction ?? 0,
          compression: debug.averageSuspensionCompression ?? 0,
          verticalVelocity: Math.abs(debug.verticalVelocity ?? state.velocity.y ?? 0),
          lateralSpeed: Math.abs(debug.lateralSpeed ?? 0),
        });
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 40));
      }

      const ys = samples.map((sample) => sample.y);
      const tractions = samples.map((sample) => sample.traction);
      const compressions = samples.map((sample) => sample.compression);
      const verticalVelocities = samples.map((sample) => sample.verticalVelocity);
      const groundedCounts = samples.map((sample) => sample.grounded);
      const lateralSpeeds = samples.map((sample) => sample.lateralSpeed);

      return {
        sampleCount: samples.length,
        yRange: Math.max(...ys) - Math.min(...ys),
        minTraction: Math.min(...tractions),
        maxCompression: Math.max(...compressions),
        maxVerticalVelocity: Math.max(...verticalVelocities),
        minGrounded: Math.min(...groundedCounts),
        maxLateralSpeed: Math.max(...lateralSpeeds),
      };
    });

    expect(metrics.sampleCount).toBeGreaterThan(60);
    expect(metrics.yRange).toBeLessThan(0.38);
    expect(metrics.minTraction).toBeGreaterThan(0.45);
    expect(metrics.maxCompression).toBeLessThan(0.22);
    expect(metrics.maxVerticalVelocity).toBeLessThan(1.4);
    expect(metrics.minGrounded).toBeGreaterThanOrEqual(2);
    expect(metrics.maxLateralSpeed).toBeLessThan(1.8);
  });

  test("car impacts a crash prop with a controlled shove and restabilizes quickly", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "car-1");

    const targetName = "CrashCubeA_dyn";
    const target = await getDynamicBodyState(page, targetName);
    const currentCar = await getVehicleState(page, "car-1");

    const movedVehicle = await page.evaluate(({ x, y, z }) => {
      return (window as any).__KINEMA__.forceVehicleTransform("car-1", { x, y, z }, 0);
    }, {
      x: target.position.x,
      y: currentCar.position.y,
      z: target.position.z + 5.8,
    });
    expect(movedVehicle).toBe(true);
    await page.waitForTimeout(180);

    const launchedVehicle = await page.evaluate(() => {
      return (window as any).__KINEMA__.forceVehicleVelocity("car-1", { x: 0, y: 0, z: -14.5 });
    });
    expect(launchedVehicle).toBe(true);
    await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ moveY: 1, sprint: true }, 420));

    await page.waitForFunction(
      ({ name, startX, startZ }) => {
        const body = (window as any).__KINEMA__.getDynamicBodyState(name);
        if (!body) return false;
        return Math.hypot(body.position.x - startX, body.position.z - startZ) > 0.2;
      },
      { name: targetName, startX: target.position.x, startZ: target.position.z },
      { timeout: 20_000 },
    );

    const afterImpactBody = await getDynamicBodyState(page, targetName);
    const afterImpactCar = await getVehicleState(page, "car-1");
    const bodyMoved = Math.hypot(
      afterImpactBody.position.x - target.position.x,
      afterImpactBody.position.z - target.position.z,
    );
    const bodySpeed = Math.hypot(afterImpactBody.velocity.x, afterImpactBody.velocity.z);
    const bodyVerticalSpeed = Math.abs(afterImpactBody.velocity.y);
    expect(bodySpeed).toBeGreaterThan(0.12);
    expect(bodySpeed).toBeGreaterThan(bodyVerticalSpeed);
    expect(bodyMoved).toBeGreaterThan(0.2);
    expect(Math.abs(afterImpactCar.debug?.forwardSpeed ?? 99)).toBeLessThan(13.5);
    expect(afterImpactCar.debug?.groundedWheelCount ?? 0).toBeGreaterThanOrEqual(2);

    await page.waitForFunction(
      ({ name, startX, startZ }) => {
        const body = (window as any).__KINEMA__.getDynamicBodyState(name);
        if (!body) return false;
        return Math.hypot(body.position.x - startX, body.position.z - startZ) > 0.7;
      },
      { name: targetName, startX: target.position.x, startZ: target.position.z },
      { timeout: 20_000 },
    );
    const sustainedBody = await getDynamicBodyState(page, targetName);
    const sustainedCar = await getVehicleState(page, "car-1");
    const sustainedBodyMoved = Math.hypot(
      sustainedBody.position.x - target.position.x,
      sustainedBody.position.z - target.position.z,
    );
    const sustainedGap = Math.hypot(
      sustainedCar.position.x - sustainedBody.position.x,
      sustainedCar.position.z - sustainedBody.position.z,
    );

    await page.waitForFunction(
      () => {
        const car = (window as any).__KINEMA__.getVehicleState("car-1");
        if (!car?.active) return false;
        const grounded = car.debug?.groundedWheelCount ?? 0;
        const verticalVelocity = Math.abs(car.debug?.verticalVelocity ?? car.velocity.y ?? 0);
        const settledSpeed = Math.hypot(car.velocity.x, car.velocity.z);
        const traction = car.debug?.groundedTraction ?? 0;
        return grounded >= 2
          && traction > 0.35
          && verticalVelocity < 1.2
          && settledSpeed > 0.05;
      },
      undefined,
      { timeout: 10_000 },
    );
    const settledCar = await getVehicleState(page, "car-1");
    const settledSpeed = Math.hypot(settledCar.velocity.x, settledCar.velocity.z);
    expect(settledCar.active).toBe(true);
    expect(settledCar.debug?.groundedWheelCount ?? 0).toBeGreaterThanOrEqual(2);
    expect(settledCar.debug?.groundedTraction ?? 0).toBeGreaterThan(0.35);
    expect(Math.abs(settledCar.debug?.verticalVelocity ?? settledCar.velocity.y)).toBeLessThan(1.2);
    expect(settledSpeed).toBeGreaterThan(0.05);
    expect(sustainedBodyMoved).toBeGreaterThan(0.7);
    expect(sustainedGap).toBeLessThan(3.4);

    const turnStart = await getVehicleState(page, "car-1");
    await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ moveY: 0.7, moveX: 1 }, 180));
    await page.waitForFunction(
      (startX) => {
        const car = (window as any).__KINEMA__.getVehicleState("car-1");
        if (!car?.active) return false;
        const lateral = Math.abs(car.debug?.lateralSpeed ?? 0);
        return Math.abs(car.position.x - startX) > 0.25 || lateral > 0.55;
      },
      turnStart.position.x,
      { timeout: 10_000 },
    );

    const secondTargetName = "CrashCubeB_dyn";
    const secondTarget = await getDynamicBodyState(page, secondTargetName);
    const beforeSecondImpactCar = await getVehicleState(page, "car-1");
    const movedVehicleAgain = await page.evaluate(({ x, y, z }) => {
      return (window as any).__KINEMA__.forceVehicleTransform("car-1", { x, y, z }, 0);
    }, {
      x: secondTarget.position.x,
      y: beforeSecondImpactCar.position.y,
      z: secondTarget.position.z + 5.4,
    });
    expect(movedVehicleAgain).toBe(true);
    await page.waitForTimeout(180);

    const relaunchedVehicle = await page.evaluate(() => {
      return (window as any).__KINEMA__.forceVehicleVelocity("car-1", { x: 0, y: 0, z: -13.8 });
    });
    expect(relaunchedVehicle).toBe(true);
    await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ moveY: 1, sprint: true }, 260));

    await page.waitForFunction(
      ({ name, startX, startZ }) => {
        const body = (window as any).__KINEMA__.getDynamicBodyState(name);
        if (!body) return false;
        return Math.hypot(body.position.x - startX, body.position.z - startZ) > 0.18;
      },
      { name: secondTargetName, startX: secondTarget.position.x, startZ: secondTarget.position.z },
      { timeout: 20_000 },
    );

    const secondTurnStart = await getVehicleState(page, "car-1");
    expect(secondTurnStart.active).toBe(true);
    await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ moveY: 0.65, moveX: -1 }, 180));
    await page.waitForFunction(
      (startX) => {
        const car = (window as any).__KINEMA__.getVehicleState("car-1");
        if (!car?.active) return false;
        const lateral = Math.abs(car.debug?.lateralSpeed ?? 0);
        return Math.abs(car.position.x - startX) > 0.25 || lateral > 0.55;
      },
      secondTurnStart.position.x,
      { timeout: 10_000 },
    );
  });

  test("car turns decisively from a clean spawn in both directions", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "car-1");

    const startLeft = await getVehicleState(page, "car-1");
    await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ moveY: 0.7, moveX: -1 }, 180));
    await page.waitForFunction(
      ({ startX, startYaw }) => {
        const car = (window as any).__KINEMA__.getVehicleState("car-1");
        if (!car?.active) return false;
        const lateral = Math.abs(car.debug?.lateralSpeed ?? 0);
        const headingYaw = car.debug?.headingYaw;
        if (typeof headingYaw !== "number") return false;
        let delta = headingYaw - startYaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        return Math.abs(car.position.x - startX) > 0.12 || lateral > 0.55 || delta < -0.08;
      },
      { startX: startLeft.position.x, startYaw: startLeft.debug?.headingYaw ?? 0 },
      { timeout: 10_000 },
    );

    const endLeft = await getVehicleState(page, "car-1");
    expect(
      Math.abs(endLeft.position.x - startLeft.position.x) > 0.12
      || Math.abs(endLeft.debug?.lateralSpeed ?? 0) > 0.55
      || shortestAngleDelta(startLeft.debug?.headingYaw ?? 0, endLeft.debug?.headingYaw ?? 0) < -0.08,
    ).toBe(true);

    await page.evaluate(() => (window as any).__KINEMA__.resetVehicle("car-1"));
    await page.waitForTimeout(250);
    await page.evaluate(() => (window as any).__KINEMA__.enterVehicle("car-1"));
    await page.waitForFunction(() => (window as any).__KINEMA__.getVehicleState("car-1")?.active === true, undefined, {
      timeout: 10_000,
    });

    const startRight = await getVehicleState(page, "car-1");
    await page.evaluate(() => (window as any).__KINEMA__.simulateVehicleInput({ moveY: 0.7, moveX: 1 }, 180));
    await page.waitForFunction(
      ({ startX, startYaw }) => {
        const car = (window as any).__KINEMA__.getVehicleState("car-1");
        if (!car?.active) return false;
        const lateral = Math.abs(car.debug?.lateralSpeed ?? 0);
        const headingYaw = car.debug?.headingYaw;
        if (typeof headingYaw !== "number") return false;
        let delta = headingYaw - startYaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        return Math.abs(car.position.x - startX) > 0.12 || lateral > 0.55 || delta > 0.08;
      },
      { startX: startRight.position.x, startYaw: startRight.debug?.headingYaw ?? 0 },
      { timeout: 10_000 },
    );

    const endRight = await getVehicleState(page, "car-1");
    expect(
      Math.abs(endRight.position.x - startRight.position.x) > 0.12
      || Math.abs(endRight.debug?.lateralSpeed ?? 0) > 0.55
      || shortestAngleDelta(startRight.debug?.headingYaw ?? 0, endRight.debug?.headingYaw ?? 0) > 0.08,
    ).toBe(true);
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
    expect(moved.delta).toBeGreaterThan(0.14);
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
