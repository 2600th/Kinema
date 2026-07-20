import "./hud.css";
import type { Disposable } from "@core/types";

/**
 * HUD component — shows interaction prompts.
 */
export class HUD implements Disposable {
  private root: HTMLDivElement;
  private container: HTMLElement;
  private prompt: HTMLDivElement;
  private holdWrap: HTMLDivElement;
  private holdFill: HTMLDivElement;
  private holdKey: HTMLDivElement;
  private objectiveRegion: HTMLDivElement;
  private objective: HTMLDivElement;
  private objectiveText: HTMLDivElement;
  private statusLane: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private damageOverlay: HTMLDivElement;
  private collectibleEl!: HTMLDivElement;
  private healthEl!: HTMLDivElement;
  private hearts: HTMLSpanElement[] = [];
  private previousObjectiveText: string | null = null;
  private previousCollectibleCount = 0;
  private previousHealth: number | null = null;
  private statusTimers = new Map<HTMLDivElement, ReturnType<typeof setTimeout>>();
  private heartTimers = new Map<HTMLSpanElement, ReturnType<typeof setTimeout>>();
  private elementTimers = new Map<HTMLElement, Map<string, ReturnType<typeof setTimeout>>>();
  private healthHitTimer: ReturnType<typeof setTimeout> | null = null;
  private damageFlashTimer: ReturnType<typeof setTimeout> | null = null;
  private holdResetTimer: ReturnType<typeof setTimeout> | null = null;
  private damageFlashIntensity = 1;
  private accessibilitySuppressed = false;
  private editorActive = false;
  private gameHudVisible = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "hud";
    this.root.className = "hud-root";
    this.root.setAttribute("aria-hidden", "false");
    parent.appendChild(this.root);
    this.container = this.root;
    this.prompt = document.createElement("div");
    this.prompt.id = "hud-prompt";
    this.prompt.className = "hud-glass-card hud-prompt";
    this.prompt.setAttribute("aria-hidden", "true");
    this.container.appendChild(this.prompt);

    this.holdWrap = document.createElement("div");
    this.holdWrap.id = "hud-hold";
    this.holdWrap.className = "hud-hold-track";
    this.holdWrap.setAttribute("role", "progressbar");
    this.holdWrap.setAttribute("aria-label", "Hold progress");
    this.holdWrap.setAttribute("aria-valuemin", "0");
    this.holdWrap.setAttribute("aria-valuemax", "100");
    this.holdWrap.setAttribute("aria-valuenow", "0");
    this.holdWrap.setAttribute("aria-hidden", "true");
    this.holdFill = document.createElement("div");
    this.holdFill.className = "hud-hold-fill";
    this.holdKey = document.createElement("div");
    this.holdKey.className = "hud-hold-key";
    this.holdKey.textContent = "F";
    const holdCaption = document.createElement("div");
    holdCaption.className = "hud-hold-caption";
    holdCaption.textContent = "Hold";
    this.holdFill.appendChild(this.holdKey);
    this.holdFill.appendChild(holdCaption);
    this.holdWrap.appendChild(this.holdFill);
    this.container.appendChild(this.holdWrap);

    this.objectiveRegion = document.createElement("div");
    this.objectiveRegion.className = "hud-objective-region";
    this.container.appendChild(this.objectiveRegion);

    this.objective = document.createElement("div");
    this.objective.id = "hud-objective";
    this.objective.className = "hud-glass-card hud-objective-card";
    this.objective.setAttribute("role", "status");
    this.objective.setAttribute("aria-live", "polite");
    this.objective.setAttribute("aria-atomic", "true");
    this.objective.setAttribute("aria-hidden", "true");
    const objectiveEyebrow = document.createElement("div");
    objectiveEyebrow.className = "hud-card-eyebrow";
    objectiveEyebrow.textContent = "Objective";
    this.objectiveText = document.createElement("div");
    this.objectiveText.className = "hud-objective-text";
    this.objective.appendChild(objectiveEyebrow);
    this.objective.appendChild(this.objectiveText);
    this.objectiveRegion.appendChild(this.objective);

    this.statusLane = document.createElement("div");
    this.statusLane.id = "hud-status-lane";
    this.statusLane.className = "hud-status-lane";
    this.statusLane.setAttribute("role", "status");
    this.statusLane.setAttribute("aria-live", "polite");
    this.statusLane.setAttribute("aria-atomic", "false");
    this.statusLane.setAttribute("aria-relevant", "additions text");
    this.statusLane.setAttribute("aria-hidden", "true");
    this.objectiveRegion.appendChild(this.statusLane);

    this.crosshair = document.createElement("div");
    this.crosshair.className = "hud-crosshair";
    this.crosshair.setAttribute("aria-hidden", "true");
    this.container.appendChild(this.crosshair);

    this.damageOverlay = document.createElement("div");
    this.damageOverlay.className = "hud-damage-overlay";
    this.damageOverlay.setAttribute("aria-hidden", "true");
    this.damageOverlay.style.setProperty("--damage-flash-intensity", "1");
    this.container.appendChild(this.damageOverlay);

    this.createCollectibleCounter();
    this.createHealthHearts();
  }

  showPrompt(text: string): void {
    this.setPrompt(text);
  }

  hidePrompt(): void {
    this.setPrompt("");
  }

  setPrompt(text: string): void {
    this.prompt.textContent = text;
    this.prompt.classList.toggle("is-visible", text.length > 0);
    this.setAccessibilityVisibility(this.prompt, text.length > 0);
  }

  setInteractionGlyph(glyph: string): void {
    this.holdKey.textContent = glyph;
  }

  setHoldProgress(progress: number | null): void {
    if (progress === null) {
      if (this.holdWrap.classList.contains("is-complete")) {
        if (this.holdResetTimer) {
          clearTimeout(this.holdResetTimer);
        }
        this.holdResetTimer = setTimeout(() => {
          this.resetHoldProgressVisuals();
          this.holdResetTimer = null;
        }, 180);
        return;
      }
      this.resetHoldProgressVisuals();
      return;
    }
    if (this.holdResetTimer) {
      clearTimeout(this.holdResetTimer);
      this.holdResetTimer = null;
    }
    const clamped = Math.max(0, Math.min(1, progress));
    this.holdWrap.classList.add("is-visible");
    this.setAccessibilityVisibility(this.holdWrap, true);
    this.holdWrap.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
    this.holdWrap.classList.toggle("is-complete", clamped >= 1);
    this.holdWrap.style.setProperty("--hold-progress", clamped.toFixed(3));
    this.holdWrap.style.setProperty("--hold-progress-angle", `${(clamped * 360).toFixed(1)}deg`);
  }

  setObjective(text: string): void {
    const changed = text !== this.previousObjectiveText;
    this.showObjective();
    this.objectiveText.textContent = text;
    if (changed) {
      this.triggerPulse(this.objective, "is-updated", 480);
      this.previousObjectiveText = text;
    }
  }

  hideObjective(): void {
    this.objective.classList.remove("is-visible");
    this.setAccessibilityVisibility(this.objective, false);
  }

  showObjective(): void {
    this.objective.classList.add("is-visible");
    this.setAccessibilityVisibility(this.objective, true);
  }

  showStatus(text: string, durationMs = 1600): void {
    const status = document.createElement("div");
    status.className = "hud-glass-card hud-status-card";
    status.textContent = text;
    status.setAttribute("aria-hidden", "false");
    this.statusLane.appendChild(status);
    void status.offsetHeight;
    status.classList.add("is-visible");

    while (this.statusLane.children.length > 3) {
      const oldest = this.statusLane.firstElementChild as HTMLDivElement | null;
      if (!oldest) break;
      this.clearStatus(oldest, true);
    }

    const timer = setTimeout(() => {
      this.clearStatus(status, false);
    }, durationMs);
    this.statusTimers.set(status, timer);
  }

  private createCollectibleCounter(): void {
    this.collectibleEl = document.createElement("div");
    this.collectibleEl.className = "hud-stat-chip hud-collectible-chip";
    this.collectibleEl.setAttribute("role", "status");
    this.collectibleEl.setAttribute("aria-live", "polite");
    this.collectibleEl.setAttribute("aria-atomic", "true");
    this.collectibleEl.setAttribute("aria-label", "Collectibles: 0 of 0");
    this.collectibleEl.setAttribute("aria-hidden", "true");

    const icon = document.createElement("div");
    icon.className = "hud-stat-icon hud-collectible-icon";
    icon.textContent = "\u2726";
    icon.setAttribute("aria-hidden", "true");

    const count = document.createElement("span");
    count.className = "collectible-count";
    count.textContent = "0/0";

    this.collectibleEl.appendChild(icon);
    this.collectibleEl.appendChild(count);
    this.container.appendChild(this.collectibleEl);
  }

  private createHealthHearts(): void {
    this.healthEl = document.createElement("div");
    this.healthEl.className = "hud-stat-chip hud-health-chip";
    this.healthEl.setAttribute("role", "status");
    this.healthEl.setAttribute("aria-live", "polite");
    this.healthEl.setAttribute("aria-atomic", "true");
    this.healthEl.setAttribute("aria-label", "Health: 3 of 3 hearts");
    this.healthEl.setAttribute("aria-hidden", "true");

    for (let i = 0; i < 3; i++) {
      const heart = document.createElement("span");
      heart.className = "hud-heart is-filled";
      heart.textContent = "\u2764";
      heart.setAttribute("aria-hidden", "true");
      this.hearts.push(heart);
      this.healthEl.appendChild(heart);
    }

    this.container.appendChild(this.healthEl);
  }

  updateCollectibles(count: number, total: number): void {
    const countEl = this.collectibleEl.querySelector(".collectible-count") as HTMLSpanElement;
    if (countEl) {
      countEl.textContent = `${count}/${total}`;
      if (count !== this.previousCollectibleCount) {
        this.triggerPulse(this.collectibleEl, "is-boosted", 440);
        countEl.style.transform = "scale(1.3)";
        setTimeout(() => {
          countEl.style.transform = "scale(1)";
        }, 200);
      }
    }
    this.collectibleEl.setAttribute("aria-label", `Collectibles: ${count} of ${total}`);
    this.previousCollectibleCount = count;
  }

  updateHealth(current: number, max: number): void {
    if (this.previousHealth !== null && current < this.previousHealth) {
      const lostCount = this.previousHealth - current;
      this.healthEl.classList.remove("is-hit");
      void this.healthEl.offsetWidth;
      this.healthEl.classList.add("is-hit");
      if (this.healthHitTimer) {
        clearTimeout(this.healthHitTimer);
      }
      this.healthHitTimer = setTimeout(() => {
        this.healthEl.classList.remove("is-hit");
        this.healthHitTimer = null;
      }, 620);

      for (let index = current; index < this.previousHealth; index++) {
        const heart = this.hearts[index];
        if (!heart) continue;
        const existing = this.heartTimers.get(heart);
        if (existing) {
          clearTimeout(existing);
        }
        heart.classList.remove("is-lost");
        void heart.offsetWidth;
        heart.classList.add("is-lost");
        const timer = setTimeout(() => {
          heart.classList.remove("is-lost");
          this.heartTimers.delete(heart);
        }, 420);
        this.heartTimers.set(heart, timer);
      }
      for (let index = 0; index < current; index++) {
        const heart = this.hearts[index];
        if (!heart) continue;
        this.triggerPulse(heart, "is-alert", 520);
      }
      this.spawnFloatingDelta(
        this.healthEl,
        lostCount === 1 ? "-1 Heart" : `-${lostCount} Hearts`,
        "hud-floating-delta health-loss",
      );
    } else if (this.previousHealth !== null && current > this.previousHealth) {
      this.triggerPulse(this.healthEl, "is-restored", 460);
      for (let index = this.previousHealth; index < current; index++) {
        const heart = this.hearts[index];
        if (!heart) continue;
        this.triggerPulse(heart, "is-refilled", 420);
      }
    }

    this.hearts.forEach((heart, i) => {
      const filled = i < current;
      heart.classList.toggle("is-filled", filled);
      heart.classList.toggle("is-empty", !filled);
    });
    this.healthEl.setAttribute("aria-label", `Health: ${current} of ${max} hearts`);
    this.previousHealth = current;
  }

  celebrateCollectible(value: number): void {
    this.triggerPulse(this.collectibleEl, "is-celebrating", 520);
    this.spawnFloatingDelta(this.collectibleEl, `+${value}`, "hud-floating-delta collectible");
  }

  celebrateAllCollectibles(total: number): void {
    this.clearPulse(this.collectibleEl, "is-boosted");
    this.clearPulse(this.collectibleEl, "is-celebrating");
    this.triggerPulse(this.collectibleEl, "is-all-collected", 1400);
    this.spawnFloatingDelta(
      this.collectibleEl,
      `All ${total} collected!`,
      "hud-floating-delta collectible collectible-complete",
    );
  }

  flashObjectiveComplete(text: string): void {
    this.triggerPulse(this.objective, "is-complete", 620);
    this.spawnFloatingDelta(this.objective, "Complete", "hud-floating-delta objective");
    if (this.objectiveText.textContent !== text) {
      this.objectiveText.textContent = text;
    }
  }

  flashDamage(reason: "spike" | "fall"): void {
    if (this.damageFlashIntensity === 0) return;
    this.clearDamageFlash();
    this.damageOverlay.classList.toggle("is-fall", reason === "fall");
    const outerDuration = (reason === "fall" ? 420 : 2500) * this.damageFlashIntensity;
    const coreDuration = (reason === "fall" ? 320 : 2500) * this.damageFlashIntensity;
    this.damageOverlay.style.setProperty("--damage-flash-outer-duration", `${outerDuration}ms`);
    this.damageOverlay.style.setProperty("--damage-flash-core-duration", `${coreDuration}ms`);
    void this.damageOverlay.offsetWidth;
    this.damageOverlay.classList.add("is-hit");
    this.damageFlashTimer = setTimeout(
      () => {
        this.damageOverlay.classList.remove("is-hit", "is-fall");
        this.damageFlashTimer = null;
      },
      Math.max(outerDuration, coreDuration),
    );
  }

  setDamageFlashIntensity(value: number): void {
    const intensity = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
    if (intensity !== this.damageFlashIntensity) this.clearDamageFlash();
    this.damageFlashIntensity = intensity;
    this.damageOverlay.style.setProperty("--damage-flash-intensity", String(intensity));
  }

  showGameHUD(): void {
    this.gameHudVisible = true;
    this.collectibleEl.classList.add("is-visible");
    this.healthEl.classList.add("is-visible");
    this.setAccessibilityVisibility(this.collectibleEl, true);
    this.setAccessibilityVisibility(this.healthEl, true);
    this.setAccessibilityVisibility(this.statusLane, true);
  }

  hideGameHUD(): void {
    this.gameHudVisible = false;
    this.hidePrompt();
    this.resetHoldProgressVisuals();
    this.hideObjective();
    this.collectibleEl.classList.remove("is-visible");
    this.healthEl.classList.remove("is-visible");
    this.setAccessibilityVisibility(this.collectibleEl, false);
    this.setAccessibilityVisibility(this.healthEl, false);
    this.setAccessibilityVisibility(this.statusLane, false);
    for (const status of Array.from(this.statusLane.children)) {
      this.clearStatus(status as HTMLDivElement, true);
    }
  }

  setGameplayAccessibilitySuppressed(suppressed: boolean): void {
    this.accessibilitySuppressed = suppressed;
    this.updateRootAccessibility();
    this.setAccessibilityVisibility(this.prompt, this.prompt.classList.contains("is-visible"));
    this.setAccessibilityVisibility(this.holdWrap, this.holdWrap.classList.contains("is-visible"));
    this.setAccessibilityVisibility(this.objective, this.objective.classList.contains("is-visible"));
    this.setAccessibilityVisibility(
      this.collectibleEl,
      this.gameHudVisible && this.collectibleEl.classList.contains("is-visible"),
    );
    this.setAccessibilityVisibility(
      this.healthEl,
      this.gameHudVisible && this.healthEl.classList.contains("is-visible"),
    );
    this.setAccessibilityVisibility(this.statusLane, this.gameHudVisible);
  }

  setEditorActive(active: boolean): void {
    this.editorActive = active;
    this.root.hidden = active;
    this.updateRootAccessibility();
  }

  dispose(): void {
    for (const timer of this.statusTimers.values()) {
      clearTimeout(timer);
    }
    this.statusTimers.clear();
    for (const timer of this.heartTimers.values()) {
      clearTimeout(timer);
    }
    this.heartTimers.clear();
    for (const timers of this.elementTimers.values()) {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    }
    this.elementTimers.clear();
    if (this.healthHitTimer) {
      clearTimeout(this.healthHitTimer);
      this.healthHitTimer = null;
    }
    this.clearDamageFlash();
    if (this.holdResetTimer) {
      clearTimeout(this.holdResetTimer);
      this.holdResetTimer = null;
    }
    this.prompt.remove();
    this.holdWrap.remove();
    this.objectiveRegion.remove();
    this.objective.remove();
    this.crosshair.remove();
    this.damageOverlay.remove();
    this.collectibleEl.remove();
    this.healthEl.remove();
    this.root.remove();
  }

  private clearStatus(status: HTMLDivElement, immediate: boolean): void {
    const timer = this.statusTimers.get(status);
    if (timer) {
      clearTimeout(timer);
      this.statusTimers.delete(status);
    }

    if (immediate) {
      status.remove();
      return;
    }

    status.classList.remove("is-visible");
    status.setAttribute("aria-hidden", "true");
    window.setTimeout(() => status.remove(), 180);
  }

  private resetHoldProgressVisuals(): void {
    this.holdWrap.classList.remove("is-visible", "is-complete");
    this.setAccessibilityVisibility(this.holdWrap, false);
    this.holdWrap.setAttribute("aria-valuenow", "0");
    this.holdWrap.style.setProperty("--hold-progress", "0");
    this.holdWrap.style.setProperty("--hold-progress-angle", "0deg");
  }

  private triggerPulse(element: HTMLElement, className: string, durationMs: number): void {
    let timers = this.elementTimers.get(element);
    if (!timers) {
      timers = new Map();
      this.elementTimers.set(element, timers);
    }
    const existing = timers.get(className);
    if (existing) {
      clearTimeout(existing);
    }
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    const timer = setTimeout(() => {
      element.classList.remove(className);
      timers.delete(className);
      if (timers.size === 0) {
        this.elementTimers.delete(element);
      }
    }, durationMs);
    timers.set(className, timer);
  }

  private clearPulse(element: HTMLElement, className: string): void {
    const timers = this.elementTimers.get(element);
    const timer = timers?.get(className);
    if (timer) {
      clearTimeout(timer);
      timers?.delete(className);
      if (timers?.size === 0) {
        this.elementTimers.delete(element);
      }
    }
    element.classList.remove(className);
  }

  private clearDamageFlash(): void {
    if (this.damageFlashTimer) {
      clearTimeout(this.damageFlashTimer);
      this.damageFlashTimer = null;
    }
    this.damageOverlay.classList.remove("is-hit", "is-fall");
  }

  private setAccessibilityVisibility(element: HTMLElement, visible: boolean): void {
    element.setAttribute("aria-hidden", String(this.accessibilitySuppressed || !visible));
  }

  private updateRootAccessibility(): void {
    this.root.setAttribute("aria-hidden", String(this.editorActive || this.accessibilitySuppressed));
  }

  private spawnFloatingDelta(parent: HTMLElement, text: string, className: string): void {
    const delta = document.createElement("div");
    delta.className = className;
    delta.textContent = text;
    delta.setAttribute("aria-hidden", "true");
    parent.appendChild(delta);
    void delta.offsetWidth;
    delta.classList.add("is-visible");
    window.setTimeout(() => {
      delta.classList.remove("is-visible");
      window.setTimeout(() => delta.remove(), 220);
    }, 320);
  }
}
