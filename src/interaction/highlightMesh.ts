import * as THREE from 'three';

const _highlightColor = new THREE.Color();

/**
 * Shared emissive highlight utility.
 * Stores original material values so they can be restored on unhighlight.
 */
const _originalMaterials = new WeakMap<THREE.Material, { emissive: number; emissiveIntensity: number }>();

export function setMeshHighlight(root: THREE.Object3D, enabled: boolean, color = 0x00ffff, intensity = 0.3): void {
  root.traverse((node) => {
    const m = node as THREE.Mesh;
    if (!m.isMesh) return;
    const materials = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of materials) {
      const std = mat as THREE.MeshStandardMaterial;
      if (!('emissive' in std)) continue;
      if (!_originalMaterials.has(mat)) {
        _originalMaterials.set(mat, {
          emissive: (std.emissive as THREE.Color | undefined)?.getHex?.() ?? 0x000000,
          emissiveIntensity: (std.emissiveIntensity as number | undefined) ?? 0,
        });
      }
      if (enabled) {
        (std.emissive as THREE.Color).set(_highlightColor.set(color));
        std.emissiveIntensity = intensity;
      } else {
        const original = _originalMaterials.get(mat)!;
        (std.emissive as THREE.Color).setHex(original.emissive);
        std.emissiveIntensity = original.emissiveIntensity;
      }
    }
  });
}
