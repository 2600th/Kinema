import * as THREE from "three";
import type { BrushDefinition, BrushParams } from "./Brush";

const CONE_RADIUS = 0.3;
const CONE_HEIGHT = 0.8;

export const SpawnBrush: BrushDefinition = {
  id: "spawn",
  label: "Spawn",
  shortcut: "7",
  // Arrow pointing up — spawn marker icon
  icon: "M12 2l6 10h-4v8h-4v-8H6z",

  buildPreviewGeometry(_params: BrushParams): THREE.BufferGeometry {
    // Fixed-size cone pointing up — visual gizmo only
    return new THREE.ConeGeometry(CONE_RADIUS, CONE_HEIGHT, 8);
  },

  computeTransform(params: BrushParams) {
    // Place at anchor, raised so the base sits on the ground
    const position = params.anchor.clone();
    position.y += CONE_HEIGHT / 2;
    return {
      position,
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
    };
  },

  getDefaultMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0x00ff44,
      roughness: 0.5,
      metalness: 0,
      emissive: 0x00ff44,
      emissiveIntensity: 0.3,
    });
  },
};
