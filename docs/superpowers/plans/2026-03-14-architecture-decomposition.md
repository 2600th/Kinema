# Architecture Decomposition Plan — Phase 1 & 2

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Decompose PlayerController and Game.ts from monoliths into modular, extensible architectures using the strangler refactor pattern.

**Architecture:** Extract a CharacterMotor (physics queries + velocity), move grab/carry into a dedicated controller, introduce RuntimeSystem interface for Game.ts subsystems. No ECS, no big-bang rewrite — incremental extraction with tests at each step.

**Tech Stack:** TypeScript, Three.js, Rapier physics, Vitest for unit tests

---

## Phase 1: PlayerController Decomposition

### File Structure

```
src/character/
  PlayerController.ts      — Slim orchestrator (input routing, visual sync, state delegation)
  CharacterMotor.ts        — NEW: Physics queries (ground detection, slope, floating spring, gravity)
  GrabCarryController.ts   — NEW: Grab/carry/throw logic extracted
  modes/
    CharacterMode.ts       — NEW: Interface for locomotion modes
    GroundedMode.ts        — NEW: Walk, sprint, step assist, crouch
    AirMode.ts             — NEW: Air control, air jumps, variable jump cut
    LadderMode.ts          — NEW: Ladder climb/dismount
    RopeMode.ts            — NEW: Rope attachment behavior
```

### Task 1: Create CharacterMotor — ground detection + floating spring

**Files:**
- Create: `src/character/CharacterMotor.ts`
- Modify: `src/character/PlayerController.ts`

The motor owns all physics queries that determine if the player is grounded,
the slope angle, and the floating spring force. It exposes a clean interface
that PlayerController and modes can read from.

**CharacterMotor responsibilities:**
- `queryGround(body, capsuleHalfHeight, config)` → `GroundInfo { grounded, closeToGround, slopeAngle, slopeNormal, standingSlopeAllowed, groundBody, floatingRayHit }`
- `applyFloatingSpring(body, groundInfo, config)` — applies spring force + ground reaction
- `applyGravity(body, verticalVelocity, config, jumpActive)` — apex hang, falling, terminal velocity
- Owns all pre-allocated Rapier vectors for ground queries
- Owns `jumpSuppressGroundFrames` logic (decrement + effective grounding)

**Steps:**
- [ ] Create CharacterMotor.ts with GroundInfo interface and queryGround method
- [ ] Extract floating spring logic from PlayerController.fixedUpdate into motor
- [ ] Extract gravity scaling logic into motor
- [ ] Extract slope detection (both standing and forward probe) into motor
- [ ] Update PlayerController to use motor.queryGround() and motor.applyFloatingSpring()
- [ ] Verify game runs identically — no behavior change
- [ ] Commit: "refactor: extract CharacterMotor for ground detection and spring physics"

### Task 2: Create GrabCarryController

**Files:**
- Create: `src/character/GrabCarryController.ts`
- Modify: `src/character/PlayerController.ts`

Extract all grab/carry/throw state and logic into a dedicated controller.

**GrabCarryController responsibilities:**
- `startGrab(body, offset)`, `endGrab()`, `updateGrab(position, cameraForward)`
- `startCarry(object)`, `throwCarried(forward)`, `dropCarried(position, forward)`, `updateCarry(position, capsuleHalfHeight)`
- Owns: grabbedBody, grabbedBodyType, grabbedGravityScale, grabbedCollisionGroups, grabDistance, grabOffsetY
- Owns: carriedObject, carriedBodyType, carriedGravityScale, carriedCollisionGroups
- `get isGrabbing`, `get isCarrying`

**Steps:**
- [ ] Create GrabCarryController.ts with grab methods extracted from PlayerController
- [ ] Move carry/throw/drop methods into GrabCarryController
- [ ] Update PlayerController to delegate grab/carry to the new controller
- [ ] Remove grab/carry fields and methods from PlayerController
- [ ] Verify grab/carry/throw still works — no behavior change
- [ ] Commit: "refactor: extract GrabCarryController from PlayerController"

### Task 3: Create CharacterMode interface + GroundedMode

**Files:**
- Create: `src/character/modes/CharacterMode.ts`
- Create: `src/character/modes/GroundedMode.ts`
- Modify: `src/character/PlayerController.ts`

**CharacterMode interface:**
```typescript
interface CharacterMode {
  readonly id: string;
  enter(ctx: PlayerContext): void;
  exit(ctx: PlayerContext): void;
  /** Returns true if this mode handled the input (prevents fallthrough). */
  handleInput(ctx: PlayerContext, input: InputState, dt: number): void;
  /** Apply mode-specific physics each fixed tick. */
  fixedUpdate(ctx: PlayerContext, input: InputState, dt: number): void;
}
```

**PlayerContext** — shared state bucket that modes read/write:
```typescript
interface PlayerContext {
  body: RAPIER.RigidBody;
  mesh: THREE.Group;
  config: PlayerConfig;
  motor: CharacterMotor;
  grabCarry: GrabCarryController;
  fsm: CharacterFSM;
  eventBus: EventBus;
  physicsWorld: PhysicsWorld;
  cameraYaw: number;
  verticalVelocity: number;
  jumpActive: boolean;
  jumpBufferRemaining: number;
  remainingAirJumps: number;
  isCrouched: boolean;
  isGrounded: boolean;
  canJump: boolean;
  groundInfo: GroundInfo;
}
```

**GroundedMode:**
- applyMoveVelocity (velocity steering)
- applyStepAssist
- crouch state management
- Jump initiation (ground jump)
- Moving platform tracking

**Steps:**
- [ ] Create CharacterMode.ts with interface + PlayerContext
- [ ] Create GroundedMode.ts, extracting movement/crouch/step-assist from PlayerController
- [ ] Wire GroundedMode into PlayerController — delegate grounded movement to it
- [ ] Verify walking, sprinting, crouching, ground jumps work
- [ ] Commit: "refactor: extract GroundedMode from PlayerController"

### Task 4: Create AirMode, LadderMode, RopeMode

**Files:**
- Create: `src/character/modes/AirMode.ts`
- Create: `src/character/modes/LadderMode.ts`
- Create: `src/character/modes/RopeMode.ts`
- Modify: `src/character/PlayerController.ts`

**AirMode:** Air control, air jumps, variable jump cut
**LadderMode:** Climb, dismount, zero-gravity
**RopeMode:** Rope attachment, detach

**Steps:**
- [ ] Create AirMode.ts with air control and air jump logic
- [ ] Create LadderMode.ts with climb and dismount
- [ ] Create RopeMode.ts with attachment behavior
- [ ] Update PlayerController to switch between modes based on state
- [ ] Remove extracted code from PlayerController fixedUpdate
- [ ] Verify air jumps, ladder climbing, rope swinging work
- [ ] Commit: "refactor: extract AirMode, LadderMode, RopeMode"

### Task 5: Slim down PlayerController to orchestrator

**Files:**
- Modify: `src/character/PlayerController.ts`

After Tasks 1-4, PlayerController should be ~300-400 lines:
- Constructor (body, collider, mesh, visual)
- fixedUpdate: poll motor, select active mode, delegate
- update: visual interpolation, animation sync
- spawn/respawn
- setInput, setActive, setEnabled
- Public getters (position, groundPosition, isGrounded, etc.)

**Steps:**
- [ ] Clean up any remaining extracted code
- [ ] Verify the full pipeline: movement, jump, double jump, crouch, grab, carry, throw, ladder, rope
- [ ] Run existing Playwright tests
- [ ] Commit: "refactor: PlayerController is now a thin orchestrator"

---

## Phase 2: Game.ts Decomposition

### File Structure

```
src/core/
  RuntimeSystem.ts         — NEW: Interface for game subsystems
src/systems/
  InteractableSystem.ts    — NEW: Throwable/grabbable spawning + tracking
  ParticleSystem.ts        — NEW: Footstep/landing/jump particles
  CheckpointSystem.ts      — NEW: Checkpoint + objective management
  DebugRuntimeSystem.ts    — NEW: Physics debug, nav target mode
src/
  Game.ts                  — Slim composition root (~300 lines)
```

### Task 6: Create RuntimeSystem interface

**Files:**
- Create: `src/core/RuntimeSystem.ts`

```typescript
interface RuntimeSystem extends Disposable {
  readonly id: string;
  setupLevel?(): void;
  teardownLevel?(): void;
  fixedUpdate?(dt: number): void;
  postPhysicsUpdate?(dt: number): void;
  update?(dt: number, alpha: number): void;
}
```

**Steps:**
- [ ] Create RuntimeSystem.ts with the interface
- [ ] Add a `systems: RuntimeSystem[]` array to Game.ts
- [ ] Wire Game's lifecycle methods to iterate over registered systems
- [ ] Commit: "refactor: add RuntimeSystem interface for Game.ts decomposition"

### Task 7: Extract InteractableSystem

**Files:**
- Create: `src/systems/InteractableSystem.ts`
- Modify: `src/Game.ts`

Move throwable spawning, grabbable spawning, vehicle spawning, rope creation,
and related tracking (throwableObjects map, carriedThrowable, throwableMaterial)
from Game.ts into InteractableSystem.

**Steps:**
- [ ] Create InteractableSystem.ts with spawn methods from Game
- [ ] Register it in Game.ts systems array
- [ ] Remove extracted spawn methods and fields from Game.ts
- [ ] Verify interactables still work
- [ ] Commit: "refactor: extract InteractableSystem from Game.ts"

### Task 8: Extract ParticleSystem + CheckpointSystem + DebugSystem

**Files:**
- Create: `src/systems/ParticleSystem.ts`
- Create: `src/systems/CheckpointSystem.ts`
- Create: `src/systems/DebugRuntimeSystem.ts`
- Modify: `src/Game.ts`

**Steps:**
- [ ] Create ParticleSystem (footstep dust, landing, jump particles)
- [ ] Create CheckpointSystem (checkpoint + objective management)
- [ ] Create DebugRuntimeSystem (physics debug view, nav target mode)
- [ ] Register all in Game.ts
- [ ] Remove extracted code from Game.ts
- [ ] Verify all systems work
- [ ] Commit: "refactor: extract particle, checkpoint, debug systems from Game.ts"

### Task 9: Final Game.ts cleanup

- [ ] Game.ts should be ~300 lines: constructor, lifecycle delegation, debug keys, dispose
- [ ] Run full Playwright test suite
- [ ] Commit: "refactor: Game.ts is now a thin composition root"

---

## Verification

After all tasks:
- [ ] Run `npx playwright test` — all existing tests pass
- [ ] Manual smoke test: walk, jump, double jump, crouch, grab, throw, ladder, rope, vehicles
- [ ] Line count check: PlayerController < 400 lines, Game.ts < 400 lines
