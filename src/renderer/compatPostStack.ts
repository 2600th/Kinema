import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";

const COMPAT_POST_SAMPLES = 4;
const COMPAT_POST_RESOLUTION_SCALE = 0.75;

export interface CompatPostStackState {
  lutTexture: THREE.Data3DTexture | null;
  lutStrength: number;
  vignetteDarkness: number;
}

type CompatComposerLike = {
  renderTarget1: { samples: number };
  renderTarget2: { samples: number };
  addPass(pass: Pass): void;
  setPixelRatio(pixelRatio: number): void;
  setSize(width: number, height: number): void;
  render(): void;
  dispose(): void;
};

type CompatGradePassLike = Pass & {
  setState(state: CompatPostStackState): void;
  dispose(): void;
};

export interface CompatPostStackFactory {
  createRenderTarget(width: number, height: number, samples: number): THREE.WebGLRenderTarget;
  createComposer(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): CompatComposerLike;
  createRenderPass(scene: THREE.Scene, camera: THREE.Camera): Pass;
  createGradePass(): CompatGradePassLike;
}

function createIdentityLut(): THREE.Data3DTexture {
  const data = new Uint8Array(2 * 2 * 2 * 4);
  let offset = 0;
  for (let z = 0; z < 2; z++) {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        data[offset++] = x * 255;
        data[offset++] = y * 255;
        data[offset++] = z * 255;
        data[offset++] = 255;
      }
    }
  }
  const texture = new THREE.Data3DTexture(data, 2, 2, 2);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.NoColorSpace;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

export class CompatGradePass extends Pass {
  readonly material: THREE.RawShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly identityLut = createIdentityLut();
  private outputColorSpace: string | null = null;
  private toneMapping: THREE.ToneMapping | null = null;
  private disposed = false;

  constructor() {
    super();
    this.material = new THREE.RawShaderMaterial({
      name: "CompatGradePass",
      glslVersion: THREE.GLSL3,
      uniforms: {
        tDiffuse: { value: null },
        lutMap: { value: this.identityLut },
        lutSize: { value: 2 },
        lutStrength: { value: 0 },
        vignetteDarkness: { value: 0 },
        toneMappingExposure: { value: 1 },
      },
      vertexShader: /* glsl */ `
        in vec3 position;
        in vec2 uv;
        out vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        precision highp sampler3D;

        uniform sampler2D tDiffuse;
        uniform sampler3D lutMap;
        uniform float lutSize;
        uniform float lutStrength;
        uniform float vignetteDarkness;

        #include <tonemapping_pars_fragment>
        #include <colorspace_pars_fragment>

        in vec2 vUv;
        out vec4 fragColor;

        void main() {
          vec4 displayColor = texture(tDiffuse, vUv);

          #ifdef LINEAR_TONE_MAPPING
            displayColor.rgb = LinearToneMapping(displayColor.rgb);
          #elif defined(REINHARD_TONE_MAPPING)
            displayColor.rgb = ReinhardToneMapping(displayColor.rgb);
          #elif defined(CINEON_TONE_MAPPING)
            displayColor.rgb = CineonToneMapping(displayColor.rgb);
          #elif defined(ACES_FILMIC_TONE_MAPPING)
            displayColor.rgb = ACESFilmicToneMapping(displayColor.rgb);
          #elif defined(AGX_TONE_MAPPING)
            displayColor.rgb = AgXToneMapping(displayColor.rgb);
          #elif defined(NEUTRAL_TONE_MAPPING)
            displayColor.rgb = NeutralToneMapping(displayColor.rgb);
          #elif defined(CUSTOM_TONE_MAPPING)
            displayColor.rgb = CustomToneMapping(displayColor.rgb);
          #endif

          #ifdef SRGB_TRANSFER
            displayColor = sRGBTransferOETF(displayColor);
          #endif

          vec2 vignetteDistance = (vUv - 0.5) * 2.0;
          float vignetteFactor = smoothstep(0.5, 1.15, length(vignetteDistance));
          float vignetteMultiplier = max(0.0, 1.0 - vignetteDarkness * vignetteFactor);
          vec4 withVignette = displayColor * vignetteMultiplier;

          float pixelWidth = 1.0 / lutSize;
          float halfPixelWidth = 0.5 / lutSize;
          vec3 lutUv = vec3(halfPixelWidth) + withVignette.rgb * (1.0 - pixelWidth);
          vec4 lutColor = vec4(texture( lutMap, lutUv ).rgb, withVignette.a);
          fragColor = mix(withVignette, lutColor, lutStrength);
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setState(state: CompatPostStackState): void {
    const lutTexture = state.lutTexture ?? this.identityLut;
    this.material.uniforms.lutMap.value = lutTexture;
    this.material.uniforms.lutSize.value = lutTexture.image.width;
    this.material.uniforms.lutStrength.value = THREE.MathUtils.clamp(state.lutStrength, 0, 1);
    this.material.uniforms.vignetteDarkness.value = THREE.MathUtils.clamp(state.vignetteDarkness, 0, 0.8);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    if (this.outputColorSpace !== renderer.outputColorSpace || this.toneMapping !== renderer.toneMapping) {
      this.outputColorSpace = renderer.outputColorSpace;
      this.toneMapping = renderer.toneMapping;
      const defines: Record<string, string> = {};
      if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) {
        defines.SRGB_TRANSFER = "";
      }
      if (renderer.toneMapping === THREE.LinearToneMapping) defines.LINEAR_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.ReinhardToneMapping) defines.REINHARD_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.CineonToneMapping) defines.CINEON_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.ACESFilmicToneMapping) defines.ACES_FILMIC_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.AgXToneMapping) defines.AGX_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.NeutralToneMapping) defines.NEUTRAL_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.CustomToneMapping) defines.CUSTOM_TONE_MAPPING = "";
      this.material.defines = defines;
      this.material.needsUpdate = true;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    this.quad.render(renderer);
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.identityLut.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

const DEFAULT_FACTORY: CompatPostStackFactory = {
  createRenderTarget(width, height, samples) {
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    target.samples = samples;
    return target;
  },
  createComposer: (renderer, target) => new EffectComposer(renderer, target),
  createRenderPass: (scene, camera) => new RenderPass(scene, camera),
  createGradePass: () => new CompatGradePass(),
};

export class CompatPostStack {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: CompatComposerLike;
  private readonly gradePass: CompatGradePassLike;
  private width: number;
  private height: number;
  private pixelRatio: number;
  private disposed = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    initialState: CompatPostStackState,
    factory: CompatPostStackFactory = DEFAULT_FACTORY,
  ) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    this.width = size.x;
    this.height = size.y;
    this.pixelRatio = renderer.getPixelRatio();
    const samples = Math.min(COMPAT_POST_SAMPLES, Math.max(0, Math.floor(renderer.capabilities.maxSamples)));
    const target = factory.createRenderTarget(size.x, size.y, samples);
    target.samples = samples;
    let composer: CompatComposerLike | null = null;
    let gradePass: CompatGradePassLike | null = null;
    try {
      composer = factory.createComposer(renderer, target);
      const renderPass = factory.createRenderPass(scene, camera);
      gradePass = factory.createGradePass();
      composer.addPass(renderPass);
      composer.addPass(gradePass);
      composer.setPixelRatio(this.pixelRatio * COMPAT_POST_RESOLUTION_SCALE);
      gradePass.setState(initialState);
    } catch (error) {
      gradePass?.dispose();
      if (composer) composer.dispose();
      else target.dispose();
      throw error;
    }
    this.composer = composer;
    this.gradePass = gradePass;
  }

  render(): void {
    const previousAutoReset = this.renderer.info.autoReset;
    this.renderer.info.autoReset = false;
    try {
      this.renderer.info.reset();
      this.composer.render();
    } finally {
      this.renderer.info.autoReset = previousAutoReset;
    }
  }

  setState(state: CompatPostStackState): void {
    this.gradePass.setState(state);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    if (pixelRatio !== this.pixelRatio) {
      this.pixelRatio = pixelRatio;
      this.composer.setPixelRatio(pixelRatio * COMPAT_POST_RESOLUTION_SCALE);
    }
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.composer.setSize(width, height);
    }
  }

  getDebugState(): { samples: [number, number]; resolutionScale: number } {
    return {
      samples: [this.composer.renderTarget1.samples, this.composer.renderTarget2.samples],
      resolutionScale: COMPAT_POST_RESOLUTION_SCALE,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gradePass.dispose();
    this.composer.dispose();
  }
}
