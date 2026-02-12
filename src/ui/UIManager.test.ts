import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hudDispose = vi.fn();
const fadeDispose = vi.fn();
const debugDispose = vi.fn();

vi.mock('./components/HUD', () => ({
  HUD: class {
    showPrompt = vi.fn();
    hidePrompt = vi.fn();
    dispose = hudDispose;
    constructor(_parent: HTMLElement) {}
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

import { UIManager } from './UIManager';

describe('UIManager', () => {
  const appendBodyChild = vi.fn();
  const createElement = vi.fn(() => ({ id: '', style: {} as Record<string, string> }));
  const getElementById = vi.fn(() => null);
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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
});
