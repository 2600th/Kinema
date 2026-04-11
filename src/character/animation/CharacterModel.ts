import * as THREE from 'three';
import type { AssetLoader } from '@level/AssetLoader';
import type { Disposable } from '@core/types';
import type { AnimationProfile } from './AnimationProfile';

export class CharacterModel implements Disposable {
  readonly root: THREE.Object3D;
  readonly clips: Map<string, THREE.AnimationClip>;
  readonly handBone: THREE.Object3D | null;
  private readonly baseRootY: number;
  private readonly baseMaterialState = new Map<
    THREE.MeshStandardMaterial,
    { color: THREE.Color; emissive: THREE.Color; emissiveIntensity: number }
  >();
  private readonly damageTint = new THREE.Color(0xff6ea8);

  private constructor(
    root: THREE.Object3D,
    clips: Map<string, THREE.AnimationClip>,
    handBone: THREE.Object3D | null,
    baseRootY: number,
  ) {
    this.root = root;
    this.clips = clips;
    this.handBone = handBone;
    this.baseRootY = baseRootY;
  }

  static async load(
    profile: AnimationProfile,
    parent: THREE.Object3D,
    loader: AssetLoader,
  ): Promise<CharacterModel> {
    // 1. Load model GLB
    const modelGltf = await loader.load(profile.modelUrl);
    const root = modelGltf.scene as THREE.Group;
    root.name = 'CharacterModel';

    // 2. Enable shadows + clone materials so each character has independent colors
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        // Clone materials to avoid sharing between character instances
        if (Array.isArray(node.material)) {
          node.material = node.material.map((m: THREE.Material) => m.clone());
        } else {
          node.material = node.material.clone();
        }
      }
    });

    // 3. Scale model to match capsule height
    const box = new THREE.Box3().setFromObject(root);
    const modelHeight = box.max.y - box.min.y;
    if (modelHeight > 0) {
      const capsuleHeight = 1.3; // 2 * (0.35 + 0.3)
      const scale = capsuleHeight / modelHeight;
      root.scale.setScalar(scale);
    }

    // 4. Offset model so feet align with capsule bottom
    const scaledBox = new THREE.Box3().setFromObject(root);
    // The floating spring maintains body center at floatingDistance above ground.
    // floatingDistance = capsuleRadius + floatHeight = 0.3 + 0.3 = 0.6
    // Mesh group is positioned at body center. Model feet should be at ground level.
    // So offset = -floatingDistance = -0.6
    const capsuleBottom = -0.6;
    root.position.y = capsuleBottom - scaledBox.min.y;

    // 5. Attach to parent, hide capsule
    parent.add(root);
    const capsule = parent.getObjectByName('PlayerCapsule');
    if (capsule) capsule.visible = false;

    // 6. Collect clips from all animation URLs (clone to avoid cache mutation)
    const clips = new Map<string, THREE.AnimationClip>();
    for (const clip of modelGltf.animations ?? []) {
      if (!clips.has(clip.name)) {
        clips.set(clip.name, clip.clone());
      }
    }
    for (const url of profile.animationUrls) {
      if (url === profile.modelUrl) continue;
      try {
        const animGltf = await loader.load(url);
        for (const clip of animGltf.animations ?? []) {
          if (!clips.has(clip.name)) {
            clips.set(clip.name, clip.clone());
          }
        }
      } catch (err) {
        console.warn(`[CharacterModel] Failed to load animation GLB: ${url}`, err);
      }
    }

    // 7. Strip root motion (X/Y/Z) from all clips — physics drives all movement
    const rootBoneName = CharacterModel.findRootBoneName(root);
    for (const clip of clips.values()) {
      CharacterModel.stripRootMotion(clip, rootBoneName);
    }

    // Diagnostic: verify track targets match skeleton bones
    const boneNames: string[] = [];
    root.traverse((n) => { if ((n as THREE.Bone).isBone) boneNames.push(n.name); });
    const trackBoneNames = new Set<string>();
    for (const clip of clips.values()) {
      for (const track of clip.tracks) {
        trackBoneNames.add(track.name.split('.')[0]);
      }
    }
    const missing = [...trackBoneNames].filter(n => !boneNames.includes(n));
    if (missing.length > 0) {
      console.warn('[CharacterModel] Track targets NOT found in skeleton:', missing);
    }
    console.debug(`[CharacterModel] Loaded: ${clips.size} clips, ${boneNames.length} bones, ${trackBoneNames.size} track targets, ${missing.length} missing`);

    // Verify SkinnedMesh is properly bound to skeleton
    let skinnedMeshCount = 0;
    root.traverse((n) => {
      if ((n as THREE.SkinnedMesh).isSkinnedMesh) {
        skinnedMeshCount++;
        const sm = n as THREE.SkinnedMesh;
        console.debug(`[CharacterModel] SkinnedMesh "${sm.name}": skeleton has ${sm.skeleton?.bones?.length ?? 0} bones, bound=${sm.skeleton?.bones?.[0]?.parent ? 'yes' : 'no'}`);
      }
    });

    // Find right hand bone for grab/carry attachment
    let handBone: THREE.Object3D | null = null;
    root.traverse((n) => {
      if (!handBone && (n as THREE.Bone).isBone && n.name === 'hand_r') {
        handBone = n;
      }
    });

    return new CharacterModel(root, clips, handBone, root.position.y);
  }

  /** Get the right hand bone's world position (for grab/carry attachment). */
  getHandWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    if (this.handBone) {
      this.handBone.updateWorldMatrix(true, false);
      this.handBone.getWorldPosition(target);
    }
    return target;
  }

  /** Get the right hand bone's world transform (for carry sockets / release positions). */
  getHandWorldTransform(positionTarget: THREE.Vector3, rotationTarget: THREE.Quaternion): boolean {
    if (!this.handBone) return false;
    this.handBone.updateWorldMatrix(true, false);
    this.handBone.getWorldPosition(positionTarget);
    this.handBone.getWorldQuaternion(rotationTarget);
    return true;
  }

  /** Raise/lower the rendered character without moving the physics body. */
  setVisualLift(offsetY: number): void {
    this.root.position.y = this.baseRootY + offsetY;
  }

  setDamagePulse(weight: number): void {
    const clamped = Math.max(0, Math.min(1, weight));
    for (const [material, base] of this.baseMaterialState.entries()) {
      material.color.copy(base.color).lerp(this.damageTint, clamped * 0.16);
      material.emissive.copy(base.emissive).lerp(this.damageTint, clamped * 0.82);
      material.emissiveIntensity = base.emissiveIntensity + clamped * 0.95;
    }
  }

  /** Reset all materials to a neutral mannequin color (removes purple joints). */
  neutralize(): void {
    const neutral = new THREE.Color(0xccbbaa);
    this.root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of materials) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.color.copy(neutral);
            mat.emissive.setScalar(0);
            mat.emissiveIntensity = 0;
          }
        }
      }
    });
  }

  /** Apply a stylized iridescent metallic finish for the player character. */
  applyHeroFinish(): void {
    let materialIndex = 0;

    this.root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;

      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const upgraded = materials.map((material) => CharacterModel.createHeroMaterial(material, materialIndex++));
      node.material = Array.isArray(node.material) ? upgraded : upgraded[0];
    });
    this.captureBaseMaterialState();
  }

  /** Tint all materials by blending toward the given color. */
  tint(color: THREE.Color): void {
    this.root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of materials) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.color.copy(color);
            mat.emissive.copy(color);
            mat.emissiveIntensity = 0.15;
          }
        }
      }
    });
    this.captureBaseMaterialState();
  }

  dispose(): void {
    // Capture parent before removal so we can restore capsule visibility
    const parent = this.root.parent;
    if (parent) {
      parent.remove(this.root);
      const capsule = parent.getObjectByName('PlayerCapsule');
      if (capsule) capsule.visible = true;
    }
    this.root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.map?.dispose();
            mat.normalMap?.dispose();
            mat.roughnessMap?.dispose();
            mat.metalnessMap?.dispose();
            mat.aoMap?.dispose();
            mat.emissiveMap?.dispose();
            mat.alphaMap?.dispose();
            mat.envMap?.dispose();
          }
          mat.dispose();
        }
      }
    });
    this.captureBaseMaterialState();
  }

  private static findRootBoneName(root: THREE.Object3D): string {
    let boneName = '';
    root.traverse((node) => {
      if (!boneName && (node as THREE.Bone).isBone) {
        boneName = node.name;
      }
    });
    return boneName || 'root';
  }

  private static stripRootMotion(clip: THREE.AnimationClip, rootBoneName: string): void {
    for (const track of clip.tracks) {
      if (track.name === rootBoneName + '.position') {
        const values = track.values;
        for (let i = 0; i < values.length; i += 3) {
          values[i] = 0;     // X
          values[i + 1] = 0; // Y
          values[i + 2] = 0; // Z
        }
      }
    }
  }

  private captureBaseMaterialState(): void {
    this.baseMaterialState.clear();
    this.root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        this.baseMaterialState.set(material, {
          color: material.color.clone(),
          emissive: material.emissive.clone(),
          emissiveIntensity: material.emissiveIntensity,
        });
      }
    });
  }

  private static createHeroMaterial(material: THREE.Material, materialIndex: number): THREE.Material {
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      return material;
    }

    const physical = material instanceof THREE.MeshPhysicalMaterial
      ? material
      : CharacterModel.upgradeStandardToPhysical(material);

    const basePalette = [
      new THREE.Color(0x5a41c7),
      new THREE.Color(0x37bb82),
      new THREE.Color(0x7a52de),
      new THREE.Color(0x4bd19a),
    ];
    const accentPalette = [
      new THREE.Color(0xb688ff),
      new THREE.Color(0x98ffd0),
      new THREE.Color(0x7dffbf),
      new THREE.Color(0xd39dff),
    ];
    // Bias the finish toward orchid and mint so the hero reads green-purple,
    // while the physical response still catches iridescent highlights.
    const baseColor = basePalette[materialIndex % basePalette.length].clone();
    const accentColor = accentPalette[materialIndex % accentPalette.length].clone();
    const emissiveColor = accentColor.clone().lerp(baseColor, 0.42);

    physical.color.copy(baseColor).lerp(accentColor, 0.18);
    physical.metalness = 0.42;
    physical.roughness = 0.18 + (materialIndex % 3) * 0.025;
    physical.clearcoat = 0.96;
    physical.clearcoatRoughness = 0.08;
    physical.iridescence = 0.95;
    physical.iridescenceIOR = 1.18;
    physical.iridescenceThicknessRange = [180, 760];
    physical.sheen = 0.2;
    physical.sheenColor.copy(emissiveColor);
    physical.sheenRoughness = 0.42;
    physical.specularIntensity = 1;
    physical.specularColor.copy(emissiveColor);
    physical.envMapIntensity = Math.max(physical.envMapIntensity, 1.7);
    physical.emissive.copy(emissiveColor);
    physical.emissiveIntensity = 0.06;

    return physical;
  }

  private static upgradeStandardToPhysical(material: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
    const physical = new THREE.MeshPhysicalMaterial();

    physical.name = material.name;
    physical.color.copy(material.color);
    physical.map = material.map;
    physical.lightMap = material.lightMap;
    physical.lightMapIntensity = material.lightMapIntensity;
    physical.aoMap = material.aoMap;
    physical.aoMapIntensity = material.aoMapIntensity;
    physical.emissive.copy(material.emissive);
    physical.emissiveMap = material.emissiveMap;
    physical.emissiveIntensity = material.emissiveIntensity;
    physical.bumpMap = material.bumpMap;
    physical.bumpScale = material.bumpScale;
    physical.normalMap = material.normalMap;
    physical.normalMapType = material.normalMapType;
    physical.normalScale.copy(material.normalScale);
    physical.displacementMap = material.displacementMap;
    physical.displacementScale = material.displacementScale;
    physical.displacementBias = material.displacementBias;
    physical.roughness = material.roughness;
    physical.roughnessMap = material.roughnessMap;
    physical.metalness = material.metalness;
    physical.metalnessMap = material.metalnessMap;
    physical.alphaMap = material.alphaMap;
    physical.envMap = material.envMap;
    physical.envMapRotation.copy(material.envMapRotation);
    physical.envMapIntensity = material.envMapIntensity;
    physical.wireframe = material.wireframe;
    physical.wireframeLinewidth = material.wireframeLinewidth;
    physical.flatShading = material.flatShading;
    physical.fog = material.fog;

    physical.side = material.side;
    physical.shadowSide = material.shadowSide;
    physical.opacity = material.opacity;
    physical.transparent = material.transparent;
    physical.alphaHash = material.alphaHash;
    physical.blending = material.blending;
    physical.blendSrc = material.blendSrc;
    physical.blendDst = material.blendDst;
    physical.blendEquation = material.blendEquation;
    physical.blendSrcAlpha = material.blendSrcAlpha;
    physical.blendDstAlpha = material.blendDstAlpha;
    physical.blendEquationAlpha = material.blendEquationAlpha;
    physical.depthFunc = material.depthFunc;
    physical.depthTest = material.depthTest;
    physical.depthWrite = material.depthWrite;
    physical.colorWrite = material.colorWrite;
    physical.stencilWrite = material.stencilWrite;
    physical.stencilWriteMask = material.stencilWriteMask;
    physical.stencilFunc = material.stencilFunc;
    physical.stencilRef = material.stencilRef;
    physical.stencilFuncMask = material.stencilFuncMask;
    physical.stencilFail = material.stencilFail;
    physical.stencilZFail = material.stencilZFail;
    physical.stencilZPass = material.stencilZPass;
    physical.clippingPlanes = material.clippingPlanes;
    physical.clipIntersection = material.clipIntersection;
    physical.clipShadows = material.clipShadows;
    physical.clipShadows = material.clipShadows;
    physical.polygonOffset = material.polygonOffset;
    physical.polygonOffsetFactor = material.polygonOffsetFactor;
    physical.polygonOffsetUnits = material.polygonOffsetUnits;
    physical.dithering = material.dithering;
    physical.alphaTest = material.alphaTest;
    physical.alphaToCoverage = material.alphaToCoverage;
    physical.premultipliedAlpha = material.premultipliedAlpha;
    physical.forceSinglePass = material.forceSinglePass;
    physical.toneMapped = material.toneMapped;
    physical.visible = material.visible;

    material.dispose();
    return physical;
  }
}
