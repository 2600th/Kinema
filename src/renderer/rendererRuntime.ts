import type * as THREE from "three";

export type TSLPassNode = {
  setMRT(mrt: unknown): void;
  getTextureNode(name: string): unknown;
  getTexture(name: string): THREE.Texture;
};

export type TSLNode = unknown;

export type GTAONodeLike = {
  resolutionScale: number;
  useTemporalFiltering: boolean;
  samples?: { value: number };
  radius?: { value: number };
  thickness?: { value: number };
  distanceExponent?: { value: number };
  distanceFallOff?: { value: number };
  scale?: { value: number };
  updateBeforeType?: string;
  dispose?: () => void;
};

export type DenoiseNodeLike = {
  updateBeforeType?: string;
  dispose?: () => void;
};

export type TSLRuntime = {
  pass: (...args: unknown[]) => TSLPassNode;
  mrt: (attachments: Record<string, unknown>) => unknown;
  output: unknown;
  emissive: unknown;
  normalView: unknown;
  directionToColor: (node: unknown) => unknown;
  colorToDirection: (node: unknown) => unknown;
  sample: (fn: (uvNode: unknown) => unknown) => unknown;
  screenUV: unknown;
  builtinAOContext: (...args: unknown[]) => unknown;
  vec2: (...args: unknown[]) => unknown;
  vec3: (...args: unknown[]) => unknown;
  vec4: (...args: unknown[]) => unknown;
  convertToTexture: (node: unknown) => unknown;
  metalness: unknown;
  roughness: unknown;
  renderOutput: (node: unknown) => unknown;
  texture3D: (texture: THREE.Data3DTexture) => unknown;
  uniform: <T>(value: T) => { value: T };
  add: (...args: unknown[]) => unknown;
  uv: () => unknown;
  smoothstep: (...args: unknown[]) => unknown;
  float: (value: number) => unknown;
  mix: (...args: unknown[]) => unknown;
  length: (...args: unknown[]) => unknown;
  max: (...args: unknown[]) => unknown;
  min: (...args: unknown[]) => unknown;
  gtao: (...args: unknown[]) => GTAONodeLike & { getTextureNode: () => { sample: (u: unknown) => { r: TSLNode } } };
  denoise: (...args: unknown[]) => TSLNode & DenoiseNodeLike & { r: TSLNode };
  fxaa: (node: unknown) => unknown;
  smaa: (node: unknown) => unknown;
  lut3D: (...args: unknown[]) => unknown;
  bloom: (...args: unknown[]) => { rgb: TSLNode; strength: { value: number }; dispose?: () => void };
  ssr: (...args: unknown[]) => unknown;
};

export async function loadTslRuntime(): Promise<TSLRuntime> {
  const tsl = await import("three/tsl");
  const { ao: gtao } = await import("three/addons/tsl/display/GTAONode.js");
  const { denoise } = await import("three/addons/tsl/display/DenoiseNode.js");
  const { fxaa } = await import("three/addons/tsl/display/FXAANode.js");
  const { smaa } = await import("three/addons/tsl/display/SMAANode.js");
  const { lut3D } = await import("three/addons/tsl/display/Lut3DNode.js");
  const { bloom } = await import("three/addons/tsl/display/BloomNode.js");
  const { ssr } = await import("three/addons/tsl/display/SSRNode.js");

  return {
    pass: tsl.pass as TSLRuntime["pass"],
    mrt: tsl.mrt as TSLRuntime["mrt"],
    output: tsl.output,
    emissive: tsl.emissive,
    normalView: tsl.normalView,
    directionToColor: tsl.directionToColor as TSLRuntime["directionToColor"],
    colorToDirection: tsl.colorToDirection as TSLRuntime["colorToDirection"],
    sample: tsl.sample as TSLRuntime["sample"],
    screenUV: tsl.screenUV,
    builtinAOContext: tsl.builtinAOContext as TSLRuntime["builtinAOContext"],
    vec2: tsl.vec2 as TSLRuntime["vec2"],
    vec3: tsl.vec3 as TSLRuntime["vec3"],
    vec4: tsl.vec4 as TSLRuntime["vec4"],
    convertToTexture: tsl.convertToTexture as TSLRuntime["convertToTexture"],
    metalness: tsl.metalness,
    roughness: tsl.roughness,
    renderOutput: tsl.renderOutput as TSLRuntime["renderOutput"],
    texture3D: tsl.texture3D as TSLRuntime["texture3D"],
    uniform: tsl.uniform as TSLRuntime["uniform"],
    add: tsl.add as TSLRuntime["add"],
    uv: tsl.uv as TSLRuntime["uv"],
    smoothstep: tsl.smoothstep as TSLRuntime["smoothstep"],
    float: tsl.float as TSLRuntime["float"],
    mix: tsl.mix as TSLRuntime["mix"],
    length: tsl.length as TSLRuntime["length"],
    max: tsl.max as TSLRuntime["max"],
    min: tsl.min as TSLRuntime["min"],
    gtao: gtao as TSLRuntime["gtao"],
    denoise: denoise as unknown as TSLRuntime["denoise"],
    fxaa: fxaa as TSLRuntime["fxaa"],
    smaa: smaa as TSLRuntime["smaa"],
    lut3D: lut3D as TSLRuntime["lut3D"],
    bloom: bloom as TSLRuntime["bloom"],
    ssr: ssr as TSLRuntime["ssr"],
  };
}
