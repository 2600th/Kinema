import * as THREE from "three";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import type { RendererPipelineDescriptor } from "./pipelineProfile";
import type { DenoiseNodeLike, GTAONodeLike, TSLNode, TSLPassNode, TSLRuntime } from "./rendererRuntime";

export interface RendererLutPassNode {
  lutNode: { value: THREE.Data3DTexture };
  size: { value: number };
  intensityNode: { value: number };
}

export interface RendererPostFxUniforms {
  ssrOpacity: { value: number };
  vignetteDarkness: { value: number };
  lutIntensity: { value: number };
  aoStrength: { value: number };
  casStrength: { value: number };
  casTexelSize: { value: THREE.Vector2 };
}

export interface BuildRendererPipelineArgs {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  runtime: TSLRuntime;
  descriptor: RendererPipelineDescriptor;
  aoOnlyView: boolean;
  vignetteEnabled: boolean;
  vignetteDarkness: number;
  lutEnabled: boolean;
  lutStrength: number;
  ssrOpacity: number;
  ssrResolutionScale: number;
  casStrength: number;
  registerDisposable: (node: { dispose?: () => void }) => void;
}

export interface BuildRendererPipelineResult {
  postProcessing: RenderPipeline;
  postFXUniforms: RendererPostFxUniforms;
  prePassNode: (TSLPassNode & { updateBeforeType?: string; dispose?: () => void }) | null;
  aoDenoisePass: DenoiseNodeLike | null;
  gtaoPass: GTAONodeLike | null;
  bloomNodes: Array<{ strength: { value: number } }>;
  ssrNode: unknown | null;
  lutPassNode: RendererLutPassNode | null;
}

export function buildRendererPipeline(args: BuildRendererPipelineArgs): BuildRendererPipelineResult {
  const {
    renderer,
    scene,
    camera,
    runtime,
    descriptor,
    aoOnlyView,
    vignetteEnabled,
    vignetteDarkness,
    lutEnabled,
    lutStrength,
    ssrOpacity,
    ssrResolutionScale,
    casStrength,
    registerDisposable,
  } = args;

  const {
    pass,
    mrt,
    output,
    emissive,
    normalView,
    directionToColor,
    colorToDirection,
    sample,
    screenUV,
    builtinAOContext,
    vec2,
    vec3,
    vec4,
    convertToTexture,
    metalness,
    roughness,
    renderOutput,
    texture3D,
    uniform,
    add,
    uv,
    smoothstep,
    float,
    mix,
    length: tslLength,
    max: tslMax,
    min: tslMin,
    gtao,
    denoise,
    fxaa,
    smaa,
    lut3D,
    bloom,
    ssr,
  } = runtime;

  const trackTempNode = <T>(node: T): T => {
    registerDisposable(node as { dispose?: () => void });
    return node;
  };

  const ssrOpacityUniform = uniform(ssrOpacity);
  const vignetteDarknessUniform = uniform(vignetteEnabled ? vignetteDarkness : 0);
  const lutIntensityUniform = uniform(lutEnabled ? lutStrength : 0);
  const aoStrengthUniform = uniform(descriptor.useAo && !aoOnlyView ? 1 : 0);
  const casStrengthUniform = uniform(descriptor.useCAS ? casStrength : 0);
  const casTexelSizeUniform = uniform(
    new THREE.Vector2(1 / Math.max(window.innerWidth, 1), 1 / Math.max(window.innerHeight, 1)),
  );

  const postFXUniforms: RendererPostFxUniforms = {
    ssrOpacity: ssrOpacityUniform as { value: number },
    vignetteDarkness: vignetteDarknessUniform as { value: number },
    lutIntensity: lutIntensityUniform as { value: number },
    aoStrength: aoStrengthUniform as { value: number },
    casStrength: casStrengthUniform as { value: number },
    casTexelSize: casTexelSizeUniform as { value: THREE.Vector2 },
  };

  const scenePass = pass(scene, camera) as TSLPassNode & {
    contextNode?: unknown;
    getTextureNode: (name: string) => unknown;
    getTexture: (name: string) => THREE.Texture;
  };
  if (descriptor.mrtAttachments.length > 0) {
    const attachments: Record<string, unknown> = { output };
    if (descriptor.mrtAttachments.includes("metalrough")) {
      attachments.metalrough = vec2(metalness, roughness);
    }
    if (descriptor.mrtAttachments.includes("emissive")) {
      attachments.emissive = vec4(emissive, 1);
    }
    scenePass.setMRT(mrt(attachments));
    if (descriptor.mrtAttachments.includes("metalrough")) {
      scenePass.getTexture("metalrough").type = THREE.HalfFloatType;
    }
    if (descriptor.mrtAttachments.includes("emissive")) {
      scenePass.getTexture("emissive").type = THREE.HalfFloatType;
    }
  }

  const scenePassColor = scenePass.getTextureNode("output") as TSLNode;
  const scenePassDepth = scenePass.getTextureNode("depth") as TSLNode;
  const scenePassEmissive = descriptor.mrtAttachments.includes("emissive")
    ? (scenePass.getTextureNode("emissive") as TSLNode)
    : null;
  const scenePassMetalrough = descriptor.mrtAttachments.includes("metalrough")
    ? (scenePass.getTextureNode("metalrough") as TSLNode)
    : null;

  let prePassNode: (TSLPassNode & { updateBeforeType?: string; dispose?: () => void }) | null = null;
  let prePassNormal: TSLNode | null = null;
  let depthForAo = scenePassDepth;
  if (descriptor.usePrePassNormals) {
    const prePass = pass(scene, camera) as TSLPassNode & {
      transparent?: boolean;
      updateBeforeType?: string;
      dispose?: () => void;
    };
    prePass.transparent = false;
    prePass.setMRT(mrt({ output: directionToColor(normalView) }));
    prePass.getTexture("output").type = THREE.UnsignedByteType;
    const packedNormalTexture = prePass.getTextureNode("output") as { sample: (uvNode: unknown) => unknown };
    prePassNormal = sample((uvNode) => colorToDirection(packedNormalTexture.sample(uvNode))) as TSLNode;
    depthForAo = prePass.getTextureNode("depth") as TSLNode;
    prePassNode = prePass;
  }

  let gtaoPass: GTAONodeLike | null = null;
  let aoDenoisePass: DenoiseNodeLike | null = null;
  let aoOnlyOutputNode: TSLNode | null = null;
  if (descriptor.useAo) {
    const aoPass = gtao(depthForAo as never, prePassNormal as never, camera);
    gtaoPass = aoPass;
    let aoOutput = aoPass.getTextureNode() as unknown as { r: TSLNode };
    let aoLightingSource = aoPass.getTextureNode() as unknown as {
      sample: (uvNode: unknown) => { r: TSLNode };
    };
    if (descriptor.useAoDenoise) {
      const aoDenoised = denoise(
        aoPass.getTextureNode() as never,
        depthForAo as never,
        prePassNormal as never,
        camera,
      ) as unknown as TSLNode & DenoiseNodeLike & { r: TSLNode };
      aoDenoisePass = aoDenoised;
      aoOutput = aoDenoised as unknown as { r: TSLNode };
      aoLightingSource = convertToTexture(aoDenoised as never) as unknown as {
        sample: (uvNode: unknown) => { r: TSLNode };
      };
    }
    aoOnlyOutputNode = vec4(vec3(aoOutput.r as never), float(1) as never) as unknown as TSLNode;
    if (!aoOnlyView) {
      const aoLightingSample = aoLightingSource.sample(screenUV as never).r as TSLNode;
      scenePass.contextNode = builtinAOContext(
        mix(float(1) as never, aoLightingSample as never, aoStrengthUniform as never),
      );
    }
  }

  const applyDisplayOutput = (colorInput: TSLNode): TSLNode => renderOutput(colorInput as never) as TSLNode;

  const placeholderLut = new THREE.Data3DTexture(new Uint8Array(4 * 2 * 2 * 2), 2, 2, 2);
  placeholderLut.format = THREE.RGBAFormat;
  placeholderLut.type = THREE.UnsignedByteType;
  placeholderLut.colorSpace = THREE.NoColorSpace;
  placeholderLut.needsUpdate = true;
  registerDisposable({ dispose: () => placeholderLut.dispose() });

  let lutPassNode: RendererLutPassNode | null = null;
  const applyColorGrade = (displayColorInput: TSLNode): TSLNode => {
    const uvCoord = uv();
    const dist = (uvCoord as { sub: (n: number) => { mul: (n: number) => TSLNode } }).sub(0.5).mul(2);
    const vignetteFactor = smoothstep(float(0.5), float(1.15), tslLength(dist as never) as never) as TSLNode;
    const one = float(1);
    const dark = (vignetteDarknessUniform as unknown as { mul: (n: TSLNode) => TSLNode }).mul(
      vignetteFactor as never,
    ) as TSLNode;
    const mult = tslMax(float(0), (one as { sub: (n: TSLNode) => TSLNode }).sub(dark as TSLNode) as never) as TSLNode;
    const withVignette = (displayColorInput as { mul: (n: TSLNode) => TSLNode }).mul(mult as TSLNode) as TSLNode;
    const lutNode = lut3D(
      withVignette as never,
      texture3D(placeholderLut),
      placeholderLut.image.width,
      lutIntensityUniform as never,
    );
    lutPassNode = lutNode as unknown as RendererLutPassNode;
    return lutNode as TSLNode;
  };

  const applyCasSharpen = (displayColorInput: TSLNode): TSLNode => {
    const sourceTexture = convertToTexture(displayColorInput as never) as unknown as {
      uvNode?: TSLNode;
      sample: (uvNode: unknown) => TSLNode;
    };
    const sourceUv = (sourceTexture.uvNode ?? uv()) as TSLNode;
    const texel = casTexelSizeUniform as unknown as { x: TSLNode; y: TSLNode };
    const uvLeft = (sourceUv as unknown as { add: (n: unknown) => TSLNode }).add(
      vec2((texel.x as unknown as { negate: () => TSLNode }).negate() as never, float(0) as never) as never,
    ) as TSLNode;
    const uvRight = (sourceUv as unknown as { add: (n: unknown) => TSLNode }).add(
      vec2(texel.x as never, float(0) as never) as never,
    ) as TSLNode;
    const uvUp = (sourceUv as unknown as { add: (n: unknown) => TSLNode }).add(
      vec2(float(0) as never, (texel.y as unknown as { negate: () => TSLNode }).negate() as never) as never,
    ) as TSLNode;
    const uvDown = (sourceUv as unknown as { add: (n: unknown) => TSLNode }).add(
      vec2(float(0) as never, texel.y as never) as never,
    ) as TSLNode;

    const center = sourceTexture.sample(sourceUv as never) as unknown as { rgb: TSLNode; a: TSLNode };
    const left = sourceTexture.sample(uvLeft as never) as unknown as { rgb: TSLNode };
    const right = sourceTexture.sample(uvRight as never) as unknown as { rgb: TSLNode };
    const up = sourceTexture.sample(uvUp as never) as unknown as { rgb: TSLNode };
    const down = sourceTexture.sample(uvDown as never) as unknown as { rgb: TSLNode };

    const luminance = (sampled: { rgb: TSLNode }): TSLNode => {
      const rgb = sampled.rgb as unknown as { r: TSLNode; g: TSLNode; b: TSLNode };
      return tslMax(rgb.r as never, rgb.g as never, rgb.b as never) as TSLNode;
    };

    const centerLum = luminance(center);
    const leftLum = luminance(left);
    const rightLum = luminance(right);
    const upLum = luminance(up);
    const downLum = luminance(down);
    const localMax = tslMax(
      centerLum as never,
      leftLum as never,
      rightLum as never,
      upLum as never,
      downLum as never,
    ) as TSLNode;
    const localMin = tslMin(
      centerLum as never,
      leftLum as never,
      rightLum as never,
      upLum as never,
      downLum as never,
    ) as TSLNode;
    const localContrast = (localMax as unknown as { sub: (n: unknown) => TSLNode }).sub(localMin as never) as TSLNode;
    const adaptiveAmount = smoothstep(float(0.02), float(0.3), localContrast as never) as TSLNode;
    const sharpenAmount = (casStrengthUniform as unknown as { mul: (n: unknown) => TSLNode }).mul(
      adaptiveAmount as never,
    ) as TSLNode;
    const horizontalNeighbors = add(left.rgb as never, right.rgb as never) as TSLNode;
    const verticalNeighbors = add(up.rgb as never, down.rgb as never) as TSLNode;
    const neighborAverage = (
      add(horizontalNeighbors as never, verticalNeighbors as never) as unknown as {
        mul: (n: unknown) => TSLNode;
      }
    ).mul(float(0.25) as never) as TSLNode;
    const detail = (center.rgb as unknown as { sub: (n: unknown) => TSLNode }).sub(neighborAverage as never) as TSLNode;
    const sharpenedRgb = (center.rgb as unknown as { add: (n: unknown) => TSLNode }).add(
      (detail as unknown as { mul: (n: unknown) => TSLNode }).mul(sharpenAmount as never) as never,
    ) as TSLNode;
    return vec4(sharpenedRgb as never, center.a as never) as unknown as TSLNode;
  };

  let currentNode = scenePassColor;
  const keepAlphaWithRgb = (base: TSLNode, rgb: TSLNode): TSLNode =>
    vec4(rgb as never, (base as unknown as { a: TSLNode }).a as never) as unknown as TSLNode;
  const currentRgb = (): TSLNode => (currentNode as unknown as { rgb: TSLNode }).rgb;

  let ssrNode: unknown | null = null;
  if (descriptor.useSSR && scenePassMetalrough && prePassNormal) {
    const metalnessNode = (scenePassMetalrough as TSLNode & { r: TSLNode }).r;
    const roughnessNode = (scenePassMetalrough as TSLNode & { g: TSLNode }).g;
    const builtSsrNode = trackTempNode(
      ssr(
        scenePassColor as never,
        scenePassDepth as never,
        prePassNormal as never,
        metalnessNode as never,
        roughnessNode as never,
        camera,
      ),
    ) as TSLNode;
    (builtSsrNode as unknown as { resolutionScale: number }).resolutionScale = ssrResolutionScale;
    const u = builtSsrNode as unknown as {
      maxDistance: { value: number };
      thickness: { value: number };
      quality: { value: number };
    };
    const blurQ = builtSsrNode as unknown as { blurQuality: { value: number } };
    blurQ.blurQuality.value = 3;
    u.maxDistance.value = 2.5;
    u.thickness.value = 0.03;
    u.quality.value = 0.7;
    ssrNode = builtSsrNode;
    const nextRgb = add(
      currentRgb() as never,
      (builtSsrNode as unknown as { rgb: { mul: (n: unknown) => TSLNode } }).rgb.mul(ssrOpacityUniform) as never,
    ) as TSLNode;
    currentNode = keepAlphaWithRgb(currentNode, nextRgb);
  }

  const bloomNodes: Array<{ strength: { value: number } }> = [];
  if (descriptor.useBloom && scenePassEmissive) {
    const bloomNode = trackTempNode(bloom(scenePassEmissive as never, 0, 0.8, 0.05));
    bloomNodes.push(bloomNode);
    const bloomRgb = (bloomNode as unknown as { rgb: TSLNode }).rgb;
    currentNode = keepAlphaWithRgb(currentNode, add(currentRgb() as never, bloomRgb as never) as TSLNode);
  }

  if (descriptor.aaMode === "smaa") {
    currentNode = trackTempNode(smaa(currentNode as never)) as TSLNode;
  }

  currentNode = applyDisplayOutput(currentNode);

  if (descriptor.aaMode === "fxaa") {
    currentNode = trackTempNode(fxaa(currentNode as never)) as TSLNode;
  }

  if (descriptor.useCAS) {
    currentNode = applyCasSharpen(currentNode);
  }

  currentNode = applyColorGrade(currentNode);

  const postProcessing = new RenderPipeline(
    renderer,
    (aoOnlyView && aoOnlyOutputNode ? aoOnlyOutputNode : currentNode) as never,
  );
  if ("outputColorTransform" in postProcessing) {
    (postProcessing as unknown as { outputColorTransform: boolean }).outputColorTransform =
      descriptor.outputColorTransform;
  }

  return {
    postProcessing,
    postFXUniforms,
    prePassNode,
    aoDenoisePass,
    gtaoPass,
    bloomNodes,
    ssrNode,
    lutPassNode,
  };
}
