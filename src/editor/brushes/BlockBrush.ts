import * as THREE from "three";
import { type BrushDefinition, type BrushParams, computeRectFootprint, MIN_BRUSH_DIMENSION } from "./Brush";

export const BlockBrush: BrushDefinition = {
  id: "block",
  label: "Block",
  shortcut: "1",
  // Simple cube outline icon
  icon: "M4 14l8 4.5 8-4.5M4 10l8 4.5 8-4.5M12 2l8 4.5v9L12 20l-8-4.5v-9z",
  defaultParams: { current: new THREE.Vector3(2, 0, 2), height: 2 },

  buildPreviewGeometry(params: BrushParams): THREE.BufferGeometry {
    const { width, depth } = computeRectFootprint(params.anchor, params.current);
    const h = Math.max(MIN_BRUSH_DIMENSION, Math.abs(params.height));
    return new THREE.BoxGeometry(width, h, depth);
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
      color: 0x808080,
      roughness: 0.7,
      metalness: 0,
    });
  },
};
