import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

/**
 * GLTF/GLB loader with caching.
 * Configures DRACO + KTX2 decoders so compressed assets work out of the box.
 */
export class AssetLoader {
  private loader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private ktx2Loader: KTX2Loader;
  private cache = new Map<string, GLTF>();

  constructor(renderer?: THREE.WebGLRenderer) {
    this.loader = new GLTFLoader();

    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.loader.setDRACOLoader(this.dracoLoader);

    this.ktx2Loader = new KTX2Loader();
    this.ktx2Loader.setTranscoderPath('https://www.gstatic.com/basis-universal/versioned/2021-04-15-ba1c3e4/');
    if (renderer) {
      this.ktx2Loader.detectSupport(renderer);
    }
    this.loader.setKTX2Loader(this.ktx2Loader);
  }

  /** Load a GLTF/GLB file. Returns cached result (with cloned scene) if available. */
  async load(url: string): Promise<GLTF> {
    const cached = this.cache.get(url);
    if (cached) return { ...cached, scene: cached.scene.clone(true) };

    const gltf = await this.loader.loadAsync(url);
    this.cache.set(url, gltf);
    return gltf;
  }

  /** Clear a specific entry from the cache, disposing GPU resources. */
  evict(url: string): void {
    const gltf = this.cache.get(url);
    if (gltf) {
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mat = child.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => { this.disposeMaterialTextures(m); m.dispose(); });
          } else {
            this.disposeMaterialTextures(mat);
            mat.dispose();
          }
        }
      });
    }
    this.cache.delete(url);
  }

  /** Clear all cached assets, disposing GPU resources. */
  clearAll(): void {
    for (const gltf of this.cache.values()) {
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mat = child.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => { this.disposeMaterialTextures(m); m.dispose(); });
          } else {
            this.disposeMaterialTextures(mat);
            mat.dispose();
          }
        }
      });
    }
    this.cache.clear();
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

  /** Dispose loaders and free decoder resources. */
  dispose(): void {
    this.clearAll();
    this.dracoLoader.dispose();
    this.ktx2Loader.dispose();
  }
}
