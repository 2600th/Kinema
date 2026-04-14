import * as THREE from "three";
import { type BrushDefinition, type BrushParams, computeRectFootprint } from "./Brush";

const FLOOR_THICKNESS = 0.1;

export const FloorBrush: BrushDefinition = {
  id: "floor",
  label: "Floor",
  shortcut: "2",
  // Flat rectangle icon
  icon: "M2 16l10 4 10-4-10-4zM2 16v-2l10-4 10 4v2",
  defaultParams: { current: new THREE.Vector3(4, 0, 4) },

  buildPreviewGeometry(params: BrushParams): THREE.BufferGeometry {
    const { width, depth } = computeRectFootprint(params.anchor, params.current);
    return new THREE.BoxGeometry(width, FLOOR_THICKNESS, depth);
  },

  computeTransform(params: BrushParams) {
    const { center } = computeRectFootprint(params.anchor, params.current);
    const position = center.clone();
    position.y += FLOOR_THICKNESS / 2;
    return {
      position,
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
    };
  },

  getDefaultMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xa0a0a0,
      roughness: 0.6,
      metalness: 0,
    });
  },
};
