import * as THREE from 'three';
import { type BrushDefinition, type BrushParams, computeRectFootprint, MIN_BRUSH_DIMENSION } from './Brush';

export const RampBrush: BrushDefinition = {
  id: 'ramp',
  label: 'Ramp',
  shortcut: '5',
  // Wedge/ramp icon — triangle shape
  icon: 'M2 20L22 20L2 4z',
  defaultParams: { current: new THREE.Vector3(2, 0, 4), height: 2 },

  buildPreviewGeometry(params: BrushParams): THREE.BufferGeometry {
    const { width, depth } = computeRectFootprint(params.anchor, params.current);
    const height = Math.max(MIN_BRUSH_DIMENSION, Math.abs(params.height));
    const hw = width / 2;
    const hd = depth / 2;

    // Wedge prism: flat bottom, sloped top rising from front (-z) to back (+z)
    //
    //   4 -------- 5     (y = height, z = +hd)
    //  /|         /|
    // / |        / |     slope from front-bottom to back-top
    // 0 -------- 1      (y = 0, z = -hd)  front-bottom
    // 2 -------- 3      (y = 0, z = +hd)  back-bottom
    //
    // Vertices:
    //   0: -hw, 0,     -hd  (front-bottom-left)
    //   1: +hw, 0,     -hd  (front-bottom-right)
    //   2: -hw, 0,     +hd  (back-bottom-left)
    //   3: +hw, 0,     +hd  (back-bottom-right)
    //   4: -hw, height, +hd (back-top-left)
    //   5: +hw, height, +hd (back-top-right)

    const positions = new Float32Array([
      // Bottom face (y=0) — two triangles
      -hw, 0, -hd,   +hw, 0, -hd,   +hw, 0, +hd,
      -hw, 0, -hd,   +hw, 0, +hd,   -hw, 0, +hd,

      // Back face (z=+hd) — two triangles
      -hw, 0, +hd,   +hw, 0, +hd,   +hw, height, +hd,
      -hw, 0, +hd,   +hw, height, +hd,   -hw, height, +hd,

      // Slope face (from front-bottom to back-top) — two triangles
      -hw, 0, -hd,   -hw, height, +hd,   +hw, height, +hd,
      -hw, 0, -hd,   +hw, height, +hd,   +hw, 0, -hd,

      // Left face — one triangle
      -hw, 0, -hd,   -hw, 0, +hd,   -hw, height, +hd,

      // Right face — one triangle
      +hw, 0, -hd,   +hw, height, +hd,   +hw, 0, +hd,
    ]);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();

    // Center vertically so transform positions it correctly
    geometry.translate(0, -height / 2, 0);

    return geometry;
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
      color: 0x888888,
      roughness: 0.65,
      metalness: 0,
    });
  },
};
