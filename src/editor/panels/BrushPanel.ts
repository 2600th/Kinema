import { EditorPanel } from './EditorPanel';
import { BRUSH_REGISTRY } from '../brushes/index';

export class BrushPanel extends EditorPanel {
  private buttons = new Map<string, HTMLDivElement>();
  private activeBrushId: string | null = null;

  constructor(private onBrushSelected: (brushId: string | null) => void) {
    super('brush-bar', 'Brushes');
  }

  build(): void {
    const el = this.container;
    // Override default panel class — brush bar uses its own fixed positioning
    el.className = 'ke-brush-bar ke-hidden';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '10000',
    });

    for (const brush of BRUSH_REGISTRY) {
      const btn = document.createElement('div');
      btn.className = 'ke-btn';
      Object.assign(btn.style, {
        flexDirection: 'column',
        padding: '6px 10px',
        gap: '3px',
        position: 'relative',
        cursor: 'pointer',
      });

      // SVG icon
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '24');
      svg.setAttribute('height', '24');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.5');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', brush.icon);
      svg.appendChild(path);
      btn.appendChild(svg);

      // Label
      const label = document.createElement('span');
      label.textContent = brush.label;
      Object.assign(label.style, {
        fontSize: '9px',
        lineHeight: '1',
        color: 'var(--ke-text-dim)',
        textAlign: 'center',
      });
      btn.appendChild(label);

      // Shortcut badge
      const badge = document.createElement('span');
      badge.textContent = brush.shortcut;
      Object.assign(badge.style, {
        position: 'absolute',
        top: '2px',
        right: '3px',
        fontSize: '8px',
        lineHeight: '1',
        color: 'var(--ke-text-dim)',
        opacity: '0.6',
        fontFamily: 'var(--ke-font-mono)',
      });
      btn.appendChild(badge);

      btn.addEventListener('click', () => {
        if (this.activeBrushId === brush.id) {
          this.onBrushSelected(null);
        } else {
          this.onBrushSelected(brush.id);
        }
      });

      this.buttons.set(brush.id, btn);
      el.appendChild(btn);
    }
  }

  update(): void {
    // No per-frame updates needed — state is driven by setActiveBrush
  }

  setActiveBrush(brushId: string | null): void {
    this.activeBrushId = brushId;
    for (const [id, btn] of this.buttons) {
      btn.classList.toggle('ke-btn-active', id === brushId);
    }
  }
}
