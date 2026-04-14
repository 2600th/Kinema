import { EventBus } from "@core/EventBus";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { PlayerHealthSystem } from "./PlayerHealthSystem";

describe("PlayerHealthSystem", () => {
  it("initializes to 3 hearts and emits health updates on setup", () => {
    const eventBus = new EventBus();
    const changed = vi.fn();
    eventBus.on("health:changed", changed);
    const system = new PlayerHealthSystem(eventBus);

    system.setupLevel();

    expect(system.getHealthState()).toMatchObject({
      current: 3,
      max: 3,
      invulnerable: false,
    });
    expect(changed).toHaveBeenLastCalledWith({ current: 3, max: 3 });
  });

  it("applies spike damage once, grants i-frames, and ignores immediate repeat overlap", () => {
    const eventBus = new EventBus();
    const damaged = vi.fn();
    const dying = vi.fn();
    const invulnerabilityChanged = vi.fn();
    eventBus.on("player:damaged", damaged);
    eventBus.on("player:dying", dying);
    eventBus.on("player:invulnerabilityChanged", invulnerabilityChanged);
    const system = new PlayerHealthSystem(eventBus);
    system.setupLevel();

    const first = system.applySpikeDamage(new THREE.Vector3(1, 2, 3));
    const second = system.applySpikeDamage(new THREE.Vector3(1, 2, 3));

    expect(first).toMatchObject({ accepted: true, deathTriggered: false });
    expect(second).toMatchObject({ accepted: false, deathTriggered: false });
    expect(system.getHealthState()).toMatchObject({
      current: 2,
      invulnerable: true,
    });
    expect(damaged).toHaveBeenCalledTimes(1);
    expect(dying).not.toHaveBeenCalled();
    expect(invulnerabilityChanged).toHaveBeenNthCalledWith(1, {
      active: true,
      remaining: 2.5,
      reason: "spike",
    });

    system.fixedUpdate(3);
    expect(invulnerabilityChanged).toHaveBeenNthCalledWith(2, {
      active: false,
      remaining: 0,
      reason: null,
    });
    const third = system.applySpikeDamage(new THREE.Vector3(1, 2, 3));
    expect(third).toMatchObject({ accepted: true, deathTriggered: false });
    expect(system.getHealthState().current).toBe(1);
  });

  it("uses respawn death resolution for non-lethal falls", () => {
    const eventBus = new EventBus();
    const damaged = vi.fn();
    const dying = vi.fn();
    eventBus.on("player:damaged", damaged);
    eventBus.on("player:dying", dying);
    const system = new PlayerHealthSystem(eventBus);
    system.setupLevel();

    const result = system.applyFallDamage(new THREE.Vector3(0, -30, 0));

    expect(result).toMatchObject({ accepted: true, deathTriggered: true });
    expect(system.getHealthState()).toMatchObject({
      current: 2,
      invulnerable: false,
    });
    expect(system.consumePendingDeathResolution()).toEqual({
      mode: "respawn",
      reason: "fall",
    });
    expect(damaged).toHaveBeenCalledTimes(1);
    expect(dying).toHaveBeenCalledTimes(1);
  });

  it("switches to full-reset when damage depletes the last heart", () => {
    const eventBus = new EventBus();
    const dying = vi.fn();
    eventBus.on("player:dying", dying);
    const system = new PlayerHealthSystem(eventBus);
    system.setupLevel();

    system.applySpikeDamage(new THREE.Vector3(0, 0, 0));
    system.fixedUpdate(3);
    system.applySpikeDamage(new THREE.Vector3(0, 0, 0));
    system.fixedUpdate(3);
    const lethal = system.applySpikeDamage(new THREE.Vector3(0, 0, 0));

    expect(lethal).toMatchObject({ accepted: true, deathTriggered: true });
    expect(system.getHealthState().current).toBe(0);
    expect(system.consumePendingDeathResolution()).toEqual({
      mode: "full-reset",
      reason: "spike",
    });
    expect(dying).toHaveBeenCalledTimes(1);
  });
});
