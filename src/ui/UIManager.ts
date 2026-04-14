import type { EventBus } from "@core/EventBus";
import { shouldShowLandscapeHint } from "@core/mobilePlatform";
import type { Disposable } from "@core/types";
import { DeathEffect } from "./components/DeathEffect";
import { DebugPanel } from "./components/DebugPanel";
import { FadeScreen } from "./components/FadeScreen";
import { HUD } from "./components/HUD";
import { LoadingScreen } from "./components/LoadingScreen";

/**
 * DOM-based UI overlay manager.
 * Subscribes to EventBus events and manages UI components.
 */
export class UIManager implements Disposable {
  public readonly hud: HUD;
  public readonly fadeScreen: FadeScreen;
  public readonly debugPanel: DebugPanel;
  public readonly loadingScreen: LoadingScreen;
  private readonly deathEffect: DeathEffect;

  private unsubscribers: (() => void)[] = [];
  private overlayEl: HTMLElement | null = null;
  private hintEl: HTMLDivElement | null = null;
  private orientationHintEl: HTMLDivElement | null = null;
  private _onViewportMetricsChanged = this.updateOrientationHint.bind(this);

  constructor(private eventBus: EventBus) {
    let overlay = document.getElementById("ui-overlay");
    if (!overlay) {
      if (!document.body) {
        throw new Error("[UIManager] Missing #ui-overlay and document.body is unavailable.");
      }
      overlay = document.createElement("div");
      overlay.id = "ui-overlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.pointerEvents = "none";
      document.body.appendChild(overlay);
      this.overlayEl = overlay;
      console.warn("[UIManager] #ui-overlay missing. Created fallback overlay element.");
    }

    this.hud = new HUD(overlay);
    this.fadeScreen = new FadeScreen(overlay);
    this.debugPanel = new DebugPanel(overlay, this.eventBus);
    this.loadingScreen = new LoadingScreen();
    this.deathEffect = new DeathEffect(this.eventBus);

    // "Click to start" hint for audio activation
    this.createInteractionHint();
    this.createOrientationHint();

    // Wire events
    this.unsubscribers.push(
      this.eventBus.on("interaction:focusChanged", ({ id, label }) => {
        if (id && label) {
          this.hud.showPrompt(label);
        } else {
          this.hud.hidePrompt();
          this.hud.setHoldProgress(null);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("interaction:holdProgress", (payload) => {
        if (!payload) {
          this.hud.setHoldProgress(null);
          return;
        }
        this.hud.setHoldProgress(payload.progress);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("interaction:blocked", ({ reason }) => {
        this.hud.showStatus(reason, 1200);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("debug:toggle", () => {
        this.debugPanel.toggle();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("objective:set", ({ text }) => {
        this.hud.setObjective(text);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("objective:completed", ({ text }) => {
        this.hud.flashObjectiveComplete(text);
        this.hud.showStatus(`Objective complete: ${text}`);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("checkpoint:activated", () => {
        this.hud.showStatus("Checkpoint activated");
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("player:dying", () => {
        this.deathEffect.play();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("player:respawned", () => {
        this.hud.showStatus("Respawned");
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("loading:progress", ({ progress }) => {
        this.loadingScreen.setProgress(progress);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("collectible:changed", ({ count }) => {
        this.hud.updateCollectibles(count);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("collectible:collected", ({ value }) => {
        this.hud.celebrateCollectible(value);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("health:changed", ({ current, max }) => {
        this.hud.updateHealth(current, max);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("player:damaged", ({ reason }) => {
        this.hud.flashDamage(reason);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("level:loaded", () => {
        this.hud.showGameHUD();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on("level:unloaded", () => {
        this.hud.hideGameHUD();
      }),
    );
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this._onViewportMetricsChanged);
      window.removeEventListener("orientationchange", this._onViewportMetricsChanged);
      window.visualViewport?.removeEventListener("resize", this._onViewportMetricsChanged);
      window.visualViewport?.removeEventListener("scroll", this._onViewportMetricsChanged);
    }
    this.hud.dispose();
    this.fadeScreen.dispose();
    this.debugPanel.dispose();
    this.loadingScreen.dispose();
    this.deathEffect.dispose();
    this.hintEl?.remove();
    this.orientationHintEl?.remove();
    this.overlayEl?.remove();
  }

  private createInteractionHint(): void {
    if (!document.body || typeof document.addEventListener !== "function") return;

    this.hintEl = document.createElement("div");
    const hint = this.hintEl;
    hint.textContent = "Click to start";
    hint.className = "kinema-ui-hint";

    document.body.appendChild(hint);

    const dismiss = (): void => {
      document.removeEventListener("pointerdown", dismiss);
      hint.style.opacity = "0";
      setTimeout(() => {
        hint.remove();
      }, 500);
    };
    document.addEventListener("pointerdown", dismiss);
  }

  private createOrientationHint(): void {
    if (!document.body || typeof window === "undefined") return;

    this.orientationHintEl = document.createElement("div");
    const hint = this.orientationHintEl;
    hint.className = "kinema-orientation-hint";
    hint.textContent = "Rotate to landscape for the best view";
    Object.assign(hint.style, {
      position: "fixed",
      left: "50%",
      top: "max(16px, env(safe-area-inset-top))",
      transform: "translateX(-50%)",
      padding: "10px 14px",
      borderRadius: "999px",
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(7, 10, 18, 0.82)",
      color: "#f5f7ff",
      fontFamily: "'Outfit', system-ui, sans-serif",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "0.04em",
      textAlign: "center",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.2s ease",
      zIndex: "1250",
      backdropFilter: "blur(14px)",
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.28)",
    } satisfies Partial<CSSStyleDeclaration>);
    hint.style.setProperty("-webkit-backdrop-filter", "blur(14px)");
    document.body.appendChild(hint);

    window.addEventListener("resize", this._onViewportMetricsChanged);
    window.addEventListener("orientationchange", this._onViewportMetricsChanged);
    window.visualViewport?.addEventListener("resize", this._onViewportMetricsChanged);
    window.visualViewport?.addEventListener("scroll", this._onViewportMetricsChanged);
    this.updateOrientationHint();
  }

  private updateOrientationHint(): void {
    if (!this.orientationHintEl || typeof window === "undefined") return;
    const visible = shouldShowLandscapeHint(window.navigator, window);
    this.orientationHintEl.style.opacity = visible ? "1" : "0";
  }
}
