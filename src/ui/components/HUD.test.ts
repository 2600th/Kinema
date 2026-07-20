import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HUD } from "./HUD";

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

  toggle(value: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class FakeStyle {
  private readonly values = new Map<string, string>();
  transform = "";

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? "";
  }
}

class FakeElement {
  id = "";
  className = "";
  textContent = "";
  hidden = false;
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle();
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  removed = false;
  offsetWidth = 1;
  offsetHeight = 1;
  firstElementChild: FakeElement | null = null;

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    this.firstElementChild ??= child;
    return child;
  }

  remove(): void {
    this.removed = true;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === ".collectible-count") {
      return this.walk().find((element) => element.className.split(" ").includes("collectible-count")) ?? null;
    }
    return null;
  }

  private walk(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.walk()]);
  }
}

describe("HUD damage flash intensity", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { document?: unknown }).document = {
      createElement: () => new FakeElement(),
    };
    (globalThis as { window?: unknown }).window = globalThis;
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { document?: unknown }).document = originalDocument;
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  function findDescendant(parent: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement | null {
    for (const child of parent.children) {
      if (predicate(child)) return child;
      const nested = findDescendant(child, predicate);
      if (nested) return nested;
    }
    return null;
  }

  function createHud(): { hud: HUD; overlay: FakeElement; parent: FakeElement } {
    const parent = new FakeElement();
    const hud = new HUD(parent as unknown as HTMLElement);
    const overlay = findDescendant(parent, (child) => child.className === "hud-damage-overlay");
    if (!overlay) throw new Error("Missing damage overlay");
    return { hud, overlay, parent };
  }

  it("hides the complete HUD for editor mode without discarding live state", () => {
    const { hud, parent } = createHud();
    hud.showGameHUD();
    hud.setObjective("Reach the checkpoint");
    hud.updateCollectibles(7, 70);
    const root = findDescendant(parent, (child) => child.id === "hud");
    const collectible = findDescendant(parent, (child) => child.className.includes("hud-collectible-chip"));
    const objective = findDescendant(parent, (child) => child.id === "hud-objective");
    expect(root).not.toBeNull();
    if (!root) throw new Error("Missing HUD root");
    expect(findDescendant(root, (child) => child.id === "hud-prompt")).not.toBeNull();
    expect(findDescendant(root, (child) => child.id === "hud-hold")).not.toBeNull();
    expect(findDescendant(root, (child) => child.className === "hud-objective-region")).not.toBeNull();
    expect(findDescendant(root, (child) => child.className === "hud-crosshair")).not.toBeNull();
    expect(findDescendant(root, (child) => child.className === "hud-damage-overlay")).not.toBeNull();
    expect(collectible?.classList.contains("is-visible")).toBe(true);
    expect(collectible?.attributes.get("aria-hidden")).toBe("false");
    expect(objective?.classList.contains("is-visible")).toBe(true);
    expect(objective?.attributes.get("aria-hidden")).toBe("false");

    hud.setEditorActive(true);

    expect(root?.hidden).toBe(true);
    expect(root?.attributes.get("aria-hidden")).toBe("true");

    hud.setEditorActive(false);

    expect(root?.hidden).toBe(false);
    expect(root?.attributes.get("aria-hidden")).toBe("false");
    expect(collectible?.classList.contains("is-visible")).toBe(true);
    expect(collectible?.attributes.get("aria-hidden")).toBe("false");
    expect(objective?.classList.contains("is-visible")).toBe(true);
    expect(objective?.attributes.get("aria-hidden")).toBe("false");
    expect(findDescendant(parent, (child) => child.className === "collectible-count")?.textContent).toBe("7/70");
    expect(findDescendant(parent, (child) => child.className === "hud-objective-text")?.textContent).toBe(
      "Reach the checkpoint",
    );
  });

  it("presents value-based collectible progress and a distinct final celebration", () => {
    const { hud, parent } = createHud();
    const collectible = findDescendant(parent, (child) => child.className.includes("hud-collectible-chip"));
    const count = findDescendant(parent, (child) => child.className === "collectible-count");
    expect(collectible).not.toBeNull();

    hud.updateCollectibles(7, 70);
    expect(count?.textContent).toBe("7/70");
    expect(collectible?.attributes.get("aria-label")).toBe("Collectibles: 7 of 70");

    hud.celebrateCollectible(1);
    expect(collectible?.classList.contains("is-celebrating")).toBe(true);
    hud.celebrateAllCollectibles(70);
    expect(collectible?.classList.contains("is-celebrating")).toBe(false);
    expect(collectible?.classList.contains("is-all-collected")).toBe(true);
    expect(
      findDescendant(collectible as FakeElement, (child) => child.textContent === "All 70 collected!"),
    ).not.toBeNull();
    vi.advanceTimersByTime(1400);
    expect(collectible?.classList.contains("is-all-collected")).toBe(false);
  });

  it("composes editor hiding with menu accessibility suppression in either release order", () => {
    const { hud, parent } = createHud();
    const root = findDescendant(parent, (child) => child.id === "hud");
    expect(root).not.toBeNull();

    hud.setGameplayAccessibilitySuppressed(true);
    hud.setEditorActive(true);
    hud.setGameplayAccessibilitySuppressed(false);
    expect(root?.hidden).toBe(true);
    expect(root?.attributes.get("aria-hidden")).toBe("true");

    hud.setEditorActive(false);
    hud.setGameplayAccessibilitySuppressed(true);
    hud.setEditorActive(true);
    hud.setEditorActive(false);
    expect(root?.hidden).toBe(false);
    expect(root?.attributes.get("aria-hidden")).toBe("true");

    hud.setGameplayAccessibilitySuppressed(false);
    expect(root?.attributes.get("aria-hidden")).toBe("false");
  });

  it.each([
    ["spike", 1, "2500ms", "2500ms", 2500],
    ["spike", 0.5, "1250ms", "1250ms", 1250],
    ["fall", 1, "420ms", "320ms", 420],
    ["fall", 0.5, "210ms", "160ms", 210],
  ] as const)("scales %s at intensity %s", (reason, intensity, outerDuration, coreDuration, removalDelay) => {
    const { hud, overlay } = createHud();
    hud.setDamageFlashIntensity(intensity);

    hud.flashDamage(reason);

    expect(overlay.style.getPropertyValue("--damage-flash-intensity")).toBe(String(intensity));
    expect(overlay.style.getPropertyValue("--damage-flash-outer-duration")).toBe(outerDuration);
    expect(overlay.style.getPropertyValue("--damage-flash-core-duration")).toBe(coreDuration);
    expect(overlay.classList.contains("is-hit")).toBe(true);
    expect(overlay.classList.contains("is-fall")).toBe(reason === "fall");
    vi.advanceTimersByTime(removalDelay - 1);
    expect(overlay.classList.contains("is-hit")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(overlay.classList.contains("is-hit")).toBe(false);
  });

  it("suppresses flashes at zero and clears an active flash when intensity changes", () => {
    const { hud, overlay } = createHud();
    hud.flashDamage("spike");
    expect(overlay.classList.contains("is-hit")).toBe(true);

    hud.setDamageFlashIntensity(0);
    expect(overlay.classList.contains("is-hit")).toBe(false);
    expect(overlay.classList.contains("is-fall")).toBe(false);
    expect(overlay.style.getPropertyValue("--damage-flash-intensity")).toBe("0");

    hud.flashDamage("fall");
    expect(overlay.classList.contains("is-hit")).toBe(false);

    hud.setDamageFlashIntensity(0.5);
    hud.flashDamage("fall");
    expect(overlay.classList.contains("is-hit")).toBe(true);
  });

  it.each(["spike", "fall"] as const)("does not activate or schedule a %s flash at zero", (reason) => {
    const { hud, overlay } = createHud();
    hud.setDamageFlashIntensity(0);

    hud.flashDamage(reason);

    expect(overlay.classList.contains("is-hit")).toBe(false);
    expect(overlay.classList.contains("is-fall")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts repeated pulses without letting an old timer clear the new pulse", () => {
    const { hud, overlay } = createHud();
    hud.flashDamage("spike");
    vi.advanceTimersByTime(2000);

    hud.flashDamage("spike");
    vi.advanceTimersByTime(500);
    expect(overlay.classList.contains("is-hit")).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(overlay.classList.contains("is-hit")).toBe(false);
  });

  it("clears the active damage timer on dispose", () => {
    const { hud, overlay } = createHud();
    hud.flashDamage("fall");

    hud.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(overlay.removed).toBe(true);
  });

  it("uses explicit root motion state and a visible linear parent multiplier in CSS", () => {
    const css = readFileSync(new URL("./hud.css", import.meta.url), "utf8");
    expect(css).toContain("opacity: var(--damage-flash-intensity, 1)");
    expect(css).toContain("var(--damage-flash-outer-duration, 2.5s)");
    expect(css).toContain("var(--damage-flash-core-duration, 2.5s)");
    expect(css).toContain(':root[data-reduced-motion="reduce"]');
    expect(css).toContain(':root:not([data-reduced-motion="normal"])');
  });
});
