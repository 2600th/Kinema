import { createDefaultKeyboardBindings } from "@input/InputBindings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHelpBindings, HelpMenu } from "./HelpMenu";

class FakeClassList {
  private values = new Set<string>();

  add(value: string): void {
    this.values.add(value);
  }

  remove(value: string): void {
    this.values.delete(value);
  }
}

class FakeElement {
  textContent = "";
  className = "";
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  removed = false;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(): void {}

  addEventListener(): void {}

  remove(): void {
    this.removed = true;
  }
}

function getKbdTexts(root: FakeElement): string[] {
  const texts: string[] = [];
  const visit = (element: FakeElement): void => {
    if (element.tagName === "kbd") texts.push(element.textContent);
    for (const child of element.children) visit(child);
  };
  visit(root);
  return texts;
}

function bindingKeys(source: "keyboard" | "gamepad" | "touch", bindings = createDefaultKeyboardBindings()): string[] {
  return getHelpBindings(source, bindings).flatMap((section) => section.bindings.map((binding) => binding.key));
}

function allBindings(source: "keyboard" | "gamepad" | "touch") {
  return getHelpBindings(source, createDefaultKeyboardBindings()).flatMap((section) => section.bindings);
}

describe("getHelpBindings", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const cancelAnimationFrame = vi.fn();
  let nextFrame = 0;

  beforeEach(() => {
    nextFrame = 0;
    cancelAnimationFrame.mockClear();
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (text: string) => {
        const node = new FakeElement("#text");
        node.textContent = text;
        return node;
      },
    };
    (globalThis as { window?: unknown }).window = {
      requestAnimationFrame: vi.fn(() => ++nextFrame),
      cancelAnimationFrame,
    };
  });

  afterEach(() => {
    (globalThis as { document?: unknown }).document = originalDocument;
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("shows keyboard controls for keyboard input", () => {
    expect(bindingKeys("keyboard")).toEqual(expect.arrayContaining(["W A S D", "Space", "Left Shift", "C", "F"]));
    expect(allBindings("keyboard")).toEqual(
      expect.arrayContaining([
        { key: "LMB", description: "Throw" },
        { key: "E / Q", description: "Change drone altitude" },
      ]),
    );
  });

  it("shows gamepad controls for gamepad input", () => {
    const keys = bindingKeys("gamepad");
    expect(keys).toEqual(expect.arrayContaining(["Left Stick", "A", "LB", "B", "X"]));
    expect(allBindings("gamepad")).toEqual(
      expect.arrayContaining([
        { key: "RT", description: "Throw" },
        { key: "Right Stick ↑ / ↓", description: "Change drone altitude" },
      ]),
    );
    expect(keys).not.toContain("LMB");
    expect(keys).not.toContain("E / Q");
    expect(keys).not.toContain("Menu");
  });

  it("shows touch controls for touch input", () => {
    const keys = bindingKeys("touch");
    expect(keys).toEqual(expect.arrayContaining(["Left Stick", "↑", "⇧", "↓", "✋"]));
    expect(allBindings("touch")).toEqual(
      expect.arrayContaining([
        { key: "Interact", description: "Throw" },
        { key: "Right Look Zone ↑ / ↓", description: "Change drone altitude" },
      ]),
    );
    expect(keys).not.toContain("LMB");
    expect(keys).not.toContain("E / Q");
    expect(keys).not.toContain("Primary");
    expect(keys).not.toContain("Menu");
  });

  it("shows configured movement and action primaries for keyboard input", () => {
    const bindings = createDefaultKeyboardBindings();
    bindings.moveForward[0] = "ArrowUp";
    bindings.moveBackward[0] = "Numpad2";
    bindings.moveLeft[0] = "Home";
    bindings.moveRight[0] = "PageDown";
    bindings.jump[0] = "NumpadEnter";
    bindings.interact[0] = "KeyZ";
    bindings.crouch[0] = "ControlRight";
    bindings.sprint[0] = "ShiftRight";

    expect(bindingKeys("keyboard", bindings)).toEqual(
      expect.arrayContaining(["Up Arrow Home Numpad 2 PageDown", "NumpadEnter", "Right Ctrl", "Right Shift", "Z"]),
    );
  });

  it("rebuilds provider labels on reopen and cleans up its subscriptions", () => {
    const bindings = createDefaultKeyboardBindings();
    const unsubscribe = vi.fn();
    const menu = new HelpMenu({
      eventBus: { on: vi.fn(() => unsubscribe) } as never,
      getInputSource: () => "keyboard",
      pollInputSource: () => "keyboard",
      getKeyboardBindings: () => bindings,
      onBack: vi.fn(),
    });

    menu.show();
    expect(getKbdTexts(menu.root as unknown as FakeElement)).toContain("F");

    bindings.interact[0] = "KeyZ";
    menu.hide();
    menu.show();

    const reopenedKeys = getKbdTexts(menu.root as unknown as FakeElement);
    expect(reopenedKeys).toContain("Z");
    expect(reopenedKeys).not.toContain("F");

    menu.dispose();
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect((menu.root as unknown as FakeElement).removed).toBe(true);
  });

  it("does not change gamepad or touch rows for custom keyboard bindings", () => {
    const bindings = createDefaultKeyboardBindings();
    bindings.interact[0] = "KeyZ";

    expect(bindingKeys("gamepad", bindings)).toEqual(expect.arrayContaining(["Left Stick", "A", "LB", "B", "X"]));
    expect(bindingKeys("touch", bindings)).toEqual(expect.arrayContaining(["Left Stick", "↑", "⇧", "↓", "✋"]));
  });
});
