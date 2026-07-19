# KIN-022 Reversible Editor Mutations And Persistent Workspace Design

## Goal

Make every editor mutation reversible, make deletion subtree-consistent, preserve the live editor
workspace and camera across plain F1 toggles, and avoid unnecessary collider reconstruction during
transform commits. Preserve the level JSON format and all KIN-021 trust guarantees.

## Chosen Architecture

Use typed command builders in `src/editor/EditorCommands.ts`, backed by a narrow mutation host owned
by `EditorManager`. Commands capture immutable before/after state and resolve ordinary targets by ID
on every execute/undo. Structural commands retain explicit object/topology/runtime snapshots because
their targets may be detached while the command remains undoable.

`CommandHistory` remains synchronous and retains KIN-021's explicit `false` rejection contract. Add
an optional `discard()` lifecycle hook invoked on eviction, redo invalidation, clear, and manager
disposal. A command cleans resources only when it owns detached state; discarding an undone delete
must not destroy live resources.

Rejected alternatives:

- Inline closures in `EditorManager`: duplicates rollback logic and further expands an already large
  coordinator.
- Whole-document JSON mementos: asynchronous reconstruction loses live object identity, session GLBs,
  selection, and physics ownership, and makes every undo expensive.

## Command And Host Contracts

```ts
export interface Command {
  execute(): void | boolean;
  undo(): void | boolean;
  discard?(): void;
}

export type CommandBuildResult =
  | { ok: true; command: Command }
  | { ok: false; reason: string };

export interface EditorMutationHost {
  applyTransform(id: string, state: EditorTransformState): boolean;
  applyMaterial(id: string, state: EditorMaterialState): boolean;
  replacePhysics(id: string, state: EditorPhysicsState): boolean;
  applyHierarchy(state: EditorHierarchyState): boolean;
  detachSubtree(state: EditorSubtreeState): boolean;
  restoreSubtree(state: EditorSubtreeState): boolean;
  finalizeDetachedSubtree(state: EditorSubtreeState): void;
  afterMutation(notice: EditorMutationNotice): void;
  reportFailure(reason: string): void;
}
```

Builders cover transform, material, physics type, rename, visibility, lock, reparent, group,
ungroup, and subtree deletion. Scalar commands store explicit values rather than toggling during
undo. UI/event publication occurs only after model/scene/physics commit and must not convert a
committed mutation into a rejected history operation.

## Snapshot Model

- Transform: immutable numeric position, rotation, and scale tuples.
- Material: serialized `EditorObject.material` plus a deduplicated snapshot for each live
  `MeshStandardMaterial`, including `transparent`, so heterogeneous GLB child materials restore
  exactly.
- Physics: logical type, tracking presence, and the recipe required to atomically create and publish
  replacement handles before retiring current handles. Destroyed handles are never reused.
- Hierarchy: affected object references, document indices, full parent child arrays, exact local
  transforms, group identity, and selection state.
- Subtree: parent-first node snapshots, leaf-first removal order, document indices, external parent
  and child index, exact local transforms, child arrays, per-node LevelManager tracking, live
  body/collider handles, and whether selection was within the subtree.

Do not use `LevelDataV2` as history state.

## Preview And Commit Boundaries

Transform and material panels emit `preview` and `commit` phases. The first preview captures the
before state. Preview updates visuals and, for transforms, body poses without history or dirty state.
Change, blur, Enter, slider release, or color commit captures after, restores before, and pushes one
command. A pending-commit guard deduplicates browser event sequences. Selection change and ordinary
blur commit; destructive load cancels; save and playtest flush before serialization.

Gizmo drag uses the same path: preview directly, then at drag end capture after, restore before, and
push one transform command.

## Subtree Delete

`EditorDocument` provides deterministic iterative `captureSubtree`, `removeSubtree`, and
`restoreSubtree` primitives derived from `parentId`; `children` remains a validated mirror.

Execute:

1. Capture every node and tracking record parent-first.
2. Clear selection and pending inspector sessions.
3. Remove LevelManager tracking and disable retained physics leaf-first.
4. Detach only the root mesh; keep internal mesh parenting intact.
5. Remove all subtree entries and the surviving parent's child reference.
6. Publish hierarchy/events after commit.

Undo restores document order and topology, attaches with `add()` using captured local transforms,
restores LevelManager tracking parent-first, re-enables physics, and pose-syncs without collider
rebuild. Redo repeats leaf-first removal. On history discard, an applied delete finalizes detached
physics exactly once; an undone delete finalizes nothing. Shared GPU resources are not blindly
disposed.

## Other Structural Commands

Reparent, group, and ungroup capture exact before/after topology and local transforms. The initial
world-preserving state may use validated `attach()`, but replay sets the parent and exact captured
local transform. Commands preserve parent child-array order, document order, selection, and physics
tracking. Existing KIN-021 attachment/shear validation remains authoritative.

## Physics And Drag Performance

Atomic physics sync accepts a per-entry collider rebuild decision. Every committed transform updates
body translation/rotation. A collider rebuild occurs only when that object's effective world scale
changed component-wise, including sign changes. Thus:

- preview: zero collider descriptor builds;
- translation/rotation commit: zero collider replacements;
- selected scale: rebuild the selected collider;
- parent/group scale: rebuild only descendants whose effective world scale changed.

All replacement descriptors/colliders are prepared before destructive publication; existing KIN-021
rollback fidelity remains intact. Add development-only counters for pose syncs, descriptor builds,
and replacements.

## Camera And Document Persistence

`FreeCamera` exposes explicit `capturePose`, `restorePose`, and `syncOrientationFromCamera`. It does
not implicitly restore inside `enable()`, because focus and playtest already use enable/disable for
orientation resync.

`EditorManager` owns one runtime-only editor pose. `exit()` captures it before gameplay resumes;
`enter()` restores it before enabling FreeCamera. First entry adopts the runtime pose. Focus uses the
explicit orientation sync. Genuine `level:loaded` clears the pose; internal playtest reconstruction
does not.

Add `documentNeedsRebuild`. Genuine level transitions set it, initial scan and explicit reconstruction
clear it, and plain F1 leaves it clear. Plain toggles therefore retain EditorObject identity, hierarchy,
lock state, history, and pending-safe document state rather than rebuilding wrappers.

## History Boundaries

- Plain F1 and save retain history.
- Successful user/external load clears and discards old history before destructive teardown once the
  validated transaction owns the load.
- Playtest flushes pending edits, then clears history before snapshot because restore creates new
  object identities.
- Manager disposal clears/discards history.
- Successful execute/undo/redo marks dirty; returning to the saved state does not implicitly mark
  clean.

## Verification

Unit tests deep-compare editor/runtime projections for every command after execute, undo, and redo.
Subtree tests cover deep trees, sibling order, physics tracking, selection, mid-remove/mid-restore
failure, and discard ownership. Material tests begin with heterogeneous child materials. Physics
tests cover replacement failure and exact tracking rollback. Panel tests prove many previews produce
one commit.

Extend the allowlisted `tests/editor-flow.ts` with a real journey:

- material change then Ctrl+Z restores;
- delete root removes children from hierarchy and saved projection; undo restores; redo removes;
- plain F1 retains exact camera position/quaternion and live hierarchy/lock state;
- playtest stop retains the same editor pose.

Development hooks expose an editor projection, camera pose setter, and physics counters.

Performance measurement uses the committed KIN-001 frame methodology with the same authored fixture
and repeated translation, rotation, and scale drags. Correctness acceptance is zero builds during
drag, zero release builds for translation/rotation, and exactly the effective-scale-changed colliders
for scale. Representative frame conclusions require headed hardware WebGPU; headless WebGL2 is used
for deterministic correctness only.

## Incremental Delivery

1. Command lifecycle and state builders.
2. Subtree capture/remove/restore and delete command.
3. Scalar and material commands with commit boundaries.
4. Transform and physics-type commands.
5. Reparent/group/ungroup commands.
6. Scale-selective collider sync and counters.
7. Camera/live-document persistence.
8. Browser/performance proof and final review.

Each slice receives RED/GREEN focused tests, TypeScript, scoped Biome, an isolated commit, and an
independent review before the next slice.
