import { DEFAULT_USER_SETTINGS } from "@core/UserSettings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsMenu } from "./SettingsMenu";

class FakeClassList {
  private readonly values = new Set<string>();

  add(...values: string[]): void {
    for (const value of values) this.values.add(value);
  }

  remove(...values: string[]): void {
    for (const value of values) this.values.delete(value);
  }

  toggle(value: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }
}

class FakeElement {
  id = "";
  type = "";
  min = "";
  max = "";
  step = "";
  value = "";
  textContent = "";
  htmlFor = "";
  checked = false;
  disabled = false;
  selected = false;
  isConnected = true;
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, (() => void)[]>();
  private _className = "";

  get className(): string {
    return this._className;
  }

  set className(value: string) {
    this._className = value;
    for (const name of value.split(/\s+/).filter(Boolean)) this.classList.add(name);
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    if (this.type === "select" && child.selected) this.value = child.value;
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.forEach((child) => {
      child.setConnected(false);
    });
    this.children.length = 0;
    for (const child of children) this.appendChild(child);
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  querySelectorAll(selector: string): FakeElement[] {
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    return this.walk().filter((element) => className && element.classList.contains(className));
  }

  remove(): void {
    this.isConnected = false;
  }

  focus(): void {}

  private setConnected(connected: boolean): void {
    this.isConnected = connected;
    for (const child of this.children) child.setConnected(connected);
  }

  walk(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.walk()]);
  }
}

function findField(menu: SettingsMenu, label: string): { wrapper: FakeElement; control: FakeElement } {
  const root = menu.root as unknown as FakeElement;
  const wrapper = root
    .walk()
    .find(
      (element) =>
        element.classList.contains("menu-field") &&
        element.walk().some((child) => child.textContent === label || child.textContent.startsWith(`${label}:`)),
    );
  if (!wrapper) throw new Error(`Missing field ${label}`);
  const control = wrapper.walk().find((child) => ["checkbox", "range", "select"].includes(child.type));
  if (!control) throw new Error(`Missing control ${label}`);
  return { wrapper, control };
}

describe("SettingsMenu comfort controls", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => {
        const element = new FakeElement();
        element.type = tag === "select" ? "select" : "";
        return element;
      },
      createTextNode: (text: string) => {
        const element = new FakeElement();
        element.textContent = text;
        return element;
      },
    };
    (globalThis as { window?: unknown }).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });

  afterEach(() => {
    (globalThis as { document?: unknown }).document = originalDocument;
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  function createMenu(inputManagerOverrides: Record<string, unknown> = {}) {
    let current = structuredClone(DEFAULT_USER_SETTINGS);
    let rendererStatus = {
      settingsLabel:
        "Renderer: WebGPU (WebGL2 backend) · Applied profile: balanced · Available post: SSAO, SSR, Bloom, Vignette, LUT",
    };
    let rendererPresentationListener: (() => void) | null = null;
    const unsubscribeRendererPresentation = vi.fn();
    const order: string[] = [];
    const settings = {
      get value() {
        return current;
      },
      update: vi.fn((patch: Record<string, unknown>) => {
        order.push(`persist:${Object.keys(patch)[0]}`);
        current = { ...current, ...patch } as typeof current;
        return current;
      }),
    };
    const comfortController = {
      setCameraEffectsIntensity: vi.fn(() => order.push("live:cameraEffectsIntensity")),
      setDamageFlashIntensity: vi.fn(() => order.push("live:damageFlashIntensity")),
      setReducedMotion: vi.fn(() => order.push("live:reducedMotion")),
    };
    const inputManager = {
      supportsTouchControls: false,
      touchControlsEnabled: false,
      isTouchActive: false,
      setTouchControlsEnabled: vi.fn(),
      setRawMouseInput: vi.fn(),
      setGamepadTuning: vi.fn(),
      setGamepadLookSensitivity: vi.fn(),
      setTouchLookSensitivity: vi.fn(),
      setSprintMode: vi.fn(),
      setCrouchMode: vi.fn(),
      ...inputManagerOverrides,
    };
    const menu = new SettingsMenu({
      settings: settings as never,
      inputManager: inputManager as never,
      camera: { setMouseSensitivity: vi.fn(), setInvertY: vi.fn(), setBaseFov: vi.fn() } as never,
      renderer: {
        camera: { fov: 75, updateProjectionMatrix: vi.fn() },
        getPostEffectCapabilities: () => ({
          postProcessingEnabled: true,
          ssaoEnabled: true,
          ssrEnabled: true,
          bloomEnabled: true,
          vignetteEnabled: true,
          lutEnabled: true,
        }),
        getPresentationState: () => rendererStatus,
        subscribePresentationState: vi.fn((listener: () => void) => {
          rendererPresentationListener = listener;
          return unsubscribeRendererPresentation;
        }),
        setResolutionScale: vi.fn(),
      } as never,
      audioManager: {
        setMasterVolume: vi.fn(),
        setMusicVolume: vi.fn(),
        setSfxVolume: vi.fn(),
      } as never,
      eventBus: { emit: vi.fn() } as never,
      comfortController,
      onBack: vi.fn(),
    });
    return {
      menu,
      settings,
      inputManager,
      comfortController,
      order,
      setRendererStatus: (settingsLabel: string) => {
        rendererStatus = { settingsLabel };
        rendererPresentationListener?.();
      },
      unsubscribeRendererPresentation,
      setCurrent: (patch: Partial<typeof current>) => {
        current = { ...current, ...patch };
      },
    };
  }

  it("extends the single Comfort section with exact ranges and motion choices", () => {
    const { menu } = createMenu();
    const headers = (menu.root as unknown as FakeElement)
      .querySelectorAll(".menu-section-header")
      .filter((header) => header.textContent === "Comfort");
    expect(headers).toHaveLength(1);

    for (const label of ["Camera effects intensity", "Damage flash intensity"]) {
      const { control } = findField(menu, label);
      expect({ type: control.type, min: control.min, max: control.max, step: control.step }).toEqual({
        type: "range",
        min: "0",
        max: "1",
        step: "0.05",
      });
    }

    const { control: select } = findField(menu, "Reduced motion");
    expect(select.children.map((option) => option.value)).toEqual(["system", "on", "off"]);
  });

  it("shows the requested touch state while menu visibility hides the controls", () => {
    const setTouchControlsEnabled = vi.fn();
    const { menu } = createMenu({
      supportsTouchControls: true,
      touchControlsEnabled: true,
      isTouchActive: false,
      setTouchControlsEnabled,
    });
    const toggle = findField(menu, "Touch controls").control;

    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatch("change");

    expect(setTouchControlsEnabled).toHaveBeenCalledWith(false);
  });

  it("persists each value before applying its live callback", () => {
    const { menu, order, comfortController } = createMenu();
    const camera = findField(menu, "Camera effects intensity").control;
    camera.value = "0.4";
    camera.dispatch("input");
    const damage = findField(menu, "Damage flash intensity").control;
    damage.value = "0.55";
    damage.dispatch("input");
    const motion = findField(menu, "Reduced motion").control;
    motion.value = "on";
    motion.dispatch("change");

    expect(order).toEqual([
      "persist:cameraEffectsIntensity",
      "live:cameraEffectsIntensity",
      "persist:damageFlashIntensity",
      "live:damageFlashIntensity",
      "persist:reducedMotion",
      "live:reducedMotion",
    ]);
    expect(comfortController.setCameraEffectsIntensity).toHaveBeenCalledWith(0.4);
    expect(comfortController.setDamageFlashIntensity).toHaveBeenCalledWith(0.55);
    expect(comfortController.setReducedMotion).toHaveBeenCalledWith("on");
  });

  it("rebuilds from stored values without duplicating control listeners", () => {
    const { menu, setCurrent } = createMenu();
    const oldCamera = findField(menu, "Camera effects intensity").control;
    setCurrent({ cameraEffectsIntensity: 0.25, damageFlashIntensity: 0.7, reducedMotion: "off" });

    menu.show();

    const camera = findField(menu, "Camera effects intensity").control;
    const damage = findField(menu, "Damage flash intensity").control;
    const motion = findField(menu, "Reduced motion").control;
    expect(camera.value).toBe("0.25");
    expect(damage.value).toBe("0.7");
    expect(motion.value).toBe("off");
    expect(camera.listeners.get("input")).toHaveLength(1);
    expect(motion.listeners.get("change")).toHaveLength(1);
    expect(oldCamera.isConnected).toBe(false);
  });

  it("keeps one full renderer status line synchronized with applied state", () => {
    const { menu, setRendererStatus, unsubscribeRendererPresentation } = createMenu();
    const statusLines = () => (menu.root as unknown as FakeElement).querySelectorAll(".menu-renderer-status");

    expect(statusLines()).toHaveLength(1);
    expect(statusLines()[0].textContent).toBe(
      "Renderer: WebGPU (WebGL2 backend) · Applied profile: balanced · Available post: SSAO, SSR, Bloom, Vignette, LUT",
    );

    setRendererStatus("Renderer: WebGLRenderer · Applied profile: performance · Post effects unavailable");
    expect(statusLines()[0].textContent).toBe(
      "Renderer: WebGLRenderer · Applied profile: performance · Post effects unavailable",
    );

    menu.show();
    expect(statusLines()).toHaveLength(1);
    menu.dispose();
    expect(unsubscribeRendererPresentation).toHaveBeenCalledOnce();
  });
});

describe("SettingsMenu section lifecycle", () => {
  it("cancels binding capture on Tab without consuming native focus navigation", () => {
    const menu = Object.create(SettingsMenu.prototype) as {
      activeCapture: { action: "interact"; button: object };
      stopBindingCapture: ReturnType<typeof vi.fn>;
      handleCaptureKeyDown: (event: KeyboardEvent) => void;
    };
    menu.activeCapture = { action: "interact", button: {} };
    menu.stopBindingCapture = vi.fn();
    const event = {
      code: "Tab",
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    menu.handleCaptureKeyDown(event);

    expect(menu.stopBindingCapture).toHaveBeenCalledWith(undefined, false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("does not restore capture focus when navigating away from Controls", () => {
    const menu = Object.create(SettingsMenu.prototype) as {
      controlsSection: { classList: { toggle: ReturnType<typeof vi.fn> } };
      graphicsSection: { classList: { toggle: ReturnType<typeof vi.fn> } };
      audioSection: { classList: { toggle: ReturnType<typeof vi.fn> } };
      stopBindingCapture: ReturnType<typeof vi.fn>;
      showSection: (section: "controls" | "graphics" | "audio") => void;
    };
    menu.controlsSection = { classList: { toggle: vi.fn() } };
    menu.graphicsSection = { classList: { toggle: vi.fn() } };
    menu.audioSection = { classList: { toggle: vi.fn() } };
    menu.stopBindingCapture = vi.fn();

    menu.showSection("graphics");

    expect(menu.stopBindingCapture).toHaveBeenCalledWith(undefined, false);
  });
});
