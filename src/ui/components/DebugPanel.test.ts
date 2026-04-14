import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugPanel } from "./DebugPanel";

vi.mock("@renderer/RendererManager", () => ({
  LUT_NAMES: ["Cubicle 99", "Soft Film"],
  ENV_NAMES: ["Royal Esplanade", "Studio"],
}));

class FakeStyle {
  cssText = "";
  [key: string]: string | undefined;
}

class FakeElement {
  textContent = "";
  className = "";
  title = "";
  value = "";
  checked = false;
  type = "";
  selected = false;
  parentElement: FakeElement | null = null;
  readonly style = new FakeStyle();
  readonly children: FakeElement[] = [];
  private listeners = new Map<string, (() => void)[]>();

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    if (this.tagName === "select" && child.selected) {
      this.value = child.value;
    }
    return child;
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
}

describe("DebugPanel", () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => new FakeElement(tag),
    };
  });

  afterEach(() => {
    (globalThis as { document?: unknown }).document = originalDocument;
  });

  it("keeps metric styles stable for live-updating values", () => {
    const parent = new FakeElement("div") as unknown as HTMLElement;
    const eventBus = { emit: vi.fn(), on: vi.fn(() => () => {}) };
    const panel = new DebugPanel(parent, eventBus as any) as any;

    expect(panel.metrics.style.cssText).toContain("grid-template-columns:minmax(0,1fr) 12ch");
    expect(panel.metricBackend.style.cssText).toContain("min-width:12ch");
    expect(panel.metricBackend.style.cssText).toContain("text-align:right");
    expect(panel.metricBackend.style.cssText).toContain("white-space:nowrap");
  });

  it("round-trips runtime toggles through syncRenderSettings", () => {
    const parent = new FakeElement("div") as unknown as HTMLElement;
    const eventBus = { emit: vi.fn(), on: vi.fn(() => () => {}) };
    const panel = new DebugPanel(parent, eventBus as any) as any;

    panel.syncRenderSettings({
      activeBackend: "WebGPU",
      showColliders: true,
      showLightHelpers: true,
      cameraCollision: false,
      postProcessingEnabled: true,
      shadowsEnabled: true,
      shadowQuality: "balanced",
      graphicsProfile: "balanced",
      envRotationDegrees: 15,
      aaMode: "fxaa",
      aoOnly: false,
      exposure: 0.85,
      ssaoEnabled: true,
      ssrEnabled: false,
      ssrOpacity: 0.4,
      ssrResolutionScale: 0.5,
      bloomEnabled: true,
      bloomStrength: 0.1,
      casEnabled: false,
      casStrength: 0.2,
      vignetteEnabled: true,
      vignetteDarkness: 0.25,
      lutEnabled: true,
      lutStrength: 0.42,
      lutName: "Cubicle 99",
      envName: "Royal Esplanade",
      shadowFrustums: true,
    });

    expect(panel.checkboxControls.get("showColliders").checked).toBe(true);
    expect(panel.checkboxControls.get("lightHelpers").checked).toBe(true);
    expect(panel.checkboxControls.get("cameraCollision").checked).toBe(false);
    expect(panel.checkboxControls.get("shadowFrustums").checked).toBe(true);
    expect(panel.metricBackend.textContent).toBe("WebGPU");
  });
});
