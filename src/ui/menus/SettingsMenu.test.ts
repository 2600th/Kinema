import { describe, expect, it, vi } from "vitest";
import { SettingsMenu } from "./SettingsMenu";

describe("SettingsMenu section lifecycle", () => {
  it("does not restore capture focus when navigating away from Controls", () => {
    const menu = Object.create(SettingsMenu.prototype) as {
      controlsSection: { classList: { toggle: ReturnType<typeof vi.fn> } };
      graphicsSection: { classList: { toggle: ReturnType<typeof vi.fn> } };
      audioSection: { classList: { toggle: ReturnType<typeof vi.fn> } };
      stopBindingCapture: ReturnType<typeof vi.fn>;
      showSection: (section: "controls" | "graphics" | "audio") => void;
    };
    menu.controlsSection = { classList: { toggle: vi.fn() } };
    menu.graphicsSection = { classList: { toggle: vi.fn() } };
    menu.audioSection = { classList: { toggle: vi.fn() } };
    menu.stopBindingCapture = vi.fn();

    menu.showSection("graphics");

    expect(menu.stopBindingCapture).toHaveBeenCalledWith(undefined, false);
  });
});
