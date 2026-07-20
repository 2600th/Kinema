import { EventBus } from "@core/EventBus";
import type { LevelManager } from "@level/LevelManager";
import type { NavDebugOverlay } from "@navigation/NavDebugOverlay";
import type { NavPatrolSystem } from "@navigation/NavPatrolSystem";
import { describe, expect, it, vi } from "vitest";
import { DebugRuntimeSystem } from "./DebugRuntimeSystem";

describe("DebugRuntimeSystem deferred navigation", () => {
  it("adopts navigation resources that become ready after level setup", () => {
    const eventBus = new EventBus();
    let patrol: Pick<NavPatrolSystem, "update"> | null = null;
    let overlay: Pick<NavDebugOverlay, "isVisible"> | null = null;
    const levelManager = {
      getNavPatrolSystem: () => patrol,
      getNavDebugOverlay: () => overlay,
    } as unknown as LevelManager;
    const system = new DebugRuntimeSystem({} as never, {} as never, eventBus, levelManager);
    system.setupLevel();
    expect(system.getNavigationDebugState().targetAvailable).toBe(false);

    patrol = { update: vi.fn() };
    overlay = { isVisible: () => false };
    eventBus.emit("navigation:ready", { name: "procedural" });
    system.fixedUpdate(1 / 60);

    expect(patrol.update).toHaveBeenCalledOnce();
    expect(system.getNavigationDebugState()).toMatchObject({ overlayAvailable: true, targetAvailable: true });
    system.dispose();
  });
});
