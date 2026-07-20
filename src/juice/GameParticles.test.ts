import type { VehicleHandlingFeelState } from "@vehicle/VehicleController";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameParticles } from "./GameParticles";

function installCanvasShim(): void {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop: vi.fn() }),
          fillStyle: "",
          fillRect: vi.fn(),
        }),
      }),
    },
  });
}

function handling(overrides: Partial<VehicleHandlingFeelState> = {}): VehicleHandlingFeelState {
  return {
    speedNorm: 0.8,
    forwardSpeed: 12,
    lateralSpeed: 0,
    slipAngle: 0,
    slipRatio: 0,
    slipSign: 0,
    driftAmount: 0,
    driftState: "none",
    handbrake: false,
    grounded: true,
    groundedWheelCount: 2,
    wheelContactPositions: [new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0, -1), null, null],
    ...overrides,
  };
}

describe("GameParticles vehicle motion pools", () => {
  beforeEach(() => installCanvasShim());

  it("emits nothing for stationary or airborne handling states", () => {
    const particles = new GameParticles(new THREE.Scene());

    particles.updateVehicleMotion(handling({ speedNorm: 0 }), false, 1, 1);
    particles.updateVehicleMotion(handling({ grounded: false }), true, 1, 1);

    expect(particles.getDebugState().vehicle.emitted).toEqual({ dust: 0, skid: 0, boost: 0 });
  });

  it("separates grounded dust, skid smoke, and additive boost trail emissions", () => {
    const particles = new GameParticles(new THREE.Scene());

    particles.updateVehicleMotion(handling(), false, 1, 1);
    const afterDust = particles.getDebugState();
    expect(afterDust.vehicle.emitted.dust).toBeGreaterThan(0);
    expect(afterDust.vehicle.emitted.skid).toBe(0);
    expect(afterDust.vehicle.emitted.boost).toBe(0);

    particles.updateVehicleMotion(handling({ driftAmount: 0.9, driftState: "drift", handbrake: true }), true, 1, 1);
    const afterDriftBoost = particles.getDebugState();
    expect(afterDriftBoost.vehicle.emitted.skid).toBeGreaterThan(0);
    expect(afterDriftBoost.vehicle.emitted.boost).toBeGreaterThan(0);
    expect(afterDriftBoost.vehicle.active.dust).toBeGreaterThan(0);
    expect(afterDriftBoost.vehicle.active.skid).toBeGreaterThan(0);
    expect(afterDriftBoost.vehicle.active.boost).toBeGreaterThan(0);
  });

  it("reduces only sustained vehicle emission with the profile density", () => {
    const cinematic = new GameParticles(new THREE.Scene());
    const performance = new GameParticles(new THREE.Scene());

    cinematic.updateVehicleMotion(handling({ driftAmount: 0.8, handbrake: true }), true, 1, 1);
    performance.updateVehicleMotion(handling({ driftAmount: 0.8, handbrake: true }), true, 1, 0.35);
    cinematic.jumpPuff(new THREE.Vector3());
    performance.jumpPuff(new THREE.Vector3());

    const cinematicState = cinematic.getDebugState();
    const performanceState = performance.getDebugState();
    expect(performanceState.vehicle.emitted.dust).toBeLessThan(cinematicState.vehicle.emitted.dust);
    expect(performanceState.vehicle.emitted.skid).toBeLessThan(cinematicState.vehicle.emitted.skid);
    expect(performanceState.vehicle.emitted.boost).toBeLessThan(cinematicState.vehicle.emitted.boost);
    expect(performanceState.gameplayActive).toBe(cinematicState.gameplayActive);
    expect(performanceState.gameplayActive).toBe(6);
  });
});
