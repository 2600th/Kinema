import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetLoader } from "./AssetLoader";

const loaderMocks = vi.hoisted(() => ({
  loadAsync: vi.fn(),
}));

vi.mock("three/addons/loaders/DRACOLoader.js", () => ({
  DRACOLoader: class {
    setDecoderPath = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("three/addons/loaders/KTX2Loader.js", () => ({
  KTX2Loader: class {
    setTranscoderPath = vi.fn();
    detectSupport = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setDRACOLoader = vi.fn();
    setKTX2Loader = vi.fn();
    loadAsync = loaderMocks.loadAsync;
  },
}));

describe("AssetLoader", () => {
  beforeEach(() => {
    loaderMocks.loadAsync.mockReset();
  });

  it("deduplicates concurrent requests for the same GLB", async () => {
    let resolveLoad: (value: any) => void = () => {};
    loaderMocks.loadAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const loader = new AssetLoader();
    const sourceScene = new THREE.Group();
    const sourceGeometry = new THREE.BoxGeometry();
    const sourceTexture = new THREE.Texture();
    const sourceMaterial = new THREE.MeshStandardMaterial({ map: sourceTexture });
    sourceScene.add(new THREE.Mesh(sourceGeometry, sourceMaterial));

    const first = loader.load("/assets/models/npc.glb");
    const second = loader.load("/assets/models/npc.glb");
    resolveLoad({ scene: sourceScene, animations: [] });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(loaderMocks.loadAsync).toHaveBeenCalledTimes(1);
    expect(firstResult.scene).not.toBe(sourceScene);
    expect(secondResult.scene).not.toBe(sourceScene);
    expect(firstResult.scene).not.toBe(secondResult.scene);
    const firstMesh = firstResult.scene.children[0] as THREE.Mesh;
    const secondMesh = secondResult.scene.children[0] as THREE.Mesh;
    expect(firstMesh.geometry).not.toBe(sourceGeometry);
    expect(secondMesh.geometry).not.toBe(sourceGeometry);
    expect(firstMesh.geometry).not.toBe(secondMesh.geometry);
    expect(firstMesh.material).not.toBe(sourceMaterial);
    expect((firstMesh.material as THREE.MeshStandardMaterial).map).not.toBe(sourceTexture);
  });

  it("loads blob URLs transiently without populating the cache", async () => {
    const sourceScene = new THREE.Group();
    loaderMocks.loadAsync.mockResolvedValue({ scene: sourceScene, animations: [] });
    const loader = new AssetLoader();

    const gltf = await loader.loadTransient("blob:kinema-import");

    expect(gltf.scene).toBe(sourceScene);
    expect(loader.has("blob:kinema-import")).toBe(false);
  });

  it("adopts a canonical GLTF atomically while returning an independently owned scene", () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geometry, material));
    const source = { scene, animations: [] } as unknown as GLTF;
    const loader = new AssetLoader();

    const owned = loader.adopt("/assets/models/imported.glb", source);

    expect(loader.has("/assets/models/imported.glb")).toBe(true);
    expect(owned.scene).not.toBe(scene);
    const ownedMesh = owned.scene.children[0] as THREE.Mesh;
    expect(ownedMesh.geometry).not.toBe(geometry);
    expect(ownedMesh.material).not.toBe(material);
  });

  it("disposes a replaced canonical source when the same asset path is adopted again", () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    const firstScene = new THREE.Group();
    firstScene.add(new THREE.Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const loader = new AssetLoader();
    const path = "/assets/models/replaced.glb";

    loader.adopt(path, { scene: firstScene, animations: [] } as unknown as GLTF);
    loader.adopt(path, { scene: new THREE.Group(), animations: [] } as unknown as GLTF);

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("disposes transient GLTF geometry, materials, and textures explicitly", () => {
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    const loader = new AssetLoader();

    loader.disposeTransient({ scene, animations: [] } as unknown as GLTF);

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });

  it("deep-clones mesh, points, line, and skinned-mesh resources while preserving shared ownership", () => {
    const sharedGeometry = new THREE.BufferGeometry();
    sharedGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    const sharedTexture = new THREE.Texture();
    const sharedMaterial = new THREE.MeshPhysicalMaterial({ map: sharedTexture });
    sharedMaterial.clearcoatMap = sharedTexture;
    sharedMaterial.transmissionMap = sharedTexture;
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(sharedGeometry, sharedMaterial),
      new THREE.Points(sharedGeometry, sharedMaterial),
      new THREE.LineSegments(sharedGeometry, sharedMaterial),
    );

    const bone = new THREE.Bone();
    const skinned = new THREE.SkinnedMesh(sharedGeometry, sharedMaterial);
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    skinned.skeleton.boneTexture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    root.add(skinned);
    const loader = new AssetLoader();

    const owned = loader.adopt("/assets/models/drawables.glb", {
      scene: root,
      animations: [new THREE.AnimationClip("idle", 1, [])],
    } as unknown as GLTF);
    const ownedDrawables = owned.scene.children as Array<THREE.Mesh | THREE.Points | THREE.LineSegments>;

    for (const drawable of ownedDrawables) {
      expect(drawable.geometry).not.toBe(sharedGeometry);
      expect(drawable.material).not.toBe(sharedMaterial);
      expect((drawable.material as THREE.MeshPhysicalMaterial).map).not.toBe(sharedTexture);
    }
    expect(ownedDrawables[0]?.geometry).toBe(ownedDrawables[1]?.geometry);
    expect(ownedDrawables[0]?.material).toBe(ownedDrawables[2]?.material);
    const ownedSkinned = ownedDrawables[3] as THREE.SkinnedMesh;
    expect(ownedSkinned.skeleton).not.toBe(skinned.skeleton);
    expect(ownedSkinned.skeleton.boneTexture).not.toBe(skinned.skeleton.boneTexture);
    expect(owned.animations[0]).toBeDefined();
  });

  it("disposes shared drawable, physical-map, and skeleton resources exactly once on eviction", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    const texture = new THREE.Texture();
    const material = new THREE.MeshPhysicalMaterial({ map: texture });
    material.clearcoatMap = texture;
    material.transmissionMap = texture;
    material.sheenColorMap = texture;
    material.specularColorMap = texture;
    material.iridescenceMap = texture;
    material.anisotropyMap = texture;
    const root = new THREE.Group();
    root.add(new THREE.Points(geometry, material), new THREE.LineSegments(geometry, material));
    const bone = new THREE.Bone();
    const skinned = new THREE.SkinnedMesh(geometry, material);
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    const boneTexture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    skinned.skeleton.boneTexture = boneTexture;
    root.add(skinned);
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    const boneTextureDispose = vi.spyOn(boneTexture, "dispose");
    const skeletonDispose = vi.spyOn(skinned.skeleton, "dispose");
    const loader = new AssetLoader();
    loader.put("/assets/models/shared-drawables.glb", { scene: root, animations: [] } as unknown as GLTF);

    loader.evict("/assets/models/shared-drawables.glb");

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(boneTextureDispose).toHaveBeenCalledOnce();
    expect(skeletonDispose).toHaveBeenCalledOnce();
  });
});
