import type { EventBus } from "@core/EventBus";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import type { EditorManager } from "@editor/EditorManager";
import type { LevelManager } from "@level/LevelManager";
import type { NavDebugOverlay } from "@navigation/NavDebugOverlay";
import type { NavPatrolSystem } from "@navigation/NavPatrolSystem";
import type { PhysicsDebugView } from "@physics/PhysicsDebugView";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type { RendererManager } from "@renderer/RendererManager";
import * as THREE from "three";

export class DebugRuntimeSystem implements RuntimeSystem {
  readonly id = "debug";

  private physicsDebugView: PhysicsDebugView | null = null;
  private colliderDebugEnabled = false;
  private navPatrolSystem: NavPatrolSystem | null = null;
  private navDebugOverlay: NavDebugOverlay | null = null;
  private navTargetMode = false;
  private _onNavTargetClick: ((e: MouseEvent) => void) | null = null;
  private navTargetMarker: THREE.Mesh | null = null;
  private navMarkerFade = 0;
  private readonly navRaycaster = new THREE.Raycaster();
  private readonly navPointer = new THREE.Vector2();
  private unsubs: (() => void)[] = [];
  private editorManager: EditorManager | null = null;

  constructor(
    private renderer: RendererManager,
    private physicsWorld: PhysicsWorld,
    private eventBus: EventBus,
    private levelManager: LevelManager,
  ) {
    this.unsubs.push(
      this.eventBus.on("debug:showColliders", (enabled) => {
        this.colliderDebugEnabled = enabled;
        if (this.physicsDebugView) {
          this.physicsDebugView.setEnabled(enabled);
        } else {
          void this.ensurePhysicsDebugView().then((v) => v.setEnabled(enabled));
        }
      }),
    );
  }

  setEditorManager(manager: EditorManager): void {
    this.editorManager = manager;
  }

  setupLevel(): void {
    this.navPatrolSystem = this.levelManager.getNavPatrolSystem();
    this.navDebugOverlay = this.levelManager.getNavDebugOverlay();
  }

  teardownLevel(): void {
    this.navPatrolSystem = null;
    this.navDebugOverlay = null;
    this.navTargetMode = false;
    if (this._onNavTargetClick) {
      window.removeEventListener("click", this._onNavTargetClick);
      this._onNavTargetClick = null;
    }
    if (this.navTargetMarker) {
      this.renderer.scene.remove(this.navTargetMarker);
      this.navTargetMarker.geometry.dispose();
      (this.navTargetMarker.material as THREE.Material).dispose();
      this.navTargetMarker = null;
    }
  }

  fixedUpdate(dt: number): void {
    this.navPatrolSystem?.update(dt);
  }

  getColliderDebugEnabled(): boolean {
    return this.colliderDebugEnabled;
  }

  update(dt: number, _alpha: number): void {
    this.physicsDebugView?.update();

    // Nav target marker fade
    if (this.navMarkerFade > 0 && this.navTargetMarker) {
      this.navMarkerFade = Math.max(0, this.navMarkerFade - dt / 3);
      (this.navTargetMarker.material as THREE.MeshBasicMaterial).opacity = 0.8 * this.navMarkerFade;
      if (this.navMarkerFade <= 0) {
        this.renderer.scene.remove(this.navTargetMarker);
        this.navTargetMarker.geometry.dispose();
        (this.navTargetMarker.material as THREE.Material).dispose();
        this.navTargetMarker = null;
      }
    }
  }

  /** Handle debug keys that belong to this subsystem (N, T — nav debug). */
  handleDebugKeyDown(e: KeyboardEvent): boolean {
    // Navigation debug keys -- only when editor is NOT active.
    if (this.editorManager?.isActive()) return false;

    if (e.code === "KeyN") {
      this.navDebugOverlay?.toggle();
      console.log(`[Nav] debug overlay toggled`);
      return true;
    }
    if (e.code === "KeyT") {
      if (!this.navPatrolSystem) return false;
      this.navTargetMode = !this.navTargetMode;
      console.log(`[Nav] target mode ${this.navTargetMode ? "ON — click floor to redirect nearest agent" : "OFF"}`);
      if (this.navTargetMode) {
        document.exitPointerLock();
        this._onNavTargetClick = (ev: MouseEvent) => this.handleNavTargetClick(ev);
        window.addEventListener("click", this._onNavTargetClick);
      } else {
        if (this._onNavTargetClick) {
          window.removeEventListener("click", this._onNavTargetClick);
          this._onNavTargetClick = null;
        }
      }
      return true;
    }
    return false;
  }

  private handleNavTargetClick(ev: MouseEvent): void {
    if (!this.navPatrolSystem || !this.navTargetMode) return;

    const navPlatform = this.renderer.scene.getObjectByName("NavPlatform");
    if (!navPlatform) return;

    const rect = this.renderer.canvas.getBoundingClientRect();
    const ndcX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.navPointer.set(ndcX, ndcY);
    this.navRaycaster.setFromCamera(this.navPointer, this.renderer.camera);
    const hits = this.navRaycaster.intersectObjects([navPlatform], false);

    if (hits.length === 0) return;

    const hit = hits[0];
    const agent = this.navPatrolSystem.requestTargetForNearest(hit.point);

    if (agent) {
      console.log(
        `[Nav] target set at (${hit.point.x.toFixed(1)}, ${hit.point.y.toFixed(1)}, ${hit.point.z.toFixed(1)})`,
      );
      this.showNavTargetMarker(hit.point);
      agent.highlight();
    } else {
      console.log("[Nav] click did not resolve to a walkable navmesh point");
    }

    this.navTargetMode = false;
    if (this._onNavTargetClick) {
      window.removeEventListener("click", this._onNavTargetClick);
      this._onNavTargetClick = null;
    }
  }

  private showNavTargetMarker(position: THREE.Vector3): void {
    if (this.navTargetMarker) {
      this.renderer.scene.remove(this.navTargetMarker);
      this.navTargetMarker.geometry.dispose();
      (this.navTargetMarker.material as THREE.Material).dispose();
    }

    const geo = new THREE.RingGeometry(0.3, 0.5, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.navTargetMarker = new THREE.Mesh(geo, mat);
    this.navTargetMarker.position.set(position.x, position.y + 0.05, position.z);
    this.navTargetMarker.name = "NavTargetMarker";
    this.renderer.scene.add(this.navTargetMarker);

    this.navMarkerFade = 1;
  }

  private async ensurePhysicsDebugView(): Promise<PhysicsDebugView> {
    if (!this.physicsDebugView) {
      const { PhysicsDebugView } = await import("@physics/PhysicsDebugView");
      this.physicsDebugView = new PhysicsDebugView(this.renderer.scene, this.physicsWorld);
    }
    return this.physicsDebugView;
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    if (this._onNavTargetClick) {
      window.removeEventListener("click", this._onNavTargetClick);
      this._onNavTargetClick = null;
    }
    if (this.navTargetMarker) {
      this.renderer.scene.remove(this.navTargetMarker);
      this.navTargetMarker.geometry.dispose();
      (this.navTargetMarker.material as THREE.Material).dispose();
      this.navTargetMarker = null;
    }
    this.physicsDebugView?.dispose();
  }
}
