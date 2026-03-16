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
    void this.requestPointerLock();
    await this.onPlay();
    while (this.stack.length) {
      this.pop();
    }
    this.resumeOnClose = false;
    if (!this.gameLoop.isRunning()) {
      this.gameLoop.start();
    }
  }

  private async handlePlaySavedLevel(key: string): Promise<void> {
    void this.requestPointerLock();
    await this.onPlayLevel(key);
    while (this.stack.length) {
      this.pop();
    }
    this.resumeOnClose = false;
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
    const orbs: { color: string; size: number; top: string; left: string; anim: string }[] = [
      { color: 'rgba(123, 47, 255, 0.15)', size: 200, top: '15%', left: '10%', anim: 'menuOrbFloat1 12s ease-in-out infinite' },
      { color: 'rgba(255, 107, 157, 0.1)', size: 160, top: '60%', left: '75%', anim: 'menuOrbFloat2 15s ease-in-out infinite' },
      { color: 'rgba(0, 210, 255, 0.08)', size: 140, top: '75%', left: '20%', anim: 'menuOrbFloat3 18s ease-in-out infinite' },
    ];

    for (const orb of orbs) {
      const el = document.createElement('div');
      el.className = 'menu-cosmic-orb';
      el.style.width = `${orb.size}px`;
      el.style.height = `${orb.size}px`;
      el.style.background = `radial-gradient(circle, ${orb.color}, transparent 70%)`;
      el.style.top = orb.top;
      el.style.left = orb.left;
      el.style.animation = orb.anim;
      this.overlay.appendChild(el);
    }

    const particles: { color: string; size: number; top: string; left: string; duration: string; delay: string; opacity: number }[] = [
      { color: '#ff6b9d', size: 4, top: '20%', left: '25%', duration: '5s', delay: '0s', opacity: 0.6 },
      { color: '#7b2fff', size: 3, top: '35%', left: '80%', duration: '4s', delay: '1.2s', opacity: 0.5 },
      { color: '#00d2ff', size: 3, top: '70%', left: '15%', duration: '6s', delay: '0.5s', opacity: 0.5 },
      { color: '#ffd700', size: 3, top: '50%', left: '60%', duration: '4.5s', delay: '2s', opacity: 0.4 },
      { color: '#ff6b9d', size: 2, top: '80%', left: '45%', duration: '5.5s', delay: '0.8s', opacity: 0.5 },
      { color: '#7b2fff', size: 4, top: '10%', left: '65%', duration: '4s', delay: '1.5s', opacity: 0.6 },
      { color: '#00d2ff', size: 2, top: '45%', left: '35%', duration: '5s', delay: '2.5s', opacity: 0.4 },
      { color: '#ffd700', size: 3, top: '85%', left: '85%', duration: '6s', delay: '0.3s', opacity: 0.5 },
    ];

    for (const p of particles) {
      const el = document.createElement('div');
      el.className = 'menu-cosmic-particle';
      el.style.width = `${p.size}px`;
      el.style.height = `${p.size}px`;
      el.style.background = p.color;
      el.style.boxShadow = `0 0 ${p.size * 2}px ${p.color}`;
      el.style.top = p.top;
      el.style.left = p.left;
      el.style.setProperty('--p-duration', p.duration);
      el.style.setProperty('--p-delay', p.delay);
      el.style.setProperty('--p-opacity', String(p.opacity));
      el.style.opacity = String(p.opacity);
      this.overlay.appendChild(el);
    }
  }

  private async requestPointerLock(): Promise<void> {
    try {
      await this.renderer.canvas.requestPointerLock();
    } catch {
      // Pointer lock may fail without user gesture; ignore.
    }
  }
}
