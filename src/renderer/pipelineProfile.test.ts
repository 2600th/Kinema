import { describe, expect, it } from "vitest";
import {
  buildRendererPipelineDescriptor,
  getRendererMaxPixelRatio,
  getShadowMapSizeForProfile,
} from "./pipelineProfile";

describe("pipelineProfile", () => {
  it("builds the balanced descriptor from the attached r183 guidance", () => {
    const descriptor = buildRendererPipelineDescriptor({
      profile: "balanced",
      aaMode: "fxaa",
      postProcessingEnabled: true,
      aoEnabled: true,
      aoOnlyView: false,
      bloomEnabled: true,
      ssrEnabled: true,
      casEnabled: true,
      casStrength: 0.3,
      vignetteEnabled: true,
      lutEnabled: true,
    });

    expect(descriptor.kind).toBe("balanced");
    expect(descriptor.useRenderPipeline).toBe(true);
    expect(descriptor.manualRenderOutput).toBe(true);
    expect(descriptor.outputColorTransform).toBe(false);
    expect(descriptor.usePrePassNormals).toBe(false);
    expect(descriptor.useAo).toBe(true);
    expect(descriptor.useAoDenoise).toBe(false);
    expect(descriptor.aoResolutionScale).toBe(0.5);
    expect(descriptor.aoSamples).toBe(8);
    expect(descriptor.useBloom).toBe(true);
    expect(descriptor.useSSR).toBe(false);
    expect(descriptor.useCAS).toBe(false);
    expect(descriptor.mrtAttachments).toEqual(["emissive"]);
  });

  it("builds a direct performance descriptor when no post pipeline is needed", () => {
    const descriptor = buildRendererPipelineDescriptor({
      profile: "performance",
      aaMode: "none",
      postProcessingEnabled: false,
      aoEnabled: false,
      aoOnlyView: false,
      bloomEnabled: false,
      ssrEnabled: false,
      casEnabled: false,
      casStrength: 0,
      vignetteEnabled: false,
      lutEnabled: false,
    });

    expect(descriptor.kind).toBe("direct");
    expect(descriptor.useRenderPipeline).toBe(false);
    expect(descriptor.mrtAttachments).toEqual([]);
  });

  it("keeps the cinematic descriptor as the full-fat path", () => {
    const descriptor = buildRendererPipelineDescriptor({
      profile: "cinematic",
      aaMode: "smaa",
      postProcessingEnabled: true,
      aoEnabled: true,
      aoOnlyView: false,
      bloomEnabled: true,
      ssrEnabled: true,
      casEnabled: true,
      casStrength: 0.3,
      vignetteEnabled: true,
      lutEnabled: true,
    });

    expect(descriptor.kind).toBe("cinematic");
    expect(descriptor.usePrePassNormals).toBe(true);
    expect(descriptor.useAoDenoise).toBe(true);
    expect(descriptor.useBloom).toBe(true);
    expect(descriptor.useSSR).toBe(true);
    expect(descriptor.useCAS).toBe(true);
    expect(descriptor.mrtAttachments).toEqual(["metalrough", "emissive"]);
  });

  it("exposes the expected DPR and shadow budgets", () => {
    expect(getRendererMaxPixelRatio("performance")).toBe(1);
    expect(getRendererMaxPixelRatio("balanced")).toBe(1.5);
    expect(getRendererMaxPixelRatio("cinematic")).toBe(2);
    expect(getShadowMapSizeForProfile("performance")).toBe(1024);
    expect(getShadowMapSizeForProfile("balanced")).toBe(1024);
    expect(getShadowMapSizeForProfile("cinematic")).toBe(2048);
  });
});
