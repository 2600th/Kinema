import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  canCarJump,
  deriveCarRideGeometry,
  isCarWheelQueryCandidate,
  pickFirstClearCarExitCandidate,
  resolveCarDriveCommand,
} from './CarController';

describe('CarController helpers', () => {
  describe('canCarJump', () => {
    it('allows a jump when at least two wheels are grounded and cooldown is clear', () => {
      expect(canCarJump(2, 0, 0)).toBe(true);
      expect(canCarJump(4, 0, 0)).toBe(true);
    });

    it('allows a jump during grounded grace even after wheel contact is lost', () => {
      expect(canCarJump(1, 0.05, 0)).toBe(true);
      expect(canCarJump(0, 0.12, 0)).toBe(true);
    });

    it('blocks the jump when cooldown is active or grounded state is insufficient', () => {
      expect(canCarJump(4, 0.12, 0.2)).toBe(false);
      expect(canCarJump(1, 0, 0)).toBe(false);
      expect(canCarJump(0, 0, 0)).toBe(false);
    });
  });

  describe('resolveCarDriveCommand', () => {
    it('drives forward with engine force instead of braking', () => {
      const command = resolveCarDriveCommand(1, 0.4, 0, 0, true, false, false, 1 / 60);

      expect(command.frontEngineForce).toBeLessThan(0);
      expect(command.rearEngineForce).toBeLessThan(0);
      expect(command.frontBrake).toBe(0);
      expect(command.rearBrake).toBe(0);
      expect(command.braking).toBe(false);
      expect(command.steerAngle).not.toBe(0);
    });

    it('brakes before reversing direction when still moving forward', () => {
      const command = resolveCarDriveCommand(-1, 0, 0, 3, true, false, false, 1 / 60);

      expect(command.frontEngineForce).toBe(0);
      expect(command.rearEngineForce).toBe(0);
      expect(command.frontBrake).toBeGreaterThan(0);
      expect(command.rearBrake).toBeGreaterThan(0);
      expect(command.braking).toBe(true);
    });

    it('loosens the rear axle under handbrake without changing front grip', () => {
      const command = resolveCarDriveCommand(0.7, 0.25, 0, 8, true, true, false, 1 / 60);

      expect(command.frontBrake).toBeGreaterThan(0);
      expect(command.rearBrake).toBeGreaterThan(command.frontBrake);
      expect(command.rearFrictionSlip).toBeLessThan(command.frontFrictionSlip);
      expect(command.rearSideFriction).toBeLessThan(command.frontSideFriction);
      expect(command.braking).toBe(true);
    });

    it('reduces steering and engine authority while airborne', () => {
      const grounded = resolveCarDriveCommand(1, 1, 0, 4, true, false, false, 1 / 60);
      const airborne = resolveCarDriveCommand(1, 1, 0, 4, false, false, false, 1 / 60);

      expect(Math.abs(airborne.physicsSteerAngle)).toBeLessThan(Math.abs(grounded.physicsSteerAngle));
      expect(Math.abs(airborne.frontEngineForce)).toBeLessThan(Math.abs(grounded.frontEngineForce));
      expect(Math.abs(airborne.rearEngineForce)).toBeLessThan(Math.abs(grounded.rearEngineForce));
    });
  });

  describe('wheel query filtering', () => {
    it('rejects sensors, excluded bodies, throwables, and other vehicles', () => {
      expect(isCarWheelQueryCandidate(true, null, false)).toBe(false);
      expect(isCarWheelQueryCandidate(false, null, true)).toBe(false);
      expect(isCarWheelQueryCandidate(false, 'player', false)).toBe(false);
      expect(isCarWheelQueryCandidate(false, 'throwable', false)).toBe(false);
      expect(isCarWheelQueryCandidate(false, 'vehicle', false)).toBe(false);
    });

    it('keeps world and platform bodies eligible for wheel support', () => {
      expect(isCarWheelQueryCandidate(false, null, false)).toBe(true);
      expect(isCarWheelQueryCandidate(false, 'moving-platform', false)).toBe(true);
      expect(isCarWheelQueryCandidate(false, 'floating-platform', false)).toBe(true);
    });
  });

  describe('ride geometry', () => {
    it('preserves positive chassis clearance at nominal compression', () => {
      const ride = deriveCarRideGeometry();

      expect(ride.chassisBottomY - ride.nominalGroundPlaneY).toBeGreaterThan(0.16);
      expect(ride.spawnYOffset).toBeGreaterThan(0);
      expect(ride.wheelHardPointY).toBeGreaterThan(ride.wheelCenterYAtRest);
    });
  });

  describe('exit candidate selection', () => {
    it('picks the first non-overlapping candidate in priority order', () => {
      const candidates = [
        new THREE.Vector3(-1, 1, 0),
        new THREE.Vector3(1, 1, 0),
        new THREE.Vector3(0, 1, 2),
      ];

      const selected = pickFirstClearCarExitCandidate(
        candidates,
        (candidate) => candidate.x > 0,
      );

      expect(selected.equals(candidates[1])).toBe(true);
    });
  });
});
