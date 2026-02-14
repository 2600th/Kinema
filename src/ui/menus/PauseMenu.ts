interface PauseMenuOptions {
  onResume: () => void;
  onSettings: () => void;
  onMainMenu: () => void;
}

export class PauseMenu {
  readonly id = 'pause';
  readonly root: HTMLDivElement;

  constructor(private options: PauseMenuOptions) {
    this.root = document.createElement('div');
    this.root.className = 'menu-screen';

    const title = document.createElement('h1');
    title.className = 'menu-title';
    title.textContent = 'Paused';
    this.root.appendChild(title);

    const resumeBtn = this.createButton('Resume', this.options.onResume);
    const settingsBtn = this.createButton('Settings', this.options.onSettings);
    const mainMenuBtn = this.createButton('Main Menu', this.options.onMainMenu);

    this.root.appendChild(resumeBtn);
    this.root.appendChild(settingsBtn);
    this.root.appendChild(mainMenuBtn);
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

  private createButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'menu-button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }
}
