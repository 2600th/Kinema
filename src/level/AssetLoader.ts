import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import type { WebGPURenderer } from "three/webgpu";

type Drawable = THREE.Mesh | THREE.Points | THREE.Line;

function isDrawable(object: THREE.Object3D): object is Drawable {
  const candidate = object as THREE.Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean };
  return candidate.isMesh === true || candidate.isPoints === true || candidate.isLine === true;
}

/**
 * GLTF/GLB loader with caching.
 * Configures DRACO + KTX2 decoders so compressed assets work out of the box.
 */
export class AssetLoader {
  private static sharedRenderer: THREE.WebGLRenderer | WebGPURenderer | undefined;

  /** Store a renderer reference so all future AssetLoader instances auto-detect KTX2 support. */
  static initRendererSupport(renderer: THREE.WebGLRenderer | WebGPURenderer): void {
    AssetLoader.sharedRenderer = renderer;
  }

  private loader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private ktx2Loader: KTX2Loader;
  private cache = new Map<string, GLTF>();
  private pending = new Map<string, Promise<GLTF>>();
  private generation = 0;

  constructor(renderer?: THREE.WebGLRenderer | WebGPURenderer) {
    this.loader = new GLTFLoader();

    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    this.loader.setDRACOLoader(this.dracoLoader);

    this.ktx2Loader = new KTX2Loader();
    this.ktx2Loader.setTranscoderPath("https://www.gstatic.com/basis-universal/versioned/2021-04-15-ba1c3e4/");
    const effectiveRenderer = renderer ?? AssetLoader.sharedRenderer;
    if (effectiveRenderer) {
      this.ktx2Loader.detectSupport(effectiveRenderer);
    }
    this.loader.setKTX2Loader(this.ktx2Loader);
  }

  /** Load a GLTF/GLB file. Returns cached result (with cloned scene) if available. */
  async load(url: string): Promise<GLTF> {
    const cached = this.cache.get(url);
    if (cached) return this.cloneForUse(cached);

    let pending = this.pending.get(url);
    if (!pending) {
      pending = this.loader.loadAsync(url);
      this.pending.set(url, pending);
    }
    const pendingGeneration = this.generation;
    try {
      const gltf = await pending;
      if (this.generation === pendingGeneration && this.pending.get(url) === pending && !this.cache.has(url)) {
        this.cache.set(url, gltf);
      }
      // Return a clone even on first load to protect the cache from mutation
      return this.cloneForUse(gltf);
    } finally {
      if (this.pending.get(url) === pending) {
        this.pending.delete(url);
      }
    }
  }

  /** Load an uncached asset whose ownership is returned to the caller. */
  loadTransient(url: string): Promise<GLTF> {
    return this.loader.loadAsync(url);
  }

  /** Read-only cache visibility for ownership-sensitive callers and tests. */
  has(url: string): boolean {
    return this.cache.has(url);
  }

  /** Dispose an uncached GLTF that was not adopted into the canonical cache. */
  disposeTransient(gltf: GLTF): void {
    this.disposeObject(gltf.scene);
  }

  disposeObject(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const disposedMaterials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const skeletons = new Set<THREE.Skeleton>();
    root.traverse((child) => {
      if (!isDrawable(child)) return;
      if (!geometries.has(child.geometry)) {
        geometries.add(child.geometry);
        child.geometry.dispose();
      }
      const drawableMaterials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of drawableMaterials) {
        if (material && !disposedMaterials.has(material)) {
          disposedMaterials.add(material);
          this.disposeMaterialTextures(material, textures);
          material.dispose();
        }
      }
      if (child instanceof THREE.SkinnedMesh && !skeletons.has(child.skeleton)) {
        skeletons.add(child.skeleton);
        if (child.skeleton.boneTexture) {
          this.disposeTextureOnce(child.skeleton.boneTexture, textures);
          child.skeleton.boneTexture = null;
        }
        child.skeleton.dispose();
      }
    });
  }

  /** Register a pre-loaded GLTF under a canonical path so it can be retrieved by load(). */
  put(url: string, gltf: GLTF): void {
    this.cache.set(url, gltf);
  }

  /** Atomically transfer a parsed GLTF into the cache and return an owned instance. */
  adopt(url: string, gltf: GLTF): GLTF {
    const owned = this.cloneForUse(gltf);
    const previous = this.cache.get(url);
    if (previous && previous !== gltf) this.disposeGLTF(previous);
    this.cache.set(url, gltf);
    return owned;
  }

  /** Clear a specific entry from the cache, disposing GPU resources. */
  evict(url: string): void {
    this.generation++;
    this.pending.delete(url);
    const gltf = this.cache.get(url);
    if (gltf) {
      this.disposeGLTF(gltf);
    }
    this.cache.delete(url);
  }

  /** Clear all cached assets, disposing GPU resources. */
  clearAll(): void {
    this.generation++;
    for (const gltf of this.cache.values()) {
      this.disposeGLTF(gltf);
    }
    this.cache.clear();
    this.pending.clear();
  }

  /** Configure KTX2 transcoder with the active renderer for optimal format selection. */
  detectKTX2Support(renderer: THREE.WebGLRenderer): void {
    this.ktx2Loader.detectSupport(renderer);
  }

  private disposeTextureOnce(texture: THREE.Texture, disposed: Set<THREE.Texture>): void {
    if (disposed.has(texture)) return;
    disposed.add(texture);
    texture.dispose();
  }

  private disposeMaterialTextures(material: THREE.Material, disposed: Set<THREE.Texture>): void {
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) this.disposeTextureOnce(value, disposed);
    }
  }

  private disposeGLTF(gltf: GLTF): void {
    this.disposeObject(gltf.scene);
  }

  private cloneForUse(gltf: GLTF): GLTF {
    const scene = skeletonClone(gltf.scene) as THREE.Group;
    const geometryClones = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
    const materialClones = new Map<THREE.Material, THREE.Material>();
    const textureClones = new Map<THREE.Texture, THREE.Texture>();
    const sourceNodes: THREE.Object3D[] = [];
    const ownedNodes: THREE.Object3D[] = [];
    const skeletonClones = new Map<THREE.Skeleton, THREE.Skeleton>();
    gltf.scene.traverse((child) => sourceNodes.push(child));
    scene.traverse((child) => ownedNodes.push(child));
    ownedNodes.forEach((child, index) => {
      if (!isDrawable(child)) return;
      let geometry = geometryClones.get(child.geometry);
      if (!geometry) {
        geometry = child.geometry.clone();
        geometryClones.set(child.geometry, geometry);
      }
      child.geometry = geometry;
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => this.cloneMaterialForUse(material, materialClones, textureClones))
        : this.cloneMaterialForUse(child.material, materialClones, textureClones);
      const source = sourceNodes[index];
      if (child instanceof THREE.SkinnedMesh && source instanceof THREE.SkinnedMesh) {
        let skeleton = skeletonClones.get(source.skeleton);
        if (!skeleton) {
          skeleton = new THREE.Skeleton(
            child.skeleton.bones,
            source.skeleton.boneInverses.map((inverse) => inverse.clone()),
          );
          if (source.skeleton.boneTexture) skeleton.computeBoneTexture();
          skeletonClones.set(source.skeleton, skeleton);
        }
        child.skeleton = skeleton;
      }
    });
    return { ...gltf, scene };
  }

  private cloneTextureForUse(texture: THREE.Texture, textureClones: Map<THREE.Texture, THREE.Texture>): THREE.Texture {
    let clone = textureClones.get(texture);
    if (!clone) {
      clone = texture.clone();
      textureClones.set(texture, clone);
    }
    return clone;
  }

  private cloneMaterialForUse(
    material: THREE.Material,
    materialClones: Map<THREE.Material, THREE.Material>,
    textureClones: Map<THREE.Texture, THREE.Texture>,
  ): THREE.Material {
    const existing = materialClones.get(material);
    if (existing) return existing;
    const clone = material.clone();
    materialClones.set(material, clone);
    const source = material as unknown as Record<string, unknown>;
    const target = clone as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(source)) {
      if (value instanceof THREE.Texture) target[key] = this.cloneTextureForUse(value, textureClones);
    }
    return clone;
  }

  /** Dispose loaders and free decoder resources. */
  dispose(): void {
    this.clearAll();
    this.dracoLoader.dispose();
    this.ktx2Loader.dispose();
  }
}
