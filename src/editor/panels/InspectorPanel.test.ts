import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { EditorObject } from "../EditorObject";
import { bindEditEvents, InspectorPanel } from "./InspectorPanel";

class FakeClassList {
  private readonly values = new Set<string>();

  set(value: string): void {
    this.values.clear();
    this.add(...value.split(/\s+/).filter(Boolean));
  }

  add(...values: string[]): void {
    for (const value of values) this.values.add(value);
  }

  remove(...values: string[]): void {
    for (const value of values) this.values.delete(value);
  }

  toggle(value: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  readonly style: Record<string, string> = {};
  readonly listeners = new Map<string, ((event: { key?: string }) => void)[]>();
  parentElement: FakeElement | null = null;
  type = "";
  value = "";
  textContent = "";
  title = "";
  min = "";
  max = "";
  step = "";
  private ownClassName = "";

  constructor(readonly tagName: string) {}

  get className(): string {
    return this.ownClassName;
  }

  set className(value: string) {
    this.ownClassName = value;
    this.classList.set(value);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: (event: { key?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: { key?: string }) => void): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    this.listeners.set(
      type,
      listeners.filter((candidate) => candidate !== listener),
    );
  }

  dispatch(type: string, event: { key?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  setAttribute(): void {}

  querySelector(selector: string): FakeElement | null {
    if (selector !== "span") return null;
    return this.walk().find((element) => element.tagName === "span") ?? null;
  }

  closest(): null {
    return null;
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 280, height: 400 };
  }

  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }

  walk(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.walk()]);
  }
}

function findInspectorControl(root: FakeElement, label: string): FakeElement {
  const row = root
    .walk()
    .find(
      (element) =>
        element.classList.contains("ke-inspector-row") &&
        element.children.some((child) => child.textContent === label),
    );
  const control = row?.walk().find((element) => element.tagName === "input");
  if (!control) throw new Error(`Missing inspector control ${label}`);
  return control;
}

class FakeInput {
  private listeners = new Map<string, ((event: { key?: string }) => void)[]>();

  addEventListener(type: string, listener: (event: { key?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: { key?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("bindEditEvents", () => {
  it("previews every material input but commits exactly once across Enter, change, and blur", () => {
    const input = new FakeInput();
    const preview = vi.fn();
    const commit = vi.fn();

    bindEditEvents(input, preview, commit);
    input.dispatch("input");
    input.dispatch("input");
    input.dispatch("input");
    input.dispatch("keydown", { key: "Enter" });

    expect(preview).toHaveBeenCalledTimes(3);
    expect(commit).toHaveBeenCalledOnce();

    input.dispatch("change");
    input.dispatch("blur");
    expect(commit).toHaveBeenCalledOnce();
  });
});

describe("InspectorPanel material controls", () => {
  it("emits complete previews and one commit from the real material wiring", () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const body = new FakeElement("body");
    (globalThis as { document?: unknown }).document = {
      body,
      createElement: (tag: string) => new FakeElement(tag),
      createElementNS: (_namespace: string, tag: string) => new FakeElement(tag),
    };
    (globalThis as { window?: unknown }).window = {
      innerWidth: 1920,
      innerHeight: 1080,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const onMaterialChange = vi.fn();
    const panel = new InspectorPanel({
      onTransformChange: vi.fn(),
      onMaterialChange,
      onPhysicsTypeChange: vi.fn(),
    });
    const selected: EditorObject = {
      id: "selected-material",
      name: "Selected",
      mesh: new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()),
      source: { type: "primitive", primitive: "cube" },
      transform: { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      physicsType: "static",
      material: {
        color: "#111111",
        roughness: 0.2,
        metalness: 0.3,
        emissive: "#222222",
        emissiveIntensity: 0.4,
        opacity: 0.5,
      },
    };

    try {
      panel.build();
      panel.setSelection(selected);
      const root = panel.getElement() as unknown as FakeElement;
      const color = findInspectorControl(root, "Color");
      const roughness = findInspectorControl(root, "Roughness");
      const metalness = findInspectorControl(root, "Metalness");
      const emissive = findInspectorControl(root, "Emissive");
      const intensity = findInspectorControl(root, "Intensity");
      const opacity = findInspectorControl(root, "Opacity");
      roughness.value = "0.61";
      metalness.value = "0.72";
      emissive.value = "#123456";
      intensity.value = "0.83";
      opacity.value = "0.94";

      for (const value of ["#ff0000", "#00ff00", "#abcdef"]) {
        color.value = value;
        color.dispatch("input");
      }
      color.dispatch("change");
      color.dispatch("blur");
      color.dispatch("keydown", { key: "Enter" });

      const previews = onMaterialChange.mock.calls.filter(([, , phase]) => phase === "preview");
      const commits = onMaterialChange.mock.calls.filter(([, , phase]) => phase === "commit");
      expect(previews).toEqual(
        ["#ff0000", "#00ff00", "#abcdef"].map((colorValue) => [
          selected.id,
          {
            color: colorValue,
            roughness: 0.61,
            metalness: 0.72,
            emissive: "#123456",
            emissiveIntensity: 0.83,
            opacity: 0.94,
          },
          "preview",
        ]),
      );
      expect(commits).toHaveLength(1);
      expect(onMaterialChange.mock.calls.every(([id]) => id === selected.id)).toBe(true);
      expect(commits[0]).toEqual([
        selected.id,
        {
          color: "#abcdef",
          roughness: 0.61,
          metalness: 0.72,
          emissive: "#123456",
          emissiveIntensity: 0.83,
          opacity: 0.94,
        },
        "commit",
      ]);
    } finally {
      panel.dispose();
      (globalThis as { document?: unknown }).document = originalDocument;
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });
});
