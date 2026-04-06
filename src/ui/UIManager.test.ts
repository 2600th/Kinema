import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hudDispose = vi.fn();
const fadeDispose = vi.fn();
const debugDispose = vi.fn();
const hudInstances: any[] = [];

vi.mock('./components/HUD', () => ({
  HUD: class {
    showPrompt = vi.fn();
    hidePrompt = vi.fn();
    setHoldProgress = vi.fn();
    showStatus = vi.fn();
    setObjective = vi.fn();
    updateCollectibles = vi.fn();
    updateHealth = vi.fn();
    showGameHUD = vi.fn();
    hideGameHUD = vi.fn();
    dispose = hudDispose;
    constructor(_parent: HTMLElement) {
      hudInstances.push(this);
    }
  },
}));

vi.mock('./components/FadeScreen', () => ({
  FadeScreen: class {
    dispose = fadeDispose;
    constructor(_parent: HTMLElement) {}
  },
}));

vi.mock('./components/DebugPanel', () => ({
  DebugPanel: class {
    toggle = vi.fn();
    dispose = debugDispose;
    constructor(_parent: HTMLElement) {}
  },
}));

vi.mock('./components/LoadingScreen', () => ({
  LoadingScreen: class {
    setProgress = vi.fn();
    show = vi.fn();
    hide = vi.fn(() => Promise.resolve());
    dispose = vi.fn();
  },
}));

vi.mock('./components/DeathEffect', () => ({
  DeathEffect: class {
    play = vi.fn();
    dispose = vi.fn();
    constructor(_eventBus: any) {}
  },
}));

import { UIManager } from './UIManager';

describe('UIManager', () => {
  const appendBodyChild = vi.fn();
  const createElement = vi.fn(() => ({ id: '', style: {} as Record<string, string>, remove: vi.fn() }));
  const getElementById = vi.fn(() => null);
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hudInstances.length = 0;
    appendBodyChild.mockClear();
    createElement.mockClear();
    getElementById.mockClear();
    (globalThis as any).document = {
      getElementById,
      createElement,
      body: { appendChild: appendBodyChild },
    };
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('creates fallback overlay when #ui-overlay is missing', () => {
    const on = vi.fn(() => () => {});
    const eventBus = { on };

    const ui = new UIManager(eventBus as any);

    expect(getElementById).toHaveBeenCalledWith('ui-overlay');
    expect(createElement).toHaveBeenCalledWith('div');
    expect(appendBodyChild).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[UIManager] #ui-overlay missing. Created fallback overlay element.',
    );
    ui.dispose();
  });

  it('routes objective updates to the pinned objective card and completion to status toasts', () => {
    const listeners = new Map<string, (payload: any) => void>();
    const on = vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.set(event, handler);
      return () => {};
    });
    const eventBus = { on };

    const ui = new UIManager(eventBus as any);
    const hud = hudInstances[0];

    listeners.get('objective:set')?.({ text: 'Reach the beacon' });
    listeners.get('objective:completed')?.({ text: 'Reach the beacon' });

    expect(hud.setObjective).toHaveBeenCalledWith('Reach the beacon');
    expect(hud.showStatus).toHaveBeenCalledWith('Objective complete: Reach the beacon');
    ui.dispose();
  });
});
