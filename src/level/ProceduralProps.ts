import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Stylized puffy bush — cluster of smooth icosahedrons. Astro Bot style. */
export function createBush(scale = 1.0, color = 0x4cd137): THREE.Mesh {
  const main = new THREE.IcosahedronGeometry(0.6, 2);
  main.translate(0, 0, 0);

  const secondary1 = new THREE.IcosahedronGeometry(0.45, 2);
  secondary1.translate(0.4, 0.1, 0.2);

  const secondary2 = new THREE.IcosahedronGeometry(0.45, 2);
  secondary2.translate(-0.35, 0.05, 0.25);

  const tertiary = new THREE.IcosahedronGeometry(0.35, 2);
  tertiary.translate(0.1, 0.3, -0.3);

  const merged = mergeGeometries([main, secondary1, secondary2, tertiary]);
  merged.scale(scale, scale, scale);

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.0,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Bush';
  return mesh;
}

/** Stylized low-poly tree — cylinder trunk + puffy icosahedron canopy. */
export function createTree(
  height = 3.0,
  color = 0x2ecc71,
  trunkColor = 0x8b6914,
): THREE.Mesh {
  const trunkHeight = height * 0.4;
  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.12, trunkHeight, 8);
  trunkGeo.translate(0, trunkHeight * 0.5, 0);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: trunkColor,
    roughness: 0.9,
    metalness: 0.0,
  });

  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.castShadow = true;
  trunk.receiveShadow = true;

  // Puffy canopy from merged icosahedrons
  const canopyRadius = height * 0.25;
  const c1 = new THREE.IcosahedronGeometry(canopyRadius, 2);
  c1.translate(0, 0, 0);

  const c2 = new THREE.IcosahedronGeometry(canopyRadius * 0.75, 2);
  c2.translate(canopyRadius * 0.6, canopyRadius * 0.2, 0.15);

  const c3 = new THREE.IcosahedronGeometry(canopyRadius * 0.7, 2);
  c3.translate(-canopyRadius * 0.5, canopyRadius * 0.15, 0.2);

  const canopyGeo = mergeGeometries([c1, c2, c3]);
  canopyGeo.translate(0, trunkHeight + canopyRadius * 0.5, 0);

  const canopyMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.0,
    flatShading: false,
  });

  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.castShadow = true;
  canopy.receiveShadow = true;

  // Use a Group so trunk and canopy keep separate materials,
  // but return as Mesh-typed via a parent wrapper.
  const group = new THREE.Group();
  group.add(trunk);
  group.add(canopy);
  group.name = 'Tree';

  // Wrap in a mesh-like object — since we need a Group for two materials,
  // we cast the group; callers should treat it as Object3D.
  // Return the group typed as THREE.Mesh for API compat (common pattern).
  return group as unknown as THREE.Mesh;
}

/** Stylized rock — displaced icosahedron with flat shading. */
export function createRock(scale = 1.0, color = 0x95a5a6): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(0.5 * scale, 1);

  // Displace vertices for natural irregularity
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const displacement = 0.15 * scale;
    pos.setXYZ(
      i,
      x + (Math.random() - 0.5) * displacement * 2,
      y + (Math.random() - 0.5) * displacement * 2,
      z + (Math.random() - 0.5) * displacement * 2,
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // Random per-axis scale for variety
  const sx = 0.8 + Math.random() * 0.4;
  const sy = 0.8 + Math.random() * 0.4;
  const sz = 0.8 + Math.random() * 0.4;
  geo.scale(sx, sy, sz);

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.8,
    metalness: 0.0,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Rock';
  return mesh;
}

/** Stylized flower — thin cylinder stem + colored petal sphere on top. */
export function createFlower(
  height = 0.6,
  petalColor = 0xff69b4,
): THREE.Mesh {
  const stemGeo = new THREE.CylinderGeometry(0.015, 0.02, height, 6);
  stemGeo.translate(0, height * 0.5, 0);

  const stemMat = new THREE.MeshStandardMaterial({
    color: 0x2ecc71,
    roughness: 0.6,
    metalness: 0.0,
  });

  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.castShadow = true;
  stem.receiveShadow = true;

  const petalGeo = new THREE.SphereGeometry(0.06, 8, 8);
  const petalMat = new THREE.MeshStandardMaterial({
    color: petalColor,
    roughness: 0.4,
    metalness: 0.0,
    emissive: petalColor,
    emissiveIntensity: 0.3,
  });

  const petal = new THREE.Mesh(petalGeo, petalMat);
  petal.position.set(0, height + 0.06, 0);
  petal.castShadow = true;
  petal.receiveShadow = true;

  const group = new THREE.Group();
  group.add(stem);
  group.add(petal);
  group.name = 'Flower';

  return group as unknown as THREE.Mesh;
}

/** Scatter multiple props randomly on a surface area. Returns a Group. */
export function scatterProps(
  factory: () => THREE.Mesh,
  count: number,
  areaWidth: number,
  areaDepth: number,
  position: THREE.Vector3,
  options?: {
    minScale?: number;
    maxScale?: number;
    randomRotation?: boolean;
  },
): THREE.Group {
  const minScale = options?.minScale ?? 0.7;
  const maxScale = options?.maxScale ?? 1.3;
  const randomRotation = options?.randomRotation ?? true;

  const group = new THREE.Group();
  group.position.copy(position);

  for (let i = 0; i < count; i++) {
    const prop = factory();

    const x = (Math.random() - 0.5) * areaWidth;
    const z = (Math.random() - 0.5) * areaDepth;
    prop.position.set(x, 0, z);

    if (randomRotation) {
      prop.rotation.y = Math.random() * Math.PI * 2;
    }

    const s = minScale + Math.random() * (maxScale - minScale);
    prop.scale.setScalar(s);

    prop.castShadow = true;
    prop.receiveShadow = true;

    group.add(prop);
  }

  group.name = 'ScatteredProps';
  return group;
}
