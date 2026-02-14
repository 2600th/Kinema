import * as THREE from 'three';
import type { EditorObject } from './EditorObject';

interface EditorUIOptions {
  onSave: () => void;
  onLoad: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
  onModeChange: (mode: 'translate' | 'rotate' | 'scale') => void;
  onInspectorChange: (values: { position?: number[]; rotation?: number[]; scale?: number[] }) => void;
}

export class EditorUI {
  readonly root: HTMLDivElement;
  readonly assetPanel: HTMLDivElement;
  private inspector: HTMLDivElement;
  private statusBar: HTMLDivElement;

  constructor(private options: EditorUIOptions) {
    this.root = document.createElement('div');
    this.root.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 1100;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #e0e0e0;
    `;
    this.root.style.display = 'none';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      display: flex;
      gap: 8px;
      background: rgba(15, 15, 25, 0.78);
      padding: 8px;
      border-radius: 10px;
      pointer-events: auto;
    `;
    toolbar.appendChild(this.makeButton('Save', this.options.onSave));
    toolbar.appendChild(this.makeButton('Load', this.options.onLoad));
    toolbar.appendChild(this.makeButton('Undo', this.options.onUndo));
    toolbar.appendChild(this.makeButton('Redo', this.options.onRedo));
    toolbar.appendChild(this.makeButton('Snap', this.options.onToggleSnap));
    toolbar.appendChild(this.makeButton('Grid', this.options.onToggleGrid));
    toolbar.appendChild(this.makeButton('W', () => this.options.onModeChange('translate')));
    toolbar.appendChild(this.makeButton('E', () => this.options.onModeChange('rotate')));
    toolbar.appendChild(this.makeButton('R', () => this.options.onModeChange('scale')));
    this.root.appendChild(toolbar);

    this.assetPanel = document.createElement('div');
    this.assetPanel.style.cssText = `
      position: absolute;
      left: 10px;
      top: 70px;
      width: 190px;
      max-height: 70vh;
      overflow: auto;
      background: rgba(15, 15, 25, 0.78);
      padding: 10px;
      border-radius: 10px;
      pointer-events: auto;
    `;
    this.root.appendChild(this.assetPanel);

    this.inspector = document.createElement('div');
    this.inspector.style.cssText = `
      position: absolute;
      right: 10px;
      top: 10px;
      width: 220px;
      background: rgba(15, 15, 25, 0.78);
      padding: 12px;
      border-radius: 10px;
      pointer-events: auto;
    `;
    this.root.appendChild(this.inspector);

    this.statusBar = document.createElement('div');
    this.statusBar.style.cssText = `
      position: absolute;
      left: 10px;
      bottom: 10px;
      background: rgba(15, 15, 25, 0.78);
      padding: 8px 12px;
      border-radius: 10px;
      pointer-events: none;
      font-size: 12px;
    `;
    this.root.appendChild(this.statusBar);
  }

  show(): void {
    this.root.style.display = 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  setStatus(text: string): void {
    this.statusBar.textContent = text;
  }

  setSelection(obj: EditorObject | null): void {
    this.inspector.innerHTML = '';
    const header = document.createElement('div');
    header.textContent = obj ? obj.name : 'No selection';
    header.style.marginBottom = '10px';
    this.inspector.appendChild(header);
    if (!obj) return;

    this.inspector.appendChild(this.makeVectorInputs('Position', obj.mesh.position.toArray(), (values) => {
      this.options.onInspectorChange({ position: values });
    }));
    this.inspector.appendChild(this.makeVectorInputs('Rotation', [
      THREE.MathUtils.radToDeg(obj.mesh.rotation.x),
      THREE.MathUtils.radToDeg(obj.mesh.rotation.y),
      THREE.MathUtils.radToDeg(obj.mesh.rotation.z),
    ], (values) => {
      this.options.onInspectorChange({ rotation: values });
    }));
    this.inspector.appendChild(this.makeVectorInputs('Scale', obj.mesh.scale.toArray(), (values) => {
      this.options.onInspectorChange({ scale: values });
    }));
  }

  dispose(): void {
    this.root.remove();
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      background: rgba(79, 195, 247, 0.2);
      border: none;
      color: #e0e0e0;
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
    `;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private makeVectorInputs(
    label: string,
    values: number[],
    onCommit: (values: number[]) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '8px';
    const title = document.createElement('div');
    title.textContent = label;
    title.style.fontSize = '12px';
    title.style.marginBottom = '4px';
    wrapper.appendChild(title);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '4px';
    values.forEach((value) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = value.toFixed(2);
      input.style.width = '60px';
      input.addEventListener('change', () => {
        const next = row.querySelectorAll('input');
        const vals = Array.from(next).map((el) => Number((el as HTMLInputElement).value));
        onCommit(vals);
      });
      row.appendChild(input);
    });
    wrapper.appendChild(row);
    return wrapper;
  }
}

