import Stats from 'three/addons/libs/stats.module.js';
import type { EventBus } from '@core/EventBus';
import type { Disposable, StateId } from '@core/types';

type GraphicsQuality = 'high' | 'medium' | 'low';
type AntiAliasingMode = 'smaa' | 'fxaa' | 'taa' | 'none';

type SSGIPreset = 'low' | 'medium' | 'high';

interface RenderSettingsSnapshot {
  postProcessingEnabled: boolean;
  shadowsEnabled: boolean;
  graphicsQuality: GraphicsQuality;
  aaMode: AntiAliasingMode;
  exposure: number;
  ssaoEnabled: boolean;
  ssaoRadius: number;
  ssrEnabled: boolean;
  ssrOpacity: number;
  ssrResolutionScale: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  vignetteEnabled: boolean;
  vignetteDarkness: number;
  lutEnabled: boolean;
  lutStrength: number;
  ssgiEnabled: boolean;
  ssgiPreset: SSGIPreset;
  ssgiRadius: number;
  ssgiGiIntensity: number;
  traaEnabled: boolean;
}

/**
 * Modern debug overlay inspired by recent three.js inspector styles.
 */
export class DebugPanel implements Disposable {
  private readonly statsFps: Stats;
  private readonly statsMs: Stats;
  private readonly statsMb: Stats;
  private readonly statsPanels: readonly Stats[];
  private readonly graphWrap: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly metrics: HTMLDivElement;
  private readonly metricState: HTMLSpanElement;
  private readonly metricGrounded: HTMLSpanElement;
  private readonly metricSpeed: HTMLSpanElement;
  private readonly metricFps: HTMLSpanElement;
  private readonly metricFrame: HTMLSpanElement;
  private readonly metricPhysics: HTMLSpanElement;
  private readonly metricDraw: HTMLSpanElement;
  private readonly metricTris: HTMLSpanElement;
  private readonly checkboxControls = new Map<string, HTMLInputElement>();
  private readonly selectControls = new Map<string, HTMLSelectElement>();
  private readonly rangeControls = new Map<
  string,
  { input: HTMLInputElement; value: HTMLSpanElement; format: (value: number) => string }
  >();
  private graphsEnabled = true;
  private visible = false;

  constructor(parent: HTMLElement, private eventBus: EventBus) {
    this.statsFps = this.createStatsPanel(0);
    this.statsMs = this.createStatsPanel(1);
    this.statsMb = this.createStatsPanel(2);
    this.statsPanels = [this.statsFps, this.statsMs, this.statsMb];

    this.panel = document.createElement('div');
    this.panel.style.cssText = [
      'position:absolute',
      'right:12px',
      'top:12px',
      'display:none',
      'width:350px',
      'padding:12px 12px 10px',
      'background:rgba(16, 18, 22, 0.76)',
      'backdrop-filter:blur(8px)',
      'border:1px solid rgba(130,148,170,0.32)',
      'border-radius:10px',
      'box-shadow:0 10px 30px rgba(0,0,0,0.35)',
      'color:#d8e6f6',
      'font:12px/1.4 Inter, Segoe UI, Arial, sans-serif',
      'user-select:none',
      'pointer-events:auto',
      'z-index:1100',
      'max-height:100vh',
      'overflow-y:auto',
      'overflow-x:hidden',
      'overscroll-behavior:contain',
    ].join(';');
    parent.appendChild(this.panel);

    const title = document.createElement('div');
    title.textContent = 'Renderer & Debug';
    title.style.cssText = 'font-size:13px;font-weight:600;letter-spacing:0.02em;margin-bottom:10px;color:#eef7ff;';
    this.panel.appendChild(title);

    this.graphWrap = document.createElement('div');
    this.graphWrap.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-bottom:8px;';
    this.graphWrap.appendChild(this.statsFps.dom);
    this.graphWrap.appendChild(this.statsMs.dom);
    this.graphWrap.appendChild(this.statsMb.dom);
    this.panel.appendChild(this.graphWrap);

    this.metrics = document.createElement('div');
    this.metrics.style.cssText = [
      'display:grid',
      'grid-template-columns:1fr auto',
      'row-gap:3px',
      'column-gap:10px',
      'padding:8px 10px',
      'border-radius:8px',
      'background:rgba(8,10,13,0.55)',
      'margin-bottom:10px',
    ].join(';');
    this.panel.appendChild(this.metrics);

    this.metricState = this.addMetricRow('State');
    this.metricGrounded = this.addMetricRow('Grounded');
    this.metricSpeed = this.addMetricRow('Speed');
    this.metricFps = this.addMetricRow('FPS');
    this.metricFrame = this.addMetricRow('Frame');
    this.metricPhysics = this.addMetricRow('Physics');
    this.metricDraw = this.addMetricRow('Draw Calls');
    this.metricTris = this.addMetricRow('Triangles');

    const controls = document.createElement('div');
    controls.style.cssText = 'display:grid;grid-template-columns:1fr;row-gap:10px;';
    this.panel.appendChild(controls);

    const runtimeSection = this.createSection('Runtime Views');
    runtimeSection.appendChild(this.createCheckbox(
      'fpsGraph',
      'Performance graphs',
      true,
      'Shows FPS, frame-time, and memory graphs side by side.',
      (value) => {
        this.graphsEnabled = value;
        this.syncVisibility();
      },
    ));
    runtimeSection.appendChild(this.createCheckbox(
      'showColliders',
      'Show colliders',
      false,
      'Renders Rapier collider wireframes for collision debugging.',
      (value) => {
        this.eventBus.emit('debug:showColliders', value);
      },
    ));
    runtimeSection.appendChild(this.createCheckbox(
      'lightHelpers',
      'Light helpers',
      false,
      'Shows directional light and shadow camera helpers.',
      (value) => {
        this.eventBus.emit('debug:showLightHelpers', value);
      },
    ));
    runtimeSection.appendChild(this.createCheckbox(
      'cameraCollision',
      'Camera collision',
      true,
      'Prevents camera clipping by enabling wall collision sweeps.',
      (value) => {
        this.eventBus.emit('debug:cameraCollision', value);
      },
    ));
    controls.appendChild(runtimeSection);

    const qualitySection = this.createSection('Quality');
    qualitySection.appendChild(this.createSelect(
      'graphics',
      'Graphics',
      ['high', 'medium', 'low'],
      'high',
      'Applies renderer quality presets.',
      (value) => {
        this.eventBus.emit('debug:graphicsQuality', { quality: value as GraphicsQuality });
      },
    ));
    qualitySection.appendChild(this.createSelect(
      'aaMode',
      'Anti-aliasing',
      ['smaa', 'fxaa', 'taa', 'none'],
      'smaa',
      'Chooses edge smoothing mode for post-processing.',
      (value) => {
        this.eventBus.emit('debug:aaMode', { mode: value as AntiAliasingMode });
      },
    ));
    qualitySection.appendChild(this.createCheckbox(
      'postProcessing',
      'Post processing',
      true,
      'Toggles the complete post-processing pipeline.',
      (value) => {
        this.eventBus.emit('debug:postProcessing', value);
      },
    ));
    qualitySection.appendChild(this.createCheckbox(
      'shadows',
      'Shadows',
      true,
      'Enables or disables real-time shadow rendering.',
      (value) => {
        this.eventBus.emit('debug:shadows', value);
      },
    ));
    qualitySection.appendChild(this.createRange(
      'exposure',
      'Exposure',
      0.4,
      1.8,
      0.01,
      0.82,
      'Adjusts tonemapping exposure/brightness.',
      (value) => {
        this.eventBus.emit('debug:exposure', value);
      },
      (value) => value.toFixed(2),
    ));
    controls.appendChild(qualitySection);

    const postFxSection = this.createSection('Post FX');
    postFxSection.appendChild(this.createCheckbox(
      'ssgiEnabled',
      'SSGI (GI + AO)',
      true,
      'Toggles screen-space global illumination and ambient occlusion (TSL pipeline).',
      (value) => {
        this.eventBus.emit('debug:ssgiEnabled', value);
      },
    ));
    postFxSection.appendChild(this.createSelect(
      'ssgiPreset',
      'SSGI quality',
      ['low', 'medium', 'high'],
      'medium',
      'SSGI slice/step preset: low=1/12, medium=2/8, high=3/16.',
      (value) => {
        this.eventBus.emit('debug:ssgiPreset', value as SSGIPreset);
      },
    ));
    postFxSection.appendChild(this.createRange(
      'ssgiRadius',
      'SSGI radius',
      1,
      25,
      0.5,
      12,
      'World-space sampling radius for SSGI.',
      (value) => {
        this.eventBus.emit('debug:ssgiRadius', value);
      },
      (value) => value.toFixed(1),
    ));
    postFxSection.appendChild(this.createRange(
      'ssgiGiIntensity',
      'SSGI GI intensity',
      0,
      100,
      1,
      10,
      'Indirect diffuse light intensity.',
      (value) => {
        this.eventBus.emit('debug:ssgiGiIntensity', value);
      },
      (value) => value.toFixed(0),
    ));
    postFxSection.appendChild(this.createCheckbox(
      'traaEnabled',
      'TRAA',
      true,
      'Temporal reprojection anti-aliasing (TSL pipeline).',
      (value) => {
        this.eventBus.emit('debug:traaEnabled', value);
      },
    ));
    postFxSection.appendChild(this.createCheckbox(
      'ssaoEnabled',
      'SSAO / SSGI',
      true,
      'In TSL pipeline this toggles SSGI (screen-space global illumination). No separate SSAO pass; SSGI provides AO-style darkening.',
      (value) => {
        this.eventBus.emit('debug:ssaoEnabled', value);
      },
    ));
    postFxSection.appendChild(this.createRange(
      'ssaoRadius',
      'SSGI radius',
      2,
      24,
      1,
      14,
      'Controls SSGI sample radius (ambient occlusion–style effect in TSL).',
      (value) => {
        this.eventBus.emit('debug:ssaoRadius', value);
      },
      (value) => value.toFixed(0),
    ));
    postFxSection.appendChild(this.createCheckbox(
      'ssrEnabled',
      'SSR reflections',
      false,
      'Toggles screen-space reflections in the TSL pipeline.',
      (value) => {
        this.eventBus.emit('debug:ssrEnabled', value);
      },
    ));
    postFxSection.appendChild(this.createRange(
      'ssrOpacity',
      'SSR opacity',
      0,
      1,
      0.01,
      0.5,
      'Blend strength of SSR reflections.',
      (value) => {
        this.eventBus.emit('debug:ssrOpacity', value);
      },
      (value) => value.toFixed(2),
    ));
    postFxSection.appendChild(this.createRange(
      'ssrResolutionScale',
      'SSR quality',
      0.25,
      1,
      0.01,
      0.5,
      'Controls SSR resolution scale: higher is cleaner but more expensive.',
      (value) => {
        this.eventBus.emit('debug:ssrResolutionScale', value);
      },
      (value) => value.toFixed(2),
    ));
    postFxSection.appendChild(this.createCheckbox(
      'bloomEnabled',
      'Bloom',
      true,
      'Toggles bright highlight bloom.',
      (value) => {
        this.eventBus.emit('debug:bloomEnabled', value);
      },
    ));
    postFxSection.appendChild(this.createRange(
      'bloomStrength',
      'Bloom strength',
      0,
      1.5,
      0.01,
      0.02,
      'Controls bloom intensity.',
      (value) => {
        this.eventBus.emit('debug:bloomStrength', value);
      },
      (value) => value.toFixed(2),
    ));
    postFxSection.appendChild(this.createCheckbox(
      'vignetteEnabled',
      'Vignette',
      true,
      'Adds subtle edge darkening for depth focus.',
      (value) => {
        this.eventBus.emit('debug:vignetteEnabled', value);
      },
    ));
    postFxSection.appendChild(this.createRange(
      'vignetteDarkness',
      'Vignette darkness',
      0,
      0.8,
      0.01,
      0.35,
      'Controls vignette darkness amount (0 = none, ~0.35 = subtle).',
      (value) => {
        this.eventBus.emit('debug:vignetteDarkness', value);
      },
      (value) => value.toFixed(2),
    ));
    postFxSection.appendChild(this.createCheckbox(
      'lutEnabled',
      'Color grading LUT',
      true,
      'Strength blends in a simple color grade (3D LUT disabled in WebGPU; full LUT when re-enabled).',
      (value) => {
        this.eventBus.emit('debug:lutEnabled', value);
      },
    ));
    postFxSection.appendChild(this.createRange(
      'lutStrength',
      'LUT strength',
      0,
      1,
      0.01,
      0.42,
      'Blends LUT color grading intensity.',
      (value) => {
        this.eventBus.emit('debug:lutStrength', value);
      },
      (value) => value.toFixed(2),
    ));
    controls.appendChild(postFxSection);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.syncVisibility();
  }

  syncRenderSettings(settings: RenderSettingsSnapshot): void {
    this.setCheckbox('postProcessing', settings.postProcessingEnabled);
    this.setCheckbox('shadows', settings.shadowsEnabled);
    this.setSelect('graphics', settings.graphicsQuality);
    this.setSelect('aaMode', settings.aaMode);
    this.setRange('exposure', settings.exposure);
    this.setCheckbox('ssgiEnabled', settings.ssgiEnabled);
    this.setSelect('ssgiPreset', settings.ssgiPreset);
    this.setRange('ssgiRadius', settings.ssgiRadius);
    this.setRange('ssgiGiIntensity', settings.ssgiGiIntensity);
    this.setCheckbox('traaEnabled', settings.traaEnabled);
    this.setCheckbox('ssaoEnabled', settings.ssaoEnabled);
    this.setRange('ssaoRadius', settings.ssaoRadius);
    this.setCheckbox('ssrEnabled', settings.ssrEnabled);
    this.setRange('ssrOpacity', settings.ssrOpacity);
    this.setRange('ssrResolutionScale', settings.ssrResolutionScale);
    this.setCheckbox('bloomEnabled', settings.bloomEnabled);
    this.setRange('bloomStrength', settings.bloomStrength);
    this.setCheckbox('vignetteEnabled', settings.vignetteEnabled);
    this.setRange('vignetteDarkness', settings.vignetteDarkness);
    this.setCheckbox('lutEnabled', settings.lutEnabled);
    this.setRange('lutStrength', settings.lutStrength);
  }

  tick(
    speed: number,
    state: StateId,
    grounded: boolean,
    perf: {
      frameMs: number;
      physicsMs: number;
      drawCalls: number;
      triangles: number;
      lines: number;
      points: number;
    },
  ): void {
    if (!this.visible) return;
    const fps = perf.frameMs > 0.001 ? 1000 / perf.frameMs : 0;
    this.metricState.textContent = state;
    this.metricGrounded.textContent = grounded ? 'yes' : 'no';
    this.metricSpeed.textContent = speed.toFixed(2);
    this.metricFps.textContent = fps.toFixed(1);
    this.metricFrame.textContent = `${perf.frameMs.toFixed(2)} ms`;
    this.metricPhysics.textContent = `${perf.physicsMs.toFixed(2)} ms`;
    this.metricDraw.textContent = String(perf.drawCalls);
    this.metricTris.textContent = String(perf.triangles);
    for (const stats of this.statsPanels) {
      stats.update();
    }
  }

  dispose(): void {
    this.panel.remove();
    for (const stats of this.statsPanels) {
      stats.dom.remove();
    }
  }

  private syncVisibility(): void {
    this.panel.style.display = this.visible ? 'block' : 'none';
    this.graphWrap.style.display = this.visible && this.graphsEnabled ? 'grid' : 'none';
  }

  private createStatsPanel(panelIndex: number): Stats {
    const stats = new Stats();
    stats.showPanel(panelIndex);
    stats.dom.style.position = 'relative';
    stats.dom.style.left = 'auto';
    stats.dom.style.right = 'auto';
    stats.dom.style.top = 'auto';
    stats.dom.style.margin = '0';
    stats.dom.style.zIndex = '0';
    // Prevent clicking a graph from cycling panel modes.
    stats.dom.style.pointerEvents = 'none';
    return stats;
  }

  private createSection(title: string): HTMLElement {
    const section = document.createElement('section');
    section.style.cssText = 'display:grid;grid-template-columns:1fr;row-gap:7px;padding:8px;border-radius:8px;background:rgba(8,10,13,0.44);';
    const heading = document.createElement('div');
    heading.textContent = title;
    heading.style.cssText = 'color:#9ec4ea;font-weight:600;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;';
    section.appendChild(heading);
    return section;
  }

  private addMetricRow(label: string): HTMLSpanElement {
    const key = document.createElement('span');
    key.textContent = label;
    key.style.cssText = 'color:#89a2ba;';
    const value = document.createElement('span');
    value.textContent = '-';
    value.style.cssText = 'font-family:Consolas, "Courier New", monospace;color:#e8f3ff;';
    this.metrics.appendChild(key);
    this.metrics.appendChild(value);
    return value;
  }

  private createCheckbox(
    key: string,
    label: string,
    initial: boolean,
    tooltip: string,
    onChange: (value: boolean) => void,
  ): HTMLLabelElement {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;';
    row.title = tooltip;
    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = 'color:#d6e4f1;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = initial;
    input.style.cssText = 'accent-color:#4ca3ff;';
    input.addEventListener('change', () => onChange(input.checked));
    this.checkboxControls.set(key, input);
    row.appendChild(text);
    row.appendChild(input);
    return row;
  }

  private createRange(
    key: string,
    label: string,
    min: number,
    max: number,
    step: number,
    initial: number,
    tooltip: string,
    onChange: (value: number) => void,
    format: (value: number) => string,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr auto;column-gap:8px;row-gap:4px;';
    row.title = tooltip;
    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = 'color:#d6e4f1;';
    const valueText = document.createElement('span');
    valueText.textContent = format(initial);
    valueText.style.cssText = 'font-family:Consolas, "Courier New", monospace;color:#8cc7ff;';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initial);
    input.style.cssText = 'grid-column:1 / span 2;accent-color:#4ca3ff;';
    input.addEventListener('input', () => {
      const value = Number(input.value);
      valueText.textContent = format(value);
      onChange(value);
    });
    this.rangeControls.set(key, { input, value: valueText, format });
    row.appendChild(text);
    row.appendChild(valueText);
    row.appendChild(input);
    return row;
  }

  private createSelect(
    key: string,
    label: string,
    options: string[],
    initial: string,
    tooltip: string,
    onChange: (value: string) => void,
  ): HTMLLabelElement {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';
    row.title = tooltip;
    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = 'color:#d6e4f1;';
    const select = document.createElement('select');
    for (const option of options) {
      const el = document.createElement('option');
      el.value = option;
      el.textContent = option;
      if (option === initial) {
        el.selected = true;
      }
      select.appendChild(el);
    }
    select.style.cssText = [
      'background:#1b2531',
      'color:#e9f4ff',
      'border:1px solid rgba(137,162,186,0.5)',
      'border-radius:6px',
      'padding:2px 6px',
      'text-transform:uppercase',
      'font-size:11px',
    ].join(';');
    select.addEventListener('change', () => onChange(select.value));
    this.selectControls.set(key, select);
    row.appendChild(text);
    row.appendChild(select);
    return row;
  }

  private setCheckbox(key: string, value: boolean): void {
    const input = this.checkboxControls.get(key);
    if (!input) return;
    input.checked = value;
  }

  private setRange(key: string, value: number): void {
    const control = this.rangeControls.get(key);
    if (!control) return;
    control.input.value = String(value);
    control.value.textContent = control.format(value);
  }

  private setSelect(key: string, value: string): void {
    const select = this.selectControls.get(key);
    if (!select) return;
    select.value = value;
  }
}
