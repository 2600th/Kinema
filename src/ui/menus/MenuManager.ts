import type { EventBus } from '@core/EventBus';
import type { GameLoop } from '@core/GameLoop';
import type { RendererManager } from '@renderer/RendererManager';
import type { UserSettingsStore } from '@core/UserSettings';
import type { OrbitFollowCamera } from '@camera/OrbitFollowCamera';
import type { AudioManager } from '@audio/AudioManager';
import type { InputManager } from '@input/InputManager';
import { MainMenu } from './MainMenu';
import { PauseMenu } from './PauseMenu';
import { SettingsMenu } from './SettingsMenu';
import { LevelSelectMenu } from './LevelSelectMenu';
import { HelpMenu } from './HelpMenu';
import './menus.css';

interface MenuScreen {
  readonly id: string;
  readonly root: HTMLElement;
  show(): void;
  hide(): void;
  dispose(): void;
}

export class MenuManager {
  private overlay: HTMLDivElement;
  private stack: MenuScreen[] = [];
  private resumeOnClose = false;
  private backgroundTimer: number | null = null;
  private lastBgRender = 0;
  private unsubs: (() => void)[] = [];

  private mainMenu: MainMenu;
  private pauseMenu: PauseMenu;
  private settingsMenu: SettingsMenu;
  private levelSelectMenu: LevelSelectMenu;
  private helpMenu: HelpMenu;

  constructor(
    private eventBus: EventBus,
    private gameLoop: GameLoop,
    private renderer: RendererManager,
    settings: UserSettingsStore,
    inputManager: InputManager,
    camera: OrbitFollowCamera,
    audioManager: AudioManager,
    private onPlay: () => Promise<void>,
    private onPlayLevel: (key: string) => Promise<void>,
    private onReturnToMainMenu: () => Promise<void>,
    private onCreateLevel?: () => Promise<void>,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'menu-overlay';
    document.body.appendChild(this.overlay);
    this.addCosmicBackground();

    this.helpMenu = new HelpMenu({
      onBack: () => this.pop(),
    });
    this.mainMenu = new MainMenu({
      onPlay: () => void this.handlePlay(),
      onLevelSelect: () => this.push(this.levelSelectMenu),
      onCreateLevel: () => void this.handleCreateLevel(),
      onSettings: () => this.push(this.settingsMenu),
      onHelp: () => this.push(this.helpMenu),
      onQuit: () => this.handleQuit(),
    });
    this.pauseMenu = new PauseMenu({
      onResume: () => this.pop(),
      onSettings: () => this.push(this.settingsMenu),
      onHelp: () => this.push(this.helpMenu),
      onMainMenu: () => void this.handleReturnToMainMenu(),
    });
    this.settingsMenu = new SettingsMenu({
      settings,
      inputManager,
      camera,
      renderer: this.renderer,
      audioManager,
      eventBus: this.eventBus,
      onBack: () => this.pop(),
    });
    this.levelSelectMenu = new LevelSelectMenu({
      onSelectLevel: (key) => void this.handlePlaySavedLevel(key),
      onPlayProcedural: () => void this.handlePlay(),
      onBack: () => this.pop(),
    });

    // Wire UI audio to all menu screens
    this.wireButtonAudio(this.mainMenu.root);
    this.wireButtonAudio(this.pauseMenu.root);
    this.wireButtonAudio(this.settingsMenu.root);
    this.wireButtonAudio(this.levelSelectMenu.root);
    this.wireButtonAudio(this.helpMenu.root);

    this.unsubs.push(
      this.eventBus.on('menu:toggle', () => {
        if (!this.stack.length) {
          if (this.gameLoop.isRunning()) {
            this.push(this.pauseMenu);
          }
          return;
        }
        const top = this.stack[this.stack.length - 1];
        if (top.id === 'main') return;
        this.pop();
      }),
    );
  }

  showMainMenu(): void {
    this.push(this.mainMenu);
  }

  isMenuOpen(): boolean {
    return this.stack.length > 0;
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.mainMenu.dispose();
    this.pauseMenu.dispose();
    this.settingsMenu.dispose();
    this.levelSelectMenu.dispose();
    this.helpMenu.dispose();
    this.overlay.remove();
    this.stopBackgroundLoop();
  }

  private push(screen: MenuScreen): void {
    if (!this.overlay.contains(screen.root)) {
      this.overlay.appendChild(screen.root);
    }
    if (this.stack.length === 0) {
      this.overlay.classList.add('active');
      this.resumeOnClose = this.gameLoop.isRunning();
      if (this.resumeOnClose) {
        this.gameLoop.stop();
      } else {
        this.startBackgroundLoop();
      }
      document.exitPointerLock();
    }
    if (this.stack.length > 0) {
      this.stack[this.stack.length - 1].hide();
    }
    this.stack.push(screen);
    screen.show();
    this.eventBus.emit('menu:opened', { screen: screen.id });
  }

  private pop(): void {
    if (!this.stack.length) return;
    const screen = this.stack.pop()!;
    screen.hide();
    if (this.stack.length > 0) {
      this.stack[this.stack.length - 1].show();
    }
    if (this.stack.length === 0) {
      this.overlay.classList.remove('active');
      this.eventBus.emit('menu:closed', undefined);
      this.stopBackgroundLoop();
      if (this.resumeOnClose) {
        this.gameLoop.start();
        void this.requestPointerLock();
      }
      this.resumeOnClose = false;
    }
  }

  private async handlePlay(): Promise<void> {
    // Close menus BEFORE starting the heavy level load so the loading screen
    // (appended to document.body) is clearly visible, not hidden behind the menu.
    while (this.stack.length) {
      this.pop();
    }
    this.resumeOnClose = false;
    await this.onPlay();
    void this.requestPointerLock();
    if (!this.gameLoop.isRunning()) {
      this.gameLoop.start();
    }
  }

  private async handlePlaySavedLevel(key: string): Promise<void> {
    while (this.stack.length) {
      this.pop();
    }
    this.resumeOnClose = false;
    await this.onPlayLevel(key);
    void this.requestPointerLock();
    if (!this.gameLoop.isRunning()) {
      this.gameLoop.start();
    }
  }

  private async handleCreateLevel(): Promise<void> {
    if (this.onCreateLevel) {
      await this.onCreateLevel();
    }
    while (this.stack.length) {
      this.pop();
    }
    this.resumeOnClose = false;
    if (!this.gameLoop.isRunning()) {
      this.gameLoop.start();
    }
    // Don't request pointer lock — editor needs free cursor
  }

  private async handleReturnToMainMenu(): Promise<void> {
    await this.onReturnToMainMenu();
    this.resumeOnClose = false;
    while (this.stack.length) {
      this.pop();
    }
    this.showMainMenu();
  }

  private handleQuit(): void {
    try {
      window.close();
    } catch {
      alert('Close the tab to exit.');
    }
  }

  private bgLoop = (now: number): void => {
    if (this.backgroundTimer === null) return;
    this.backgroundTimer = requestAnimationFrame(this.bgLoop);
    if (now - this.lastBgRender > 1000 / 15) {
      this.renderer.render();
      this.lastBgRender = now;
    }
  };

  private startBackgroundLoop(): void {
    if (this.backgroundTimer !== null) return;
    this.backgroundTimer = requestAnimationFrame(this.bgLoop);
  }

  private stopBackgroundLoop(): void {
    if (this.backgroundTimer === null) return;
    cancelAnimationFrame(this.backgroundTimer);
    this.backgroundTimer = null;
  }

  private wireButtonAudio(container: HTMLElement): void {
    let lastHovered: Element | null = null;
    container.addEventListener('mouseover', (e) => {
      const btn = (e.target as Element).closest('button, [role="button"]');
      if (btn && btn !== lastHovered) {
        lastHovered = btn;
        this.eventBus.emit('ui:hover', undefined);
      }
    });
    container.addEventListener('mouseout', (e) => {
      const btn = (e.target as Element).closest('button, [role="button"]');
      if (btn === lastHovered) lastHovered = null;
    });
    container.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button, [role="button"]')) {
        this.eventBus.emit('ui:click', undefined);
      }
    });
  }

  private addCosmicBackground(): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'menu-backdrop';

    const glows = document.createElement('div');
    glows.className = 'menu-backdrop-glows';
    ['a', 'b', 'c'].forEach((suffix) => {
      const glow = document.createElement('div');
      glow.className = `menu-backdrop-glow menu-backdrop-glow-${suffix}`;
      glows.appendChild(glow);
    });
    backdrop.appendChild(glows);

    const ribbons = document.createElement('div');
    ribbons.className = 'menu-backdrop-ribbons';
    ['a', 'b'].forEach((suffix) => {
      const ribbon = document.createElement('div');
      ribbon.className = `menu-backdrop-ribbon menu-backdrop-ribbon-${suffix}`;
      ribbons.appendChild(ribbon);
    });
    backdrop.appendChild(ribbons);

    const pane = document.createElement('div');
    pane.className = 'menu-backdrop-pane';

    const paneShine = document.createElement('div');
    paneShine.className = 'menu-backdrop-pane-shine';
    pane.appendChild(paneShine);

    const particles = document.createElement('div');
    particles.className = 'menu-backdrop-particles';
    const particleConfigs = [
      { x: '10%', y: '68%', size: '220px', color: 'rgba(97, 229, 255, 0.18)', duration: '22s', delay: '-4s' },
      { x: '22%', y: '24%', size: '140px', color: 'rgba(255, 95, 174, 0.18)', duration: '18s', delay: '-9s' },
      { x: '38%', y: '78%', size: '260px', color: 'rgba(122, 103, 255, 0.16)', duration: '26s', delay: '-3s' },
      { x: '56%', y: '18%', size: '180px', color: 'rgba(97, 229, 255, 0.14)', duration: '20s', delay: '-12s' },
      { x: '74%', y: '62%', size: '210px', color: 'rgba(255, 208, 105, 0.12)', duration: '24s', delay: '-7s' },
      { x: '84%', y: '28%', size: '300px', color: 'rgba(255, 95, 174, 0.14)', duration: '28s', delay: '-10s' },
    ];

    for (const particle of particleConfigs) {
      const el = document.createElement('div');
      el.className = 'menu-backdrop-particle';
      el.style.left = particle.x;
      el.style.top = particle.y;
      el.style.width = particle.size;
      el.style.height = particle.size;
      el.style.setProperty('--particle-color', particle.color);
      el.style.setProperty('--particle-duration', particle.duration);
      el.style.setProperty('--particle-delay', particle.delay);
      particles.appendChild(el);
    }
    pane.appendChild(particles);

    const contour = document.createElement('div');
    contour.className = 'menu-backdrop-contour';
    pane.appendChild(contour);

    backdrop.appendChild(pane);

    this.overlay.appendChild(backdrop);
  }

  private async requestPointerLock(): Promise<void> {
    try {
      await this.renderer.canvas.requestPointerLock();
    } catch {
      // Pointer lock may fail without user gesture; ignore.
    }
  }
}
