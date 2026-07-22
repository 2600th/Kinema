import { expect, type Page, test } from "@playwright/test";
import type { KinemaVehicleSteeringTrace } from "../src/core/KinemaDebugApi";
import { waitForGrounded } from "./helpers/kinema";

type VehicleState = {
  id: string;
  active: boolean;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
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

async function waitForVehiclesStationReady(page: Page, rendererQuery = ""): Promise<void> {
  const suffix = rendererQuery ? `&${rendererQuery}` : "";
  await page.goto(`/?station=vehicles${suffix}`, { waitUntil: "domcontentloaded" });
  await page.locator("canvas[data-engine]").waitFor({ state: "visible", timeout: 60_000 });
  await waitForGrounded(page);
}

async function waitForFullVehiclesReady(page: Page): Promise<void> {
  await page.goto("/?spawn=vehicles", { waitUntil: "domcontentloaded" });
  await page.locator("canvas[data-engine]").waitFor({ state: "visible", timeout: 60_000 });
  await waitForGrounded(page);
  await page.waitForFunction(() => window.__KINEMA__.listVehicles().includes("car-1"), undefined, {
    timeout: 60_000,
  });
}

async function getVehicleState(page: Page, id: string): Promise<VehicleState> {
  const state = await page.evaluate((vehicleId) => window.__KINEMA__.getVehicleState(vehicleId), id);
  expect(state).not.toBeNull();
  return state as VehicleState;
}

async function getDynamicBodyState(page: Page, name: string): Promise<DynamicBodyState> {
  const state = await page.evaluate((bodyName) => window.__KINEMA__.getDynamicBodyState(bodyName), name);
  expect(state).not.toBeNull();
  return state as DynamicBodyState;
}

async function getVehicleSteeringTrace(page: Page, id: string): Promise<KinemaVehicleSteeringTrace> {
  const trace = await page.evaluate((vehicleId) => window.__KINEMA__.getVehicleSteeringDebug(vehicleId), id);
  expect(trace).not.toBeNull();
  if (!trace) throw new Error(`Vehicle steering trace was not available for ${id}`);
  return trace;
}

async function enterVehicle(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((vehicleId) => {
          const state = window.__KINEMA__.getVehicleState(vehicleId);
          if (!state) return "missing";
          if (state.active) return "active";
          window.__KINEMA__.enterVehicle(vehicleId);
          return window.__KINEMA__.getVehicleState(vehicleId)?.active ? "active" : "cooldown";
        }, id),
      { timeout: 10_000, intervals: [100, 250, 500] },
    )
    .toBe("active");
}

async function exitActiveVehicle(page: Page): Promise<void> {
  await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ interactPressed: true }, 8));
  await page.waitForFunction(
    () => {
      const ids: string[] = window.__KINEMA__.listVehicles();
      return ids.every((id) => !window.__KINEMA__.getVehicleState(id)?.active);
    },
    undefined,
    { timeout: 10_000 },
  );
}

test.describe("Vehicle Controllers", () => {
  for (const rendererPath of [
    { label: "webgpu-auto", query: "", backend: /^WebGPU/ },
    {
      label: "webgpu-webgl2",
      query: "forceWebGPUWebGL=1",
      backend: /^WebGPU \(WebGL2 backend\)$/,
    },
    { label: "compat-webgl", query: "forceWebGL=1", backend: /^WebGLRenderer$/ },
  ]) {
    test(`vehicle dust, skid, and boost render on ${rendererPath.label}`, async ({ page }, testInfo) => {
      await waitForVehiclesStationReady(page, rendererPath.query);
      expect(await page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().activeBackend)).toMatch(
        rendererPath.backend,
      );
      await enterVehicle(page, "car-1");

      await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveY: 1, sprint: true }, 180));
      await page.waitForFunction(
        () => {
          const emitted = window.__KINEMA__.getVfxDebugState().vehicle.emitted;
          return emitted.dust > 0 && emitted.boost > 0;
        },
        undefined,
        { timeout: 15_000 },
      );

      await page.evaluate(() =>
        window.__KINEMA__.simulateVehicleInput({ moveY: 0.75, moveX: 1, crouch: true, sprint: true }, 60),
      );
      await page.waitForFunction(() => window.__KINEMA__.getVfxDebugState().vehicle.emitted.skid > 0, undefined, {
        timeout: 15_000,
      });
      const active = await page.evaluate(() => window.__KINEMA__.getVfxDebugState().vehicle.active);
      expect(active.dust + active.skid + active.boost).toBeGreaterThan(0);

      const evidence = await page.evaluate(() => ({
        backend: window.__KINEMA__.getRendererDebugFlags().activeBackend,
        vfx: window.__KINEMA__.getVfxDebugState(),
      }));
      await testInfo.attach(`kin026-vehicle-vfx-${rendererPath.label}`, {
        body: Buffer.from(JSON.stringify(evidence, null, 2)),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath(`kin026-vehicle-vfx-${rendererPath.label}.png`) });
      await exitActiveVehicle(page);
      await page.waitForFunction(
        () => {
          const counts = window.__KINEMA__.getVfxDebugState().vehicle.active;
          return counts.dust + counts.skid + counts.boost === 0;
        },
        undefined,
        { timeout: 10_000 },
      );
    });
  }

  test("vehicles station exposes expected runtime ids", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    const ids = await page.evaluate(() => window.__KINEMA__.listVehicles());
    expect(ids).toContain("car-1");
    expect(ids).toContain("drone-1");
  });

  test("car entry activates controller and reverse input moves the vehicle", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "car-1");

    const before = await getVehicleState(page, "car-1");
    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveY: -1 }, 90));

    await page.waitForFunction(
      (startPosition) => {
        const s = window.__KINEMA__.getVehicleState("car-1");
        if (!s) return false;
        const speed = Math.hypot(s.velocity.x, s.velocity.z);
        const moved = Math.hypot(s.position.x - startPosition.x, s.position.z - startPosition.z);
        return speed > 0.05 && moved > 0.005;
      },
      before.position,
      { timeout: 10_000 },
    );

    const after = await getVehicleState(page, "car-1");
    const moved = Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z);
    const speed = Math.hypot(after.velocity.x, after.velocity.z);
    expect(after.active).toBe(true);
    expect(speed).toBeGreaterThan(0.05);
    expect(moved).toBeGreaterThan(0.005);
  });

  test("car steering debug trace captures forward steering samples", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "car-1");

    const enabled = await page.evaluate(() =>
      window.__KINEMA__.enableVehicleSteeringDebug("car-1", {
        capacity: 120,
        autoLog: false,
        label: "playwright-forward-turn",
      }),
    );
    expect(enabled?.enabled).toBe(true);

    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveY: 0.75, moveX: -1 }, 120));
    await page.waitForTimeout(2200);

    const trace = await getVehicleSteeringTrace(page, "car-1");
    expect(trace.enabled).toBe(true);
    expect(trace.label).toBe("playwright-forward-turn");
    expect(trace.sampleCount).toBeGreaterThanOrEqual(3);
    const activeForwardTurnSamples = trace.samples.filter(
      (sample) =>
        sample.derived.driveMode === "forward" &&
        sample.input.moveX < -0.9 &&
        sample.input.moveY > 0.7 &&
        Math.abs(sample.command.physicsSteerAngle) > 0.01 &&
        sample.state.groundedWheelCount >= 2,
    );

    expect(activeForwardTurnSamples.length).toBeGreaterThan(0);
    expect(activeForwardTurnSamples.some((sample) => sample.state.rearGroundedWheelCount > 0)).toBe(true);
    expect(
      activeForwardTurnSamples
        .filter((sample) => sample.derived.actualYawSign !== 0)
        .some((sample) => sample.derived.yawAgreement),
    ).toBe(true);
    expect(
      activeForwardTurnSamples.some(
        (sample) =>
          sample.derived.suspectedForwardSteerLoss &&
          sample.state.frontGroundedWheelCount > 0 &&
          sample.state.rearGroundedWheelCount === 0,
      ),
    ).toBe(false);

    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveX: 0, moveY: 0 }, 240));
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
      const k = window.__KINEMA__;
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
      while (performance.now() - start < 3200 || samples.length <= 60) {
        const state = k.getVehicleState("car-1");
        if (!state) throw new Error("Car state was not available");
        const debug = state.debug;
        samples.push({
          y: state.position.y,
          grounded: debug?.groundedWheelCount ?? 0,
          traction: debug?.groundedTraction ?? 0,
          compression: debug?.averageSuspensionCompression ?? 0,
          verticalVelocity: Math.abs(debug?.verticalVelocity ?? state.velocity.y ?? 0),
          lateralSpeed: Math.abs(debug?.lateralSpeed ?? 0),
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

    const movedVehicle = await page.evaluate(
      ({ x, y, z }) => {
        return window.__KINEMA__.forceVehicleTransform("car-1", { x, y, z }, 0);
      },
      {
        x: target.position.x,
        y: currentCar.position.y,
        z: target.position.z + 5.8,
      },
    );
    expect(movedVehicle).toBe(true);
    await page.waitForTimeout(180);

    const launchedVehicle = await page.evaluate(() => {
      return window.__KINEMA__.forceVehicleVelocity("car-1", { x: 0, y: 0, z: -14.5 });
    });
    expect(launchedVehicle).toBe(true);
    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveY: 1, sprint: true }, 420));

    await page.waitForFunction(
      ({ name, startX, startZ }) => {
        const body = window.__KINEMA__.getDynamicBodyState(name);
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
    const postImpactSpeed = Math.abs(afterImpactCar.debug?.forwardSpeed ?? 99);
    expect(postImpactSpeed).toBeLessThan(24);
    expect(afterImpactCar.debug?.groundedWheelCount ?? 0).toBeGreaterThanOrEqual(2);

    await page.waitForFunction(
      ({ name, startX, startZ }) => {
        const body = window.__KINEMA__.getDynamicBodyState(name);
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
        const car = window.__KINEMA__.getVehicleState("car-1");
        if (!car?.active) return false;
        const grounded = car.debug?.groundedWheelCount ?? 0;
        const verticalVelocity = Math.abs(car.debug?.verticalVelocity ?? car.velocity.y ?? 0);
        const settledSpeed = Math.hypot(car.velocity.x, car.velocity.z);
        const traction = car.debug?.groundedTraction ?? 0;
        return grounded >= 2 && traction > 0.35 && verticalVelocity < 1.2 && settledSpeed > 0.05;
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
    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveY: 0.7, moveX: 1 }, 180));
    await page.waitForFunction(
      (startX) => {
        const car = window.__KINEMA__.getVehicleState("car-1");
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
    const movedVehicleAgain = await page.evaluate(
      ({ x, y, z }) => {
        return window.__KINEMA__.forceVehicleTransform("car-1", { x, y, z }, 0);
      },
      {
        x: secondTarget.position.x,
        y: beforeSecondImpactCar.position.y,
        z: secondTarget.position.z + 5.4,
      },
    );
    expect(movedVehicleAgain).toBe(true);
    await page.waitForTimeout(180);

    const relaunchedVehicle = await page.evaluate(() => {
      return window.__KINEMA__.forceVehicleVelocity("car-1", { x: 0, y: 0, z: -13.8 });
    });
    expect(relaunchedVehicle).toBe(true);
    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveY: 1, sprint: true }, 260));

    await page.waitForFunction(
      ({ name, startX, startZ }) => {
        const body = window.__KINEMA__.getDynamicBodyState(name);
        if (!body) return false;
        return Math.hypot(body.position.x - startX, body.position.z - startZ) > 0.18;
      },
      { name: secondTargetName, startX: secondTarget.position.x, startZ: secondTarget.position.z },
      { timeout: 20_000 },
    );

    const secondTurnStart = await getVehicleState(page, "car-1");
    expect(secondTurnStart.active).toBe(true);
    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveY: 0.65, moveX: -1 }, 180));
    await page.waitForFunction(
      (startX) => {
        const car = window.__KINEMA__.getVehicleState("car-1");
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
    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveY: 0.7, moveX: -1 }, 180));
    await page.waitForFunction(
      ({ startX, startYaw }) => {
        const car = window.__KINEMA__.getVehicleState("car-1");
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
      Math.abs(endLeft.position.x - startLeft.position.x) > 0.12 ||
        Math.abs(endLeft.debug?.lateralSpeed ?? 0) > 0.55 ||
        shortestAngleDelta(startLeft.debug?.headingYaw ?? 0, endLeft.debug?.headingYaw ?? 0) < -0.08,
    ).toBe(true);

    await page.evaluate(() => window.__KINEMA__.resetVehicle("car-1"));
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__KINEMA__.enterVehicle("car-1"));
    await page.waitForFunction(() => window.__KINEMA__.getVehicleState("car-1")?.active === true, undefined, {
      timeout: 10_000,
    });

    const startRight = await getVehicleState(page, "car-1");
    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveY: 0.7, moveX: 1 }, 180));
    await page.waitForFunction(
      ({ startX, startYaw }) => {
        const car = window.__KINEMA__.getVehicleState("car-1");
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
      Math.abs(endRight.position.x - startRight.position.x) > 0.12 ||
        Math.abs(endRight.debug?.lateralSpeed ?? 0) > 0.55 ||
        shortestAngleDelta(startRight.debug?.headingYaw ?? 0, endRight.debug?.headingYaw ?? 0) > 0.08,
    ).toBe(true);
  });

  test("vehicle exit clears active state and player regains grounded control", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "car-1");
    await page.evaluate(() => {
      window.__KINEMA__.clearInteractionEvents();
      window.__KINEMA__.simulateVehicleInput({ moveY: 1, sprint: true }, 24);
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__KINEMA__
            .getInteractionEvents()
            .some((event) => event.type === "vehicle:boostChanged" && event.active),
        ),
      )
      .toBe(true);
    await exitActiveVehicle(page);
    const boostEdges = await page.evaluate(() =>
      window.__KINEMA__
        .getInteractionEvents()
        .filter((event) => event.type === "vehicle:boostChanged")
        .map((event) => (event.type === "vehicle:boostChanged" ? event.active : null)),
    );
    expect(boostEdges).toEqual([true, false]);

    const grounded = await page.evaluate(() => window.__KINEMA__.waitFor("p.isGrounded === true", 10_000));
    expect(grounded).toBe(true);

    const moved = await page.evaluate(async () => {
      const k = window.__KINEMA__;
      const before = k.player.position;
      k.simulateMove(0, 1, 180);
      const ok = await k.waitFor(
        `Math.hypot(p.x - ${before.x}, p.z - ${before.z}) > 0.14 && Math.hypot(p.vx, p.vz) > 0.2`,
        12_000,
      );
      const after = k.player.position;
      return {
        ok,
        delta: Math.hypot(after.x - before.x, after.z - before.z),
      };
    });

    expect(moved.ok).toBe(true);
    expect(moved.delta).toBeGreaterThan(0.14);
  });

  test("car exits wall-flush placements into capsule-clear space 20 times", async ({ page }) => {
    await waitForFullVehiclesReady(page);
    const spawn = await getVehicleState(page, "car-1");

    for (let attempt = 0; attempt < 20; attempt++) {
      const wallX = attempt % 2 === 0 ? -28.1 : 28.1;
      const forced = await page.evaluate(
        ({ x, y, z }) => window.__KINEMA__.forceVehicleTransform("car-1", { x, y, z }, 0),
        { x: wallX, y: spawn.position.y, z: spawn.position.z },
      );
      expect(forced).toBe(true);
      await enterVehicle(page, "car-1");
      await exitActiveVehicle(page);
      const player = await page.evaluate(() => window.__KINEMA__.player);

      expect(Number.isFinite(player.position.x)).toBe(true);
      const distanceFromInnerWallPlane = Math.abs(Math.abs(player.position.x) - 29.5);
      expect(distanceFromInnerWallPlane).toBeGreaterThan(0.3);
      await page.evaluate(() => window.__KINEMA__.resetVehicle("car-1"));
      await page.waitForFunction(() => window.__KINEMA__.player.isGrounded, undefined, { timeout: 10_000 });
    }
  });

  test("holding keyboard crouch resets a flipped car upright within three seconds", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await page.evaluate(() => window.__KINEMA__.setGraphicsProfile("performance"));
    const spawn = await getVehicleState(page, "car-1");
    const forced = await page.evaluate(
      ({ x, y, z }) =>
        window.__KINEMA__.forceVehicleTransform("car-1", { x: x + 3, y: y + 0.58, z }, 0, {
          x: 1,
          y: 0,
          z: 0,
          w: 0,
        }),
      spawn.position,
    );
    expect(forced).toBe(true);
    await enterVehicle(page, "car-1");

    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ crouch: true }, 1000));
    await expect(page.locator("#hud-hold")).toHaveClass(/is-visible/, { timeout: 10_000 });
    await expect(page.locator("#hud-hold .hud-hold-key")).toHaveText("C");
    await expect(page.locator("#hud-status-lane")).toContainText("Vehicle reset", { timeout: 20_000 });

    const reset = await getVehicleState(page, "car-1");
    const upY = 1 - 2 * (reset.rotation.x * reset.rotation.x + reset.rotation.z * reset.rotation.z);
    expect(upY).toBeGreaterThan(0.9);
    expect(reset.active).toBe(true);
    expect(
      Math.hypot(
        reset.position.x - spawn.position.x,
        reset.position.y - spawn.position.y,
        reset.position.z - spawn.position.z,
      ),
    ).toBeLessThan(0.8);
    await page.evaluate(() => window.__KINEMA__.clearSimulatedInput());
  });

  test("gamepad B drives the reset hold ring and cancels on release", async ({ page }) => {
    await page.addInitScript(() => {
      const state = { active: false };
      Object.defineProperty(window, "__KINEMA_RESET_TEST_GAMEPAD__", { value: state, configurable: true });
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [
          {
            axes: [0, 0, 0, 0],
            buttons: Array.from({ length: 16 }, (_, index) => ({
              pressed: state.active && index === 1,
              touched: state.active && index === 1,
              value: state.active && index === 1 ? 1 : 0,
            })),
            connected: true,
            id: "Kinema reset test pad",
            index: 0,
            mapping: "standard",
            timestamp: 0,
          },
        ],
      });
    });
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "car-1");

    await page.evaluate(() => {
      (
        window as unknown as { __KINEMA_RESET_TEST_GAMEPAD__: { active: boolean } }
      ).__KINEMA_RESET_TEST_GAMEPAD__.active = true;
    });
    await expect(page.locator("#hud-hold")).toHaveClass(/is-visible/, { timeout: 5_000 });
    await expect(page.locator("#hud-hold .hud-hold-key")).toHaveText("B");

    await page.evaluate(() => {
      (
        window as unknown as { __KINEMA_RESET_TEST_GAMEPAD__: { active: boolean } }
      ).__KINEMA_RESET_TEST_GAMEPAD__.active = false;
    });
    await expect(page.locator("#hud-hold")).not.toHaveClass(/is-visible/, { timeout: 5_000 });
  });

  test("drone entry activates drone and forward input produces motion", async ({ page }) => {
    await waitForVehiclesStationReady(page);
    await enterVehicle(page, "drone-1");

    const before = await getVehicleState(page, "drone-1");
    await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ moveY: 1, sprint: true }, 90));

    await page.waitForFunction(
      (start) => {
        const s = window.__KINEMA__.getVehicleState("drone-1");
        if (!s) return false;
        const horizontalSpeed = Math.hypot(s.velocity.x, s.velocity.z);
        const horizontalDistance = Math.hypot(s.position.x - start.position.x, s.position.z - start.position.z);
        return horizontalSpeed > 0.2 && horizontalDistance > 0.05;
      },
      before,
      { timeout: 10_000 },
    );

    const after = await getVehicleState(page, "drone-1");
    const moved = Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z);
    const speed = Math.hypot(after.velocity.x, after.velocity.z);
    expect(after.active).toBe(true);
    expect(speed).toBeGreaterThan(0.2);
    expect(moved).toBeGreaterThan(0.05);
  });
});
