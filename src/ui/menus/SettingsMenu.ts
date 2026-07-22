import type { AudioController } from "@audio/AudioManager";
import type { OrbitFollowCamera } from "@camera/OrbitFollowCamera";
import type { EventBus } from "@core/EventBus";
import {
  type AntiAliasingMode,
  type GraphicsProfile,
  type InputActivationMode,
  type ReducedMotionPreference,
  type ShadowQualityTier,
  USER_SETTINGS_RANGES,
  type UserSettingsStore,
} from "@core/UserSettings";
import {
  createDefaultKeyboardBindings,
  getKeyboardCodeLabel,
  INPUT_ACTION_LABELS,
  isReservedBindingCode,
  KEYBOARD_BINDING_ACTIONS,
  type KeyboardBindingAction,
  type KeyboardBindings,
  rebindKeyboardAction,
} from "@input/InputBindings";
import type { InputManager } from "@input/InputManager";
import type { RendererManager } from "@renderer/RendererManager";
import type { ComfortPreferencesController } from "../ComfortPreferencesController";

interface SettingsMenuOptions {
  settings: UserSettingsStore;
  inputManager: InputManager;
  camera: OrbitFollowCamera;
  renderer: RendererManager;
  audioManager: AudioController;
  eventBus: EventBus;
  comfortController: Pick<
    ComfortPreferencesController,
    "setCameraEffectsIntensity" | "setDamageFlashIntensity" | "setReducedMotion"
  >;
  onBack: () => void;
}

export class SettingsMenu {
  readonly id = "settings";
  readonly root: HTMLDivElement;

  private controlsSection: HTMLDivElement;
  private graphicsSection: HTMLDivElement;
  private audioSection: HTMLDivElement;
  private controlId = 0;
  private bindingLabels = new Map<KeyboardBindingAction, HTMLElement>();
  private bindingStatus: HTMLParagraphElement | null = null;
  private rendererStatusLine: HTMLParagraphElement | null = null;
  private readonly unsubscribeRendererPresentation: () => void;
  private activeCapture: { action: KeyboardBindingAction; button: HTMLButtonElement } | null = null;
  private readonly onCaptureKeyDown = (event: KeyboardEvent): void => this.handleCaptureKeyDown(event);

  constructor(private options: SettingsMenuOptions) {
    this.root = document.createElement("div");
    this.root.className = "menu-screen";

    const title = document.createElement("h1");
    title.className = "menu-title";
    title.textContent = "Settings";
    this.root.appendChild(title);

    const tabs = document.createElement("div");
    tabs.className = "menu-tabs";
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Settings sections");
    this.root.appendChild(tabs);

    const controlsTab = this.createTab("Controls", () => this.showSection("controls"));
    const graphicsTab = this.createTab("Graphics", () => this.showSection("graphics"));
    const audioTab = this.createTab("Audio", () => this.showSection("audio"));
    tabs.appendChild(controlsTab);
    tabs.appendChild(graphicsTab);
    tabs.appendChild(audioTab);

    this.controlsSection = document.createElement("div");
    this.controlsSection.className = "menu-section";
    this.graphicsSection = document.createElement("div");
    this.graphicsSection.className = "menu-section";
    this.audioSection = document.createElement("div");
    this.audioSection.className = "menu-section";
    this.root.appendChild(this.controlsSection);
    this.root.appendChild(this.graphicsSection);
    this.root.appendChild(this.audioSection);

    this.buildControlsSection();
    this.buildGraphicsSection();
    this.buildAudioSection();
    this.unsubscribeRendererPresentation = this.options.renderer.subscribePresentationState(() => {
      this.syncRendererStatus();
    });

    const backBtn = document.createElement("button");
    backBtn.className = "menu-button";
    backBtn.textContent = "Back";
    backBtn.addEventListener("click", () => this.options.onBack());
    this.root.appendChild(backBtn);

    this.setActiveTab(controlsTab);
    this.showSection("controls");
  }

  show(): void {
    this.stopBindingCapture(undefined, false);
    this.controlsSection.replaceChildren();
    this.graphicsSection.replaceChildren();
    this.audioSection.replaceChildren();
    this.buildControlsSection();
    this.buildGraphicsSection();
    this.buildAudioSection();
    this.root.classList.add("active");
  }

  hide(): void {
    this.stopBindingCapture(undefined, false);
    this.root.classList.remove("active");
  }

  dispose(): void {
    this.stopBindingCapture(undefined, false);
    this.unsubscribeRendererPresentation();
    this.root.remove();
  }

  private buildControlsSection(): void {
    const { settings, inputManager, camera, renderer } = this.options;

    this.bindingLabels.clear();
    this.bindingStatus = null;
    this.controlsSection.appendChild(this.createSectionHeader("Pointer & Camera"));

    this.controlsSection.appendChild(
      this.createSlider(
        "Mouse sensitivity",
        settings.value.mouseSensitivity,
        USER_SETTINGS_RANGES.mouseSensitivity.min,
        USER_SETTINGS_RANGES.mouseSensitivity.max,
        USER_SETTINGS_RANGES.mouseSensitivity.step,
        (value) => {
          const s = settings.update({ mouseSensitivity: value });
          camera.setMouseSensitivity(s.mouseSensitivity);
        },
      ),
    );

    this.controlsSection.appendChild(
      this.createToggle("Invert Y", settings.value.invertY, (value) => {
        const s = settings.update({ invertY: value });
        camera.setInvertY(s.invertY);
      }),
    );

    this.controlsSection.appendChild(
      this.createToggle("Raw mouse input", settings.value.rawMouseInput, (value) => {
        const s = settings.update({ rawMouseInput: value });
        inputManager.setRawMouseInput(s.rawMouseInput);
      }),
    );

    this.controlsSection.appendChild(
      this.createSlider(
        "Camera FOV",
        settings.value.cameraFov,
        USER_SETTINGS_RANGES.cameraFov.min,
        USER_SETTINGS_RANGES.cameraFov.max,
        USER_SETTINGS_RANGES.cameraFov.step,
        (value) => {
          const s = settings.update({ cameraFov: value });
          renderer.camera.fov = s.cameraFov;
          camera.setBaseFov(s.cameraFov);
          renderer.camera.updateProjectionMatrix();
        },
      ),
    );

    this.controlsSection.appendChild(this.createSectionHeader("Gamepad Tuning"));
    this.controlsSection.appendChild(
      this.createSlider(
        "Gamepad deadzone",
        settings.value.gamepadDeadzone,
        USER_SETTINGS_RANGES.gamepadDeadzone.min,
        USER_SETTINGS_RANGES.gamepadDeadzone.max,
        USER_SETTINGS_RANGES.gamepadDeadzone.step,
        (value) => {
          const s = settings.update({ gamepadDeadzone: value });
          inputManager.setGamepadTuning(s.gamepadDeadzone, s.gamepadCurve);
        },
      ),
    );

    this.controlsSection.appendChild(
      this.createSlider(
        "Gamepad curve",
        settings.value.gamepadCurve,
        USER_SETTINGS_RANGES.gamepadCurve.min,
        USER_SETTINGS_RANGES.gamepadCurve.max,
        USER_SETTINGS_RANGES.gamepadCurve.step,
        (value) => {
          const s = settings.update({ gamepadCurve: value });
          inputManager.setGamepadTuning(s.gamepadDeadzone, s.gamepadCurve);
        },
      ),
    );

    this.controlsSection.appendChild(this.createSectionHeader("Keyboard Remapping"));
    const remapping = document.createElement("div");
    remapping.className = "binding-list";
    for (const action of KEYBOARD_BINDING_ACTIONS) {
      remapping.appendChild(this.createBindingRow(action, settings.value.keyboardBindings));
    }
    this.controlsSection.appendChild(remapping);

    const resetBindings = document.createElement("button");
    resetBindings.type = "button";
    resetBindings.className = "menu-button menu-button-small binding-reset-button";
    resetBindings.textContent = "Reset bindings";
    resetBindings.addEventListener("click", () => this.resetBindings());
    this.controlsSection.appendChild(resetBindings);

    this.bindingStatus = document.createElement("p");
    this.bindingStatus.className = "binding-status";
    this.bindingStatus.setAttribute("role", "status");
    this.bindingStatus.setAttribute("aria-live", "polite");
    this.bindingStatus.setAttribute("aria-atomic", "true");
    this.controlsSection.appendChild(this.bindingStatus);

    this.controlsSection.appendChild(this.createSectionHeader("Comfort"));
    this.controlsSection.appendChild(
      this.createSlider(
        "Camera effects intensity",
        settings.value.cameraEffectsIntensity,
        USER_SETTINGS_RANGES.cameraEffectsIntensity.min,
        USER_SETTINGS_RANGES.cameraEffectsIntensity.max,
        USER_SETTINGS_RANGES.cameraEffectsIntensity.step,
        (value) => {
          const saved = settings.update({ cameraEffectsIntensity: value });
          this.options.comfortController.setCameraEffectsIntensity(saved.cameraEffectsIntensity);
        },
      ),
    );
    this.controlsSection.appendChild(
      this.createSlider(
        "Damage flash intensity",
        settings.value.damageFlashIntensity,
        USER_SETTINGS_RANGES.damageFlashIntensity.min,
        USER_SETTINGS_RANGES.damageFlashIntensity.max,
        USER_SETTINGS_RANGES.damageFlashIntensity.step,
        (value) => {
          const saved = settings.update({ damageFlashIntensity: value });
          this.options.comfortController.setDamageFlashIntensity(saved.damageFlashIntensity);
        },
      ),
    );
    this.controlsSection.appendChild(
      this.createSelect("Reduced motion", settings.value.reducedMotion, ["system", "on", "off"], (value) => {
        const saved = settings.update({ reducedMotion: value as ReducedMotionPreference });
        this.options.comfortController.setReducedMotion(saved.reducedMotion);
      }),
    );
    this.controlsSection.appendChild(
      this.createSlider(
        "Gamepad look sensitivity",
        settings.value.gamepadLookSensitivity,
        USER_SETTINGS_RANGES.gamepadLookSensitivity.min,
        USER_SETTINGS_RANGES.gamepadLookSensitivity.max,
        USER_SETTINGS_RANGES.gamepadLookSensitivity.step,
        (value) => {
          const s = settings.update({ gamepadLookSensitivity: value });
          inputManager.setGamepadLookSensitivity(s.gamepadLookSensitivity);
        },
      ),
    );
    this.controlsSection.appendChild(
      this.createSlider(
        "Touch look sensitivity",
        settings.value.touchLookSensitivity,
        USER_SETTINGS_RANGES.touchLookSensitivity.min,
        USER_SETTINGS_RANGES.touchLookSensitivity.max,
        USER_SETTINGS_RANGES.touchLookSensitivity.step,
        (value) => {
          const s = settings.update({ touchLookSensitivity: value });
          inputManager.setTouchLookSensitivity(s.touchLookSensitivity);
        },
      ),
    );
    this.controlsSection.appendChild(
      this.createSelect("Sprint mode", settings.value.sprintMode, ["hold", "toggle"], (value) => {
        const s = settings.update({ sprintMode: value as InputActivationMode });
        inputManager.setSprintMode(s.sprintMode);
      }),
    );
    this.controlsSection.appendChild(
      this.createSelect("Crouch mode", settings.value.crouchMode, ["hold", "toggle"], (value) => {
        const s = settings.update({ crouchMode: value as InputActivationMode });
        inputManager.setCrouchMode(s.crouchMode);
      }),
    );

    // Touch controls toggle — only visible on touch-capable devices
    if (inputManager.supportsTouchControls) {
      this.controlsSection.appendChild(
        this.createToggle("Touch controls", inputManager.touchControlsEnabled, (value) => {
          inputManager.setTouchControlsEnabled(value);
        }),
      );
    }
  }

  private buildGraphicsSection(): void {
    const { settings, renderer, eventBus } = this.options;
    const capabilities = renderer.getPostEffectCapabilities();

    // --- Profile & Resolution ---
    this.graphicsSection.appendChild(this.createSectionHeader("Profile & Resolution"));
    this.rendererStatusLine = document.createElement("p");
    this.rendererStatusLine.className = "menu-renderer-status";
    this.syncRendererStatus();
    this.graphicsSection.appendChild(this.rendererStatusLine);

    this.graphicsSection.appendChild(
      this.createSelect(
        "Graphics profile",
        settings.value.graphicsProfile,
        ["performance", "balanced", "cinematic"],
        (value) => {
          eventBus.emit("debug:graphicsProfile", { profile: value as GraphicsProfile });
        },
      ),
    );

    this.graphicsSection.appendChild(
      this.createSelect("AA mode", settings.value.aaMode, ["smaa", "fxaa", "none"], (value) => {
        const mode = value as AntiAliasingMode;
        settings.update({ aaMode: mode });
        eventBus.emit("debug:aaMode", { mode });
      }),
    );

    this.graphicsSection.appendChild(
      this.createSlider(
        "Resolution scale",
        settings.value.resolutionScale,
        USER_SETTINGS_RANGES.resolutionScale.min,
        USER_SETTINGS_RANGES.resolutionScale.max,
        USER_SETTINGS_RANGES.resolutionScale.step,
        (value) => {
          const s = settings.update({ resolutionScale: value });
          renderer.setResolutionScale(s.resolutionScale);
        },
      ),
    );

    // --- Lighting & Shadows ---
    this.graphicsSection.appendChild(this.createSectionHeader("Lighting & Shadows"));

    this.graphicsSection.appendChild(
      this.createToggle("Shadows", settings.value.shadowsEnabled, (value) => {
        settings.update({ shadowsEnabled: value });
        eventBus.emit("debug:shadows", value);
      }),
    );
    this.graphicsSection.appendChild(
      this.createSelect(
        "Shadow quality",
        settings.value.shadowQuality,
        ["auto", "performance", "balanced", "cinematic"],
        (value) => {
          const tier = value as ShadowQualityTier;
          settings.update({ shadowQuality: tier });
          eventBus.emit("debug:shadowQuality", { tier });
        },
      ),
    );
    this.graphicsSection.appendChild(
      this.createSlider(
        "Environment rotation",
        settings.value.envRotationDegrees,
        USER_SETTINGS_RANGES.envRotationDegrees.min,
        USER_SETTINGS_RANGES.envRotationDegrees.max,
        USER_SETTINGS_RANGES.envRotationDegrees.step,
        (value) => {
          const s = settings.update({ envRotationDegrees: value });
          eventBus.emit("debug:environmentRotation", s.envRotationDegrees);
        },
      ),
    );

    // --- Post Effects ---
    this.graphicsSection.appendChild(this.createSectionHeader("Post Effects"));

    this.graphicsSection.appendChild(
      this.createToggle(
        "Post-processing",
        settings.value.postProcessingEnabled,
        (value) => eventBus.emit("debug:postProcessing", value),
        capabilities.postProcessingEnabled
          ? undefined
          : "Unavailable: active renderer has no post-processing pipeline.",
      ),
    );
    this.graphicsSection.appendChild(
      this.createToggle(
        "SSAO",
        settings.value.ssaoEnabled,
        (value) => eventBus.emit("debug:ssaoEnabled", value),
        capabilities.ssaoEnabled ? undefined : "Unavailable: active renderer cannot apply SSAO.",
      ),
    );
    this.graphicsSection.appendChild(
      this.createToggle(
        "SSR",
        settings.value.ssrEnabled,
        (value) => eventBus.emit("debug:ssrEnabled", value),
        capabilities.ssrEnabled ? undefined : "Unavailable: active renderer cannot apply SSR.",
      ),
    );
    this.graphicsSection.appendChild(
      this.createToggle(
        "Bloom",
        settings.value.bloomEnabled,
        (value) => eventBus.emit("debug:bloomEnabled", value),
        capabilities.bloomEnabled ? undefined : "Unavailable: active renderer cannot apply bloom.",
      ),
    );
    this.graphicsSection.appendChild(
      this.createToggle("CAS sharpening", settings.value.casEnabled, (value) => {
        const s = settings.update({ casEnabled: value });
        eventBus.emit("debug:casEnabled", s.casEnabled);
      }),
    );
    this.graphicsSection.appendChild(
      this.createSlider(
        "CAS strength",
        settings.value.casStrength,
        USER_SETTINGS_RANGES.casStrength.min,
        USER_SETTINGS_RANGES.casStrength.max,
        USER_SETTINGS_RANGES.casStrength.step,
        (value) => {
          const s = settings.update({ casStrength: value });
          eventBus.emit("debug:casStrength", s.casStrength);
        },
      ),
    );
    this.graphicsSection.appendChild(
      this.createToggle(
        "Vignette",
        settings.value.vignetteEnabled,
        (value) => eventBus.emit("debug:vignetteEnabled", value),
        capabilities.vignetteEnabled ? undefined : "Unavailable: active renderer cannot apply vignette.",
      ),
    );
    this.graphicsSection.appendChild(
      this.createToggle(
        "LUT",
        settings.value.lutEnabled,
        (value) => eventBus.emit("debug:lutEnabled", value),
        capabilities.lutEnabled ? undefined : "Unavailable: active renderer cannot apply LUT color grading.",
      ),
    );

    // --- Developer ---
    this.graphicsSection.appendChild(this.createSectionHeader("Developer"));

    this.graphicsSection.appendChild(
      this.createDebugPanelButton(() => {
        eventBus.emit("debug:toggle", undefined);
      }),
    );
  }

  private syncRendererStatus(): void {
    if (this.rendererStatusLine) {
      this.rendererStatusLine.textContent = this.options.renderer.getPresentationState().settingsLabel;
    }
  }

  private buildAudioSection(): void {
    const { settings, audioManager, eventBus } = this.options;
    this.audioSection.appendChild(
      this.createSlider(
        "Master volume",
        settings.value.masterVolume,
        USER_SETTINGS_RANGES.masterVolume.min,
        USER_SETTINGS_RANGES.masterVolume.max,
        USER_SETTINGS_RANGES.masterVolume.step,
        (value) => {
          const s = settings.update({ masterVolume: value });
          audioManager.setMasterVolume(s.masterVolume);
          eventBus.emit("audio:masterVolume", s.masterVolume);
        },
      ),
    );
    this.audioSection.appendChild(
      this.createSlider(
        "Music volume",
        settings.value.musicVolume,
        USER_SETTINGS_RANGES.musicVolume.min,
        USER_SETTINGS_RANGES.musicVolume.max,
        USER_SETTINGS_RANGES.musicVolume.step,
        (value) => {
          const s = settings.update({ musicVolume: value });
          audioManager.setMusicVolume(s.musicVolume);
          eventBus.emit("audio:musicVolume", s.musicVolume);
        },
      ),
    );
    this.audioSection.appendChild(
      this.createSlider(
        "SFX volume",
        settings.value.sfxVolume,
        USER_SETTINGS_RANGES.sfxVolume.min,
        USER_SETTINGS_RANGES.sfxVolume.max,
        USER_SETTINGS_RANGES.sfxVolume.step,
        (value) => {
          const s = settings.update({ sfxVolume: value });
          audioManager.setSfxVolume(s.sfxVolume);
          eventBus.emit("audio:sfxVolume", s.sfxVolume);
        },
      ),
    );
  }

  private createTab(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "menu-tab";
    btn.textContent = label;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      this.setActiveTab(btn);
      onClick();
    });
    return btn;
  }

  private setActiveTab(tab: HTMLButtonElement): void {
    const tabs = Array.from(this.root.querySelectorAll(".menu-tab"));
    for (const t of tabs) {
      const active = t === tab;
      t.classList.toggle("active", active);
      t.setAttribute("aria-pressed", String(active));
    }
  }

  private showSection(section: "controls" | "graphics" | "audio"): void {
    if (section !== "controls") this.stopBindingCapture(undefined, false);
    this.controlsSection.classList.toggle("active", section === "controls");
    this.graphicsSection.classList.toggle("active", section === "graphics");
    this.audioSection.classList.toggle("active", section === "audio");
  }

  private createSectionHeader(title: string): HTMLHeadingElement {
    const h3 = document.createElement("h3");
    h3.className = "menu-section-header";
    h3.textContent = title;
    return h3;
  }

  private createBindingRow(action: KeyboardBindingAction, bindings: Readonly<KeyboardBindings>): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "binding-row";

    const actionLabel = document.createElement("span");
    actionLabel.className = "binding-action";
    actionLabel.textContent = INPUT_ACTION_LABELS[action];
    row.appendChild(actionLabel);

    const binding = document.createElement("kbd");
    binding.className = "binding-key";
    binding.textContent = getKeyboardCodeLabel(bindings[action][0]);
    this.bindingLabels.set(action, binding);
    row.appendChild(binding);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-button menu-button-small binding-button";
    button.textContent = "Rebind";
    button.setAttribute("aria-label", `Rebind ${INPUT_ACTION_LABELS[action]}`);
    button.addEventListener("click", () => this.startBindingCapture(action, button));
    row.appendChild(button);
    return row;
  }

  private startBindingCapture(action: KeyboardBindingAction, button: HTMLButtonElement): void {
    this.stopBindingCapture(undefined, false);
    this.activeCapture = { action, button };
    button.classList.add("is-capturing");
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-label", `Capturing ${INPUT_ACTION_LABELS[action]}; Escape cancels`);
    button.textContent = "Press a key...";
    button.focus({ preventScroll: true });
    this.announceBindingStatus(`Listening for ${INPUT_ACTION_LABELS[action]}. Escape cancels.`);
    window.addEventListener("keydown", this.onCaptureKeyDown, true);
  }

  private handleCaptureKeyDown(event: KeyboardEvent): void {
    const capture = this.activeCapture;
    if (!capture) return;

    if (event.code === "Tab") {
      this.stopBindingCapture(undefined, false);
      return;
    }
    if (
      (event.code === "Enter" || event.code === "Space") &&
      event.target instanceof HTMLButtonElement &&
      event.target.classList.contains("menu-tab")
    ) {
      this.stopBindingCapture(undefined, false);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.code === "Escape") {
      this.stopBindingCapture(`Cancelled ${INPUT_ACTION_LABELS[capture.action]} rebinding.`);
      return;
    }

    const current = this.options.settings.value.keyboardBindings;
    const currentCode = current[capture.action][0];
    if (event.code === currentCode) {
      this.stopBindingCapture(
        `${INPUT_ACTION_LABELS[capture.action]} is already ${getKeyboardCodeLabel(currentCode)}.`,
      );
      return;
    }
    if (isReservedBindingCode(event.code)) {
      this.announceBindingStatus(`${getKeyboardCodeLabel(event.code)} is reserved. Choose another key.`);
      return;
    }

    const next = rebindKeyboardAction(current, capture.action, event.code);
    if (next[capture.action][0] !== event.code) {
      this.announceBindingStatus("That key is not supported. Choose another key.");
      return;
    }

    const saved = this.options.settings.update({ keyboardBindings: next });
    this.options.inputManager.setKeyboardBindings(saved.keyboardBindings);
    this.refreshBindingRows(saved.keyboardBindings);
    this.stopBindingCapture(`${INPUT_ACTION_LABELS[capture.action]} set to ${getKeyboardCodeLabel(event.code)}.`);
  }

  private stopBindingCapture(message?: string, restoreFocus = true): void {
    window.removeEventListener("keydown", this.onCaptureKeyDown, true);
    const capture = this.activeCapture;
    this.activeCapture = null;
    if (capture) {
      capture.button.classList.remove("is-capturing");
      capture.button.removeAttribute("aria-busy");
      capture.button.removeAttribute("aria-disabled");
      capture.button.setAttribute("aria-label", `Rebind ${INPUT_ACTION_LABELS[capture.action]}`);
      capture.button.textContent = "Rebind";
      if (restoreFocus && capture.button.isConnected) {
        capture.button.focus({ preventScroll: true });
      }
    }
    if (message) this.announceBindingStatus(message);
  }

  private refreshBindingRows(bindings: Readonly<KeyboardBindings>): void {
    for (const action of KEYBOARD_BINDING_ACTIONS) {
      const label = this.bindingLabels.get(action);
      if (label) label.textContent = getKeyboardCodeLabel(bindings[action][0]);
    }
  }

  private resetBindings(): void {
    this.stopBindingCapture(undefined, false);
    const saved = this.options.settings.update({ keyboardBindings: createDefaultKeyboardBindings() });
    this.options.inputManager.setKeyboardBindings(saved.keyboardBindings);
    this.refreshBindingRows(saved.keyboardBindings);
    this.announceBindingStatus("Keyboard bindings reset to defaults.");
  }

  private announceBindingStatus(message: string): void {
    if (this.bindingStatus) this.bindingStatus.textContent = message;
  }

  private createSlider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.className = "menu-field";
    const fieldLabel = document.createElement("label");
    const decimals = step < 0.01 ? (step < 0.001 ? 4 : 3) : 2;
    fieldLabel.textContent = `${label}: ${value.toFixed(decimals)}`;
    const input = document.createElement("input");
    const inputId = `settings-control-${++this.controlId}`;
    fieldLabel.htmlFor = inputId;
    input.id = inputId;
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      fieldLabel.textContent = `${label}: ${v.toFixed(decimals)}`;
      onChange(v);
    });
    wrapper.appendChild(fieldLabel);
    wrapper.appendChild(input);
    return wrapper;
  }

  private createToggle(
    label: string,
    value: boolean,
    onChange: (value: boolean) => void,
    unavailableReason?: string,
  ): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.className = "menu-field";
    const fieldLabel = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    input.disabled = unavailableReason !== undefined;
    input.addEventListener("change", () => {
      onChange(input.checked);
    });
    fieldLabel.appendChild(input);
    fieldLabel.appendChild(document.createTextNode(label));
    wrapper.appendChild(fieldLabel);
    if (unavailableReason) {
      const help = document.createElement("p");
      help.className = "menu-field-help";
      help.textContent = unavailableReason;
      wrapper.appendChild(help);
    }
    return wrapper;
  }

  private createDebugPanelButton(onClick: () => void): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.className = "menu-field";
    const btn = document.createElement("button");
    btn.className = "menu-button";
    btn.textContent = "Toggle Debug Panel";
    btn.addEventListener("click", onClick);
    wrapper.appendChild(btn);
    return wrapper;
  }

  private createSelect(
    label: string,
    value: string,
    options: string[],
    onChange: (value: string) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.className = "menu-field";
    const fieldLabel = document.createElement("label");
    fieldLabel.textContent = label;
    const select = document.createElement("select");
    const selectId = `settings-control-${++this.controlId}`;
    fieldLabel.htmlFor = selectId;
    select.id = selectId;
    select.className = "menu-select";
    options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt;
      option.textContent = opt;
      if (opt === value) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      onChange(select.value);
    });
    wrapper.appendChild(fieldLabel);
    wrapper.appendChild(select);
    return wrapper;
  }
}
