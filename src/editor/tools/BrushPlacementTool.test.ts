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
    const onFinished = vi.fn();
    const onBrushChanged = vi.fn();
    const onError = vi.fn();
    const tool = new BrushPlacementTool({ onFinished, onBrushChanged, onError });
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
    const preview = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const scene = new THREE.Scene();
    scene.add(preview);
    internals.previewMesh = preview;

    (context as unknown as { scene: THREE.Scene }).scene = scene;
    expect(() => tool.onPointerDown(context, { button: 0 } as MouseEvent)).not.toThrow();
    expect(createRigidBody).not.toHaveBeenCalled();
    expect(brokenGeometry.dispose).toBeDefined();
    expect(scene.children).not.toContain(preview);
    expect(onFinished).toHaveBeenCalledOnce();
    expect(onBrushChanged).toHaveBeenLastCalledWith(null);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/could not be placed/i));
    expect(internals.activeBrush).toBeNull();
    expect(internals.placementPhase).toBe("idle");
  });

  it.each([
    "collider",
    "history",
  ] as const)("releases final resources, physics, and tool state when %s publication fails", (failure) => {
    const body = { id: "body" };
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const removeBody = vi.fn();
    const historyPush = vi.fn(() => {
      if (failure === "history") throw new Error("forced history failure");
    });
    const scene = new THREE.Scene();
    const preview = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(preview);
    const context = {
      scene,
      physicsWorld: {
        world: {
          createRigidBody: vi.fn(() => body),
          createCollider: vi.fn(() => {
            if (failure === "collider") throw new Error("forced collider failure");
            return { id: "collider" };
          }),
        },
        removeBody,
      },
      history: { push: historyPush },
    } as unknown as EditorToolContext;
    const brush = {
      id: "block",
      label: "Block",
      defaultParams: {},
      buildPreviewGeometry: () => geometry,
      getDefaultMaterial: () => material,
    } as unknown as BrushDefinition;
    const onFinished = vi.fn();
    const onBrushChanged = vi.fn();
    const onError = vi.fn();
    const tool = new BrushPlacementTool({ onFinished, onBrushChanged, onError });
    const internals = tool as unknown as {
      activeBrush: BrushDefinition | null;
      placementPhase: "idle" | "position";
      previewMesh: THREE.Mesh | null;
    };
    internals.activeBrush = brush;
    internals.placementPhase = "position";
    internals.previewMesh = preview;

    expect(() => tool.onPointerDown(context, { button: 0 } as MouseEvent)).not.toThrow();

    expect(removeBody).toHaveBeenCalledWith(body);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(scene.children).not.toContain(preview);
    expect(onFinished).toHaveBeenCalledOnce();
    expect(onBrushChanged).toHaveBeenLastCalledWith(null);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/could not be placed/i));
    expect(internals.activeBrush).toBeNull();
    expect(internals.placementPhase).toBe("idle");
  });
});
