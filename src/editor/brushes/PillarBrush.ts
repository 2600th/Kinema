import * as THREE from "three";
import { type BrushDefinition, type BrushParams, computeRectFootprint, MIN_BRUSH_DIMENSION } from "./Brush";

export const PillarBrush: BrushDefinition = {
  id: "pillar",
  label: "Pillar",
  shortcut: "3",
  // Cylinder outline icon
  icon: "M6 4a6 3 0 0 1 12 0v16a6 3 0 0 1-12 0zM6 4a6 3 0 0 0 12 0",
  defaultParams: { current: new THREE.Vector3(0.5, 0, 0.5), height: 3 },

  buildPreviewGeometry(params: BrushParams): THREE.BufferGeometry {
    const { width, depth } = computeRectFootprint(params.anchor, params.current);
    const radius = Math.max(MIN_BRUSH_DIMENSION / 2, Math.min(width, depth) / 2);
    const h = Math.max(MIN_BRUSH_DIMENSION, Math.abs(params.height));
    return new THREE.CylinderGeometry(radius, radius, h, 16);
  },

  computeTransform(params: BrushParams) {
    const { center } = computeRectFootprint(params.anchor, params.current);
    const h = Math.max(MIN_BRUSH_DIMENSION, Math.abs(params.height));
    const position = center.clone();
    position.y += h / 2;
    return {
      position,
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
    };
  },

  getDefaultMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0x606060,
      roughness: 0.8,
      metalness: 0,
    });
  },
};
