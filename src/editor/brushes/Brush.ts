import type * as THREE from "three";

/** Minimum dimension for any brush axis to prevent degenerate geometry */
export const MIN_BRUSH_DIMENSION = 0.1;

export interface BrushParams {
  anchor: THREE.Vector3;
  current: THREE.Vector3;
  /** Surface normal at placement point — used by wall-aligned brushes (DoorFrame, etc.) */
  normal: THREE.Vector3;
  height: number;
}

export interface BrushDefinition {
  id: string;
  label: string;
  shortcut: string;
  icon: string; // SVG path data (d attribute value)

  /**
   * Player-appropriate default placement params.
   * Merged with generic defaults in BrushPlacementTool.
   * Player capsule: 1.4m tall, 0.6m wide — brushes should be scaled relative to this.
   */
  defaultParams?: Partial<BrushParams>;

  /** Build preview geometry from current placement params */
  buildPreviewGeometry(params: BrushParams): THREE.BufferGeometry;

  /** Compute world transform for preview/final mesh */
  computeTransform(params: BrushParams): {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
  };

  /** Get default material for this brush */
  getDefaultMaterial(): THREE.MeshStandardMaterial;
}

export function snapValue(value: number, step: number): number {
  const s = Math.max(1e-6, Math.abs(step));
  return Math.round(value / s) * s;
}

export function computeRectFootprint(
  anchor: THREE.Vector3,
  current: THREE.Vector3,
): { width: number; depth: number; center: THREE.Vector3 } {
  const diff = current.clone().sub(anchor);
  const width = Math.max(MIN_BRUSH_DIMENSION, Math.abs(diff.x));
  const depth = Math.max(MIN_BRUSH_DIMENSION, Math.abs(diff.z));
  const center = anchor.clone().add(current).multiplyScalar(0.5);
  center.y = anchor.y;
  return { width, depth, center };
}
