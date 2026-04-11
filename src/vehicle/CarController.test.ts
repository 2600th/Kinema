import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  canCarJump,
  computeCarContactPushImpulse,
  computeCarDriveSpeedDelta,
  computeCarLateralGripDelta,
  computeCarYawDirectionSign,
  computeCarYawAssistAuthority,
  deriveCarRideGeometry,
  isCarWheelQueryCandidate,
  isCarWheelSupportingContact,
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
    it('rejects sensors, excluded bodies, throwables, other vehicles, and shoveable dynamic props', () => {
      expect(isCarWheelQueryCandidate(true, null, null, false)).toBe(false);
      expect(isCarWheelQueryCandidate(false, null, null, true)).toBe(false);
      expect(isCarWheelQueryCandidate(false, 'player', RAPIER.RigidBodyType.Dynamic, false)).toBe(false);
      expect(isCarWheelQueryCandidate(false, 'throwable', RAPIER.RigidBodyType.Dynamic, false)).toBe(false);
      expect(isCarWheelQueryCandidate(false, 'vehicle', RAPIER.RigidBodyType.Dynamic, false)).toBe(false);
      expect(isCarWheelQueryCandidate(false, 'showcase-prop', RAPIER.RigidBodyType.Dynamic, false)).toBe(false);
    });

    it('keeps world and platform bodies eligible for wheel support', () => {
      expect(isCarWheelQueryCandidate(false, null, RAPIER.RigidBodyType.Fixed, false)).toBe(true);
      expect(isCarWheelQueryCandidate(false, 'moving-platform', RAPIER.RigidBodyType.KinematicPositionBased, false)).toBe(true);
      expect(isCarWheelQueryCandidate(false, 'floating-platform', RAPIER.RigidBodyType.Dynamic, false)).toBe(true);
    });
  });

  describe('wheel support classification', () => {
    it('rejects wall-like or zero-force contacts from grounded support', () => {
      expect(isCarWheelSupportingContact(false, 1, 30)).toBe(false);
      expect(isCarWheelSupportingContact(true, 0.18, 24)).toBe(false);
      expect(isCarWheelSupportingContact(true, 0.92, 0.4)).toBe(false);
    });

    it('accepts upward contacts that are carrying real suspension load', () => {
      expect(isCarWheelSupportingContact(true, 0.85, 9)).toBe(true);
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

  describe('arcade traction helpers', () => {
    it('applies coast drag when throttle is released', () => {
      const slowing = computeCarDriveSpeedDelta(0, 8, true, false, 1 / 60);
      const stoppingReverse = computeCarDriveSpeedDelta(0, -6, true, false, 1 / 60);

      expect(slowing).toBeLessThan(0);
      expect(stoppingReverse).toBeGreaterThan(0);
    });

    it('accelerates forward on the ground and brakes before reversing', () => {
      const launch = computeCarDriveSpeedDelta(1, 0, true, false, 1 / 60);
      const boost = computeCarDriveSpeedDelta(1, 12, true, true, 1 / 60);
      const brakeToReverse = computeCarDriveSpeedDelta(-1, 7, true, false, 1 / 60);

      expect(launch).toBeGreaterThan(0);
      expect(boost).toBeGreaterThan(launch);
      expect(brakeToReverse).toBeLessThan(0);
    });

    it('keeps less grip while handbraking or airborne', () => {
      const grounded = Math.abs(computeCarLateralGripDelta(5, true, false, 1 / 60));
      const handbrake = Math.abs(computeCarLateralGripDelta(5, true, true, 1 / 60));
      const airborne = Math.abs(computeCarLateralGripDelta(5, false, false, 1 / 60));

      expect(grounded).toBeGreaterThan(handbrake);
      expect(handbrake).toBeGreaterThan(airborne);
    });

    it('drops yaw assist when either axle has lost support', () => {
      expect(computeCarYawAssistAuthority(4, 2, 2)).toBe(1);
      expect(computeCarYawAssistAuthority(3, 1, 2)).toBe(1);
      expect(computeCarYawAssistAuthority(2, 1, 1)).toBe(0.45);
      expect(computeCarYawAssistAuthority(2, 2, 0)).toBe(0);
      expect(computeCarYawAssistAuthority(2, 0, 2)).toBe(0);
      expect(computeCarYawAssistAuthority(1, 1, 0)).toBe(0);
    });

    it('matches yaw direction to steering input for forward and reverse travel', () => {
      expect(computeCarYawDirectionSign(1, 8)).toBe(-1);
      expect(computeCarYawDirectionSign(-1, 8)).toBe(1);
      expect(computeCarYawDirectionSign(1, -4)).toBe(1);
      expect(computeCarYawDirectionSign(-1, -4)).toBe(-1);
      expect(computeCarYawDirectionSign(0, 8)).toBe(0);
      expect(computeCarYawDirectionSign(1, 0)).toBe(0);
    });

    it('transfers sustained drive into a capped contact push impulse', () => {
      const none = computeCarContactPushImpulse(0, 0.1, 5, 1 / 60);
      const sustained = computeCarContactPushImpulse(1.3, 0.05, 6, 1 / 60);
      const burst = computeCarContactPushImpulse(2.2, 12, 9, 1 / 60);

      expect(none).toBe(0);
      expect(sustained).toBeGreaterThan(0.4);
      expect(burst).toBeGreaterThan(sustained);
      expect(burst).toBe(2.35);
    });
  });
});
