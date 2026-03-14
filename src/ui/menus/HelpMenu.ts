interface HelpMenuOptions {
  onBack: () => void;
}

interface KeyBinding {
  key: string;
  description: string;
}

export class HelpMenu {
  readonly id = 'help';
  readonly root: HTMLDivElement;

  constructor(private options: HelpMenuOptions) {
    this.root = document.createElement('div');
    this.root.className = 'menu-screen help-menu';

    const title = document.createElement('h1');
    title.className = 'menu-title';
    title.textContent = 'Controls & Help';
    this.root.appendChild(title);

    const content = document.createElement('div');
    content.className = 'help-content';
    this.root.appendChild(content);

    const movement: KeyBinding[] = [
      { key: 'W A S D', description: 'Move' },
      { key: '↑ ↓ ← →', description: 'Move (arrows)' },
      { key: 'Space', description: 'Jump / Double Jump' },
      { key: 'C', description: 'Crouch' },
      { key: 'Shift', description: 'Sprint' },
      { key: 'W / S', description: 'Climb (on ladder)' },
    ];

    const interaction: KeyBinding[] = [
      { key: 'F', description: 'Interact / Grab' },
      { key: 'LMB', description: 'Throw / Primary action' },
      { key: 'E', description: 'Altitude Up' },
      { key: 'Q', description: 'Altitude Down' },
    ];

    const cameraSystem: KeyBinding[] = [
      { key: 'Mouse', description: 'Look around' },
      { key: 'Scroll', description: 'Zoom camera' },
      { key: 'Escape', description: 'Pause menu' },
      { key: '`', description: 'Debug panel' },
      { key: 'F1', description: 'Level editor' },
      { key: 'F6', description: 'Cycle graphics profile' },
    ];

    content.appendChild(this.createBindingSection('Movement', movement));
    content.appendChild(this.createBindingSection('Interaction', interaction));
    content.appendChild(this.createBindingSection('Camera & System', cameraSystem));

    const backBtn = document.createElement('button');
    backBtn.className = 'menu-button';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => this.options.onBack());
    this.root.appendChild(backBtn);
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

  private createBindingSection(title: string, bindings: KeyBinding[]): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'help-section';

    const header = document.createElement('h3');
    header.className = 'menu-section-header';
    header.textContent = title;
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'help-bindings-grid';

    for (const binding of bindings) {
      const keyCell = document.createElement('div');
      keyCell.className = 'help-key-cell';

      const keys = binding.key.split(' / ');
      for (let i = 0; i < keys.length; i++) {
        const kbd = document.createElement('kbd');
        kbd.className = 'help-key';
        kbd.textContent = keys[i];
        keyCell.appendChild(kbd);
        if (i < keys.length - 1) {
          const sep = document.createTextNode(' / ');
          keyCell.appendChild(sep);
        }
      }

      const descCell = document.createElement('div');
      descCell.className = 'help-desc-cell';
      descCell.textContent = binding.description;

      grid.appendChild(keyCell);
      grid.appendChild(descCell);
    }

    section.appendChild(grid);
    return section;
  }
}
