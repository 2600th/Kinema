import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type BrushDefinition, type BrushParams, computeRectFootprint, MIN_BRUSH_DIMENSION } from './Brush';

const DEFAULT_STEP_COUNT = 8;

export const StairsBrush: BrushDefinition = {
  id: 'stairs',
  label: 'Stairs',
  shortcut: '4',
  // Staircase icon — ascending steps
  icon: 'M2 20h4v-4h4v-4h4v-4h4v-4h2v20H2z',

  buildPreviewGeometry(params: BrushParams): THREE.BufferGeometry {
    const { width, depth } = computeRectFootprint(params.anchor, params.current);
    const totalHeight = Math.max(MIN_BRUSH_DIMENSION, Math.abs(params.height));
    const stepCount = DEFAULT_STEP_COUNT;
    const stepHeight = totalHeight / stepCount;
    const stepDepth = depth / stepCount;

    const steps: THREE.BoxGeometry[] = [];
    for (let i = 0; i < stepCount; i++) {
      const h = stepHeight * (i + 1);
      const geo = new THREE.BoxGeometry(width, h, stepDepth);
      // Position each step: centered x, stacked from bottom, marching forward in z
      geo.translate(0, h / 2 - totalHeight / 2, (i + 0.5) * stepDepth - depth / 2);
      steps.push(geo);
    }

    const merged = mergeGeometries(steps, false);
    // Dispose intermediate geometries
    for (const s of steps) s.dispose();
    return merged ?? new THREE.BoxGeometry(width, totalHeight, depth);
  },

  computeTransform(params: BrushParams) {
    const { center } = computeRectFootprint(params.anchor, params.current);
    const totalHeight = Math.max(MIN_BRUSH_DIMENSION, Math.abs(params.height));
    const position = center.clone();
    position.y += totalHeight / 2;
    return {
      position,
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
    };
  },

  getDefaultMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0x909090,
      roughness: 0.7,
      metalness: 0,
    });
  },
};
