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

  private mainMenu: MainMenu;
  private pauseMenu: PauseMenu;
  private settingsMenu: SettingsMenu;

  constructor(
    private eventBus: EventBus,
    private gameLoop: GameLoop,
    private renderer: RendererManager,
    settings: UserSettingsStore,
    inputManager: InputManager,
    camera: OrbitFollowCamera,
    audioManager: AudioManager,
    private onPlay: () => Promise<void>,
    private onReturnToMainMenu: () => Promise<void>,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'menu-overlay';
    document.body.appendChild(this.overlay);

    this.mainMenu = new MainMenu({
      onPlay: () => void this.handlePlay(),
      onSettings: () => this.push(this.settingsMenu),
      onQuit: () => this.handleQuit(),
    });
    this.pauseMenu = new PauseMenu({
      onResume: () => this.pop(),
      onSettings: () => this.push(this.settingsMenu),
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
    });
  }

  showMainMenu(): void {
    this.push(this.mainMenu);
  }

  isMenuOpen(): boolean {
    return this.stack.length > 0;
  }

  dispose(): void {
    this.mainMenu.dispose();
    this.pauseMenu.dispose();
    this.settingsMenu.dispose();
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
    await this.onPlay();
    while (this.stack.length) {
      this.pop();
    }
    this.resumeOnClose = false;
    if (!this.gameLoop.isRunning()) {
      this.gameLoop.start();
    }
    void this.requestPointerLock();
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

  private startBackgroundLoop(): void {
    if (this.backgroundTimer !== null) return;
    this.backgroundTimer = window.setInterval(() => {
      this.renderer.render();
    }, 1000 / 15);
  }

  private stopBackgroundLoop(): void {
    if (this.backgroundTimer === null) return;
    window.clearInterval(this.backgroundTimer);
    this.backgroundTimer = null;
  }

  private async requestPointerLock(): Promise<void> {
    try {
      await this.renderer.canvas.requestPointerLock();
    } catch {
      // Pointer lock may fail without user gesture; ignore.
    }
  }
}
