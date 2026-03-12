import type { EventBus } from '@core/EventBus';
import type { UserSettingsStore, GraphicsProfile, AntiAliasingMode, ShadowQualityTier } from '@core/UserSettings';
import type { InputManager } from '@input/InputManager';
import type { OrbitFollowCamera } from '@camera/OrbitFollowCamera';
import type { RendererManager } from '@renderer/RendererManager';
import type { AudioManager } from '@audio/AudioManager';

interface SettingsMenuOptions {
  settings: UserSettingsStore;
  inputManager: InputManager;
  camera: OrbitFollowCamera;
  renderer: RendererManager;
  audioManager: AudioManager;
  eventBus: EventBus;
  onBack: () => void;
}

export class SettingsMenu {
  readonly id = 'settings';
  readonly root: HTMLDivElement;

  private controlsSection: HTMLDivElement;
  private graphicsSection: HTMLDivElement;
  private audioSection: HTMLDivElement;

  constructor(private options: SettingsMenuOptions) {
    this.root = document.createElement('div');
    this.root.className = 'menu-screen';

    const title = document.createElement('h1');
    title.className = 'menu-title';
    title.textContent = 'Settings';
    this.root.appendChild(title);

    const tabs = document.createElement('div');
    tabs.className = 'menu-tabs';
    this.root.appendChild(tabs);

    const controlsTab = this.createTab('Controls', () => this.showSection('controls'));
    const graphicsTab = this.createTab('Graphics', () => this.showSection('graphics'));
    const audioTab = this.createTab('Audio', () => this.showSection('audio'));
    tabs.appendChild(controlsTab);
    tabs.appendChild(graphicsTab);
    tabs.appendChild(audioTab);

    this.controlsSection = document.createElement('div');
    this.controlsSection.className = 'menu-section';
    this.graphicsSection = document.createElement('div');
    this.graphicsSection.className = 'menu-section';
    this.audioSection = document.createElement('div');
    this.audioSection.className = 'menu-section';
    this.root.appendChild(this.controlsSection);
    this.root.appendChild(this.graphicsSection);
    this.root.appendChild(this.audioSection);

    this.buildControlsSection();
    this.buildGraphicsSection();
    this.buildAudioSection();

    const backBtn = document.createElement('button');
    backBtn.className = 'menu-button';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => this.options.onBack());
    this.root.appendChild(backBtn);

    this.setActiveTab(controlsTab);
    this.showSection('controls');
  }

  show(): void {
    this.root.classList.add('active');
  }

  hide(): void {
    this.root.classList.remove('active');
  }

  dispose(): void {
    this.root.remove();
  }

  private buildControlsSection(): void {
    const { settings, inputManager, camera, renderer } = this.options;

    this.controlsSection.appendChild(
      this.createSlider(
        'Mouse sensitivity',
        settings.value.mouseSensitivity,
        0.0005,
        0.008,
        0.0001,
        (value) => {
          const s = settings.update({ mouseSensitivity: value });
          camera.setMouseSensitivity(s.mouseSensitivity);
        },
      ),
    );

    this.controlsSection.appendChild(
      this.createToggle('Invert Y', settings.value.invertY, (value) => {
        const s = settings.update({ invertY: value });
        camera.setInvertY(s.invertY);
      }),
    );

    this.controlsSection.appendChild(
      this.createToggle('Raw mouse input', settings.value.rawMouseInput, (value) => {
        const s = settings.update({ rawMouseInput: value });
        inputManager.setRawMouseInput(s.rawMouseInput);
      }),
    );

    this.controlsSection.appendChild(
      this.createSlider('Camera FOV', settings.value.cameraFov, 60, 75, 1, (value) => {
        const s = settings.update({ cameraFov: value });
        renderer.camera.fov = s.cameraFov;
        camera.setBaseFov(s.cameraFov);
        renderer.camera.updateProjectionMatrix();
      }),
    );

    this.controlsSection.appendChild(
      this.createSlider(
        'Gamepad deadzone',
        settings.value.gamepadDeadzone,
        0,
        0.4,
        0.01,
        (value) => {
          const s = settings.update({ gamepadDeadzone: value });
          inputManager.setGamepadTuning(s.gamepadDeadzone, s.gamepadCurve);
        },
      ),
    );

    this.controlsSection.appendChild(
      this.createSlider(
        'Gamepad curve',
        settings.value.gamepadCurve,
        0.6,
        3.0,
        0.1,
        (value) => {
          const s = settings.update({ gamepadCurve: value });
          inputManager.setGamepadTuning(s.gamepadDeadzone, s.gamepadCurve);
        },
      ),
    );
  }

  private buildGraphicsSection(): void {
    const { settings, renderer, eventBus } = this.options;
    const flags = renderer.getDebugFlags();

    // --- Profile & Resolution ---
    this.graphicsSection.appendChild(this.createSectionHeader('Profile & Resolution'));

    this.graphicsSection.appendChild(
      this.createSelect('Graphics profile', settings.value.graphicsProfile, ['performance', 'balanced', 'cinematic'], (value) => {
        eventBus.emit('debug:graphicsProfile', { profile: value as GraphicsProfile });
      }),
    );

    this.graphicsSection.appendChild(
      this.createSelect('AA mode', settings.value.aaMode, ['smaa', 'fxaa', 'none'], (value) => {
        const mode = value as AntiAliasingMode;
        settings.update({ aaMode: mode });
        eventBus.emit('debug:aaMode', { mode });
      }),
    );

    this.graphicsSection.appendChild(
      this.createSlider('Resolution scale', settings.value.resolutionScale, 0.5, 1, 0.05, (value) => {
        const s = settings.update({ resolutionScale: value });
        renderer.setResolutionScale(s.resolutionScale);
      }),
    );

    // --- Lighting & Shadows ---
    this.graphicsSection.appendChild(this.createSectionHeader('Lighting & Shadows'));

    this.graphicsSection.appendChild(
      this.createToggle('Shadows', settings.value.shadowsEnabled, (value) => {
        settings.update({ shadowsEnabled: value });
        eventBus.emit('debug:shadows', value);
      }),
    );
    this.graphicsSection.appendChild(
      this.createSelect(
        'Shadow quality',
        settings.value.shadowQuality,
        ['auto', 'performance', 'balanced', 'cinematic'],
        (value) => {
          const tier = value as ShadowQualityTier;
          settings.update({ shadowQuality: tier });
          eventBus.emit('debug:shadowQuality', { tier });
        },
      ),
    );
    this.graphicsSection.appendChild(
      this.createSlider('Environment rotation', settings.value.envRotationDegrees, -180, 180, 1, (value) => {
        const s = settings.update({ envRotationDegrees: value });
        eventBus.emit('debug:environmentRotation', s.envRotationDegrees);
      }),
    );

    // --- Post Effects ---
    this.graphicsSection.appendChild(this.createSectionHeader('Post Effects'));

    this.graphicsSection.appendChild(
      this.createToggle('Post-processing', flags.postProcessingEnabled, (value) => {
        eventBus.emit('debug:postProcessing', value);
      }),
    );
    this.graphicsSection.appendChild(
      this.createToggle('SSAO', flags.ssaoEnabled, (value) => {
        eventBus.emit('debug:ssaoEnabled', value);
      }),
    );
    this.graphicsSection.appendChild(
      this.createToggle('SSR', flags.ssrEnabled, (value) => {
        eventBus.emit('debug:ssrEnabled', value);
      }),
    );
    this.graphicsSection.appendChild(
      this.createToggle('Bloom', flags.bloomEnabled, (value) => {
        eventBus.emit('debug:bloomEnabled', value);
      }),
    );
    this.graphicsSection.appendChild(
      this.createToggle('CAS sharpening', settings.value.casEnabled, (value) => {
        const s = settings.update({ casEnabled: value });
        eventBus.emit('debug:casEnabled', s.casEnabled);
      }),
    );
    this.graphicsSection.appendChild(
      this.createSlider('CAS strength', settings.value.casStrength, 0, 1, 0.05, (value) => {
        const s = settings.update({ casStrength: value });
        eventBus.emit('debug:casStrength', s.casStrength);
      }),
    );
    this.graphicsSection.appendChild(
      this.createToggle('Vignette', flags.vignetteEnabled, (value) => {
        eventBus.emit('debug:vignetteEnabled', value);
      }),
    );
    this.graphicsSection.appendChild(
      this.createToggle('LUT', flags.lutEnabled, (value) => {
        eventBus.emit('debug:lutEnabled', value);
      }),
    );
  }

  private buildAudioSection(): void {
    const { settings, audioManager, eventBus } = this.options;
    this.audioSection.appendChild(
      this.createSlider('Master volume', settings.value.masterVolume, 0, 1, 0.01, (value) => {
        const s = settings.update({ masterVolume: value });
        audioManager.setMasterVolume(s.masterVolume);
        eventBus.emit('audio:masterVolume', s.masterVolume);
      }),
    );
    this.audioSection.appendChild(
      this.createSlider('Music volume', settings.value.musicVolume, 0, 1, 0.01, (value) => {
        const s = settings.update({ musicVolume: value });
        audioManager.setMusicVolume(s.musicVolume);
        eventBus.emit('audio:musicVolume', s.musicVolume);
      }),
    );
    this.audioSection.appendChild(
      this.createSlider('SFX volume', settings.value.sfxVolume, 0, 1, 0.01, (value) => {
        const s = settings.update({ sfxVolume: value });
        audioManager.setSfxVolume(s.sfxVolume);
        eventBus.emit('audio:sfxVolume', s.sfxVolume);
      }),
    );
  }

  private createTab(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'menu-tab';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      this.setActiveTab(btn);
      onClick();
    });
    return btn;
  }

  private setActiveTab(tab: HTMLButtonElement): void {
    const tabs = Array.from(this.root.querySelectorAll('.menu-tab'));
    for (const t of tabs) {
      t.classList.toggle('active', t === tab);
    }
  }

  private showSection(section: 'controls' | 'graphics' | 'audio'): void {
    this.controlsSection.classList.toggle('active', section === 'controls');
    this.graphicsSection.classList.toggle('active', section === 'graphics');
    this.audioSection.classList.toggle('active', section === 'audio');
  }

  private createSectionHeader(title: string): HTMLHeadingElement {
    const h3 = document.createElement('h3');
    h3.className = 'menu-section-header';
    h3.textContent = title;
    return h3;
  }

  private createSlider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'menu-field';
    const fieldLabel = document.createElement('label');
    const decimals = step < 0.01 ? (step < 0.001 ? 4 : 3) : 2;
    fieldLabel.textContent = `${label}: ${value.toFixed(decimals)}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      fieldLabel.textContent = `${label}: ${v.toFixed(decimals)}`;
      onChange(v);
    });
    wrapper.appendChild(fieldLabel);
    wrapper.appendChild(input);
    return wrapper;
  }

  private createToggle(label: string, value: boolean, onChange: (value: boolean) => void): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'menu-field';
    const fieldLabel = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => {
      onChange(input.checked);
    });
    fieldLabel.appendChild(input);
    fieldLabel.appendChild(document.createTextNode(label));
    wrapper.appendChild(fieldLabel);
    return wrapper;
  }

  private createSelect(
    label: string,
    value: string,
    options: string[],
    onChange: (value: string) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'menu-field';
    const fieldLabel = document.createElement('label');
    fieldLabel.textContent = label;
    const select = document.createElement('select');
    select.className = 'menu-select';
    options.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (opt === value) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      onChange(select.value);
    });
    wrapper.appendChild(fieldLabel);
    wrapper.appendChild(select);
    return wrapper;
  }
}
