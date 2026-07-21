import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hudDispose = vi.fn();
const fadeDispose = vi.fn();
const debugDispose = vi.fn();
const hudInstances: any[] = [];
const rendererStatusInstances: Array<{
  notifyUiReady: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("./components/HUD", () => ({
  HUD: class {
    showPrompt = vi.fn();
    hidePrompt = vi.fn();
    setPrompt = vi.fn();
    setInteractionGlyph = vi.fn();
    setHoldProgress = vi.fn();
    showStatus = vi.fn();
    setObjective = vi.fn();
    flashObjectiveComplete = vi.fn();
    updateCollectibles = vi.fn();
    celebrateCollectible = vi.fn();
    celebrateAllCollectibles = vi.fn();
    updateHealth = vi.fn();
    flashDamage = vi.fn();
    setDamageFlashIntensity = vi.fn();
    showGameHUD = vi.fn();
    hideGameHUD = vi.fn();
    setEditorActive = vi.fn();
    setGameplayAccessibilitySuppressed = vi.fn();
    dispose = hudDispose;
    constructor(_parent: HTMLElement) {
      hudInstances.push(this);
    }
  },
}));

vi.mock("./components/FadeScreen", () => ({
  FadeScreen: class {
    dispose = fadeDispose;
    constructor(_parent: HTMLElement) {}
  },
}));

vi.mock("./components/DebugPanel", () => ({
  DebugPanel: class {
    toggle = vi.fn();
    dispose = debugDispose;
    constructor(_parent: HTMLElement) {}
  },
}));

vi.mock("./components/LoadingScreen", () => ({
  LoadingScreen: class {
    setProgress = vi.fn();
    setStatus = vi.fn();
    show = vi.fn();
    hide = vi.fn(() => Promise.resolve());
    dispose = vi.fn();
  },
}));

vi.mock("./components/DeathEffect", () => ({
  DeathEffect: class {
    play = vi.fn();
    dispose = vi.fn();
    constructor(_eventBus: any) {}
  },
}));

vi.mock("./components/RendererStatusBadge", () => ({
  RendererStatusBadge: class {
    notifyUiReady = vi.fn();
    dispose = vi.fn();
    constructor(_parent: HTMLElement, _source: unknown) {
      rendererStatusInstances.push(this);
    }
  },
}));

import { createDefaultKeyboardBindings } from "@input/InputBindings";
import { UIManager } from "./UIManager";

type LoadingScreenDouble = {
  setProgress: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
};

describe("UIManager", () => {
  const appendBodyChild = vi.fn();
  const createElement = vi.fn(() => ({ id: "", style: {} as Record<string, string>, remove: vi.fn() }));
  const getElementById = vi.fn(() => null);
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hudInstances.length = 0;
    rendererStatusInstances.length = 0;
    appendBodyChild.mockClear();
    createElement.mockClear();
    getElementById.mockClear();
    (globalThis as any).document = {
      getElementById,
      createElement,
      body: { appendChild: appendBodyChild },
    };
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("routes optional loading stages without replacing progress updates", () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const ui = new UIManager({ on } as any);
    const loading = ui.loadingScreen as unknown as LoadingScreenDouble;

    listeners.get("loading:progress")?.({ progress: 0.96, status: "Compiling shaders…" });
    listeners.get("loading:progress")?.({ progress: 1 });

    expect(loading.setProgress).toHaveBeenNthCalledWith(1, 0.96);
    expect(loading.setProgress).toHaveBeenNthCalledWith(2, 1);
    expect(loading.setStatus).toHaveBeenCalledOnce();
    expect(loading.setStatus).toHaveBeenCalledWith("Compiling shaders…");
    ui.dispose();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("creates fallback overlay when #ui-overlay is missing", () => {
    const on = vi.fn(() => () => {});
    const eventBus = { on };

    const ui = new UIManager(eventBus as any);

    expect(getElementById).toHaveBeenCalledWith("ui-overlay");
    expect(createElement).toHaveBeenCalledWith("div");
    expect(appendBodyChild).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("[UIManager] #ui-overlay missing. Created fallback overlay element.");
    ui.dispose();
  });

  it("routes objective updates to the pinned objective card and completion to status toasts", () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const eventBus = { on };

    const ui = new UIManager(eventBus as any);
    const hud = hudInstances[0];

    listeners.get("objective:set")?.({ id: "reach-beacon", text: "Reach the beacon" });
    listeners.get("objective:completed")?.({ text: "Reach the beacon" });
    listeners.get("objective:set")?.({ id: "none", text: "All objectives complete" });

    expect(hud.setObjective).toHaveBeenNthCalledWith(1, "Reach the beacon");
    expect(hud.setObjective).toHaveBeenNthCalledWith(2, "All objectives complete");
    expect(hud.flashObjectiveComplete).toHaveBeenCalledWith("Reach the beacon");
    expect(hud.showStatus).toHaveBeenCalledWith("Objective complete: Reach the beacon");
    expect(hud.showStatus).toHaveBeenCalledWith("All objectives complete");
    ui.dispose();
  });

  it("clears prompt content and updates the hold glyph from input-source events", () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const ui = new UIManager({ on } as any);
    const hud = hudInstances[0];

    listeners.get("interaction:focusChanged")?.({ id: "door", label: "Press F to Open Door" });
    listeners.get("interaction:focusChanged")?.({ id: null, label: null });
    listeners.get("input:sourceChanged")?.({ source: "touch" });

    expect(hud.setPrompt).toHaveBeenNthCalledWith(1, "Press F to Open Door");
    expect(hud.setPrompt).toHaveBeenNthCalledWith(2, "");
    expect(hud.setInteractionGlyph).toHaveBeenCalledWith("✋");
    ui.dispose();
  });

  it("routes source-aware throw and drone altitude guidance", () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const on = vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const ui = new UIManager({ on } as never);
    const hud = hudInstances[0];

    listeners.get("input:sourceChanged")?.({ source: "touch" });
    listeners.get("interaction:pickUp")?.({ object: {} });
    expect(hud.showStatus).toHaveBeenCalledWith("Interact to throw", 2200);

    listeners.get("input:sourceChanged")?.({ source: "gamepad" });
    listeners.get("vehicle:enter")?.({ vehicle: { type: "drone" } });
    expect(hud.showStatus).toHaveBeenCalledWith("Right Stick ↑ / ↓ to change drone altitude", 2800);
    ui.dispose();
  });

  it("uses the crouch glyph for vehicle reset progress and restores interaction afterward", () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const ui = new UIManager({ on } as any);
    const hud = hudInstances[0];

    listeners.get("input:sourceChanged")?.({ source: "gamepad" });
    listeners.get("vehicle:resetHoldProgress")?.({ id: "car-1", progress: 0.5 });
    listeners.get("vehicle:resetHoldProgress")?.(null);
    listeners.get("vehicle:reset")?.({ id: "car-1" });

    expect(hud.setInteractionGlyph).toHaveBeenNthCalledWith(1, "X");
    expect(hud.setInteractionGlyph).toHaveBeenNthCalledWith(2, "B");
    expect(hud.setHoldProgress).toHaveBeenCalledWith(0.5);
    expect(hud.setHoldProgress).toHaveBeenCalledWith(null);
    expect(hud.setInteractionGlyph).toHaveBeenLastCalledWith("B");
    expect(hud.showStatus).toHaveBeenCalledWith("Vehicle reset");
    ui.dispose();
  });

  it("updates an active reset hold and entry hint when the input source changes", () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const ui = new UIManager({ on } as any);
    const hud = hudInstances[0];

    listeners.get("vehicle:resetHoldProgress")?.({ id: "car-1", progress: 0.25 });
    listeners.get("input:sourceChanged")?.({ source: "gamepad" });
    listeners.get("vehicle:resetAvailable")?.({ id: "car-1" });

    expect(hud.setInteractionGlyph).toHaveBeenNthCalledWith(1, "C");
    expect(hud.setInteractionGlyph).toHaveBeenNthCalledWith(2, "B");
    expect(hud.showStatus).toHaveBeenCalledWith("Hold B to reset while stopped or upside-down", 2800);
    ui.dispose();
  });

  it("reads live keyboard bindings for interaction and vehicle reset glyphs", () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const bindings = createDefaultKeyboardBindings();
    const ui = new UIManager({ on } as any, () => bindings);
    const hud = hudInstances[0];

    listeners.get("interaction:holdProgress")?.({ id: "door", progress: 0.2 });
    bindings.interact[0] = "KeyZ";
    listeners.get("interaction:holdProgress")?.({ id: "door", progress: 0.4 });
    bindings.crouch[0] = "ControlRight";
    listeners.get("vehicle:resetHoldProgress")?.({ id: "car-1", progress: 0.5 });
    listeners.get("vehicle:resetAvailable")?.({ id: "car-1" });

    expect(hud.setInteractionGlyph).toHaveBeenCalledWith("F");
    expect(hud.setInteractionGlyph).toHaveBeenCalledWith("Z");
    expect(hud.setInteractionGlyph).toHaveBeenCalledWith("Right Ctrl");
    expect(hud.showStatus).toHaveBeenCalledWith("Hold Right Ctrl to reset while stopped or upside-down", 2800);
    ui.dispose();
  });

  it("routes collectible count updates to the HUD collectible chip", () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const eventBus = { on };

    const ui = new UIManager(eventBus as any);
    const hud = hudInstances[0];

    listeners.get("collectible:changed")?.({ count: 5, total: 70 });

    expect(hud.updateCollectibles).toHaveBeenCalledWith(5, 70);
    ui.dispose();
  });

  it("routes the one-shot collectible completion celebration and status", () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const ui = new UIManager({ on } as any);
    const hud = hudInstances[0];

    listeners.get("collectible:allCollected")?.({ count: 70, total: 70 });

    expect(hud.celebrateAllCollectibles).toHaveBeenCalledExactlyOnceWith(70);
    expect(hud.showStatus).toHaveBeenCalledExactlyOnceWith("All 70 collectibles collected!", 3200);
    ui.dispose();
  });

  it("routes collectible pickup celebrations and damage flashes to the HUD", () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const eventBus = { on };

    const ui = new UIManager(eventBus as any);
    const hud = hudInstances[0];

    listeners.get("collectible:collected")?.({ value: 1 });
    listeners.get("player:damaged")?.({ reason: "spike" });

    expect(hud.celebrateCollectible).toHaveBeenCalledWith(1);
    expect(hud.flashDamage).toHaveBeenCalledWith("spike");
    ui.dispose();
  });

  it("routes health updates to the HUD heart chip", () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const eventBus = { on };

    const ui = new UIManager(eventBus as any);
    const hud = hudInstances[0];

    listeners.get("health:changed")?.({ current: 2, max: 3 });

    expect(hud.updateHealth).toHaveBeenCalledWith(2, 3);
    ui.dispose();
  });

  it("exposes the HUD damage intensity target", () => {
    const ui = new UIManager({ on: vi.fn(() => () => {}) } as any);
    const hud = hudInstances[0];

    ui.setDamageFlashIntensity(0.45);

    expect(hud.setDamageFlashIntensity).toHaveBeenCalledExactlyOnceWith(0.45);
    ui.dispose();
  });

  it("suppresses gameplay accessibility while a menu is open", () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const on = vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const ui = new UIManager({ on } as never);
    const hud = hudInstances[0];

    listeners.get("menu:opened")?.({ screen: "pause" });
    listeners.get("menu:closed")?.(undefined);

    expect(hud.setGameplayAccessibilitySuppressed).toHaveBeenNthCalledWith(1, true);
    expect(hud.setGameplayAccessibilitySuppressed).toHaveBeenNthCalledWith(2, false);
    ui.dispose();
  });

  it("hides and restores the gameplay HUD around editor sessions", () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const on = vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const ui = new UIManager({ on } as never);
    const hud = hudInstances[0];

    listeners.get("editor:opened")?.(undefined);
    listeners.get("editor:closed")?.(undefined);

    expect(hud.setEditorActive).toHaveBeenNthCalledWith(1, true);
    expect(hud.setEditorActive).toHaveBeenNthCalledWith(2, false);
    ui.dispose();
  });

  it("reveals automatic renderer fallback status only when a visible UI surface is ready", () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const on = vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const source = {
      getPresentationState: vi.fn(),
      subscribePresentationState: vi.fn(),
    };
    const ui = new UIManager({ on } as never, undefined, source as never);
    const rendererStatus = rendererStatusInstances[0];

    expect(rendererStatus.notifyUiReady).not.toHaveBeenCalled();
    listeners.get("menu:opened")?.({ screen: "main" });
    listeners.get("level:loaded")?.(undefined);
    expect(rendererStatus.notifyUiReady).toHaveBeenCalledTimes(2);

    ui.dispose();
    expect(rendererStatus.dispose).toHaveBeenCalledOnce();
  });
});
