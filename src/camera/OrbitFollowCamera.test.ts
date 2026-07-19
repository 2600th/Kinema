import type { PlayerController } from "@character/PlayerController";
import { EventBus } from "@core/EventBus";
import { type InputState, NULL_INPUT } from "@core/types";
import type RAPIER from "@dimforge/rapier3d-compat";
import { FOVPunch } from "@juice/FOVPunch";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type { VehicleHandlingFeelState } from "@vehicle/VehicleController";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { OrbitFollowCamera } from "./OrbitFollowCamera";

interface CameraInternals {
  landingDip: number;
  landingDipVelocity: number;
  lookAheadOffset: THREE.Vector3;
  lateralDriftCurrent: number;
  driftLateralCurrent: number;
  pivotPosition: THREE.Vector3;
  currentDistance: number;
  screenShake: { getTrauma(): number };
}

interface PunchInternals {
  currentPunch: number;
  velocity: number;
}

interface TestHarness {
  camera: THREE.PerspectiveCamera;
  follow: OrbitFollowCamera;
  eventBus: EventBus;
  target: THREE.Object3D;
  velocity: { x: number; y: number; z: number };
}

const VEHICLE_DRIFT: VehicleHandlingFeelState = {
  speedNorm: 0.6,
  forwardSpeed: 8,
  lateralSpeed: 3,
  slipAngle: 0.4,
  slipRatio: 0.5,
  slipSign: 1,
  driftAmount: 0.4,
  driftState: "drift",
  handbrake: true,
  grounded: true,
  groundedWheelCount: 4,
};

function internals(follow: OrbitFollowCamera): CameraInternals {
  return follow as unknown as CameraInternals;
}

function punchInternals(punch: FOVPunch): PunchInternals {
  return punch as unknown as PunchInternals;
}

function makeHarness(options?: {
  velocity?: Partial<{ x: number; y: number; z: number }>;
  input?: Partial<InputState>;
}): TestHarness {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const velocity = { x: 0, y: 0, z: 0, ...options?.velocity };
  const body = { linvel: () => velocity } as unknown as RAPIER.RigidBody;
  const input = { ...NULL_INPUT, ...options?.input };
  const player = {
    body,
    carriedBody: null,
    getCameraHeightOffset: () => 0,
    isRopeAttached: false,
    lastInputSnapshot: input,
    renderPosition: new THREE.Vector3(),
  } as unknown as PlayerController;
  const physicsWorld = {
    castRay: () => null,
    castShape: () => null,
  } as unknown as PhysicsWorld;
  const eventBus = new EventBus();
  const target = new THREE.Object3D();
  const follow = new OrbitFollowCamera(camera, player, physicsWorld, eventBus);
  follow.setCollisionEnabled(false);
  follow.setTarget(target, { body, heightOffset: 0, inputProvider: () => input });
  follow.snapToTarget();
  return { camera, follow, eventBus, target, velocity };
}

function configureEveryEffect(harness: TestHarness): FOVPunch {
  harness.eventBus.emit("player:landed", { impactSpeed: 2 });
  harness.follow.setVehicleSpeedRatio(0.6);
  harness.follow.setVehicleHandlingFeel(VEHICLE_DRIFT);
  harness.follow.addTrauma(0.8);
  const punch = new FOVPunch();
  punch.punch(4);
  harness.follow.setFOVPunch(punch);
  return punch;
}

function expectVectorClose(actual: THREE.Vector3, expected: THREE.Vector3): void {
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBeCloseTo(expected.y, 12);
  expect(actual.z).toBeCloseTo(expected.z, 12);
}

describe("OrbitFollowCamera effects intensity", () => {
  it("defaults to exact legacy output and clamps finite setter endpoints", () => {
    const makeActive = () => {
      const harness = makeHarness({
        velocity: { z: 7 },
        input: { forward: true, moveX: 0.5, sprint: true },
      });
      configureEveryEffect(harness);
      return harness;
    };
    const defaultIntensity = makeActive();
    const explicitOne = makeActive();
    const aboveRange = makeActive();
    const explicitZero = makeActive();
    const belowRange = makeActive();
    explicitOne.follow.setEffectsIntensity(1);
    aboveRange.follow.setEffectsIntensity(20);
    explicitZero.follow.setEffectsIntensity(0);
    belowRange.follow.setEffectsIntensity(-20);

    for (const harness of [defaultIntensity, explicitOne, aboveRange, explicitZero, belowRange]) {
      harness.follow.update(0.02, 0);
    }

    expect(explicitOne.camera.position.toArray()).toEqual(defaultIntensity.camera.position.toArray());
    expect(explicitOne.camera.quaternion.toArray()).toEqual(defaultIntensity.camera.quaternion.toArray());
    expect(explicitOne.camera.fov).toBe(defaultIntensity.camera.fov);
    expect(aboveRange.camera.position.toArray()).toEqual(explicitOne.camera.position.toArray());
    expect(aboveRange.camera.quaternion.toArray()).toEqual(explicitOne.camera.quaternion.toArray());
    expect(aboveRange.camera.fov).toBe(explicitOne.camera.fov);
    expect(belowRange.camera.position.toArray()).toEqual(explicitZero.camera.position.toArray());
    expect(belowRange.camera.quaternion.toArray()).toEqual(explicitZero.camera.quaternion.toArray());
    expect(belowRange.camera.fov).toBe(explicitZero.camera.fov);

    const nonFinite = makeActive();
    nonFinite.follow.setEffectsIntensity(0);
    nonFinite.follow.setEffectsIntensity(Number.NaN);
    nonFinite.follow.update(0.02, 0);
    expect(nonFinite.camera.position.toArray()).toEqual(explicitZero.camera.position.toArray());
    expect(nonFinite.camera.quaternion.toArray()).toEqual(explicitZero.camera.quaternion.toArray());
    expect(nonFinite.camera.fov).toBe(explicitZero.camera.fov);
  });

  it("matches the legacy pivot, distance, and FOV formulas at intensity one", () => {
    const dt = 0.02;
    const harness = makeHarness({
      velocity: { z: 7 },
      input: { forward: true, moveX: 0.5, sprint: true },
    });
    configureEveryEffect(harness);
    harness.follow.setEffectsIntensity(1);
    harness.follow.update(dt, 0);

    const landingVelocity = -0.36 + (0 - 22 * -0.36) * dt;
    const landingDip = landingVelocity * dt;
    const lookAhead = 0.5 * 1.9 * (1 - Math.exp(-4 * dt));
    const playerLateral = THREE.MathUtils.damp(0, 0.5 * 0.22, 5, dt);
    const driftTarget = -1 * 0.4 * 0.22 * 3.8;
    const vehicleLateral = THREE.MathUtils.damp(0, driftTarget, 4.5, dt);
    expect(internals(harness.follow).lateralDriftCurrent).toBe(playerLateral);
    expect(internals(harness.follow).driftLateralCurrent).toBe(vehicleLateral);
    expectVectorClose(
      internals(harness.follow).pivotPosition,
      new THREE.Vector3(playerLateral + vehicleLateral, landingDip, lookAhead),
    );

    const desiredDistance = 5 + 0.6 * 3 + 0.4 * 0.9;
    const expectedDistance = 5 + (desiredDistance - 5) * (1 - Math.exp(-4 * dt));
    expect(internals(harness.follow).currentDistance).toBe(expectedDistance);

    const punchVelocity = 4 * 30 + -12 * (4 * 30) * dt;
    const punchFov = punchVelocity * dt;
    const locomotionFov = Math.min(12, 0.5 * 0.5 * 6 + 8);
    const targetFov = 60 + locomotionFov + 0.6 * 15 + 0.4 * 4.5 + punchFov;
    const expectedFov = 60 + (targetFov - 60) * (1 - Math.exp(-12 * dt));
    expect(harness.camera.fov).toBe(expectedFov);
  });

  it("linearly scales every named positional, distance, and FOV contribution", () => {
    const makeActive = (intensity: number) => {
      const harness = makeHarness({
        velocity: { z: 7 },
        input: { forward: true, moveX: 0.5, sprint: true },
      });
      configureEveryEffect(harness);
      harness.follow.setEffectsIntensity(intensity);
      harness.follow.update(0.02, 0);
      return harness;
    };
    const zero = makeActive(0);
    const half = makeActive(0.5);
    const one = makeActive(1);
    const zeroState = internals(zero.follow);
    const halfState = internals(half.follow);
    const oneState = internals(one.follow);

    expectVectorClose(zeroState.pivotPosition, new THREE.Vector3());
    expectVectorClose(halfState.pivotPosition, oneState.pivotPosition.clone().multiplyScalar(0.5));
    expect(zeroState.landingDip).toBe(oneState.landingDip);
    expect(zeroState.landingDipVelocity).toBe(oneState.landingDipVelocity);
    expect(zeroState.lookAheadOffset.toArray()).toEqual(oneState.lookAheadOffset.toArray());
    expect(zeroState.lateralDriftCurrent).toBe(oneState.lateralDriftCurrent);
    expect(zeroState.driftLateralCurrent).toBe(oneState.driftLateralCurrent);
    expect(halfState.currentDistance - zeroState.currentDistance).toBeCloseTo(
      (oneState.currentDistance - zeroState.currentDistance) * 0.5,
      12,
    );
    expect(half.camera.fov - zero.camera.fov).toBeCloseTo((one.camera.fov - zero.camera.fov) * 0.5, 12);
  });

  it("keeps all effect state advancing while zero output remains stable", () => {
    const harness = makeHarness({
      velocity: { z: 7 },
      input: { forward: true, moveX: 0.5, sprint: true },
    });
    const punch = configureEveryEffect(harness);
    harness.follow.setEffectsIntensity(0);
    const state = internals(harness.follow);
    const initialTrauma = state.screenShake.getTrauma();
    const initialPosition = harness.camera.position.toArray();
    const initialQuaternion = harness.camera.quaternion.toArray();

    harness.follow.update(0.02, 0);

    expectVectorClose(state.pivotPosition, new THREE.Vector3());
    expect(state.currentDistance).toBe(5);
    expect(harness.camera.fov).toBe(60);
    expect(harness.camera.position.toArray()).toEqual(initialPosition);
    expect(harness.camera.quaternion.toArray()).toEqual(initialQuaternion);
    expect(state.landingDip).not.toBe(0);
    expect(state.landingDipVelocity).not.toBe(-0.36);
    expect(state.lookAheadOffset.length()).toBeGreaterThan(0);
    expect(state.lateralDriftCurrent).not.toBe(0);
    expect(state.driftLateralCurrent).not.toBe(0);
    expect(punchInternals(punch).currentPunch).not.toBe(0);
    expect(punchInternals(punch).velocity).not.toBe(4 * 30);
    expect(state.screenShake.getTrauma()).toBeLessThan(initialTrauma);
  });

  it("advances FOV punch and base-FOV damping through the zero-intensity consumer", () => {
    const harness = makeHarness();
    const punch = new FOVPunch();
    punch.punch(4);
    harness.follow.setFOVPunch(punch);
    harness.follow.setEffectsIntensity(0);
    harness.camera.fov = 80;

    harness.follow.update(0.02, 0);

    expect(punchInternals(punch).currentPunch).toBe(1.824);
    expect(harness.camera.fov).toBe(80 + (60 - 80) * (1 - Math.exp(-12 * 0.02)));
  });

  it("keeps ordinary target follow, target height, zoom, and manual orbit active at zero", () => {
    const harness = makeHarness();
    harness.follow.setEffectsIntensity(0);
    harness.target.position.set(3, 2, -1);
    harness.follow.handleZoomInput(500);
    harness.follow.handleMouseInput(100, -50);

    harness.follow.update(0.1, 0);

    expect(internals(harness.follow).pivotPosition.x).toBeGreaterThan(0);
    expect(internals(harness.follow).pivotPosition.y).toBeGreaterThan(0);
    expect(internals(harness.follow).currentDistance).toBeGreaterThan(5);
    expect(harness.follow.getYaw()).not.toBe(0);
  });

  it("preserves the selected intensity across snap, reset, and config transitions", () => {
    const harness = makeHarness({ velocity: { z: 7 }, input: { moveX: 0.5 } });
    harness.follow.setEffectsIntensity(0);
    harness.follow.applyCameraConfig({ lookAhead: 0.8 });
    harness.follow.resetCameraConfig();
    harness.follow.resetTarget();
    const body = { linvel: () => harness.velocity } as unknown as RAPIER.RigidBody;
    harness.follow.setTarget(harness.target, {
      body,
      heightOffset: 0,
      inputProvider: () => ({ ...NULL_INPUT, moveX: 0.5 }),
    });
    harness.follow.snapToTarget();
    configureEveryEffect(harness);

    harness.follow.update(0.02, 0);

    expectVectorClose(internals(harness.follow).pivotPosition, new THREE.Vector3());
    expect(internals(harness.follow).currentDistance).toBe(5);
    expect(harness.camera.fov).toBe(60);
  });
});
