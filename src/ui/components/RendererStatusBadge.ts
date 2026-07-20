import type { Disposable } from "@core/types";
import type { RendererPresentationSource, RendererPresentationState } from "@renderer/rendererPresentation";

const FALLBACK_TOAST_DURATION_MS = 4_000;

export class RendererStatusBadge implements Disposable {
  private readonly badge: HTMLDivElement;
  private readonly toast: HTMLDivElement | null;
  private readonly unsubscribe: () => void;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private uiReady = false;
  private toastConsumed = false;

  constructor(
    private readonly parent: HTMLElement,
    source: RendererPresentationSource,
  ) {
    const initialState = source.getPresentationState();
    this.badge = document.createElement("div");
    this.badge.id = "renderer-status-badge";
    this.badge.className = "renderer-status-badge";
    parent.appendChild(this.badge);
    this.sync(initialState);

    this.toast = initialState.automaticFallback ? this.createFallbackToast() : null;
    this.unsubscribe = source.subscribePresentationState((state) => this.sync(state));
  }

  sync(state: RendererPresentationState): void {
    this.badge.textContent = state.compactLabel;
    this.badge.setAttribute("aria-label", state.settingsLabel);
  }

  notifyUiReady(): void {
    this.uiReady = true;
    this.showFallbackToastOnce();
  }

  private createFallbackToast(): HTMLDivElement {
    const toast = document.createElement("div");
    toast.className = "renderer-fallback-toast";
    toast.textContent = "Compatibility renderer active — some effects reduced";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("aria-atomic", "true");
    toast.setAttribute("aria-hidden", "true");
    this.parent.appendChild(toast);

    return toast;
  }

  private showFallbackToastOnce(): void {
    if (!this.uiReady || !this.toast || this.toastConsumed) return;
    this.toastConsumed = true;
    this.toast.setAttribute("aria-hidden", "false");
    this.toast.classList.add("is-visible");
    this.toastTimer = globalThis.setTimeout(() => {
      this.toastTimer = null;
      this.toast?.classList.remove("is-visible");
      this.toast?.setAttribute("aria-hidden", "true");
    }, FALLBACK_TOAST_DURATION_MS);
  }

  dispose(): void {
    if (this.toastTimer !== null) {
      globalThis.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.unsubscribe();
    this.badge.remove();
    this.toast?.remove();
  }
}
