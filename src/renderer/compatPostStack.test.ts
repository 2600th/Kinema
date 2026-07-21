import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  CompatGradePass,
  CompatPostStack,
  type CompatPostStackFactory,
  type CompatPostStackState,
} from "./compatPostStack";

const INITIAL_STATE: CompatPostStackState = {
  lutTexture: null,
  lutStrength: 0.38,
  vignetteDarkness: 0,
};

describe("CompatPostStack", () => {
  it("owns one multisampled RenderPass -> raw output-grade chain", () => {
    const addedPasses: unknown[] = [];
    const renderTarget1 = { samples: 2 };
    const renderTarget2 = { samples: 2 };
    const info = { autoReset: true, reset: vi.fn() };
    const composer = {
      renderTarget1,
      renderTarget2,
      addPass: vi.fn((pass: unknown) => addedPasses.push(pass)),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      render: vi.fn(() => expect(info.autoReset).toBe(false)),
      dispose: vi.fn(),
    };
    const renderPass = { kind: "render" };
    const gradePass = { kind: "grade", setState: vi.fn(), dispose: vi.fn() };
    const target = { samples: 0 };
    const factory: CompatPostStackFactory = {
      createRenderTarget: vi.fn(() => target as never),
      createComposer: vi.fn(() => composer as never),
      createRenderPass: vi.fn(() => renderPass as never),
      createGradePass: vi.fn(() => gradePass as never),
    };
    const renderer = {
      capabilities: { maxSamples: 2 },
      getPixelRatio: () => 1.5,
      getSize: (size: THREE.Vector2) => size.set(1280, 720),
      info,
    };

    const stack = new CompatPostStack(
      renderer as never,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      INITIAL_STATE,
      factory,
    );

    expect(factory.createRenderTarget).toHaveBeenCalledWith(1280, 720, 2);
    expect(target.samples).toBe(2);
    expect(addedPasses).toEqual([renderPass, gradePass]);
    expect(composer.setPixelRatio.mock.calls[0]?.[0]).toBeCloseTo(1.125);
    expect(composer.setSize).not.toHaveBeenCalled();
    expect(gradePass.setState).toHaveBeenCalledWith(INITIAL_STATE);
    expect(stack.getDebugState()).toMatchObject({ samples: [2, 2], resolutionScale: 0.75 });

    stack.render();
    expect(composer.render).toHaveBeenCalledOnce();
    expect(info.reset).toHaveBeenCalledOnce();
    expect(info.autoReset).toBe(true);
  });

  it("restores renderer stats accounting when a composer render fails", () => {
    const failure = new Error("composer failed");
    const info = { autoReset: true, reset: vi.fn() };
    const composer = {
      renderTarget1: { samples: 2 },
      renderTarget2: { samples: 2 },
      addPass: vi.fn(),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      render: vi.fn(() => {
        expect(info.autoReset).toBe(false);
        throw failure;
      }),
      dispose: vi.fn(),
    };
    const factory: CompatPostStackFactory = {
      createRenderTarget: vi.fn(() => ({ samples: 2 }) as never),
      createComposer: vi.fn(() => composer as never),
      createRenderPass: vi.fn(() => ({}) as never),
      createGradePass: vi.fn(() => ({ setState: vi.fn(), dispose: vi.fn() }) as never),
    };
    const renderer = {
      capabilities: { maxSamples: 8 },
      getPixelRatio: () => 1,
      getSize: (size: THREE.Vector2) => size.set(800, 600),
      info,
    };
    const stack = new CompatPostStack(
      renderer as never,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      INITIAL_STATE,
      factory,
    );

    expect(factory.createRenderTarget).toHaveBeenCalledWith(800, 600, 2);
    expect(() => stack.render()).toThrow(failure);
    expect(info.reset).toHaveBeenCalledOnce();
    expect(info.autoReset).toBe(true);
  });

  it("releases the owned target if composer construction fails", () => {
    const failure = new Error("composer construction failed");
    const target = { samples: 0, dispose: vi.fn() };
    const factory: CompatPostStackFactory = {
      createRenderTarget: vi.fn(() => target as never),
      createComposer: vi.fn(() => {
        throw failure;
      }),
      createRenderPass: vi.fn(),
      createGradePass: vi.fn(),
    };
    const renderer = {
      capabilities: { maxSamples: 4 },
      getPixelRatio: () => 1,
      getSize: (size: THREE.Vector2) => size.set(800, 600),
      info: { autoReset: true, reset: vi.fn() },
    };

    expect(
      () =>
        new CompatPostStack(
          renderer as never,
          new THREE.Scene(),
          new THREE.PerspectiveCamera(),
          INITIAL_STATE,
          factory,
        ),
    ).toThrow(failure);
    expect(target.dispose).toHaveBeenCalledOnce();
  });

  it("synchronizes size, grade state, and idempotent ownership disposal", () => {
    const composer = {
      renderTarget1: { samples: 2 },
      renderTarget2: { samples: 2 },
      addPass: vi.fn(),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    };
    const gradePass = { setState: vi.fn(), dispose: vi.fn() };
    const factory: CompatPostStackFactory = {
      createRenderTarget: vi.fn(() => ({ samples: 2 }) as never),
      createComposer: vi.fn(() => composer as never),
      createRenderPass: vi.fn(() => ({}) as never),
      createGradePass: vi.fn(() => gradePass as never),
    };
    const renderer = {
      capabilities: { maxSamples: 4 },
      getPixelRatio: () => 1,
      getSize: (size: THREE.Vector2) => size.set(800, 600),
      info: { autoReset: true, reset: vi.fn() },
    };
    const stack = new CompatPostStack(
      renderer as never,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      INITIAL_STATE,
      factory,
    );
    const nextState = { ...INITIAL_STATE, lutStrength: 0.6, vignetteDarkness: 0.42 };

    composer.setPixelRatio.mockClear();
    composer.setSize.mockClear();
    stack.setSize(800, 600, 1);
    expect(composer.setPixelRatio).not.toHaveBeenCalled();
    expect(composer.setSize).not.toHaveBeenCalled();

    stack.setSize(800, 600, 1.25);
    expect(composer.setPixelRatio).toHaveBeenCalledOnce();
    expect(composer.setPixelRatio).toHaveBeenLastCalledWith(0.9375);
    expect(composer.setSize).not.toHaveBeenCalled();

    stack.setSize(1024, 576, 1.25);
    stack.setState(nextState);
    stack.dispose();
    stack.dispose();

    expect(composer.setPixelRatio).toHaveBeenCalledOnce();
    expect(composer.setSize).toHaveBeenLastCalledWith(1024, 576);
    expect(composer.setSize).toHaveBeenCalledOnce();
    expect(gradePass.setState).toHaveBeenLastCalledWith(nextState);
    expect(gradePass.dispose).toHaveBeenCalledOnce();
    expect(composer.dispose).toHaveBeenCalledOnce();
  });
});

describe("CompatGradePass", () => {
  it("uses a raw display-space shader that applies vignette before LUT grading", () => {
    const pass = new CompatGradePass();
    const texture = new THREE.Data3DTexture(new Uint8Array(32), 2, 2, 2);

    pass.setState({ lutTexture: texture, lutStrength: 0.4, vignetteDarkness: 0.3 });

    expect(pass.material).toBeInstanceOf(THREE.RawShaderMaterial);
    expect(pass.material.toneMapped).toBe(false);
    expect(pass.material.uniforms.lutMap.value).toBe(texture);
    expect(pass.material.uniforms.lutStrength.value).toBe(0.4);
    expect(pass.material.uniforms.vignetteDarkness.value).toBe(0.3);
    expect(pass.material.fragmentShader).toContain("ACESFilmicToneMapping");
    expect(pass.material.fragmentShader).toContain("sRGBTransferOETF");
    expect(pass.material.fragmentShader.indexOf("ACESFilmicToneMapping")).toBeLessThan(
      pass.material.fragmentShader.indexOf("withVignette"),
    );
    expect(pass.material.fragmentShader.indexOf("sRGBTransferOETF")).toBeLessThan(
      pass.material.fragmentShader.indexOf("withVignette"),
    );
    expect(pass.material.fragmentShader.indexOf("withVignette")).toBeLessThan(
      pass.material.fragmentShader.indexOf("texture( lutMap"),
    );
    expect(pass.material.fragmentShader).not.toContain("clamp(withVignette.rgb");

    pass.dispose();
    texture.dispose();
  });
});
