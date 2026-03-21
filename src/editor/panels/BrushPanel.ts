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
    el.className = 'ke-brush-bar ke-hidden';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '10000',
    });

    for (const brush of BRUSH_REGISTRY) {
      const btn = document.createElement('div');
      btn.className = 'ke-brush-item';

      // Shortcut badge (top-right corner)
      const badge = document.createElement('span');
      badge.className = 'ke-brush-badge';
      badge.textContent = brush.shortcut;
      btn.appendChild(badge);

      // SVG icon
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '28');
      svg.setAttribute('height', '28');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.5');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.classList.add('ke-brush-icon');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', brush.icon);
      svg.appendChild(path);
      btn.appendChild(svg);

      // Label
      const label = document.createElement('span');
      label.className = 'ke-brush-label';
      label.textContent = brush.label;
      btn.appendChild(label);

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
      btn.classList.toggle('ke-brush-active', id === brushId);
    }
  }
}
