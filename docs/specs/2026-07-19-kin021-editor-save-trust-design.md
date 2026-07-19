# KIN-021 Editor Save Trust Design

Date: 2026-07-19
Status: Approved through the user's standing automatic-recommendation preference

## Goal

Make editor save state honest and loss-resistant: visible unsaved state, a real
Ctrl/Cmd+S path, explicit overwrite consent, conditional native unload protection,
and on-screen explanations for session-only GLB imports and missing-asset placeholders.

The level JSON format and KIN-009 download fallback behavior remain unchanged.

## Chosen Approach

Use a small pure `EditorDocumentState` controller owned by `EditorManager`, inject one
mutation callback into `CommandHistory`, and keep toolbar/panel classes as render-only
views of editor state. Missing-GLB state is runtime metadata detected independently by
both level reconstruction paths and is never serialized.

This is preferred over two alternatives:

1. Comparing serialized document fingerprints after every edit would be expensive,
   presentation-sensitive, and awkward around async GLB reconstruction.
2. A history revision/savepoint model could recognize undo-back-to-clean, but KIN-021
   explicitly treats execute/undo/redo as dirty and KIN-022 owns undo-everywhere.

## Editor Document State

`EditorDocumentState` stores exactly:

- `name`, initially `Untitled`;
- `dirty`, initially `false`;
- `markDirty()`;
- `markClean(name)`;
- a change callback used by `EditorManager` to refresh the toolbar and unload guard.

`markDirty()` is idempotent. `markClean(name)` updates the clean baseline only after a
successful persistent save or a completed explicit user load. It is not persisted and
does not alter the level format.

The toolbar renders the current name and appends `*` when dirty. The Save button contains
a visible `.ke-dirty-dot`; its accessible label/title also communicates unsaved state.

## Mutation Coverage

`CommandHistory` accepts an optional `onMutation` callback. It fires once after a
successful `push`, non-empty `undo`, and non-empty `redo`; empty operations and `clear()`
do not fire it. This centrally covers brush placement, GLB placement, duplicate, gizmo
commit, and delete.

The remaining direct mutations mark dirty after a real change:

- rename;
- visibility and lock toggles;
- reparent, group, and ungroup;
- inspector transform and material changes;
- physics-type changes;
- live gizmo movement, so closing mid-drag is protected.

Low-level add/remove helpers do not mark dirty because load and play-test restoration use
the same helpers. Direct mutation callbacks compare or use their existing success result
where a no-op is possible.

## Save, Load, And Play-Test Lifecycle

Ctrl/Cmd+S is handled in the editor's capture-phase key listener before editable-target
filtering and before `FreeCamera`. The handler uses `ctrlKey || metaKey`, prevents the
browser default, ignores repeated keydown after prevention, and invokes the existing save
flow. Plain `S` is untouched.

Save behavior:

1. Prompt with the current document name (or `custom` for `Untitled`).
2. If `LevelSaveStore.list()` already contains the chosen name, ask for overwrite
   confirmation.
3. A canceled prompt or confirmation performs no serialization, download, or storage write.
4. Preserve the existing `created` timestamp when overwriting.
5. Preserve the KIN-009 download behavior and persistent-storage result contract.
6. Clear dirty and update the document name only when `LevelSaveStore.save()` succeeds.
7. Quota/error results remain dirty and keep the persistent toolbar error visible.

Explicit editor file load calls `applyLoadedLevel` with `user-load` intent. Dirty state is
cleared only after every object and hierarchy edge has been reconstructed successfully;
the old history is then cleared. Play-test restoration passes `playtest-restore`, preserving
the prior name and dirty state. Plain F1 close/reopen also preserves state. A later external
`level:loaded` event establishes a new clean baseline so edits from a previous run cannot
leak into a new run; procedural/station content starts as `Untitled`, while saved JSON uses
its authored name.

## Unload Protection And Cleanup

`EditorManager.shouldWarnBeforeUnload()` is true only when dirty and either editor-active
or play-testing. It emits a protection-state event only when this derived value changes.
`main.ts` uses that event to attach the `beforeunload` listener only while needed.

The warning listener calls `preventDefault()` and assigns `returnValue` for legacy browser
support. It performs no teardown because the event is cancelable and the user may stay.
Actual cleanup moves to `pagehide`; a persisted back/forward-cache page is left intact.
The development debug surface exposes registration and last-prevention state so Playwright
can dispatch a synthetic cancelable event without attempting to automate native browser UI.

## Session-Only GLB Import Banner

`GLBPlacementTool` receives an `onImported` callback. It runs only after a successful parse,
cache registration, and placement-preview start. Failed imports neither show the banner nor
emit the existing success warning.

`ToolbarPanel` shows a persistent, dismissible, editor-local notice in a message stack:

> Imported model is session-only — copy it to public/assets/models/ to keep it after reload.

The notice uses `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`. Its Dismiss
button is keyboard accessible. A later successful import shows the notice again. The message
stack also prevents overlap with the existing save-error alert.

## Missing-Asset Placeholder Honesty

`EditorObject` gains runtime-only `missingAssetPath?: string`. A placeholder root is tagged
in `userData` when GLB loading fails; `buildEditorObject()` reads that tag so F1 re-entry in
the same session retains the explanation.

Both reconstruction paths apply the contract:

1. `EditorManager.spawnSerializedObject()` for the editor JSON file picker.
2. `LevelManager.spawnJSONObject()` / `loadGLBObject()` for a saved level selected after a
   browser reload.

`LevelManager.spawnJSONObject()` also restores `entry.source` to `obj.userData.editorSource`.
Without this, successful GLB groups can disappear from the editor hierarchy and failed GLBs
are misclassified as primitive cubes.

The warning is never included in `SerializedObjectV2`; the original GLB source remains the
source of truth. Copying the missing file into the expected path and reloading naturally
removes the warning.

Hierarchy rows prepend a visible `⚠` with accessible label
`GLB unavailable; placeholder shown.` The inspector shows:

> Model unavailable: {assetPath}. Kinema is showing a placeholder. Copy the original file to public/assets/models/ and reload the level.

All dynamic copy is assigned with `textContent`.

## Verification

Unit tests cover:

- CommandHistory mutation notification for push/non-empty undo/non-empty redo and no
  notification for empty operations or clear;
- document-state clean/dirty/name transitions and idempotence;
- GLB success/failure callback boundaries;
- both LevelManager GLB metadata paths;
- absence of runtime placeholder metadata from serialized V2 output.

The serial `tests/editor-flow.ts` journey covers:

- place block → `Untitled*` and visible dirty dot;
- synthetic beforeunload event is prevented only while protection is active, including
  play-test state;
- Ctrl/Cmd+S saves without a browser Save dialog and clears dirty only on success;
- overwrite cancellation leaves storage/download/state untouched, then confirmation saves;
- successful GLB import shows and dismisses the exact banner;
- save → browser reload → saved-level selection → F1 produces a hierarchy marker and
  inspector explanation for a deterministic missing root asset;
- screenshots of dirty state, GLB banner, and placeholder explanation.

The existing nested `Mannequin_F.glb` fixture is uploaded under its basename. The importer
records `/assets/models/Mannequin_F.glb`, which is intentionally absent at that root after
reload, providing a real deterministic placeholder path without adding binary assets.

## Out Of Scope

- Undo coverage for direct inspector/document mutations (KIN-022).
- Child-aware delete, editor camera persistence, and drag-end collider rebuild (KIN-022).
- A new open-level dialog or a general notification service.
- Changes to serialized level schema, download fallback semantics, or deployment assets.
