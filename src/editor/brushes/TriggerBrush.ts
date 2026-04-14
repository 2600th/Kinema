import * as THREE from "three";
import { type BrushDefinition, type BrushParams, computeRectFootprint, MIN_BRUSH_DIMENSION } from "./Brush";

export const TriggerBrush: BrushDefinition = {
  id: "trigger",
  label: "Trigger",
  shortcut: "8",
  // Dashed box icon — trigger zone
  icon: "M4 4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 8v4M20 8v4",
  defaultParams: { current: new THREE.Vector3(3, 0, 3), height: 2.5 },

  buildPreviewGeometry(params: BrushParams): THREE.BufferGeometry {
    const { width, depth } = computeRectFootprint(params.anchor, params.current);
    const h = Math.max(MIN_BRUSH_DIMENSION, Math.abs(params.height));
    // Standard BoxGeometry — wireframe/edges rendering handled at placement time
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
      color: 0xffff00,
      roughness: 0.5,
      metalness: 0,
      transparent: true,
      opacity: 0.25,
    });
  },
};
