import type { EventBus } from "@core/EventBus";
import type { InputSource } from "@core/types";
import { getInputGlyph } from "@input/InputGlyphs";

interface HelpMenuOptions {
  eventBus: EventBus;
  getInputSource: () => InputSource;
  pollInputSource: () => InputSource;
  onBack: () => void;
}

export interface KeyBinding {
  key: string;
  description: string;
}

export interface HelpBindingSection {
  title: string;
  bindings: KeyBinding[];
}

export function getHelpBindings(source: InputSource): HelpBindingSection[] {
  if (source === "gamepad") {
    return [
      {
        title: "Movement",
        bindings: [
          { key: "Left Stick", description: "Move" },
          { key: getInputGlyph("jump", source), description: "Jump / Double Jump" },
          { key: getInputGlyph("crouch", source), description: "Crouch" },
          { key: getInputGlyph("sprint", source), description: "Sprint" },
        ],
      },
      {
        title: "Interaction",
        bindings: [
          { key: getInputGlyph("interact", source), description: "Interact / Grab" },
          { key: "RT", description: "Throw / Primary action" },
        ],
      },
      {
        title: "Camera & System",
        bindings: [{ key: "Right Stick", description: "Look around" }],
      },
    ];
  }

  if (source === "touch") {
    return [
      {
        title: "Movement",
        bindings: [
          { key: "Left Stick", description: "Move" },
          { key: getInputGlyph("jump", source), description: "Jump / Double Jump" },
          { key: getInputGlyph("crouch", source), description: "Crouch" },
          { key: getInputGlyph("sprint", source), description: "Sprint" },
        ],
      },
      {
        title: "Interaction",
        bindings: [{ key: getInputGlyph("interact", source), description: "Interact / Grab" }],
      },
      {
        title: "Camera & System",
        bindings: [{ key: "Right Look Zone", description: "Look around" }],
      },
    ];
  }

  return [
    {
      title: "Movement",
      bindings: [
        { key: "W A S D", description: "Move" },
        { key: "↑ ↓ ← →", description: "Move (arrows)" },
        { key: getInputGlyph("jump", source), description: "Jump / Double Jump" },
        { key: getInputGlyph("crouch", source), description: "Crouch" },
        { key: getInputGlyph("sprint", source), description: "Sprint" },
        { key: "W / S", description: "Climb (on ladder)" },
      ],
    },
    {
      title: "Interaction",
      bindings: [
        { key: getInputGlyph("interact", source), description: "Interact / Grab" },
        { key: "LMB", description: "Throw / Primary action" },
        { key: "E", description: "Altitude Up" },
        { key: "Q", description: "Altitude Down" },
      ],
    },
    {
      title: "Camera & System",
      bindings: [
        { key: "Mouse", description: "Look around" },
        { key: "Scroll", description: "Zoom camera" },
        { key: "Escape", description: "Pause menu" },
        { key: "`", description: "Debug panel" },
        { key: "F1", description: "Level editor" },
        { key: "F6", description: "Cycle graphics profile" },
      ],
    },
  ];
}

export class HelpMenu {
  readonly id = "help";
  readonly root: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly unsubscribeInputSource: () => void;
  private sourcePollFrame: number | null = null;

  constructor(private options: HelpMenuOptions) {
    this.root = document.createElement("div");
    this.root.className = "menu-screen help-menu";

    const title = document.createElement("h1");
    title.className = "menu-title";
    title.textContent = "Controls & Help";
    this.root.appendChild(title);

    this.content = document.createElement("div");
    this.content.className = "help-content";
    this.root.appendChild(this.content);
    this.renderBindings(this.options.getInputSource());
    this.unsubscribeInputSource = this.options.eventBus.on("input:sourceChanged", ({ source }) => {
      this.renderBindings(source);
    });

    const backBtn = document.createElement("button");
    backBtn.className = "menu-button";
    backBtn.textContent = "Back";
    backBtn.addEventListener("click", () => this.options.onBack());
    this.root.appendChild(backBtn);
  }

  show(): void {
    this.renderBindings(this.options.getInputSource());
    this.root.classList.add("active");
    this.startSourcePolling();
  }

  hide(): void {
    this.root.classList.remove("active");
    this.stopSourcePolling();
  }

  dispose(): void {
    this.stopSourcePolling();
    this.unsubscribeInputSource();
    this.root.remove();
  }

  private renderBindings(source: InputSource): void {
    this.content.replaceChildren(
      ...getHelpBindings(source).map(({ title, bindings }) => this.createBindingSection(title, bindings)),
    );
  }

  private startSourcePolling(): void {
    if (this.sourcePollFrame !== null) return;
    const poll = (): void => {
      this.options.pollInputSource();
      this.sourcePollFrame = window.requestAnimationFrame(poll);
    };
    this.sourcePollFrame = window.requestAnimationFrame(poll);
  }

  private stopSourcePolling(): void {
    if (this.sourcePollFrame === null) return;
    window.cancelAnimationFrame(this.sourcePollFrame);
    this.sourcePollFrame = null;
  }

  private createBindingSection(title: string, bindings: KeyBinding[]): HTMLDivElement {
    const section = document.createElement("div");
    section.className = "help-section";

    const header = document.createElement("h3");
    header.className = "menu-section-header";
    header.textContent = title;
    section.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "help-bindings-grid";

    for (const binding of bindings) {
      const keyCell = document.createElement("div");
      keyCell.className = "help-key-cell";

      const keys = binding.key.split(" / ");
      for (let i = 0; i < keys.length; i++) {
        const kbd = document.createElement("kbd");
        kbd.className = "help-key";
        kbd.textContent = keys[i];
        keyCell.appendChild(kbd);
        if (i < keys.length - 1) {
          keyCell.appendChild(document.createTextNode(" / "));
        }
      }

      const descCell = document.createElement("div");
      descCell.className = "help-desc-cell";
      descCell.textContent = binding.description;

      grid.appendChild(keyCell);
      grid.appendChild(descCell);
    }

    section.appendChild(grid);
    return section;
  }
}
