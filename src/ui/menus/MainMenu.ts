interface MainMenuOptions {
  onPlay: () => void;
  onLevelSelect: () => void;
  onCreateLevel: () => void;
  onSettings: () => void;
  onHelp: () => void;
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
    playBtn.classList.add('menu-button-primary');
    const levelSelectBtn = this.createButton('Level Select', this.options.onLevelSelect);
    const createLevelBtn = this.createButton('Create Level', this.options.onCreateLevel);
    const settingsBtn = this.createButton('Settings', this.options.onSettings);
    const helpBtn = this.createButton('Help', this.options.onHelp);
    const quitBtn = this.createButton('Quit', this.options.onQuit);

    this.root.appendChild(playBtn);
    this.root.appendChild(levelSelectBtn);
    this.root.appendChild(createLevelBtn);
    this.root.appendChild(settingsBtn);
    this.root.appendChild(helpBtn);
    this.root.appendChild(quitBtn);

    // Version text
    const version = document.createElement('div');
    version.className = 'menu-version';
    version.textContent = 'v0.1 alpha';
    this.root.appendChild(version);
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
