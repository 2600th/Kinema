interface MainMenuOptions {
  onPlay: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

export class MainMenu {
  readonly id = 'main';
  readonly root: HTMLDivElement;

  constructor(private options: MainMenuOptions) {
    this.root = document.createElement('div');
    this.root.className = 'menu-screen';

    const title = document.createElement('h1');
    title.className = 'menu-title';
    title.textContent = 'Kinema';
    this.root.appendChild(title);

    const playBtn = this.createButton('Play', this.options.onPlay);
    const settingsBtn = this.createButton('Settings', this.options.onSettings);
    const quitBtn = this.createButton('Quit', this.options.onQuit);

    this.root.appendChild(playBtn);
    this.root.appendChild(settingsBtn);
    this.root.appendChild(quitBtn);
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
