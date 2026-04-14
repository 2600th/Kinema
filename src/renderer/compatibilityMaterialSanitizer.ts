import * as THREE from "three";

type NodeLikeMaterial = THREE.Material & {
  isNodeMaterial?: boolean;
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
};

type MeshStyleMaterial = THREE.Material & {
  fog?: boolean;
  wireframe?: boolean;
};

export interface CompatibilityMaterialSanitizationResult {
  replaced: number;
  replacedTypes: string[];
}

function isNodeLikeMaterial(material: THREE.Material): material is NodeLikeMaterial {
  return Boolean((material as NodeLikeMaterial).isNodeMaterial) || /NodeMaterial/i.test(material.type);
}

function copyCommonMaterialState(source: THREE.Material, target: THREE.Material): void {
  const sourceMeshStyle = source as MeshStyleMaterial;
  const targetMeshStyle = target as MeshStyleMaterial;

  target.name = source.name;
  target.transparent = source.transparent;
  target.opacity = source.opacity;
  target.blending = source.blending;
  target.blendSrc = source.blendSrc;
  target.blendDst = source.blendDst;
  target.blendEquation = source.blendEquation;
  target.depthTest = source.depthTest;
  target.depthWrite = source.depthWrite;
  target.side = source.side;
  target.alphaTest = source.alphaTest;
  target.toneMapped = source.toneMapped;
  target.visible = source.visible;
  target.vertexColors = source.vertexColors;
  if (typeof sourceMeshStyle.fog === "boolean") {
    targetMeshStyle.fog = sourceMeshStyle.fog;
  }
  if (typeof sourceMeshStyle.wireframe === "boolean") {
    targetMeshStyle.wireframe = sourceMeshStyle.wireframe;
  }
}

function createFallbackMaterial(source: NodeLikeMaterial): THREE.Material {
  const useBasicFallback = /Basic/i.test(source.type);
  const fallback = useBasicFallback ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial();

  copyCommonMaterialState(source, fallback);

  if ("color" in fallback && source.color instanceof THREE.Color) {
    fallback.color.copy(source.color);
  }

  if ("map" in fallback) fallback.map = source.map ?? null;
  if ("alphaMap" in fallback) fallback.alphaMap = source.alphaMap ?? null;
  if ("aoMap" in fallback) fallback.aoMap = source.aoMap ?? null;

  if (fallback instanceof THREE.MeshStandardMaterial) {
    fallback.roughness = typeof source.roughness === "number" ? source.roughness : 1;
    fallback.metalness = typeof source.metalness === "number" ? source.metalness : 0;
    fallback.flatShading = Boolean(source.flatShading);
    fallback.normalMap = source.normalMap ?? null;
    fallback.roughnessMap = source.roughnessMap ?? null;
    fallback.metalnessMap = source.metalnessMap ?? null;
    fallback.emissiveMap = source.emissiveMap ?? null;
    if (source.emissive instanceof THREE.Color) {
      fallback.emissive.copy(source.emissive);
    }
    fallback.emissiveIntensity = typeof source.emissiveIntensity === "number" ? source.emissiveIntensity : 0;
  }

  fallback.userData = {
    ...source.userData,
    __kinemaCompatibilityFallback: true,
    __kinemaCompatibilityFallbackFrom: source.type,
  };
  fallback.needsUpdate = true;
  return fallback;
}

function sanitizeMaterial(material: THREE.Material): { material: THREE.Material; replaced: boolean } {
  if (!isNodeLikeMaterial(material)) {
    return { material, replaced: false };
  }

  const fallback = createFallbackMaterial(material);
  material.dispose();
  return { material: fallback, replaced: true };
}

export function sanitizeSceneForCompatibility(scene: THREE.Scene): CompatibilityMaterialSanitizationResult {
  let replaced = 0;
  const replacedTypes = new Set<string>();

  scene.traverse((object) => {
    const renderObject = object as THREE.Mesh;
    if (!("material" in renderObject)) return;

    if (Array.isArray(renderObject.material)) {
      let changed = false;
      const sanitized = renderObject.material.map((material) => {
        const result = sanitizeMaterial(material);
        if (result.replaced) {
          replaced += 1;
          replacedTypes.add(material.type);
          changed = true;
        }
        return result.material;
      });
      if (changed) {
        renderObject.material = sanitized;
      }
      return;
    }

    const result = sanitizeMaterial(renderObject.material);
    if (result.replaced) {
      replaced += 1;
      replacedTypes.add(renderObject.material.type);
      renderObject.material = result.material;
    }
  });

  return {
    replaced,
    replacedTypes: [...replacedTypes].sort(),
  };
}
