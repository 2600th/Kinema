import { describe, expect, it, vi } from "vitest";
import { bindEditEvents } from "./InspectorPanel";

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
