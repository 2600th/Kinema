import type * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { LUT3dlLoader } from "three/addons/loaders/LUT3dlLoader.js";
import { LUTCubeLoader } from "three/addons/loaders/LUTCubeLoader.js";
import { LUTImageLoader } from "three/addons/loaders/LUTImageLoader.js";
import { ENV_PRESETS, LUT_PRESETS, type LutPresetFormat } from "./rendererPresets";

export interface EnvironmentTargetLike {
  texture: THREE.Texture;
  dispose(): void;
}

export interface PmremGeneratorLike {
  compileEquirectangularShader(): void;
  fromScene(scene: THREE.Scene, sigma?: number): EnvironmentTargetLike;
  fromEquirectangular(texture: THREE.Texture): EnvironmentTargetLike;
  dispose(): void;
}

export class RendererAssetLibrary {
  private readonly lut3dlLoader = new LUT3dlLoader();
  private readonly lutCubeLoader = new LUTCubeLoader();
  private readonly lutImageLoader = new LUTImageLoader();
  private readonly hdrLoader = new HDRLoader();
  private readonly lutCache = new Map<string, THREE.Data3DTexture>();
  private readonly envCache = new Map<string, EnvironmentTargetLike>();
  private pmrem: PmremGeneratorLike | null = null;

  setPmremGenerator(pmrem: PmremGeneratorLike | null): void {
    if (this.pmrem === pmrem) return;
    if (this.pmrem) {
      this.pmrem.dispose();
    }
    this.pmrem = pmrem;
  }

  getCachedLut(name: string): THREE.Data3DTexture | null {
    return this.lutCache.get(name) ?? null;
  }

  async ensureLut(name: string): Promise<THREE.Data3DTexture | null> {
    const cached = this.lutCache.get(name);
    if (cached) return cached;

    const preset = LUT_PRESETS.find((entry) => entry.name === name);
    if (!preset) {
      console.warn(`[RendererAssetLibrary] Unknown LUT: ${name}`);
      return null;
    }

    try {
      const url = `/assets/postfx/${preset.file}`;
      const texture = await this.loadLutByFormat(url, preset.format);
      if (!texture) return null;
      texture.needsUpdate = true;
      this.lutCache.set(name, texture);
      return texture;
    } catch (err) {
      console.warn(`[RendererAssetLibrary] Failed to load LUT: ${name}`, err);
      return null;
    }
  }

  getCachedEnvironment(name: string): EnvironmentTargetLike | null {
    return this.envCache.get(name) ?? null;
  }

  getOrCreateRoomEnvironment(): EnvironmentTargetLike | null {
    const cached = this.envCache.get("Room Environment");
    if (cached) return cached;
    if (!this.pmrem) return null;

    const target = this.pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.envCache.set("Room Environment", target);
    return target;
  }

  async ensureEnvironment(name: string): Promise<EnvironmentTargetLike | null> {
    const cached = this.envCache.get(name);
    if (cached) return cached;
    if (name === "Room Environment") {
      return this.getOrCreateRoomEnvironment();
    }
    if (!this.pmrem) return null;

    const preset = ENV_PRESETS.find((entry) => entry.name === name);
    if (!preset?.file) return null;

    try {
      const url = `/assets/env/${preset.file}`;
      const hdrTexture = await this.hdrLoader.loadAsync(url);
      const envTarget = this.pmrem.fromEquirectangular(hdrTexture);
      hdrTexture.dispose();
      this.envCache.set(name, envTarget);
      return envTarget;
    } catch (err) {
      console.warn(`[RendererAssetLibrary] Failed to load environment: ${name}`, err);
      return null;
    }
  }

  dispose(): void {
    for (const target of this.envCache.values()) {
      target.dispose();
    }
    this.envCache.clear();

    if (this.pmrem) {
      this.pmrem.dispose();
      this.pmrem = null;
    }

    for (const texture of this.lutCache.values()) {
      texture.dispose();
    }
    this.lutCache.clear();
  }

  private async loadLutByFormat(url: string, format: LutPresetFormat): Promise<THREE.Data3DTexture | null> {
    let parsed: { texture3D?: THREE.Data3DTexture };
    if (format === "cube") {
      parsed = (await this.lutCubeLoader.loadAsync(url)) as { texture3D?: THREE.Data3DTexture };
    } else if (format === "image") {
      parsed = (await this.lutImageLoader.loadAsync(url)) as { texture3D?: THREE.Data3DTexture };
    } else {
      parsed = (await this.lut3dlLoader.loadAsync(url)) as { texture3D?: THREE.Data3DTexture };
    }
    return parsed.texture3D ?? null;
  }
}
