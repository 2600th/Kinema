import { EditorPanel } from './EditorPanel';
import type { EditorObject } from '../EditorObject';

/* ------------------------------------------------------------------ */
/*  Callback interfaces                                                */
/* ------------------------------------------------------------------ */

export interface InspectorCallbacks {
  onTransformChange: (
    id: string,
    transform: {
      position: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
    },
  ) => void;
  onMaterialChange: (
    id: string,
    material: {
      color: string;
      roughness: number;
      metalness: number;
      emissive: string;
      emissiveIntensity: number;
      opacity: number;
    },
  ) => void;
  onPhysicsTypeChange: (id: string, type: 'static' | 'dynamic' | 'kinematic') => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Chevron-down icon path (16x16 viewBox) */
const ICON_CHEVRON = 'M4 6l4 4 4-4';

/* ------------------------------------------------------------------ */
/*  InspectorPanel                                                     */
/* ------------------------------------------------------------------ */

export class InspectorPanel extends EditorPanel {
  private selection: EditorObject | null = null;

  /** Guard to suppress callbacks while programmatically updating inputs. */
  private updating = false;

  /* --- Section DOM refs --- */
  private placeholder!: HTMLDivElement;
  private transformSection!: HTMLDivElement;
  private transformBody!: HTMLDivElement;
  private materialSection!: HTMLDivElement;
  private materialBody!: HTMLDivElement;

  /* --- Transform inputs --- */
  private posInputs!: HTMLInputElement[];
  private rotInputs!: HTMLInputElement[];
  private scaleInputs!: HTMLInputElement[];
  private physicsSelect!: HTMLSelectElement;

  /* --- Material inputs --- */
  private colorInput!: HTMLInputElement;
  private colorHex!: HTMLSpanElement;
  private roughnessSlider!: HTMLInputElement;
  private metalnessSlider!: HTMLInputElement;
  private emissiveInput!: HTMLInputElement;
  private emissiveHex!: HTMLSpanElement;
  private emissiveIntensitySlider!: HTMLInputElement;
  private opacitySlider!: HTMLInputElement;

  /* --- Collapse state --- */
  private transformCollapsed = false;
  private materialCollapsed = false;

  constructor(private callbacks: InspectorCallbacks) {
    super('inspector', 'Inspector');
  }

  /* ================================================================ */
  /*  Public API                                                       */
  /* ================================================================ */

  setSelection(obj: EditorObject | null): void {
    this.selection = obj;
    this.refreshDisplay();
  }

  /* ================================================================ */
  /*  Lifecycle                                                        */
  /* ================================================================ */

  build(): void {
    const el = this.container;
    el.className = 'ke-panel ke-panel-inspector ke-hidden';
    Object.assign(el.style, {
      position: 'fixed',
      top: '60px',
      right: '12px',
      width: '280px',
      maxHeight: 'calc(100vh - 80px)',
      zIndex: '10000',
      overflowY: 'auto',
    });

    /* -- Header -- */
    const header = document.createElement('div');
    header.className = 'ke-panel-header';
    header.textContent = 'Inspector';
    el.appendChild(header);

    /* -- Body -- */
    const body = document.createElement('div');
    body.className = 'ke-panel-body';

    /* Placeholder (no selection) */
    this.placeholder = document.createElement('div');
    Object.assign(this.placeholder.style, {
      textAlign: 'center',
      padding: '24px 0',
      color: 'var(--ke-text-dim)',
      fontSize: 'var(--ke-font-size)',
    });
    this.placeholder.textContent = 'No selection';
    body.appendChild(this.placeholder);

    /* ---------- Transform section ---------- */
    this.transformSection = document.createElement('div');

    const transformHeader = this.createSectionHeader('Transform', (collapsed) => {
      this.transformCollapsed = collapsed;
      this.transformBody.style.display = collapsed ? 'none' : '';
    });
    this.transformSection.appendChild(transformHeader);

    this.transformBody = document.createElement('div');
    this.transformBody.className = 'ke-inspector';

    this.posInputs = this.createVectorRow(this.transformBody, 'Position');
    this.rotInputs = this.createVectorRow(this.transformBody, 'Rotation');
    this.scaleInputs = this.createVectorRow(this.transformBody, 'Scale');

    /* Physics type dropdown */
    const physicsRow = document.createElement('div');
    physicsRow.className = 'ke-inspector-row';

    const physicsLabel = document.createElement('span');
    physicsLabel.className = 'ke-inspector-label';
    physicsLabel.textContent = 'Physics';
    physicsRow.appendChild(physicsLabel);

    const physicsValueWrap = document.createElement('div');
    physicsValueWrap.className = 'ke-inspector-value';

    this.physicsSelect = document.createElement('select');
    this.physicsSelect.className = 'ke-input';
    for (const opt of ['static', 'dynamic', 'kinematic'] as const) {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
      this.physicsSelect.appendChild(option);
    }
    this.physicsSelect.addEventListener('change', () => {
      if (this.updating || !this.selection) return;
      this.callbacks.onPhysicsTypeChange(
        this.selection.id,
        this.physicsSelect.value as 'static' | 'dynamic' | 'kinematic',
      );
    });
    physicsValueWrap.appendChild(this.physicsSelect);
    physicsRow.appendChild(physicsValueWrap);
    this.transformBody.appendChild(physicsRow);

    /* Wire up transform input callbacks */
    const fireTransform = (): void => {
      if (this.updating || !this.selection) return;
      this.callbacks.onTransformChange(this.selection.id, {
        position: this.readVec3(this.posInputs),
        rotation: this.readVec3Rad(this.rotInputs),
        scale: this.readVec3(this.scaleInputs),
      });
    };

    for (const input of [...this.posInputs, ...this.rotInputs, ...this.scaleInputs]) {
      input.addEventListener('input', fireTransform);
    }

    this.transformSection.appendChild(this.transformBody);
    body.appendChild(this.transformSection);

    /* ---------- Material section ---------- */
    this.materialSection = document.createElement('div');
    Object.assign(this.materialSection.style, { marginTop: '4px' });

    const materialHeader = this.createSectionHeader('Material', (collapsed) => {
      this.materialCollapsed = collapsed;
      this.materialBody.style.display = collapsed ? 'none' : '';
    });
    this.materialSection.appendChild(materialHeader);

    this.materialBody = document.createElement('div');
    this.materialBody.className = 'ke-inspector';

    /* Color */
    const colorResult = this.createColorRow(this.materialBody, 'Color', '#808080');
    this.colorInput = colorResult.input;
    this.colorHex = colorResult.hex;

    /* Roughness */
    const roughResult = this.createSliderRow(this.materialBody, 'Roughness', 0, 1, 0.01, 0.7);
    this.roughnessSlider = roughResult.slider;

    /* Metalness */
    const metalResult = this.createSliderRow(this.materialBody, 'Metalness', 0, 1, 0.01, 0);
    this.metalnessSlider = metalResult.slider;

    /* Emissive */
    const emissiveResult = this.createColorRow(this.materialBody, 'Emissive', '#000000');
    this.emissiveInput = emissiveResult.input;
    this.emissiveHex = emissiveResult.hex;

    /* Emissive Intensity */
    const intensityResult = this.createSliderRow(
      this.materialBody,
      'Intensity',
      0,
      5,
      0.01,
      0,
    );
    this.emissiveIntensitySlider = intensityResult.slider;

    /* Opacity */
    const opacityResult = this.createSliderRow(this.materialBody, 'Opacity', 0, 1, 0.01, 1);
    this.opacitySlider = opacityResult.slider;

    /* Wire up material input callbacks */
    const fireMaterial = (): void => {
      if (this.updating || !this.selection) return;
      this.callbacks.onMaterialChange(this.selection.id, {
        color: this.colorInput.value,
        roughness: parseFloat(this.roughnessSlider.value),
        metalness: parseFloat(this.metalnessSlider.value),
        emissive: this.emissiveInput.value,
        emissiveIntensity: parseFloat(this.emissiveIntensitySlider.value),
        opacity: parseFloat(this.opacitySlider.value),
      });
    };

    this.colorInput.addEventListener('input', () => {
      this.colorHex.textContent = this.colorInput.value;
      fireMaterial();
    });
    this.emissiveInput.addEventListener('input', () => {
      this.emissiveHex.textContent = this.emissiveInput.value;
      fireMaterial();
    });

    for (const slider of [
      this.roughnessSlider,
      this.metalnessSlider,
      this.emissiveIntensitySlider,
      this.opacitySlider,
    ]) {
      slider.addEventListener('input', () => {
        this.syncSliderDisplay(slider);
        fireMaterial();
      });
    }

    this.materialSection.appendChild(this.materialBody);
    body.appendChild(this.materialSection);

    el.appendChild(body);

    /* Initial state: hide sections */
    this.transformSection.style.display = 'none';
    this.materialSection.style.display = 'none';
  }

  update(): void {
    // State-driven — no per-frame work needed.
  }

  /* ================================================================ */
  /*  Private — display refresh                                        */
  /* ================================================================ */

  private refreshDisplay(): void {
    const obj = this.selection;

    if (!obj) {
      this.placeholder.style.display = '';
      this.transformSection.style.display = 'none';
      this.materialSection.style.display = 'none';
      return;
    }

    this.placeholder.style.display = 'none';
    this.transformSection.style.display = '';
    this.materialSection.style.display = '';

    /* Suppress callbacks while writing values into DOM inputs */
    this.updating = true;

    /* --- Transform --- */
    this.writeVec3(this.posInputs, obj.transform.position);
    this.writeVec3Deg(this.rotInputs, obj.transform.rotation);
    this.writeVec3(this.scaleInputs, obj.transform.scale);
    this.physicsSelect.value = obj.physicsType ?? 'static';

    /* --- Material --- */
    const mat = obj.material;
    if (mat) {
      this.colorInput.value = mat.color;
      this.colorHex.textContent = mat.color;
      this.roughnessSlider.value = String(mat.roughness);
      this.syncSliderDisplay(this.roughnessSlider);
      this.metalnessSlider.value = String(mat.metalness);
      this.syncSliderDisplay(this.metalnessSlider);
      this.emissiveInput.value = mat.emissive;
      this.emissiveHex.textContent = mat.emissive;
      this.emissiveIntensitySlider.value = String(mat.emissiveIntensity);
      this.syncSliderDisplay(this.emissiveIntensitySlider);
      this.opacitySlider.value = String(mat.opacity);
      this.syncSliderDisplay(this.opacitySlider);
    }

    /* Restore collapse states */
    this.transformBody.style.display = this.transformCollapsed ? 'none' : '';
    this.materialBody.style.display = this.materialCollapsed ? 'none' : '';

    this.updating = false;
  }

  /* ================================================================ */
  /*  Private — DOM builders                                           */
  /* ================================================================ */

  /**
   * Creates a collapsible section header with a chevron icon.
   * Returns the header element.
   */
  private createSectionHeader(
    label: string,
    onToggle: (collapsed: boolean) => void,
  ): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'ke-section-header';

    const icon = this.createChevronIcon();
    icon.classList.add('ke-section-header-icon');
    header.appendChild(icon);

    const text = document.createElement('span');
    text.textContent = label;
    header.appendChild(text);

    let collapsed = false;
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      header.classList.toggle('collapsed', collapsed);
      onToggle(collapsed);
    });

    return header;
  }

  /**
   * Creates a row with a label and 3 number inputs (X, Y, Z).
   * Appends to `parent` and returns the 3 input elements.
   */
  private createVectorRow(parent: HTMLDivElement, label: string): HTMLInputElement[] {
    const row = document.createElement('div');
    row.className = 'ke-inspector-row';

    const lbl = document.createElement('span');
    lbl.className = 'ke-inspector-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const valueWrap = document.createElement('div');
    valueWrap.className = 'ke-inspector-value';
    Object.assign(valueWrap.style, { display: 'flex', gap: '4px' });

    const inputs: HTMLInputElement[] = [];
    const axes = ['X', 'Y', 'Z'];

    for (const axis of axes) {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'ke-input ke-input-number';
      input.step = '0.01';
      input.value = '0';
      input.title = `${label} ${axis}`;
      Object.assign(input.style, { width: '70px' });
      inputs.push(input);
      valueWrap.appendChild(input);
    }

    row.appendChild(valueWrap);
    parent.appendChild(row);
    return inputs;
  }

  /**
   * Creates a color picker row with swatch + hex display.
   * Appends to `parent`.
   */
  private createColorRow(
    parent: HTMLDivElement,
    label: string,
    defaultValue: string,
  ): { input: HTMLInputElement; hex: HTMLSpanElement } {
    const row = document.createElement('div');
    row.className = 'ke-inspector-row';

    const lbl = document.createElement('span');
    lbl.className = 'ke-inspector-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const valueWrap = document.createElement('div');
    valueWrap.className = 'ke-inspector-value ke-color-picker';

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'ke-color-picker-swatch';
    input.value = defaultValue;
    valueWrap.appendChild(input);

    const hex = document.createElement('span');
    hex.className = 'ke-color-picker-input';
    hex.textContent = defaultValue;
    Object.assign(hex.style, {
      display: 'inline-block',
      fontSize: 'var(--ke-font-size-sm)',
      fontFamily: 'var(--ke-font-mono)',
      color: 'var(--ke-text-dim)',
    });
    valueWrap.appendChild(hex);

    row.appendChild(valueWrap);
    parent.appendChild(row);

    return { input, hex };
  }

  /**
   * Creates a range slider row with value display.
   * Appends to `parent`.
   */
  private createSliderRow(
    parent: HTMLDivElement,
    label: string,
    min: number,
    max: number,
    step: number,
    defaultValue: number,
  ): { slider: HTMLInputElement; display: HTMLSpanElement } {
    const row = document.createElement('div');
    row.className = 'ke-inspector-row';

    const lbl = document.createElement('span');
    lbl.className = 'ke-inspector-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const valueWrap = document.createElement('div');
    valueWrap.className = 'ke-inspector-value';
    Object.assign(valueWrap.style, { display: 'flex', alignItems: 'center', gap: '6px' });

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ke-slider';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(defaultValue);
    Object.assign(slider.style, { flex: '1' });
    valueWrap.appendChild(slider);

    const display = document.createElement('span');
    Object.assign(display.style, {
      minWidth: '36px',
      textAlign: 'right',
      fontSize: 'var(--ke-font-size-sm)',
      fontFamily: 'var(--ke-font-mono)',
      color: 'var(--ke-text-dim)',
    });
    display.textContent = defaultValue.toFixed(2);
    valueWrap.appendChild(display);

    row.appendChild(valueWrap);
    parent.appendChild(row);

    return { slider, display };
  }

  /* ================================================================ */
  /*  Private — helpers                                                */
  /* ================================================================ */

  private createChevronIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICON_CHEVRON);
    svg.appendChild(path);
    return svg;
  }

  /** Reads 3 number inputs as a tuple. */
  private readVec3(inputs: HTMLInputElement[]): [number, number, number] {
    return [
      parseFloat(inputs[0].value) || 0,
      parseFloat(inputs[1].value) || 0,
      parseFloat(inputs[2].value) || 0,
    ];
  }

  /** Reads 3 degree inputs and converts to radians. */
  private readVec3Rad(inputs: HTMLInputElement[]): [number, number, number] {
    return [
      (parseFloat(inputs[0].value) || 0) * DEG2RAD,
      (parseFloat(inputs[1].value) || 0) * DEG2RAD,
      (parseFloat(inputs[2].value) || 0) * DEG2RAD,
    ];
  }

  /** Writes a tuple into 3 number inputs. */
  private writeVec3(inputs: HTMLInputElement[], values: [number, number, number]): void {
    inputs[0].value = values[0].toFixed(2);
    inputs[1].value = values[1].toFixed(2);
    inputs[2].value = values[2].toFixed(2);
  }

  /** Writes radians into 3 inputs, displayed as degrees. */
  private writeVec3Deg(inputs: HTMLInputElement[], radians: [number, number, number]): void {
    inputs[0].value = (radians[0] * RAD2DEG).toFixed(2);
    inputs[1].value = (radians[1] * RAD2DEG).toFixed(2);
    inputs[2].value = (radians[2] * RAD2DEG).toFixed(2);
  }

  /** Updates the display span next to a slider to reflect its current value. */
  private syncSliderDisplay(slider: HTMLInputElement): void {
    const display = slider.parentElement?.querySelector('span');
    if (display) {
      display.textContent = parseFloat(slider.value).toFixed(2);
    }
  }
}
