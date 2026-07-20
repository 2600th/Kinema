import { EventBus } from "@core/EventBus";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { VehicleController } from "@vehicle/VehicleController";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { VehicleSeat } from "./VehicleSeat";

describe("VehicleSeat", () => {
  it("emits the current world-space seat position for transition feedback", () => {
    const eventBus = new EventBus();
    const entered = vi.fn();
    eventBus.on("vehicle:enter", entered);
    const mesh = new THREE.Group();
    mesh.position.set(10, 2, 3);
    mesh.rotation.y = Math.PI / 2;
    const vehicle = { mesh } as unknown as VehicleController;
    const offset = new THREE.Vector3(-1.5, 0.5, -1);
    const seat = new VehicleSeat("car-seat", "Drive", {} as RAPIER.Collider, vehicle, eventBus, offset);

    seat.interact({} as never);

    const expected = offset.clone().applyQuaternion(mesh.quaternion).add(mesh.position);
    expect(entered).toHaveBeenCalledTimes(1);
    expect(entered.mock.calls[0][0].vehicle).toBe(vehicle);
    expect(entered.mock.calls[0][0].position.toArray()).toEqual(expected.toArray());
  });
});
