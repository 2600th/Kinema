import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

/**
 * GLTF/GLB loader with caching.
 */
export class AssetLoader {
  private loader = new GLTFLoader();
  private cache = new Map<string, GLTF>();

  /** Load a GLTF/GLB file. Returns cached result if available. */
  async load(url: string): Promise<GLTF> {
    const cached = this.cache.get(url);
    if (cached) return cached;

    const gltf = await this.loader.loadAsync(url);
    this.cache.set(url, gltf);
    return gltf;
  }

  /** Clear a specific entry from the cache. */
  evict(url: string): void {
    this.cache.delete(url);
  }

  /** Clear all cached assets. */
  clearAll(): void {
    this.cache.clear();
  }
}
