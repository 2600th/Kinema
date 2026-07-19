import type { PhysicsWorld } from "@physics/PhysicsWorld";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { BrushDefinition } from "../brushes/Brush";
import { BrushPlacementTool } from "./BrushPlacementTool";
import type { EditorToolContext } from "./EditorTool";

describe("BrushPlacementTool physics ownership", () => {
  it("builds the collider descriptor before creating a rigid body", () => {
    const createRigidBody = vi.fn();
    const context = {
      physicsWorld: {
        world: { createRigidBody, createCollider: vi.fn() },
        removeBody: vi.fn(),
      } as unknown as PhysicsWorld,
      history: { push: vi.fn() },
    } as unknown as EditorToolContext;
    const tool = new BrushPlacementTool({ onFinished: vi.fn(), onBrushChanged: vi.fn() });
    const brokenGeometry = new THREE.BufferGeometry();
    brokenGeometry.computeBoundingBox = () => {
      throw new Error("forced descriptor bounding box failure");
    };
    const brush = {
      id: "pillar",
      label: "Broken pillar",
      defaultParams: {},
      buildPreviewGeometry: () => brokenGeometry,
      getDefaultMaterial: () => new THREE.MeshStandardMaterial(),
    } as unknown as BrushDefinition;
    const internals = tool as unknown as {
      activeBrush: BrushDefinition | null;
      placementPhase: "idle" | "position";
      previewMesh: THREE.Mesh | null;
    };
    internals.activeBrush = brush;
    internals.placementPhase = "position";
    internals.previewMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());

    expect(() => tool.onPointerDown(context, { button: 0 } as MouseEvent)).toThrow(/bounding box/i);
    expect(createRigidBody).not.toHaveBeenCalled();
  });
});
