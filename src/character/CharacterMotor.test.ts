import type RAPIER from "@dimforge/rapier3d-compat";
import { describe, expect, it } from "vitest";
import { shouldApplyGroundReaction } from "./CharacterMotor";

describe("shouldApplyGroundReaction", () => {
  it("allows floating platforms to react to the player", () => {
    expect(shouldApplyGroundReaction({ userData: { kind: "floating-platform" } } as unknown as RAPIER.RigidBody)).toBe(
      true,
    );
  });

  it("still ignores throwables", () => {
    expect(shouldApplyGroundReaction({ userData: { kind: "throwable" } } as unknown as RAPIER.RigidBody)).toBe(false);
  });
});
