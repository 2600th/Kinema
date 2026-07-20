# KIN-022 Final Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final KIN-022 lifecycle, ownership, shortcut, and collider-rollback findings without weakening the existing reversible editor guarantees.

**Architecture:** `EditorManager` owns one combined pending inspector boundary, while transform and material retain focused commit/cancel primitives. Creation commands share a small applied-state ownership helper whose discard callback runs only for detached objects. Atomic subtree physics rollback asks the host whether each old collider is actually live instead of inferring liveness from control flow.

**Tech Stack:** TypeScript 5.9, Three.js, Rapier 3D, Vitest 4, Playwright, Biome.

## Global Constraints

- Preserve `LevelDataV2`, KIN-021 dirty/load/unload/resource guarantees, and existing undoable actions.
- Use strict RED before production changes for every finding.
- Do not dispose geometry/material assets unless exclusive ownership is proven.
- Clear command history before dependent runtime teardown during manager disposal.
- Run browser verification serially and do not overlap heavy verification commands.

---

### Task 1: Pending inspector lifecycle and keyboard routing

**Files:**
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/EditorManager.test.ts`
- Modify: `tests/editor-flow.ts`

**Interfaces:**
- Produces `commitPendingTransformEdit(): boolean`, `cancelPendingTransformEdit(): void`, `commitPendingEdit(): boolean`, and `cancelPendingEdit(): void`.
- Keeps `applyInspectorTransform(..., "preview" | "commit")` as the real preview entry point.

- [x] Add manager regressions that start real transform preview sessions, then prove selection/save/playtest commit ordering, downstream abort on commit failure, validated/current-load cancellation, dispose cancellation, and exact dirty/history state.
- [x] Add a keyboard-event regression proving Ctrl+Shift+Z calls redo once and undo zero times while Ctrl+Z and Ctrl+Y preserve their existing meanings.
- [x] Run `npx vitest run src/editor/EditorManager.test.ts` and record the expected lifecycle/shortcut failures.
- [x] Extract transform commit/cancel primitives and route selection, save, playtest, authoritative destructive load, external unload, and dispose through the combined pending boundary.
- [x] Order redo before undo (or make the branches mutually exclusive) and return after handling the shortcut.
- [x] Re-run the manager tests and add a serial browser assertion for Ctrl+Shift+Z plus transform-input Ctrl+S when the existing editor-flow harness can express both without configuration changes.

### Task 2: Detached created-object ownership

**Files:**
- Modify: `src/editor/EditorCommands.ts`
- Modify: `src/editor/EditorCommands.test.ts`
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/EditorManager.test.ts`
- Modify: `src/editor/tools/BrushPlacementTool.ts`
- Modify: `src/editor/tools/BrushPlacementTool.test.ts`
- Modify: `src/editor/tools/GLBPlacementTool.ts`
- Modify: `src/editor/tools/GLBPlacementTool.test.ts`

**Interfaces:**
- Produces `createOwnedCreationCommand(execute, undo, discardDetached): Command`.
- Consumes the existing `rollbackEditorObject` context callback to retire detached physics without assuming GPU ownership.

- [x] Add RED tests for duplicate, brush, and GLB commands proving redo invalidation and `history.clear()` destroy an undone object's retained body/collider exactly once, while applied discard destroys nothing.
- [x] Add a manager-dispose ordering regression proving `history.clear()` precedes runtime-dependent teardown.
- [x] Run the focused command, manager, brush, and GLB tests and record the expected retained-resource failures.
- [x] Implement the shared applied-state helper and use it in all three creation paths.
- [x] Re-run focused tests and confirm no geometry/material disposal is added to discard paths.

### Task 3: Collider rollback liveness

**Files:**
- Modify: `src/editor/EditorPhysicsSync.ts`
- Modify: `src/editor/EditorPhysicsSync.test.ts`
- Modify: `src/editor/EditorManager.ts`

**Interfaces:**
- Adds required `isColliderLive(collider: TCollider): boolean` to `AtomicPhysicsSyncOptions`.
- Uses `prepareColliderRestore` only when the actual old collider is no longer live.

- [x] Add a two-collider RED regression where the second old-collider removal invalidates the handle and then throws; assert restored tracking points only to live colliders and every replacement/old handle has exact single ownership.
- [x] Run `npx vitest run src/editor/EditorPhysicsSync.test.ts` and record the dead-handle rollback failure.
- [x] Replace the `retired` inference with host-reported collider liveness and wire Rapier `isValid()` from `EditorManager`.
- [x] Re-run physics sync and manager tests.

### Task 4: Verification, report, and commit

**Files:**
- Modify: `tasks/todo.md` (workspace-local, not committed)
- Create: `.superpowers/sdd/kin022-final-fixes-report.md`

**Interfaces:**
- Produces the requested RED/GREEN and verification evidence report.

- [x] Run focused manager/physics/brush/GLB/history tests.
- [x] Run `npm run test`, `npx tsc`, scoped Biome error gate for every touched source/test file, `npm run build`, and relevant serial Playwright grep(s), without overlapping heavy commands.
- [x] Review `git diff`, ensure only fix files are staged, write the report, and commit with a detailed imperative subject.
- [x] Mark the KIN-022 todo final-review wave complete and return status, commit, tests, browser result, concerns, and report path.

### Task 5: Active gizmo drag lifecycle extension

**Files:**
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/EditorManager.test.ts`
- Modify: `tests/editor-flow.ts`

**Interfaces:**
- Replaces the anonymous drag-start snapshot with an owned session containing the exact object ID,
  object reference, and before transform.
- Extends `commitPendingEdit()` and `cancelPendingEdit()` to include active gizmo drags.

- [x] Add strict-RED manager regressions for save, playtest, selection, authoritative load, external
  unload, dispose, rejected history publication, and pointer-up deduplication.
- [x] Add a strict-RED serial browser journey that holds a physical gizmo drag across Ctrl+S and
  proves the saved transform plus one-step undo/redo behavior.
- [x] Implement exact-object gizmo commit/cancel primitives and route them through the shared pending
  lifecycle boundary.
- [x] Run focused/full unit, typecheck, scoped Biome, build, and serial targeted browser verification.
- [x] Append the evidence report and commit the extension separately.

### Task 6: Terminate physical gizmo interaction at lifecycle boundaries

**Files:**
- Modify: `src/editor/TransformGizmo.ts`
- Create: `src/editor/TransformGizmo.test.ts`
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/EditorManager.test.ts`
- Modify: `tests/editor-flow.ts`

**Interfaces:**
- Adds idempotent `TransformGizmo.finishDrag()` using the public TransformControls pointer-up API.
- Requires pending drag commit/cancel to end physical control ownership after clearing logical session
  ownership, so recursive drag-end publication cannot create a second command.

- [x] Add strict-RED wrapper, manager, and held-pointer browser regressions.
- [x] Terminate the physical gizmo interaction during commit/cancel and ignore object-change events
  when no owned drag session exists.
- [x] Run focused/full unit, typecheck, scoped Biome, build, and serial targeted browser verification.
- [x] Append the evidence report and commit the termination fix separately.
