import { EditorPanel } from './EditorPanel';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface ToolbarCallbacks {
  onSave: () => void;
  onLoad: () => void;
  onImportGLB: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
  onSetMode: (mode: TransformMode) => void;
  onPlayTest: () => void;
}

/* ---- SVG icon paths (24×24 viewBox, Lucide-style) ---- */
const ICON_SAVE =
  'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8';
const ICON_FOLDER =
  'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z';
const ICON_IMPORT =
  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3';
const ICON_UNDO = 'M3 10h6M3 10l4-4M3 10l4 4M21 18a7 7 0 0 0-7-7H3';
const ICON_REDO = 'M21 10h-6M21 10l-4-4M21 10l-4 4M3 18a7 7 0 0 1 7-7h11';
const ICON_SNAP = 'M21 3H3v18h18V3zM12 3v18M3 12h18';
const ICON_GRID = 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18';
const ICON_PLAY = 'M5 3l14 9-14 9V3z';

export class ToolbarPanel extends EditorPanel {
  private modeButtons = new Map<TransformMode, HTMLButtonElement>();
  private snapBtn!: HTMLButtonElement;
  private gridBtn!: HTMLButtonElement;

  constructor(private callbacks: ToolbarCallbacks) {
    super('toolbar', 'Toolbar');
  }

  build(): void {
    const el = this.container;
    el.className = 'ke-toolbar ke-hidden';
    Object.assign(el.style, {
      position: 'fixed',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '10000',
    });

    // ── Left section: File operations ──
    const leftGroup = this.createGroup();
    leftGroup.appendChild(this.createIconBtn(ICON_SAVE, 'Save (Ctrl+S)', this.callbacks.onSave));
    leftGroup.appendChild(this.createIconBtn(ICON_FOLDER, 'Load', this.callbacks.onLoad));
    leftGroup.appendChild(this.createIconBtn(ICON_IMPORT, 'Import GLB', this.callbacks.onImportGLB));
    leftGroup.appendChild(this.createSep());
    leftGroup.appendChild(this.createIconBtn(ICON_UNDO, 'Undo (Ctrl+Z)', this.callbacks.onUndo));
    leftGroup.appendChild(this.createIconBtn(ICON_REDO, 'Redo (Ctrl+Y)', this.callbacks.onRedo));
    el.appendChild(leftGroup);

    el.appendChild(this.createDivider());

    // ── Center section: Transport controls (Unity-style) ──
    const transportGroup = this.createGroup();
    transportGroup.classList.add('ke-toolbar-transport');

    const playBtn = document.createElement('button');
    playBtn.className = 'ke-btn ke-btn-play';
    playBtn.title = 'Play Test (Ctrl+P)';
    // Build a filled play triangle SVG directly (not using svgIcon which sets stroke)
    const playSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    playSvg.setAttribute('width', '14');
    playSvg.setAttribute('height', '14');
    playSvg.setAttribute('viewBox', '0 0 24 24');
    playSvg.setAttribute('fill', 'currentColor');
    playSvg.setAttribute('stroke', 'none');
    const playPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    playPath.setAttribute('d', ICON_PLAY);
    playSvg.appendChild(playPath);
    playBtn.appendChild(playSvg);
    const playLabel = document.createElement('span');
    playLabel.textContent = 'Play';
    playLabel.style.fontSize = '12px';
    playLabel.style.fontWeight = '600';
    playBtn.appendChild(playLabel);
    playBtn.addEventListener('click', this.callbacks.onPlayTest);
    transportGroup.appendChild(playBtn);

    el.appendChild(transportGroup);

    el.appendChild(this.createDivider());

    // ── Right section: Snap/Grid toggles + Transform modes ──
    const rightGroup = this.createGroup();

    this.snapBtn = this.createIconBtn(ICON_SNAP, 'Toggle Snap', this.callbacks.onToggleSnap);
    this.gridBtn = this.createIconBtn(ICON_GRID, 'Toggle Grid', this.callbacks.onToggleGrid);
    rightGroup.appendChild(this.snapBtn);
    rightGroup.appendChild(this.gridBtn);
    rightGroup.appendChild(this.createSep());

    const modes: { label: string; mode: TransformMode; shortcut: string }[] = [
      { label: 'W', mode: 'translate', shortcut: 'Move (W)' },
      { label: 'E', mode: 'rotate', shortcut: 'Rotate (E)' },
      { label: 'R', mode: 'scale', shortcut: 'Scale (R)' },
    ];

    for (const { label, mode, shortcut } of modes) {
      const btn = document.createElement('button');
      btn.className = 'ke-btn ke-btn-mode';
      btn.textContent = label;
      btn.title = shortcut;
      btn.addEventListener('click', () => this.callbacks.onSetMode(mode));
      this.modeButtons.set(mode, btn);
      rightGroup.appendChild(btn);
    }

    el.appendChild(rightGroup);

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

  // ── Private helpers ──

  private createGroup(): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'ke-toolbar-group';
    return group;
  }

  private createIconBtn(iconPath: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'ke-btn ke-btn-icon';
    btn.title = title;
    btn.appendChild(this.svgIcon(iconPath, 16));
    btn.addEventListener('click', onClick);
    return btn;
  }

  private createDivider(): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'ke-toolbar-divider';
    return div;
  }

  private createSep(): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'ke-toolbar-sep';
    return div;
  }

  private svgIcon(pathD: string, size: number): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
  }
}
