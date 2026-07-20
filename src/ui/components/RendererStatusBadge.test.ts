import type { RendererPresentationState } from "@renderer/rendererPresentation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererStatusBadge } from "./RendererStatusBadge";

class FakeClassList {
  private readonly values = new Set<string>();

  add(...values: string[]): void {
    for (const value of values) this.values.add(value);
  }

  remove(...values: string[]): void {
    for (const value of values) this.values.delete(value);
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }
}

class FakeElement {
  id = "";
  textContent = "";
  className = "";
  readonly classList = new FakeClassList();
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  removed = false;

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  remove(): void {
    this.removed = true;
  }
}

function presentation(overrides: Partial<RendererPresentationState> = {}): RendererPresentationState {
  return {
    activeBackend: "WebGLRenderer",
    compactBackendLabel: "WebGL",
    profile: "balanced",
    compactLabel: "WebGL · balanced",
    settingsLabel: "Renderer: WebGLRenderer · Applied profile: balanced · Post effects unavailable",
    compatibilityActive: true,
    automaticFallback: false,
    fallbackReason: null,
    ...overrides,
  };
}

function source(initial: RendererPresentationState) {
  let listener: ((state: RendererPresentationState) => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    source: {
      getPresentationState: () => initial,
      subscribePresentationState: vi.fn((next: (state: RendererPresentationState) => void) => {
        listener = next;
        return unsubscribe;
      }),
    },
    emit: (state: RendererPresentationState) => listener?.(state),
    unsubscribe,
  };
}

describe("RendererStatusBadge", () => {
  const originalDocument = globalThis.document;
  let parent: FakeElement;

  beforeEach(() => {
    vi.useFakeTimers();
    parent = new FakeElement();
    (globalThis as { document?: unknown }).document = {
      createElement: () => new FakeElement(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { document?: unknown }).document = originalDocument;
  });

  it("keeps a live, accessible badge synchronized with the applied renderer state", () => {
    const presentationSource = source(presentation());
    const status = new RendererStatusBadge(parent as unknown as HTMLElement, presentationSource.source);
    const badge = parent.children[0];

    expect(badge.id).toBe("renderer-status-badge");
    expect(badge.textContent).toBe("WebGL · balanced");
    expect(badge.attributes.has("aria-live")).toBe(false);

    presentationSource.emit(
      presentation({
        activeBackend: "WebGPU",
        compactBackendLabel: "WebGPU",
        profile: "cinematic",
        compactLabel: "WebGPU · cinematic",
        settingsLabel:
          "Renderer: WebGPU · Applied profile: cinematic · Available post: SSAO, SSR, Bloom, Vignette, LUT",
        compatibilityActive: false,
      }),
    );

    expect(badge.textContent).toBe("WebGPU · cinematic");
    expect(badge.attributes.get("aria-label")).toBe(
      "Renderer: WebGPU · Applied profile: cinematic · Available post: SSAO, SSR, Bloom, Vignette, LUT",
    );
    status.dispose();
    expect(badge.removed).toBe(true);
    expect(presentationSource.unsubscribe).toHaveBeenCalledOnce();
  });

  it("shows one four-second toast only for an automatic compatibility fallback", () => {
    const presentationSource = source(presentation({ automaticFallback: true, fallbackReason: "platform" }));
    const status = new RendererStatusBadge(parent as unknown as HTMLElement, presentationSource.source);
    const toast = parent.children[1];

    expect(toast.textContent).toBe("Compatibility renderer active — some effects reduced");
    expect(toast.attributes.get("role")).toBe("status");
    expect(toast.attributes.get("aria-live")).toBe("polite");
    expect(toast.classList.contains("is-visible")).toBe(false);
    status.notifyUiReady();
    expect(toast.classList.contains("is-visible")).toBe(true);
    expect(toast.attributes.get("aria-hidden")).toBe("false");

    vi.advanceTimersByTime(2_000);
    status.notifyUiReady();
    vi.advanceTimersByTime(2_000);

    expect(toast.classList.contains("is-visible")).toBe(false);
    expect(toast.attributes.get("aria-hidden")).toBe("true");
    status.notifyUiReady();
    expect(toast.classList.contains("is-visible")).toBe(false);
    status.dispose();
  });

  it("does not create a toast for an explicit compatibility request", () => {
    const presentationSource = source(presentation());
    const status = new RendererStatusBadge(parent as unknown as HTMLElement, presentationSource.source);

    status.notifyUiReady();
    expect(parent.children).toHaveLength(1);
    status.dispose();
  });
});
