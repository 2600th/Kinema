import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import type { WebGPURenderer } from "three/webgpu";

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
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        this.disposeMaterialTextures(material);
        material.dispose();
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

  private disposeMaterialTextures(material: THREE.Material): void {
    const mat = material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.normalMap?.dispose();
    mat.roughnessMap?.dispose();
    mat.metalnessMap?.dispose();
    mat.aoMap?.dispose();
    mat.emissiveMap?.dispose();
    mat.displacementMap?.dispose();
    mat.alphaMap?.dispose();
    mat.envMap?.dispose();
    mat.lightMap?.dispose();
    mat.bumpMap?.dispose();
  }

  private disposeGLTF(gltf: GLTF): void {
    this.disposeObject(gltf.scene);
  }

  private cloneForUse(gltf: GLTF): GLTF {
    const scene = skeletonClone(gltf.scene) as THREE.Group;
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry = child.geometry.clone();
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => this.cloneMaterialForUse(material))
        : this.cloneMaterialForUse(child.material);
    });
    return { ...gltf, scene };
  }

  private cloneMaterialForUse(material: THREE.Material): THREE.Material {
    const clone = material.clone();
    const source = material as unknown as Record<string, unknown>;
    const target = clone as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(source)) {
      if (value instanceof THREE.Texture) target[key] = value.clone();
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
