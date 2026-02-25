import { EditorPanel } from './EditorPanel';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface ToolbarCallbacks {
  onSave: () => void;
  onLoad: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
  onSetMode: (mode: TransformMode) => void;
}

export class ToolbarPanel extends EditorPanel {
  private modeButtons = new Map<TransformMode, HTMLButtonElement>();
  private snapBtn!: HTMLButtonElement;
  private gridBtn!: HTMLButtonElement;

  constructor(private callbacks: ToolbarCallbacks) {
    super('toolbar', 'Toolbar');
  }

  build(): void {
    const el = this.container;
    // Override default panel class — toolbar uses its own fixed positioning
    el.className = 'ke-toolbar ke-hidden';
    Object.assign(el.style, {
      position: 'fixed',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '10000',
    });

    // --- Group 1: File operations ---
    el.appendChild(this.createBtn('Save', this.callbacks.onSave));
    el.appendChild(this.createBtn('Load', this.callbacks.onLoad));
    el.appendChild(this.createBtn('Undo', this.callbacks.onUndo));
    el.appendChild(this.createBtn('Redo', this.callbacks.onRedo));

    el.appendChild(this.createDivider());

    // --- Group 2: Toggles ---
    this.snapBtn = this.createBtn('Snap', this.callbacks.onToggleSnap);
    this.gridBtn = this.createBtn('Grid', this.callbacks.onToggleGrid);
    el.appendChild(this.snapBtn);
    el.appendChild(this.gridBtn);

    el.appendChild(this.createDivider());

    // --- Group 3: Transform mode ---
    const modes: { label: string; mode: TransformMode }[] = [
      { label: 'W', mode: 'translate' },
      { label: 'E', mode: 'rotate' },
      { label: 'R', mode: 'scale' },
    ];

    for (const { label, mode } of modes) {
      const btn = this.createBtn(label, () => this.callbacks.onSetMode(mode));
      this.modeButtons.set(mode, btn);
      el.appendChild(btn);
    }

    // Default: translate active
    this.setActiveMode('translate');
  }

  update(): void {
    // No per-frame updates needed — state is driven by setters
  }

  setActiveMode(mode: string): void {
    for (const [m, btn] of this.modeButtons) {
      btn.classList.toggle('ke-btn-active', m === mode);
    }
  }

  setSnapActive(active: boolean): void {
    this.snapBtn.classList.toggle('ke-btn-active', active);
  }

  setGridActive(active: boolean): void {
    this.gridBtn.classList.toggle('ke-btn-active', active);
  }

  // ---- private helpers ----

  private createBtn(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'ke-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private createDivider(): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'ke-toolbar-divider';
    return div;
  }
}
