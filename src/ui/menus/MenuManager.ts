import type { AudioController } from "@audio/AudioManager";
import type { OrbitFollowCamera } from "@camera/OrbitFollowCamera";
import type { EventBus } from "@core/EventBus";
import type { GameLoop } from "@core/GameLoop";
import type { GamepadMenuAction } from "@core/types";
import type { UserSettingsStore } from "@core/UserSettings";
import type { InputManager } from "@input/InputManager";
import { exitPointerLockIfSupported } from "@input/pointerLock";
import type { RendererManager } from "@renderer/RendererManager";
import { HelpMenu } from "./HelpMenu";
import { LevelSelectMenu } from "./LevelSelectMenu";
import { MainMenu } from "./MainMenu";
import { PauseMenu } from "./PauseMenu";
import { SettingsMenu } from "./SettingsMenu";
import "./menus.css";

interface MenuScreen {
  readonly id: string;
  readonly root: HTMLElement;
  show(): void;
  hide(): void;
  dispose(): void;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export class MenuManager {
  private overlay: HTMLDivElement;
  private stack: MenuScreen[] = [];
  private focusOrigins: (HTMLElement | null)[] = [];
  private resumeOnClose = false;
  private backgroundTimer: number | null = null;
  private lastBgRender = 0;
  private unsubs: (() => void)[] = [];

  private mainMenu: MainMenu;
  private pauseMenu: PauseMenu;
  private settingsMenu: SettingsMenu;
  private levelSelectMenu: LevelSelectMenu;
  private helpMenu: HelpMenu;
  private _onOverlayClick = this.handleOverlayClick.bind(this);
  private _onOverlayPointerDown = this.leaveGamepadNavigationMode.bind(this);
  private _onOverlayKeyDown = this.handleOverlayKeyDown.bind(this);

  constructor(
    private eventBus: EventBus,
    private gameLoop: GameLoop,
    private renderer: RendererManager,
    settings: UserSettingsStore,
    private inputManager: InputManager,
    camera: OrbitFollowCamera,
    audioManager: AudioController,
    private onPlay: () => Promise<void>,
    private onPlayLevel: (key: string) => Promise<void>,
    private onReturnToMainMenu: () => Promise<void>,
    private onCreateLevel?: () => Promise<void>,
  ) {
    this.overlay = document.createElement("div");
    this.overlay.className = "menu-overlay";
    this.overlay.addEventListener("click", this._onOverlayClick);
    this.overlay.addEventListener("pointerdown", this._onOverlayPointerDown);
    document.addEventListener("keydown", this._onOverlayKeyDown);
    document.body.appendChild(this.overlay);
    this.addCosmicBackground();

    this.helpMenu = new HelpMenu({
      eventBus: this.eventBus,
      getInputSource: () => this.inputManager.lastInputSource,
      pollInputSource: () => this.inputManager.pollInputSource(),
      getKeyboardBindings: () => settings.value.keyboardBindings,
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
      this.eventBus.on("menu:toggle", () => {
        if (this.inputManager.lastInputSource === "gamepad") this.enterGamepadNavigationMode();
        if (!this.stack.length) {
          if (this.gameLoop.isRunning()) {
            this.push(this.pauseMenu);
          }
          return;
        }
        const top = this.stack[this.stack.length - 1];
        if (top.id === "main") return;
        this.pop();
      }),
      this.eventBus.on("menu:gamepadInput", ({ action }) => {
        this.handleGamepadMenuInput(action);
      }),
    );
  }

  showMainMenu(): void {
    this.resumeOnClose = false;
    while (this.stack.length) {
      this.pop(false);
    }
    this.push(this.mainMenu);
    this.resumeOnClose = false;
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
    this.overlay.removeEventListener("click", this._onOverlayClick);
    this.overlay.removeEventListener("pointerdown", this._onOverlayPointerDown);
    document.removeEventListener("keydown", this._onOverlayKeyDown);
    this.overlay.remove();
    this.stopBackgroundLoop();
  }

  private push(screen: MenuScreen): void {
    const activeElement = document.activeElement;
    const invoker = activeElement instanceof HTMLElement ? activeElement : null;
    this.prepareDialog(screen);
    if (!this.overlay.contains(screen.root)) {
      this.overlay.appendChild(screen.root);
    }
    if (this.stack.length === 0) {
      this.overlay.classList.add("active");
      this.resumeOnClose = this.gameLoop.isRunning();
      if (this.resumeOnClose) {
        this.gameLoop.stop();
      } else {
        this.startBackgroundLoop();
      }
      exitPointerLockIfSupported();
    }
    const previous = this.stack[this.stack.length - 1];
    this.stack.push(screen);
    this.focusOrigins.push(invoker);
    screen.show();
    this.setDialogActive(screen, true);
    this.focusFirstControl(screen);
    if (previous) {
      previous.hide();
      this.setDialogActive(previous, false);
    }
    this.eventBus.emit("menu:opened", { screen: screen.id });
  }

  private pop(restoreFocus = true): void {
    const screen = this.stack.pop();
    if (!screen) return;
    const invoker = this.focusOrigins.pop() ?? null;
    const previous = this.stack[this.stack.length - 1];
    if (this.stack.length > 0) {
      previous.show();
      this.setDialogActive(previous, true);
      if (restoreFocus) {
        this.restoreFocus(invoker);
      } else {
        this.releaseFocusFrom(screen);
      }
    } else if (restoreFocus) {
      this.restoreFocus(invoker);
      this.releaseFocusFrom(screen);
    } else {
      this.releaseFocusFrom(screen);
    }
    screen.hide();
    this.setDialogActive(screen, false);
    if (this.stack.length === 0) {
      this.overlay.classList.remove("active");
      this.eventBus.emit("menu:closed", undefined);
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
      this.pop(false);
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
      this.pop(false);
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
      this.pop(false);
    }
    this.resumeOnClose = false;
    if (!this.gameLoop.isRunning()) {
      this.gameLoop.start();
    }
    // Don't request pointer lock — editor needs free cursor
  }

  private async handleReturnToMainMenu(): Promise<void> {
    await this.onReturnToMainMenu();
    this.showMainMenu();
  }

  private handleQuit(): void {
    try {
      window.close();
    } catch {
      alert("Close the tab to exit.");
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
    container.addEventListener("mouseover", (e) => {
      const btn = (e.target as Element).closest('button, [role="button"]');
      if (btn && btn !== lastHovered) {
        lastHovered = btn;
        this.eventBus.emit("ui:hover", undefined);
      }
    });
    container.addEventListener("mouseout", (e) => {
      const btn = (e.target as Element).closest('button, [role="button"]');
      if (btn === lastHovered) lastHovered = null;
    });
    container.addEventListener("click", (e) => {
      if ((e.target as Element).closest('button, [role="button"]')) {
        this.eventBus.emit("ui:click", undefined);
      }
    });
  }

  private handleOverlayClick(event: MouseEvent): void {
    if (!this.resumeOnClose || this.stack.length === 0) return;

    const top = this.stack[this.stack.length - 1];
    if (top.id === "main") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, input, select, textarea, label, a, [role="button"]')) return;

    const isBackdropClick = target === this.overlay;
    const isPauseCardClick = top.id === "pause" && top.root.contains(target);
    if (!isBackdropClick && !isPauseCardClick) return;

    event.preventDefault();
    this.pop();
  }

  private handleOverlayKeyDown(event: KeyboardEvent): void {
    if (this.stack.length === 0) return;
    this.leaveGamepadNavigationMode();

    if (event.key === "Escape") {
      const top = this.stack[this.stack.length - 1];
      if (top.id === "main") return;
      event.preventDefault();
      event.stopPropagation();
      this.pop();
      return;
    }

    if (event.key !== "Tab") return;

    const top = this.stack[this.stack.length - 1];
    const focusable = this.getFocusableControls(top.root);
    if (focusable.length === 0) {
      event.preventDefault();
      top.root.focus({ preventScroll: true });
      return;
    }

    const activeElement = document.activeElement;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (activeElement === first || !top.root.contains(activeElement))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (activeElement === last || !top.root.contains(activeElement))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  private handleGamepadMenuInput(action: Exclude<GamepadMenuAction, "start">): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    this.enterGamepadNavigationMode();
    if (action === "back") {
      if (top.id !== "main") this.pop();
      return;
    }

    const focusable = this.getFocusableControls(top.root);
    if (focusable.length === 0) {
      top.root.focus({ preventScroll: true });
      return;
    }
    const activeElement = document.activeElement;
    const activeIndex = activeElement instanceof HTMLElement ? focusable.indexOf(activeElement) : -1;

    if (action === "up" || action === "down") {
      const offset = action === "up" ? -1 : 1;
      const startIndex = activeIndex >= 0 ? activeIndex : action === "up" ? 0 : -1;
      const nextIndex = (startIndex + offset + focusable.length) % focusable.length;
      this.focusGamepadControl(focusable[nextIndex]);
      return;
    }

    if (action === "left" || action === "right") {
      const direction = action === "left" ? -1 : 1;
      if (activeElement instanceof HTMLInputElement && activeElement.type === "range") {
        this.adjustRange(activeElement, direction);
      } else if (activeElement instanceof HTMLSelectElement) {
        this.adjustSelect(activeElement, direction);
      }
      return;
    }

    if (action === "activate") {
      const control = activeIndex >= 0 ? focusable[activeIndex] : focusable[0];
      if (activeIndex < 0) this.focusGamepadControl(control);
      control.click();
    }
  }

  private focusGamepadControl(control: HTMLElement): void {
    control.focus({ preventScroll: true });
    control.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private enterGamepadNavigationMode(): void {
    this.overlay.classList.add("is-gamepad-navigation");
  }

  private leaveGamepadNavigationMode(): void {
    this.overlay.classList.remove("is-gamepad-navigation");
  }

  private adjustRange(input: HTMLInputElement, direction: -1 | 1): void {
    const current = input.valueAsNumber;
    const parsedStep = Number(input.step);
    const step = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1;
    const parsedMin = Number(input.min);
    const parsedMax = Number(input.max);
    const min = Number.isFinite(parsedMin) ? parsedMin : Number.NEGATIVE_INFINITY;
    const max = Number.isFinite(parsedMax) ? parsedMax : Number.POSITIVE_INFINITY;
    const next = Math.min(max, Math.max(min, current + direction * step));
    if (!Number.isFinite(current) || next === current) return;
    input.valueAsNumber = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private adjustSelect(select: HTMLSelectElement, direction: -1 | 1): void {
    const nextIndex = Math.min(select.options.length - 1, Math.max(0, select.selectedIndex + direction));
    if (nextIndex === select.selectedIndex) return;
    select.selectedIndex = nextIndex;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  private prepareDialog(screen: MenuScreen): void {
    const title = screen.root.querySelector<HTMLElement>(".menu-title");
    if (!title) {
      throw new Error(`[MenuManager] Menu screen '${screen.id}' is missing a .menu-title.`);
    }
    title.id ||= `menu-${screen.id}-title`;
    screen.root.setAttribute("role", "dialog");
    screen.root.setAttribute("aria-modal", "true");
    screen.root.setAttribute("aria-labelledby", title.id);
    screen.root.tabIndex = -1;
    this.setDialogActive(screen, false);
  }

  private setDialogActive(screen: MenuScreen, active: boolean): void {
    screen.root.setAttribute("aria-hidden", String(!active));
    screen.root.inert = !active;
  }

  private focusFirstControl(screen: MenuScreen): void {
    const first = this.getFocusableControls(screen.root)[0] ?? screen.root;
    first.focus({ preventScroll: true });
  }

  private restoreFocus(invoker: HTMLElement | null): void {
    if (invoker?.isConnected) {
      if (!invoker.closest('[aria-hidden="true"]')) {
        invoker.focus({ preventScroll: true });
        if (document.activeElement === invoker) return;
      } else {
        queueMicrotask(() => {
          if (invoker.isConnected && !invoker.closest('[aria-hidden="true"]')) {
            invoker.focus({ preventScroll: true });
          }
        });
      }
    }
    const top = this.stack[this.stack.length - 1];
    if (top) this.focusFirstControl(top);
  }

  private releaseFocusFrom(screen: MenuScreen): void {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && screen.root.contains(activeElement)) {
      activeElement.blur();
    }
  }

  private getFocusableControls(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
      if (element.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    });
  }

  private addCosmicBackground(): void {
    const backdrop = document.createElement("div");
    backdrop.className = "menu-backdrop";

    const glows = document.createElement("div");
    glows.className = "menu-backdrop-glows";
    ["a", "b", "c"].forEach((suffix) => {
      const glow = document.createElement("div");
      glow.className = `menu-backdrop-glow menu-backdrop-glow-${suffix}`;
      glows.appendChild(glow);
    });
    backdrop.appendChild(glows);

    const ribbons = document.createElement("div");
    ribbons.className = "menu-backdrop-ribbons";
    ["a", "b"].forEach((suffix) => {
      const ribbon = document.createElement("div");
      ribbon.className = `menu-backdrop-ribbon menu-backdrop-ribbon-${suffix}`;
      ribbons.appendChild(ribbon);
    });
    backdrop.appendChild(ribbons);

    const pane = document.createElement("div");
    pane.className = "menu-backdrop-pane";

    const paneShine = document.createElement("div");
    paneShine.className = "menu-backdrop-pane-shine";
    pane.appendChild(paneShine);

    const particles = document.createElement("div");
    particles.className = "menu-backdrop-particles";
    const particleConfigs = [
      { x: "10%", y: "68%", size: "220px", color: "rgba(97, 229, 255, 0.18)", duration: "22s", delay: "-4s" },
      { x: "22%", y: "24%", size: "140px", color: "rgba(255, 95, 174, 0.18)", duration: "18s", delay: "-9s" },
      { x: "38%", y: "78%", size: "260px", color: "rgba(122, 103, 255, 0.16)", duration: "26s", delay: "-3s" },
      { x: "56%", y: "18%", size: "180px", color: "rgba(97, 229, 255, 0.14)", duration: "20s", delay: "-12s" },
      { x: "74%", y: "62%", size: "210px", color: "rgba(255, 208, 105, 0.12)", duration: "24s", delay: "-7s" },
      { x: "84%", y: "28%", size: "300px", color: "rgba(255, 95, 174, 0.14)", duration: "28s", delay: "-10s" },
    ];

    for (const particle of particleConfigs) {
      const el = document.createElement("div");
      el.className = "menu-backdrop-particle";
      el.style.left = particle.x;
      el.style.top = particle.y;
      el.style.width = particle.size;
      el.style.height = particle.size;
      el.style.setProperty("--particle-color", particle.color);
      el.style.setProperty("--particle-duration", particle.duration);
      el.style.setProperty("--particle-delay", particle.delay);
      particles.appendChild(el);
    }
    pane.appendChild(particles);

    const contour = document.createElement("div");
    contour.className = "menu-backdrop-contour";
    pane.appendChild(contour);

    backdrop.appendChild(pane);

    this.overlay.appendChild(backdrop);
  }

  private async requestPointerLock(): Promise<void> {
    try {
      await this.inputManager.requestPointerLock({ preferRaw: false });
    } catch {
      // Pointer lock may fail without user gesture; ignore.
    }
  }
}
