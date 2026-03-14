import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type BrushDefinition, type BrushParams, computeRectFootprint, MIN_BRUSH_DIMENSION } from './Brush';

const FRAME_THICKNESS = 0.2;

export const DoorFrameBrush: BrushDefinition = {
  id: 'doorframe',
  label: 'Door Frame',
  shortcut: '6',
  // Door frame icon — rectangular opening with frame
  icon: 'M4 2v20h3V6h10v16h3V2zM7 6h10v16H7z',
  defaultParams: { current: new THREE.Vector3(1.4, 0, 0.3), height: 2.4 },

  buildPreviewGeometry(params: BrushParams): THREE.BufferGeometry {
    const { width, depth } = computeRectFootprint(params.anchor, params.current);
    const height = Math.max(MIN_BRUSH_DIMENSION, Math.abs(params.height));
    const frameDepth = Math.max(MIN_BRUSH_DIMENSION, depth);

    // Lintel height is the frame thickness
    const lintelHeight = FRAME_THICKNESS;
    const pillarHeight = height - lintelHeight;
    const pillarWidth = FRAME_THICKNESS;
    const openingWidth = Math.max(MIN_BRUSH_DIMENSION, width - 2 * pillarWidth);

    const parts: THREE.BoxGeometry[] = [];

    // Left pillar
    const leftPillar = new THREE.BoxGeometry(pillarWidth, pillarHeight, frameDepth);
    leftPillar.translate(-(openingWidth / 2 + pillarWidth / 2), pillarHeight / 2 - height / 2, 0);
    parts.push(leftPillar);

    // Right pillar
    const rightPillar = new THREE.BoxGeometry(pillarWidth, pillarHeight, frameDepth);
    rightPillar.translate(openingWidth / 2 + pillarWidth / 2, pillarHeight / 2 - height / 2, 0);
    parts.push(rightPillar);

    // Lintel across the top
    const lintel = new THREE.BoxGeometry(width, lintelHeight, frameDepth);
    lintel.translate(0, height / 2 - lintelHeight / 2, 0);
    parts.push(lintel);

    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return merged ?? new THREE.BoxGeometry(width, height, frameDepth);
  },

  computeTransform(params: BrushParams) {
    const { center } = computeRectFootprint(params.anchor, params.current);
    const height = Math.max(MIN_BRUSH_DIMENSION, Math.abs(params.height));
    const position = center.clone();
    position.y += height / 2;
    return {
      position,
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
    };
  },

  getDefaultMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0x707070,
      roughness: 0.75,
      metalness: 0,
    });
  },
};
