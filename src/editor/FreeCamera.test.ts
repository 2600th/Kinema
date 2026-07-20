import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FreeCamera } from "./FreeCamera";

function pointerEvent(type: string, values: { button?: number; clientX?: number; clientY?: number }): Event {
  const event = new Event(type);
  Object.assign(event, values);
  return event;
}

describe("FreeCamera pose lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures cloned values and restores the exact position and quaternion", () => {
    const runtimeCamera = new THREE.PerspectiveCamera();
    runtimeCamera.position.set(3.25, -4.5, 8.75);
    runtimeCamera.quaternion.setFromEuler(new THREE.Euler(0.37, -1.18, 0, "YXZ"));
    const camera = new FreeCamera(runtimeCamera, new EventTarget() as HTMLElement);

    const pose = camera.capturePose();
    runtimeCamera.position.set(99, 99, 99);
    runtimeCamera.quaternion.identity();

    expect(pose.position).toEqual([3.25, -4.5, 8.75]);
    expect(pose.quaternion).not.toEqual(runtimeCamera.quaternion.toArray());
    camera.restorePose(pose);
    expect(runtimeCamera.position.toArray()).toEqual(pose.position);
    expect(runtimeCamera.quaternion.toArray()).toEqual(pose.quaternion);
  });

  it("round-trips one pose exactly across repeated runtime camera changes", () => {
    const runtimeCamera = new THREE.PerspectiveCamera();
    runtimeCamera.position.set(-12.5, 7.125, 0.0625);
    runtimeCamera.quaternion.setFromEuler(new THREE.Euler(-0.41, 2.27, 0, "YXZ"));
    const camera = new FreeCamera(runtimeCamera, new EventTarget() as HTMLElement);
    const pose = camera.capturePose();

    for (let cycle = 0; cycle < 5; cycle += 1) {
      runtimeCamera.position.set(cycle + 100, cycle - 50, cycle * 7);
      runtimeCamera.quaternion.setFromEuler(new THREE.Euler(cycle * 0.1, cycle * -0.2, 0, "YXZ"));
      camera.restorePose(pose);
      expect(camera.capturePose()).toEqual(pose);
    }
  });

  it("syncs orientation from an externally changed camera without cycling listeners", () => {
    const fakeWindow = new EventTarget();
    vi.stubGlobal("window", fakeWindow);
    const domElement = new EventTarget();
    const runtimeCamera = new THREE.PerspectiveCamera();
    const camera = new FreeCamera(runtimeCamera, domElement as HTMLElement);
    const windowAdd = vi.spyOn(fakeWindow, "addEventListener");
    const domAdd = vi.spyOn(domElement, "addEventListener");
    camera.enable();
    const listenerCounts = [windowAdd.mock.calls.length, domAdd.mock.calls.length];

    runtimeCamera.quaternion.setFromEuler(new THREE.Euler(0.31, -1.47, 0, "YXZ"));
    const expected = runtimeCamera.quaternion.toArray();
    camera.syncOrientationFromCamera();
    domElement.dispatchEvent(pointerEvent("mousedown", { button: 2, clientX: 40, clientY: 20 }));
    fakeWindow.dispatchEvent(pointerEvent("mousemove", { clientX: 40, clientY: 20 }));

    runtimeCamera.quaternion.toArray().forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 14);
    });
    expect([windowAdd.mock.calls.length, domAdd.mock.calls.length]).toEqual(listenerCounts);
    camera.disable();
  });
});
