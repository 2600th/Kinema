# KIN-025 Feedback, Coin Completion, and Checkpoint Respawn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan test-first and request an independent review before landing.

**Goal:** Complete Kinema's proportional feedback contract, present active-run collectible progress as `count/total` with a one-shot completion celebration, and recover lethal deaths at an active checkpoint without reloading or losing collected coins.

**Architecture:** A typed `FeedbackPresets` map is the single source for new discrete camera presets; `Game` consumes it while preserving the continuous movement FOV path. `CoinCollectibleSystem` owns the active run's value total and emits `collectible:allCollected` exactly once after the final `collected` event. UI, particles, and audio independently consume that domain event. `CheckpointManager` exposes a cloned active spawn point. On lethal damage, `PlayerHealthSystem` snapshots that point into a discriminated `checkpoint-respawn` resolution so later debug teleports or vehicle exits cannot redirect recovery. The death-midpoint handler spawns at the snapshot, restores full health plus i-frames, and keeps the level loaded. Without an active checkpoint, the current full-reset path remains unchanged.

**Tech Stack:** TypeScript 5.9, Three.js, Rapier, Tone.js, Vitest 4, Playwright, Biome, Vite 8.

## Behavior Contract

- Pickup/drop use tiny FOV impulses; ladder/rope attach and release use small framing impulses; sprint start uses one edge impulse; vehicle enter/exit use `0.15` trauma plus pooled dust; collect uses a `0.3` FOV pop.
- Crouch remains audio-only. Vehicle boost adds a sustained `+3` FOV through the existing camera FOV composition and clears on release/exit, never as a repeated punch.
- `collectible:changed` always includes the active run total. Full showcase progress is `n/70`; direct-station progress uses that station's registered total.
- The final coin emits `collectible:changed`, then `collectible:collected`, then one `collectible:allCollected` carrying total and final world position.
- Checkpoint recovery is guarded by `DEATH_RESPAWN_AT_CHECKPOINT = true`. It restores three hearts, grants 2.5 seconds of i-frames, preserves the current level and coins, exits any active vehicle, and emits the existing respawn lifecycle event.
- Lethal damage without an active checkpoint still emits `run:restartRequested`; existing non-lethal fall and spike i-frame behavior does not change.

---

### Task 1: RED domain contracts

**Files:**
- Modify: `src/systems/CoinCollectibleSystem.test.ts`
- Modify: `src/systems/PlayerHealthSystem.test.ts`
- Modify: `src/level/CheckpointManager.test.ts`
- Modify: `src/systems/CheckpointObjectiveSystem.test.ts`
- Create: `src/juice/FeedbackPresets.test.ts`

- [ ] Assert active-run totals, event payloads/order, and one-shot all-collected emission.
- [ ] Assert lethal checkpoint resolution snapshots a cloned point and recovery restores full health plus i-frames.
- [ ] Assert active checkpoint state is explicit and clears on dispose.
- [ ] Assert the typed feedback values are proportionate and do not duplicate crouch visuals.
- [ ] Run focused tests and preserve the expected RED result before implementation.

### Task 2: Implement progression and death recovery

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/systems/CoinCollectibleSystem.ts`
- Modify: `src/level/CheckpointManager.ts`
- Modify: `src/systems/CheckpointObjectiveSystem.ts`
- Modify: `src/systems/PlayerHealthSystem.ts`
- Modify: `src/Game.ts`
- Modify: `src/core/KinemaDebugApi.ts`
- Modify: `src/main.ts`

- [ ] Add total-bearing collectible events and the one-shot completion event.
- [ ] Expose active-run total and a cloned active checkpoint through deterministic DEV hooks.
- [ ] Inject the feature-flagged active-checkpoint resolver into health and snapshot it on lethal damage.
- [ ] Resolve `checkpoint-respawn` at the death midpoint: force vehicle exit, spawn at snapshot, restore health/i-frames, emit respawn.
- [ ] Keep restart and non-lethal fall paths intact, then turn focused domain tests GREEN.

### Task 3: Implement feedback, HUD, particles, and audio

**Files:**
- Create: `src/juice/FeedbackPresets.ts`
- Modify: `src/character/PlayerController.ts`
- Modify: `src/vehicle/VehicleManager.ts`
- Modify: `src/camera/OrbitFollowCamera.ts`
- Modify: `src/Game.ts`
- Modify: `src/juice/GameParticles.ts`
- Modify: `src/systems/ParticleSystem.ts`
- Modify: `src/audio/AudioManager.ts`
- Modify: `src/ui/components/HUD.ts`
- Modify: `src/ui/components/hud.css`
- Modify: `src/ui/UIManager.ts`
- Modify/add focused tests beside affected systems

- [ ] Emit semantic sprint-start, ladder attach/release, and vehicle boost edge events.
- [ ] Wire discrete presets without changing existing jump/land/grab/throw feedback or double-scaling intensity.
- [ ] Compose held boost as `+3` FOV and clear it on release/exit; reuse pooled dust for vehicle transitions.
- [ ] Reuse coin pools for the completion burst, render `count/total`, and add a longer final-completion pulse/status.
- [ ] Reuse `objectiveComplete()` plus the existing music duck for the celebration chord.

### Task 4: Browser proof, regression gates, and landing

**Files:**
- Modify: `tests/procedural-coins.ts`
- Modify: `tests/procedural-hazards.ts`
- Update ignored state/evidence: `tasks/todo.md`, `.superpowers/sdd/progress.md`, `output/kin025/`

- [ ] Collect all 70 showcase coins through deterministic teleport hooks; assert HUD increments, final one-shot state, and capture `70/70` plus celebration evidence.
- [ ] Activate the checkpoint, collect a coin, take three spaced hazard hits, and assert checkpoint position, full health/i-frames, preserved coin count, and no run reload.
- [ ] Retain and re-run the no-checkpoint lethal full-reset assertions.
- [ ] Exercise keyboard/touch and vehicle entry/exit/boost paths; verify default and compatibility renderers serially.
- [ ] Record celebration frame stats and inspect required screenshots.
- [ ] Run focused/full units, TypeScript, touched-file Biome error diagnostics, build, and event-order/static gates.
- [ ] Request an independent GPT-5.6 SOL review of the exact KIN-025 diff, address findings test-first, then create a detailed implementation commit.
