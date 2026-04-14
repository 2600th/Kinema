import { EventBus } from "@core/EventBus";
import { type InputState, NULL_INPUT, STATE } from "@core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration-style test: EventBus + FSM interact flow.
 * Verifies that when player:stateChanged emits 'interact', a listener
 * can trigger interaction logic (matching Game's orchestration).
 */
describe("interaction flow", () => {
  let eventBus: EventBus;
  let triggered: string | null;

  beforeEach(() => {
    eventBus = new EventBus();
    triggered = null;
  });

  it("triggers interaction when state changes to interact", () => {
    const triggerInteraction = vi.fn(() => {
      triggered = "interact";
    });

    eventBus.on("player:stateChanged", ({ current }) => {
      if (current === STATE.interact) {
        triggerInteraction();
      }
    });

    eventBus.emit("player:stateChanged", { previous: STATE.idle, current: STATE.interact });

    expect(triggerInteraction).toHaveBeenCalledTimes(1);
    expect(triggered).toBe("interact");
  });

  it("does not trigger when state changes to non-interact", () => {
    const triggerInteraction = vi.fn();

    eventBus.on("player:stateChanged", ({ current }) => {
      if (current === STATE.interact) {
        triggerInteraction();
      }
    });

    eventBus.emit("player:stateChanged", { previous: STATE.idle, current: STATE.move });

    expect(triggerInteraction).not.toHaveBeenCalled();
  });

  it("InputState has interactPressed for edge-triggered interaction", () => {
    const state: InputState = {
      ...NULL_INPUT,
      interact: true,
      interactPressed: true,
    };
    expect(state.interactPressed).toBe(true);
    expect(state.interact).toBe(true);
  });
});
