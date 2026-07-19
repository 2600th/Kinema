import type { PhysicsWorld } from "@physics/PhysicsWorld";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrushDefinition } from "../brushes/Brush";
import { getBrushById } from "../brushes/index";
import { BrushPlacementTool } from "./BrushPlacementTool";
import type { EditorToolContext } from "./EditorTool";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BrushPlacementTool physics ownership", () => {
  it.each(["factory", "getter", "preview-setter"] as const)(
    "resets and releases preview preparation ownership when the %s fails",
    (failure) => {
      const brush = getBrushById("block");
      if (!brush) throw new Error("Block brush fixture is missing.");
      const geometry = new THREE.BoxGeometry();
      const material = new THREE.MeshStandardMaterial();
      const geometryDispose = vi.spyOn(geometry, "dispose");
      const materialDispose = vi.spyOn(material, "dispose");
      const geometryFactory = vi.spyOn(brush, "buildPreviewGeometry");
      const materialFactory = vi.spyOn(brush, "getDefaultMaterial");
      if (failure === "factory") geometryFactory.mockImplementation(() => { throw new Error("preview factory failed"); });
      else geometryFactory.mockReturnValue(geometry);
      if (failure === "getter") materialFactory.mockImplementation(() => { throw new Error("material getter failed"); });
      else materialFactory.mockReturnValue(material);
      if (failure === "preview-setter") {
        Object.defineProperty(material, "transparent", {
          configurable: true,
          set: () => { throw new Error("preview setter failed"); },
        });
      }
      const scene = new THREE.Scene();
      const context = { scene } as unknown as EditorToolContext;
      const onFinished = vi.fn();
      const onBrushChanged = vi.fn();
      const onError = vi.fn();
      const tool = new BrushPlacementTool({ onFinished, onBrushChanged, onError });

      expect(() => tool.startBrush(context, "block")).not.toThrow();

      expect(scene.children).toHaveLength(0);
      if (failure !== "factory") expect(geometryDispose).toHaveBeenCalledOnce();
      else expect(geometryDispose).not.toHaveBeenCalled();
      if (failure === "preview-setter") expect(materialDispose).toHaveBeenCalledOnce();
      else expect(materialDispose).not.toHaveBeenCalled();
      expect(tool.getActiveBrushId()).toBeNull();
      expect(onBrushChanged).toHaveBeenLastCalledWith(null);
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/could not be prepared/i));
      expect(onFinished).toHaveBeenCalledOnce();
    },
  );

  it.each(["factory", "getter", "property"] as const)(
    "disposes preview and newly-owned final resources when the %s fails during final preparation",
    (failure) => {
      const finalGeometry = new THREE.BoxGeometry();
      const finalMaterial = new THREE.MeshStandardMaterial();
      const geometryDispose = vi.spyOn(finalGeometry, "dispose");
      const materialDispose = vi.spyOn(finalMaterial, "dispose");
      const brush = {
        id: "block",
        label: "Block",
        defaultParams: {},
        buildPreviewGeometry: vi.fn(() => {
          if (failure === "factory") throw new Error("final factory failed");
          return finalGeometry;
        }),
        getDefaultMaterial: vi.fn(() => {
          if (failure === "getter") throw new Error("final getter failed");
          return finalMaterial;
        }),
      } as unknown as BrushDefinition;
      if (failure === "property") {
        Object.defineProperty(finalMaterial, "roughness", {
          configurable: true,
          get: () => { throw new Error("final property failed"); },
        });
      }
      const previewGeometry = new THREE.BoxGeometry();
      const previewMaterial = new THREE.MeshBasicMaterial();
      const previewGeometryDispose = vi.spyOn(previewGeometry, "dispose");
      const previewMaterialDispose = vi.spyOn(previewMaterial, "dispose");
      const preview = new THREE.Mesh(previewGeometry, previewMaterial);
      const scene = new THREE.Scene();
      scene.add(preview);
      const historyPush = vi.fn();
      const context = {
        scene,
        history: { push: historyPush },
        physicsWorld: { world: { createRigidBody: vi.fn(), createCollider: vi.fn() }, removeBody: vi.fn() },
      } as unknown as EditorToolContext;
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

      expect(historyPush).not.toHaveBeenCalled();
      expect(previewGeometryDispose).toHaveBeenCalledOnce();
      expect(previewMaterialDispose).toHaveBeenCalledOnce();
      if (failure !== "factory") expect(geometryDispose).toHaveBeenCalledOnce();
      else expect(geometryDispose).not.toHaveBeenCalled();
      if (failure === "property") expect(materialDispose).toHaveBeenCalledOnce();
      else expect(materialDispose).not.toHaveBeenCalled();
      expect(scene.children).not.toContain(preview);
      expect(internals.activeBrush).toBeNull();
      expect(internals.placementPhase).toBe("idle");
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/could not be placed/i));
      expect(onFinished).toHaveBeenCalledOnce();
    },
  );

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
    const rollbackEditorObject = vi.fn();
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
      rollbackEditorObject,
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

    if (failure === "history") {
      expect(rollbackEditorObject).toHaveBeenCalledOnce();
      expect(removeBody).not.toHaveBeenCalled();
    } else {
      expect(rollbackEditorObject).not.toHaveBeenCalled();
      expect(removeBody).toHaveBeenCalledWith(body);
    }
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
