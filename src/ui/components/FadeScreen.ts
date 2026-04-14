import type { Disposable } from "@core/types";

/**
 * Full-screen fade overlay for level transitions.
 * Uses CSS opacity transitions and returns a Promise.
 */
export class FadeScreen implements Disposable {
  private overlay: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.overlay = document.createElement("div");
    this.overlay.id = "fade-screen";
    this.overlay.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: black;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.5s ease;
      z-index: 100;
    `;
    parent.appendChild(this.overlay);
  }

  /** Fade to black. Returns when transition completes. */
  fadeIn(durationMs = 500): Promise<void> {
    this.overlay.style.transition = `opacity ${durationMs}ms ease`;
    this.overlay.style.opacity = "1";
    this.overlay.style.pointerEvents = "all";
    return this.waitForTransition(durationMs);
  }

  /** Fade from black to transparent. Returns when transition completes. */
  fadeOut(durationMs = 500): Promise<void> {
    this.overlay.style.transition = `opacity ${durationMs}ms ease`;
    this.overlay.style.opacity = "0";
    return this.waitForTransition(durationMs).then(() => {
      this.overlay.style.pointerEvents = "none";
    });
  }

  private waitForTransition(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.overlay.removeEventListener("transitionend", handler);
        clearTimeout(timer);
        resolve();
      };
      const handler = () => done();
      this.overlay.addEventListener("transitionend", handler);
      const timer = setTimeout(done, durationMs + 100);
    });
  }

  dispose(): void {
    this.overlay.remove();
  }
}
