import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Disposable } from '@core/types';

/**
 * Wraps the renderer, scene, camera, and post-processing chain.
 */
export class RendererManager implements Disposable {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private smaaPass: SMAAPass;

  private _onResize = this.handleResize.bind(this);

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa9b9ee);
    this.scene.fog = new THREE.Fog(0xa9b9ee, 85, 260);
    this.renderer.setClearColor(0xa9b9ee, 1);

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 5, 10);
    this.camera.lookAt(0, 0, 0);

    // Three.js current post-processing pipeline: RenderPass -> Bloom -> OutputPass.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.02,
      0.1,
      0.99,
    );
    this.composer.addPass(this.bloomPass);
    this.smaaPass = new SMAAPass();
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(new OutputPass());
  }

  /** Must be called before first render. */
  async init(): Promise<void> {
    document.body.style.margin = '0';
    document.body.style.background = '#a9b9ee';
    document.body.style.backgroundAttachment = 'fixed';

    this.renderer.domElement.style.position = 'fixed';
    this.renderer.domElement.style.inset = '0';
    this.renderer.domElement.style.zIndex = '0';
    document.body.appendChild(this.renderer.domElement);
    window.addEventListener('resize', this._onResize);
    console.log('[RendererManager] Initialized');
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  /** Render one frame. */
  render(): void {
    this.composer.render();
  }

  /** Set the animation loop callback. */
  setAnimationLoop(callback: ((time: DOMHighResTimeStamp) => void) | null): void {
    this.renderer.setAnimationLoop(callback);
  }

  private handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.smaaPass.setSize(
      w * this.renderer.getPixelRatio(),
      h * this.renderer.getPixelRatio(),
    );
  }

  dispose(): void {
    window.removeEventListener('resize', this._onResize);
    this.renderer.setAnimationLoop(null);
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
