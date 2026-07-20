# KIN-027 Audio Lifecycle and Pooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan test-first and request an independent review before landing.

**Goal:** Make audio follow pause, editor, and document-visibility context without losing user volume intent, eliminate the remaining cited per-event Tone allocations, and retain exactly one live music-loop generation across rapid restart cycles.

**Architecture:** `AudioManager` remains the sole owner of application context. It composes SFX gain from the stored user volume and pause multiplier, and composes music ducking as the minimum of pause, editor, and all active transient reasons. `SFXEngine` owns one dedicated sustained-source bus for car, drone, and slide graphs plus construction-time UI/checkpoint/death nodes. Visibility transitions serialize against the native Tone `AudioContext`; resume is context-state-aware and persistent gesture listeners retry rejected browser resumes. `MusicEngine` keeps its existing generation/timer protection and narrows deferred cleanup to the loop set captured by that stop request.

**Tech Stack:** TypeScript 5.9, Tone.js 15.1, Vitest 4, Playwright/Chromium, Biome, Vite 8.

**Status:** Complete.

## Behavior Contract

- Pause keeps user volume semantics: SFX target is `0.79 * userSfxVolume * 0.1`, music duck is at most `0.3`, and car/drone/slide sustained graphs are muted without oscillator recreation.
- Resume restores the current user SFX level and sustained bus. A settings change made while paused remains scaled until resume.
- Editor music stays at exactly `0.15` while editor context is open; SFX remains available for current and future editor feedback.
- Persistent and transient music reasons compose by minimum gain. Expiring a checkpoint/death/objective timer cannot erase a pause/editor duck or a longer transient.
- Hidden documents suspend a running native audio context. A visible document attempts resume; if the browser rejects it, the next click/keydown/touch/pointer retries through the existing unlock path.
- Context transitions and unlock attempts are serialized and disposal-safe; no late promise may start disposed engines.
- Ten hover triggers reuse one prebuilt UI synth and drop events within 60 ms instead of scheduling backlog. UI click uses the same pool but is not discarded.
- Checkpoint reuses one FMSynth/chorus graph; death midpoint reuses one reverb/noise graph; all pooled nodes dispose exactly once.
- Rapid music stop/start still disposes the fading generation immediately and stale deferred cleanup cannot touch replacement loops.

## Current-Tree Corrections

- Commit `d225fbe` already fixed the main music restart race and added two passing generation tests. Preserve that implementation and only capture the stopped loop set locally.
- Typed editor lifecycle events and KIN-015 interaction/progression sounds already exist; no editor, event-type, or gameplay-content changes are needed.
- `ensureToneStarted()` currently returns early for a suspended context, and its gesture handler removes all retry listeners before awaiting a potentially rejected start. Both behaviors must change together.
- Independent unconditional `unduck()` calls are unsafe: transient timeout expiry can currently erase a later editor/pause duck.

---

### Task 1: RED application-context contracts

**Files:**
- Create: `src/audio/AudioManager.test.ts`
- Modify: `src/audio/AudioManager.ts`

- [ ] Mock Tone buses/context plus Music/SFX engines around a real `EventBus`.
- [ ] Assert pause SFX target `0.079` at default volume, sustained mute, and exact restoration.
- [ ] Assert volume changes while paused keep the `0.1` multiplier.
- [ ] Assert editor `0.15`, pause `0.3`, and overlapping transient amounts compose by minimum across timer expiry.
- [ ] Assert context state is applied before Tone unlock.
- [ ] Assert hidden suspends, visible resumes, rejected resume retries on the next gesture, and dispose blocks late completion.
- [ ] Run the focused test and preserve the expected RED result.

### Task 2: Implement composed lifecycle state

**Files:**
- Modify: `src/audio/AudioManager.ts`

- [ ] Store user SFX volume, pause/editor flags, transient duck amount per timer, and disposed/in-flight context state.
- [ ] Replace direct SFX writes with one derived-gain function.
- [ ] Replace unconditional music duck/unduck calls with one minimum-gain resolver.
- [ ] Apply pause/editor state regardless of Tone unlock; gate only audible one-shots.
- [ ] Serialize `visibilitychange` against the native context and keep gesture retry listeners until disposal.
- [ ] Turn application-context tests GREEN without changing `AudioController`, event types, settings storage, or menu/editor emitters.

### Task 3: RED pooled-node and captured-generation contracts

**Files:**
- Create: `src/audio/SFXEngine.test.ts`
- Modify: `src/audio/MusicEngine.test.ts`

- [ ] Assert ten hover calls construct only the single UI synth and accept at most one trigger per 60 ms.
- [ ] Assert click feedback reuses the same UI synth without being dropped behind hover throttling.
- [ ] Assert repeated checkpoint/death calls create no new FMSynth, chorus, reverb, or death-noise graph.
- [ ] Assert car/drone/slide pause and resume do not allocate replacement source nodes.
- [ ] Assert every new pooled node and bus disposes exactly once.
- [ ] Assert deferred music stop disposes only its captured generation and a restart preserves four new loops.
- [ ] Run focused tests and preserve the expected RED result.

### Task 4: Implement pooling and music hardening

**Files:**
- Modify: `src/audio/SFXEngine.ts`
- Modify: `src/audio/MusicEngine.ts`

- [ ] Add a sustained bus and route car, drone, and slide parent gains through it.
- [ ] Add idempotent `setSustainedPaused()` without stopping or recreating oscillators.
- [ ] Construct UI synth, checkpoint FM/chorus, and death reverb/noise once; remove cited per-event allocation timers.
- [ ] Enforce the 60 ms hover drop window and safe click scheduling.
- [ ] Capture the stopped music loop set locally while retaining timer identity/generation protection.
- [ ] Turn focused tests GREEN and keep land dedup, volume routing, and degraded dynamics unchanged.

### Task 5: Browser proof, verification, review, and landing

**Files:**
- Modify: `tests/pause-pointer-lock.ts`
- Update ignored evidence/state: `tasks/todo.md`, `output/kin027/`

- [ ] Extend the existing allowlisted pause spec; do not create a new Playwright filename.
- [ ] Exercise ten real pause/resume round-trips after audio unlock and fail on Tone scheduling/lifecycle console errors.
- [ ] Use Chromium WebAudio instrumentation where stable to record node-allocation observations during hover/menu stress; keep semantic gates in deterministic units.
- [ ] Exercise editor open/close and a second-tab visibility cycle where headless Chromium exposes reliable visibility state.
- [ ] Run focused/full units, TypeScript, touched-file Biome error diagnostics, build, and the affected serial Playwright spec.
- [ ] Mark pause/background/editor/hover sound quality as manual-perceptual if the environment cannot be listened to; never claim perceptual proof from state alone.
- [ ] Request independent GPT-5.6 SOL review, address findings test-first, update durable task state, and create a detailed implementation commit.

## Verification Notes

- Tone’s official guidance requires `Tone.start()` from a user action and only treats audio as ready after its promise resolves. Tone context resume is asynchronous, so rejected visibility restoration must remain retryable from later gestures.
- Tone Transport pause/stop affects transport-synced music sources, not the unsynced car/drone/slide oscillators. Application pause therefore uses derived buses, while document backgrounding suspends the native context for complete silence.
- Browser audio quality and crackle are perceptual. Automated checks prove ownership, gain targets, context state, allocation counts, and absence of scheduling errors; a human listening pass remains a distinct acceptance item.

## Completion Record

- Full Vitest passed: 83 files / 695 tests.
- TypeScript and the production build passed; the existing large-chunk warning remains.
- Scoped Biome passed all seven touched source/test files with zero diagnostics.
- Full serial `pause-pointer-lock` Playwright coverage passed 5/5, and the final lifecycle stress rerun passed 1/1 after review fixes.
- Repository-wide Biome remains on its documented baseline failure (134 errors, 269 warnings, 11 infos); no touched-file diagnostics remain.
- A GPT-5.6 SOL review found a hidden-tab/in-flight unlock race and an unstarted pooled Chorus. Both received regression coverage and the re-review verdict was Ready YES.
- Manual perceptual listening remains a follow-up; automated evidence covers gain/context state, allocation ownership, scheduling stability, and disposal rather than subjective mix quality.
