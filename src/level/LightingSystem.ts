import type { Disposable } from "@core/types";
import type { GraphicsProfile, ShadowQualityTier } from "@core/UserSettings";
import { getShadowMapSizeForProfile } from "@renderer/pipelineProfile";
import * as THREE from "three";

const _lightGoalPos = new THREE.Vector3();
const _lightGoalTarget = new THREE.Vector3();

/**
 * Manages all scene lighting: directional, ambient, hemisphere lights,
 * shadow quality settings, and debug helpers.
 */
export class LightingSystem implements Disposable {
  private dirLight: THREE.DirectionalLight | null = null;
  private dirLightTarget: THREE.Object3D | null = null;
  private lightDebugEnabled = false;
  private shadowDebugEnabled = false;
  private lightHelpers: THREE.Object3D[] = [];
  private shadowFrustumHelpers: THREE.CameraHelper[] = [];
  private shadowsEnabled = true;
  private graphicsProfile: GraphicsProfile = "cinematic";
  private shadowQualityTier: ShadowQualityTier = "auto";
  private lightFollowPos = new THREE.Vector3(20, 30, 10);
  private lightTargetPos = new THREE.Vector3(0, 1, 0);

  /** Objects added to scene by lighting (caller must track for unload). */
  private ownedObjects: THREE.Object3D[] = [];

  constructor(private scene: THREE.Scene) {}

  /**
   * Add ambient, hemisphere, and directional lights to the scene.
   * Returns the list of objects added so the caller can track them for disposal.
   */
  addLighting(): THREE.Object3D[] {
    this.ownedObjects = [];

    // Minimal ambient to prevent pitch-black shadows.
    const ambientLight = new THREE.AmbientLight(0xf0f0ff, 0.15);
    ambientLight.name = "__kinema_ambient";
    this.scene.add(ambientLight);
    this.ownedObjects.push(ambientLight);

    // Gentle hemisphere fill — sky white, ground blue-gray.
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.3);
    hemiLight.name = "__kinema_hemilight";
    this.scene.add(hemiLight);
    this.ownedObjects.push(hemiLight);

    // Clean sky-blue fog — pushed far back so foreground stays vibrant.
    this.scene.fog = new THREE.Fog(0xdcf2ff, 60, 200);

    // Balanced environment intensity — enough for reflections without washout.
    this.scene.environmentIntensity = 0.68;
    // Clear sunrise sky visible through open ceiling — sharp HDR, no blur.
    this.scene.backgroundIntensity = 1.0;
    this.scene.backgroundBlurriness = 0.15;

    // Warm directional key — main shadow caster.
    const dirLight = new THREE.DirectionalLight(0xfff5e0, 2.0);
    dirLight.position.set(10, 30, 8);
    dirLight.castShadow = this.shadowsEnabled;
    const shadowSize = this.getShadowMapSize();
    dirLight.shadow.mapSize.set(shadowSize, shadowSize);
    // r183 WebGPU shadows need materially less bias than the older setup.
    dirLight.shadow.normalBias = 0.004;
    dirLight.shadow.bias = 0;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 90;
    dirLight.shadow.camera.left = -35;
    dirLight.shadow.camera.right = 35;
    dirLight.shadow.camera.top = 35;
    dirLight.shadow.camera.bottom = -35;
    dirLight.shadow.radius = 2;
    dirLight.shadow.blurSamples = 8;
    dirLight.name = "__kinema_dirlight";

    const lightTarget = new THREE.Object3D();
    lightTarget.position.set(0, 1, 0);
    lightTarget.name = "__kinema_dirlight_target";
    this.scene.add(lightTarget);
    this.ownedObjects.push(lightTarget);
    dirLight.target = lightTarget;

    this.scene.add(dirLight);
    this.ownedObjects.push(dirLight);
    this.dirLight = dirLight;
    this.dirLightTarget = lightTarget;
    this.lightFollowPos.copy(dirLight.position);
    this.lightTargetPos.copy(lightTarget.position);
    this.applyDirectionalLightQuality();
    if (this.lightDebugEnabled) {
      this.ensureLightHelpers();
    }

    return this.ownedObjects;
  }

  /** Keep directional light near player for stable, sharp shadows.
   * Snaps to shadow texel grid to prevent shadow swimming/shimmer. */
  updateLighting(playerPos: THREE.Vector3): void {
    if (!this.dirLight || !this.dirLightTarget) return;
    // Snap to shadow texel size to prevent shadow swimming from continuous movement.
    const shadowFrustumSize = 70; // matches shadow.camera.left/right
    const shadowMapSize = this.dirLight.shadow.mapSize.x || 2048;
    const texelSize = shadowFrustumSize / shadowMapSize;
    const snappedX = Math.round(playerPos.x / texelSize) * texelSize;
    const snappedZ = Math.round(playerPos.z / texelSize) * texelSize;

    _lightGoalPos.set(snappedX + 10, playerPos.y + 30, snappedZ + 8);
    _lightGoalTarget.set(snappedX, playerPos.y + 1, snappedZ);
    this.lightFollowPos.lerp(_lightGoalPos, 0.08);
    this.lightTargetPos.lerp(_lightGoalTarget, 0.1);
    this.dirLight.position.copy(this.lightFollowPos);
    this.dirLightTarget.position.copy(this.lightTargetPos);
    this.updateDebugHelpers();
  }

  /** Allows runtime quality changes to update shadow map budgets. */
  setGraphicsProfile(profile: GraphicsProfile): void {
    this.graphicsProfile = profile;
    this.applyDirectionalLightQuality();
  }

  setShadowQualityTier(tier: ShadowQualityTier): void {
    this.shadowQualityTier = tier;
    this.applyDirectionalLightQuality();
  }

  getShadowQualityTier(): ShadowQualityTier {
    return this.shadowQualityTier;
  }

  setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    // IMPORTANT: Avoid toggling `light.castShadow` at runtime under WebGPU.
    // It can trigger shadow texture destruction/recreation while render commands
    // are being encoded/submitted, causing WebGPU validation errors.
    this.applyDirectionalLightQuality();
  }

  setLightDebugEnabled(enabled: boolean): void {
    this.lightDebugEnabled = enabled;
    if (!enabled) {
      this.removeLightHelpers();
      return;
    }
    this.ensureLightHelpers();
  }

  getLightDebugEnabled(): boolean {
    return this.lightDebugEnabled;
  }

  setShadowDebugEnabled(enabled: boolean): void {
    this.shadowDebugEnabled = enabled;
    if (!enabled) {
      this.removeShadowHelpers();
      return;
    }
    this.ensureShadowHelpers();
  }

  getShadowDebugEnabled(): boolean {
    return this.shadowDebugEnabled;
  }

  /** Clear light references on level unload (objects are disposed by caller). */
  clearLightReferences(): void {
    this.dirLight = null;
    this.dirLightTarget = null;
    this.removeLightHelpers();
    this.removeShadowHelpers();
    this.ownedObjects = [];
  }

  dispose(): void {
    this.clearLightReferences();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private getShadowMapSize(): number {
    const effectiveProfile = this.shadowQualityTier === "auto" ? this.graphicsProfile : this.shadowQualityTier;
    return getShadowMapSizeForProfile(effectiveProfile);
  }

  private applyDirectionalLightQuality(): void {
    if (!this.dirLight) return;
    // Keep castShadow stable; enable/disable shadowing via renderer.shadowMap.enabled instead.
    this.dirLight.castShadow = true;
    this.dirLight.shadow.autoUpdate = this.shadowsEnabled;
    if (!this.shadowsEnabled) {
      this.updateDebugHelpers();
      return;
    }
    const size = this.getShadowMapSize();
    this.dirLight.shadow.mapSize.set(size, size);
    this.dirLight.shadow.needsUpdate = true;
    this.updateDebugHelpers();
  }

  private ensureLightHelpers(): void {
    // Rebuild helpers to reflect the full light set (and any runtime changes).
    this.removeLightHelpers();

    this.scene.traverse((obj) => {
      if (!(obj as unknown as { isLight?: boolean }).isLight) return;
      const light = obj as unknown as THREE.Light & {
        isAmbientLight?: boolean;
        isDirectionalLight?: boolean;
        isPointLight?: boolean;
        isSpotLight?: boolean;
        isHemisphereLight?: boolean;
        castShadow?: boolean;
        distance?: number;
        decay?: number;
      };
      if (light.isAmbientLight) return;

      let helper: THREE.Object3D | null = null;
      if (light.isDirectionalLight) {
        helper = new THREE.DirectionalLightHelper(light as unknown as THREE.DirectionalLight, 2.2, 0xffcc66);
      } else if (light.isPointLight) {
        helper = new THREE.PointLightHelper(light as unknown as THREE.PointLight, 0.55, 0xffcc66);
      } else if (light.isSpotLight) {
        helper = new THREE.SpotLightHelper(light as unknown as THREE.SpotLight, 0xffcc66);
      } else if (light.isHemisphereLight) {
        helper = new THREE.HemisphereLightHelper(light as unknown as THREE.HemisphereLight, 1.6, 0xffcc66);
      }

      if (helper) {
        helper.userData.__kinemaLightHelper = true;
        this.scene.add(helper);
        this.lightHelpers.push(helper);
      }

      // Range visualization (radius) for local lights with finite distance.
      const distance = (light as unknown as { distance?: number }).distance ?? 0;
      if ((light.isPointLight || light.isSpotLight) && distance > 0) {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(1, 16, 12),
          new THREE.MeshBasicMaterial({
            color: light.color,
            wireframe: true,
            transparent: true,
            opacity: 0.22,
            depthTest: false,
          }),
        );
        sphere.userData.__kinemaLightHelper = true;
        sphere.userData.__kinemaLightRef = light;
        sphere.renderOrder = 9999;
        sphere.scale.setScalar(distance);
        sphere.position.copy((light as unknown as { position: THREE.Vector3 }).position);
        this.scene.add(sphere);
        this.lightHelpers.push(sphere);
      }
    });

    this.updateDebugHelpers();
  }

  private removeLightHelpers(): void {
    for (const helper of this.lightHelpers) {
      this.scene.remove(helper);
      (helper as unknown as { dispose?: () => void }).dispose?.();
      if (helper instanceof THREE.Mesh) {
        helper.geometry.dispose();
        (helper.material as THREE.Material).dispose();
      }
    }
    this.lightHelpers = [];
    // Light helpers previously included the directional shadow camera helper; keep that under the
    // dedicated shadow frustum toggle now.
    if (!this.shadowDebugEnabled) {
      this.removeShadowHelpers();
    }
  }

  private ensureShadowHelpers(): void {
    this.removeShadowHelpers();

    this.scene.traverse((obj) => {
      if (!(obj as unknown as { isLight?: boolean }).isLight) return;
      const light = obj as unknown as THREE.Light & {
        castShadow?: boolean;
        shadow?: { camera?: THREE.Camera };
      };
      if (!light.castShadow) return;
      const camera = light.shadow?.camera;
      if (!camera) return;
      const helper = new THREE.CameraHelper(camera);
      helper.userData.__kinemaLightHelper = true;
      this.scene.add(helper);
      this.shadowFrustumHelpers.push(helper);
    });

    this.updateDebugHelpers();
  }

  private removeShadowHelpers(): void {
    for (const helper of this.shadowFrustumHelpers) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.shadowFrustumHelpers = [];
  }

  private updateDebugHelpers(): void {
    if (this.lightDebugEnabled) {
      for (const helper of this.lightHelpers) {
        (helper as unknown as { update?: () => void }).update?.();
        const ref = (helper.userData?.__kinemaLightRef ?? null) as THREE.Object3D | null;
        if (ref && helper instanceof THREE.Mesh) {
          helper.position.copy(ref.position);
          helper.updateWorldMatrix(true, false);
        }
      }
    }
    if (this.shadowDebugEnabled) {
      for (const helper of this.shadowFrustumHelpers) {
        helper.update();
      }
    }
  }
}
