import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createVfxDisposer, rollbackVfxRoots } from "./VfxShowcase";

describe("VfxShowcase owned resource disposal", () => {
  it("removes roots and disposes shared geometry, materials, textures, and instance buffers once", () => {
    const texture = new THREE.Texture();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material));
    root.add(new THREE.Mesh(geometry, material));
    const instances = new THREE.InstancedMesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial(), 2);
    root.add(instances);
    const scene = new THREE.Scene();
    scene.add(root);
    const textureDispose = vi.spyOn(texture, "dispose");
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const instanceGeometryDispose = vi.spyOn(instances.geometry, "dispose");
    const instanceMaterialDispose = vi.spyOn(instances.material as THREE.Material, "dispose");
    const instanceDispose = vi.spyOn(instances, "dispose");

    const dispose = createVfxDisposer([root]);
    dispose();
    dispose();

    expect(root.parent).toBeNull();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(instanceGeometryDispose).toHaveBeenCalledOnce();
    expect(instanceMaterialDispose).toHaveBeenCalledOnce();
    expect(instanceDispose).toHaveBeenCalledOnce();
  });

  it("rolls back only roots registered by a failed construction section", () => {
    const acceptedRoot = new THREE.Group();
    const failedGeometry = new THREE.BoxGeometry();
    const failedMaterial = new THREE.MeshBasicMaterial();
    const failedRoot = new THREE.Mesh(failedGeometry, failedMaterial);
    const scene = new THREE.Scene();
    scene.add(acceptedRoot, failedRoot);
    const roots: THREE.Object3D[] = [acceptedRoot];
    const sectionStart = roots.length;
    roots.push(failedRoot);
    const geometryDispose = vi.spyOn(failedGeometry, "dispose");
    const materialDispose = vi.spyOn(failedMaterial, "dispose");

    rollbackVfxRoots(roots, sectionStart);

    expect(roots).toEqual([acceptedRoot]);
    expect(acceptedRoot.parent).toBe(scene);
    expect(failedRoot.parent).toBeNull();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });
});
