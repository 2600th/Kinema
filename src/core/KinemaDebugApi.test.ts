import { describe, expect, it } from "vitest";
import { isFixedWorldCollider } from "./KinemaDebugApi";

function collider(sensor: boolean, parentFixed: boolean | null) {
  return {
    isSensor: () => sensor,
    parent: () => (parentFixed == null ? null : { isFixed: () => parentFixed }),
  };
}

describe("isFixedWorldCollider", () => {
  it("accepts only solid standalone or fixed-parent colliders", () => {
    expect(isFixedWorldCollider(collider(false, null))).toBe(true);
    expect(isFixedWorldCollider(collider(false, true))).toBe(true);
    expect(isFixedWorldCollider(collider(false, false))).toBe(false);
    expect(isFixedWorldCollider(collider(true, true))).toBe(false);
  });
});
