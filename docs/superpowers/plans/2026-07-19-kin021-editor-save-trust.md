# KIN-021 Editor Save Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visible, persistent-in-session editor dirty state, safe save/unload behavior, overwrite consent, and truthful GLB import/placeholder messaging without changing the level schema.

**Architecture:** A pure `EditorDocumentState` owned by `EditorManager` drives the toolbar and a derived unload-protection event. `CommandHistory` reports command mutations centrally while current direct mutations mark dirty at their existing manager boundaries. GLB failures attach runtime-only source-path metadata in both reconstruction paths; editor panels render it but the serializer ignores it.

**Tech Stack:** TypeScript 5.9, Three.js, Vitest 4, Vite 8, Playwright Chromium, Biome.

## Global Constraints

- Preserve the current `LevelDataV2` JSON shape and KIN-009 download fallback behavior.
- Dirty defaults to false, the default document name is exactly `Untitled`, and dirty titles append exactly `*`.
- Clear dirty only after successful persistent save or completed explicit user load; preserve it across F1 and play-test restoration.
- Warn on unload only while dirty and editor-active or play-testing; a canceled unload must not dispose the app.
- Intercept only modified `KeyS` (`ctrlKey || metaKey`); plain `S` remains FreeCamera input.
- Show exact import copy: `Imported model is session-only — copy it to public/assets/models/ to keep it after reload.`
- Runtime placeholder metadata must never be serialized and must disappear naturally when the asset loads successfully.
- Do not add or update dependencies, generated output, or binary assets.
- Keep KIN-022 undo-everywhere, child delete, camera persistence, and drag collider work out of scope.

---

### Task 1: Dirty-State Core And Toolbar Truth

**Files:**
- Create: `src/editor/EditorDocumentState.ts`
- Create: `src/editor/EditorDocumentState.test.ts`
- Modify: `src/editor/CommandHistory.ts`
- Modify: `src/editor/CommandHistory.test.ts`
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/panels/ToolbarPanel.ts`
- Modify: `src/editor/styles/editor.css`

**Interfaces:**
- Produces: `EditorDocumentState.value: Readonly<{ name: string; dirty: boolean }>`
- Produces: `markDirty(): void` and `markClean(name: string): void`
- Changes: `new CommandHistory(onMutation?: () => void)`
- Produces: `ToolbarPanel.setDocumentState(name: string, dirty: boolean): void`
- Produces: `EditorManager.isDirty(): boolean` and `EditorManager.getDocumentState()`

- [ ] **Step 1: Write failing state and history tests**

Add `EditorDocumentState.test.ts` with assertions for:

```ts
const changes: EditorDocumentSnapshot[] = [];
const state = new EditorDocumentState((value) => changes.push({ ...value }));

expect(state.value).toEqual({ name: "Untitled", dirty: false });
state.markDirty();
state.markDirty();
expect(state.value).toEqual({ name: "Untitled", dirty: true });
expect(changes).toEqual([{ name: "Untitled", dirty: true }]);
state.markClean("Saved Lab");
expect(state.value).toEqual({ name: "Saved Lab", dirty: false });
```

Extend `CommandHistory.test.ts` so an injected spy fires once for successful `push`, undo,
and redo, and never for empty undo/redo or `clear()`:

```ts
const onMutation = vi.fn();
const history = new CommandHistory(onMutation);
history.undo();
history.redo();
history.clear();
expect(onMutation).not.toHaveBeenCalled();
history.push(createCommand("first", []));
history.undo();
history.redo();
expect(onMutation).toHaveBeenCalledTimes(3);
```

- [ ] **Step 2: Run RED tests**

Run: `npx vitest run src/editor/EditorDocumentState.test.ts src/editor/CommandHistory.test.ts`

Expected: FAIL because `EditorDocumentState` and the `CommandHistory` callback do not exist.

- [ ] **Step 3: Implement the pure document state**

Create this boundary:

```ts
export interface EditorDocumentSnapshot {
  name: string;
  dirty: boolean;
}

export class EditorDocumentState {
  private name = "Untitled";
  private dirty = false;

  constructor(private readonly onChange: (value: Readonly<EditorDocumentSnapshot>) => void = () => {}) {}

  get value(): Readonly<EditorDocumentSnapshot> {
    return { name: this.name, dirty: this.dirty };
  }

  markDirty(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.onChange(this.value);
  }

  markClean(name: string): void {
    const nextName = name.trim() || "Untitled";
    if (!this.dirty && this.name === nextName) return;
    this.name = nextName;
    this.dirty = false;
    this.onChange(this.value);
  }
}
```

- [ ] **Step 4: Add the history mutation callback**

Store the optional callback in `CommandHistory`. Call it after stack state is updated by a
successful push/non-empty undo/non-empty redo. Do not call it from `clear()` or empty operations:

```ts
constructor(private readonly onMutation: () => void = () => {}) {}

push(cmd: Command): void {
  cmd.execute();
  // existing stack maintenance
  this.onMutation();
}
```

Apply the same final call to the non-empty undo and redo paths.

- [ ] **Step 5: Render document state in the toolbar**

Keep references to the save button and a new `.ke-document-title`. Put a child
`.ke-dirty-dot` in the Save button and hide it by default. Implement:

```ts
setDocumentState(name: string, dirty: boolean): void {
  this.documentTitle.textContent = `${name}${dirty ? "*" : ""}`;
  this.saveButton.classList.toggle("ke-btn-dirty", dirty);
  this.dirtyDot.classList.toggle("ke-hidden", !dirty);
  this.saveButton.title = dirty ? "Save (Ctrl+S) — Unsaved changes" : "Save (Ctrl+S)";
  this.saveButton.setAttribute("aria-label", this.saveButton.title);
}
```

Add focused CSS for a compact title and cyan dirty dot. Do not change toolbar dimensions
outside the space required by the title.

- [ ] **Step 6: Wire all current editor mutation boundaries**

Initialize `EditorDocumentState` and `CommandHistory` in `EditorManager`:

```ts
this.documentState = new EditorDocumentState((state) => this.onDocumentStateChanged(state));
this.history = new CommandHistory(() => this.markDirty());
```

Expose:

```ts
isDirty(): boolean { return this.documentState.value.dirty; }
getDocumentState(): Readonly<EditorDocumentSnapshot> { return this.documentState.value; }
```

Call `markDirty()` after a real rename, visibility toggle, lock toggle, reparent, successful
group/ungroup, applied material, changed physics type, inspector transform, and live gizmo
object change. The history callback covers brush/GLB placement, duplicate, drag commit, and
delete. Do not mark low-level add/remove/load helpers.

- [ ] **Step 7: Run GREEN checks**

Run: `npx vitest run src/editor/EditorDocumentState.test.ts src/editor/CommandHistory.test.ts`

Expected: both files pass.

Run: `npx tsc`

Expected: exit 0.

- [ ] **Step 8: Commit the increment**

Stage only the seven Task 1 files and commit:

```text
Add editor dirty-state foundation
```

---

### Task 2: Save, Overwrite, Load, And Unload Lifecycle

**Files:**
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/KinemaDebugApi.ts`
- Modify: `src/main.ts`
- Test: `src/editor/EditorDocumentState.test.ts`
- Test: `tests/editor-flow.ts`
- Create: `docs/audits/evidence/28-editor-dirty.png`

**Interfaces:**
- Produces: `EditorManager.shouldWarnBeforeUnload(): boolean`
- Produces: `shouldProtectEditorUnload(dirty: boolean, active: boolean, playTesting: boolean): boolean`
- Produces event: `editor:unloadProtectionChanged: boolean`
- Produces debug values: `getEditorDocumentState()` and `getEditorUnloadProtectionState()`
- Changes: `applyLoadedLevel(data, intent: "user-load" | "playtest-restore")`

- [ ] **Step 1: Add RED lifecycle and browser tests**

Extend the pure state tests with a `shouldProtectEditorUnload(dirty, active, playTesting)`
truth table: true only for dirty+active and dirty+play-testing. Add one Playwright journey
named `protects unsaved editor work and saves through Ctrl+S` that places a block and first
asserts `.ke-dirty-dot`, title `Untitled*`, debug dirty state, and a prevented synthetic
`beforeunload` event.

Run: `npx vitest run src/editor/EditorDocumentState.test.ts`

Expected: FAIL because `shouldProtectEditorUnload` does not exist.

Run: `npx playwright test tests/editor-flow.ts --grep "protects unsaved editor work" --workers=1`

Expected: FAIL at the first dirty-state/debug assertion.

- [ ] **Step 2: Implement modified-KeyS before editable filtering**

At the top of active editor `onKeyDown`, compute `const cmd = e.ctrlKey || e.metaKey`. Before
the input/contenteditable return, handle only `KeyS`:

```ts
if (e.code === "KeyS" && cmd) {
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!e.repeat) void this.saveLevel();
  return;
}
```

Reuse `cmd` for existing undo/redo/play-test shortcuts. Plain `KeyS` continues to FreeCamera.

- [ ] **Step 3: Put overwrite consent before side effects**

Use the current document name as the prompt default except that `Untitled` defaults to
`custom`. If the chosen name exists, call:

```ts
const overwrite = window.confirm(`A level named "${name}" already exists. Overwrite it?`);
if (!overwrite) return;
```

This check must precede `serialize`, `download`, and `LevelSaveStore.save`. Preserve the
existing `created` timestamp. Only after `{ ok: true }` call
`this.documentState.markClean(data.name)`, clear the save error, and emit `editor:saved`.

- [ ] **Step 4: Separate user load from play-test restore**

Change `applyLoadedLevel` to require explicit intent. File picker calls `user-load`; stop
play-test calls `playtest-restore`. At the end of a completed user load:

```ts
if (intent === "user-load") {
  this.history.clear();
  this.documentState.markClean(data.name);
}
```

Subscribe to `level:loaded` so a new external run resets stale editor state. Normalize
`procedural` and `station:*` to `Untitled`; keep authored JSON names. Do not reset during
play-test restoration.

- [ ] **Step 5: Derive and emit unload protection state**

Add this pure helper beside `EditorDocumentState`, add the typed event to `EventMap`, and
cache the last emitted derived state in `EditorManager`:

```ts
export function shouldProtectEditorUnload(dirty: boolean, active: boolean, playTesting: boolean): boolean {
  return dirty && (active || playTesting);
}
```

Then wire it through the manager:

```ts
shouldWarnBeforeUnload(): boolean {
  return shouldProtectEditorUnload(this.documentState.value.dirty, this.active, this.playTestActive);
}

private syncUnloadProtection(): void {
  const enabled = this.shouldWarnBeforeUnload();
  if (enabled === this.unloadProtectionEnabled) return;
  this.unloadProtectionEnabled = enabled;
  this.eventBus.emit("editor:unloadProtectionChanged", enabled);
}
```

Call the sync method after document-state changes and editor/play-test lifecycle edges.

- [ ] **Step 6: Split warning from actual page cleanup**

In `main.ts`, dynamically add/remove one saved `beforeunload` handler from the new event.
The handler rechecks `editorManager?.shouldWarnBeforeUnload()`, then:

```ts
event.preventDefault();
event.returnValue = true;
editorBeforeUnloadPrevented = event.defaultPrevented;
```

It must not stop/dispose anything. Move current teardown to a `pagehide` listener and skip
teardown when `event.persisted` is true. Guard cleanup so it runs once.

- [ ] **Step 7: Extend the development debug contract**

Add exact interface results:

```ts
getEditorDocumentState(): { name: string; dirty: boolean };
getEditorUnloadProtectionState(): { registered: boolean; lastPrevented: boolean };
```

Return cloned primitive objects from `main.ts`; never expose mutable controllers.

- [ ] **Step 8: Complete and run the save-trust browser journey**

Continue the RED journey from Step 1 to prove dirty state survives play-test restore,
Ctrl+S creates the app JSON download/localStorage entry and clears state, overwrite cancel
has no side effects, overwrite accept clears state, and quota failure remains dirty. Capture
`docs/audits/evidence/28-editor-dirty.png` before the first save.

Run: `npx playwright test tests/editor-flow.ts --grep "protects unsaved editor work" --workers=1`

Expected: pass.

- [ ] **Step 9: Run focused and static checks**

Run: `npx vitest run src/editor/EditorDocumentState.test.ts src/editor/CommandHistory.test.ts`

Run: `npx tsc`

Run Biome on the Task 2 TypeScript files with formatter disabled. Expected: no errors.

- [ ] **Step 10: Inspect evidence and commit the increment**

Inspect `28-editor-dirty.png`; confirm the title, dot, toolbar readability, and surrounding
editor state. Then commit only Task 2 files and evidence:

```text
Protect unsaved editor work
```

---

### Task 3: GLB Session Banner And Missing-Asset Explanation

**Files:**
- Modify: `src/editor/EditorObject.ts`
- Modify: `src/editor/tools/GLBPlacementTool.ts`
- Create: `src/editor/tools/GLBPlacementTool.test.ts`
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/panels/ToolbarPanel.ts`
- Modify: `src/editor/panels/HierarchyPanel.ts`
- Modify: `src/editor/panels/InspectorPanel.ts`
- Modify: `src/editor/styles/editor.css`
- Modify: `src/level/LevelManager.ts`
- Modify: `src/level/LevelManager.test.ts`
- Modify: `src/editor/LevelSerializer.test.ts`
- Modify: `tests/editor-flow.ts`
- Create: `docs/audits/evidence/29-glb-session-banner.png`
- Create: `docs/audits/evidence/30-glb-placeholder.png`

**Interfaces:**
- Adds runtime-only: `EditorObject.missingAssetPath?: string`
- Adds userData key: `editorMissingAssetPath: string`
- Changes constructor option: `GLBPlacementTool({ levelManager, onFinished, onImported })`
- Produces: `ToolbarPanel.showSessionImportNotice(): void`

- [ ] **Step 1: Write RED GLB boundary tests**

Create a focused tool test with mocked `AssetLoader.load/put`, object URLs, and a minimal
tool context. A successful `Test.glb` import must cache `/assets/models/Test.glb` and call
`onImported("/assets/models/Test.glb")` exactly once. A rejected load must not call it.

Extend `LevelManager.test.ts` to assert:

```ts
expect(placeholder.userData.editorMissingAssetPath).toBe("/assets/models/Missing.glb");
expect(spawned.obj.userData.editorSource).toEqual(entry.source);
```

Cover successful and placeholder roots. Extend `LevelSerializer.test.ts` with an
`EditorObject` carrying `missingAssetPath`; assert serialized output has no such property.

Also add a Playwright journey named `explains session-only and missing GLB models`. Upload
the nested `Mannequin_F.glb`, then first assert the exact session banner copy.

- [ ] **Step 2: Run RED GLB tests**

Run: `npx vitest run src/editor/tools/GLBPlacementTool.test.ts src/level/LevelManager.test.ts src/editor/LevelSerializer.test.ts`

Expected: FAIL for missing callback/metadata behavior.

Run: `npx playwright test tests/editor-flow.ts --grep "explains session-only" --workers=1`

Expected: FAIL because the on-screen session banner does not exist.

- [ ] **Step 3: Make successful imports announce truthfully**

Add `onImported` to `GLBPlacementTool` options. Invoke it inside the success branch only,
after `put()` and `startPlacement()`. Move the console warning into that branch so failed
imports no longer claim success. `EditorManager` passes a callback to the toolbar.

- [ ] **Step 4: Add the dismissible toolbar message stack**

Place both the existing save alert and a new session notice under `.ke-toolbar-messages`.
The exact session notice uses `role="status"`, `aria-live="polite"`, and
`aria-atomic="true"`, with a `Dismiss` button. `showSessionImportNotice()` unhides it on
every successful import. Preserve the save-error persistent alert behavior.

- [ ] **Step 5: Tag both GLB reconstruction paths**

In each GLB catch create the placeholder, then assign:

```ts
placeholder.userData.editorMissingAssetPath = assetPath;
```

In `LevelManager.spawnJSONObject`, always restore:

```ts
obj.userData.editorSource = { ...entry.source };
```

In `EditorManager.buildEditorObject`, read a string `editorMissingAssetPath` into the
runtime-only `missingAssetPath`. The editor file-load catch applies the same tag before
building its `EditorObject`.

- [ ] **Step 6: Render hierarchy and inspector explanations**

For a placeholder row, prepend a `.ke-tree-row-warning` span containing `⚠`, with title and
accessible label exactly `GLB unavailable; placeholder shown.`

Add a hidden inspector warning note before Transform. For a selected placeholder, assign
with `textContent`:

```ts
`Model unavailable: ${obj.missingAssetPath}. Kinema is showing a placeholder. ` +
  "Copy the original file to public/assets/models/ and reload the level."
```

Hide and clear it for ordinary selections and no selection. Add warning styles that remain
readable against the editor panel without shifting ordinary rows.

- [ ] **Step 7: Complete the real GLB reload journey**

Capture `29-glb-session-banner.png`, dismiss the banner, place the preview, and save as
`kin021-session-model`. Reload, choose that named card through Level Select, open F1 editor,
assert/select the hierarchy warning, assert the full inspector explanation, and capture
`30-glb-placeholder.png`.

Run: `npx playwright test tests/editor-flow.ts --grep "explains session-only" --workers=1`

Expected: pass.

- [ ] **Step 8: Run GREEN GLB checks**

Run the three focused test files from Step 2. Expected: pass.

Run: `npx tsc`

Run scoped Biome on Task 3 TypeScript/CSS files with formatter disabled. Expected: no errors.

- [ ] **Step 9: Inspect evidence and commit the increment**

Inspect 29 and 30 for readable banner/Dismiss control, visible hierarchy warning, selected
row, and complete inspector copy. Then commit only Task 3 files and evidence:

```text
Explain session-only editor models
```

---

### Task 4: Real Chromium Journeys, Evidence, And Final Verification

**Files:**
- Verify: `tests/editor-flow.ts`
- Inspect: `docs/audits/evidence/28-editor-dirty.png`
- Inspect: `docs/audits/evidence/29-glb-session-banner.png`
- Inspect: `docs/audits/evidence/30-glb-placeholder.png`
- Modify only if final verification finds a KIN-021 defect: files from Tasks 1–3 and their focused tests

**Interfaces:**
- Consumes: the exact toolbar classes, debug API, banner copy, hierarchy marker, and inspector note from Tasks 1–3.
- Produces: deterministic browser proof and inspected evidence for every KIN-021 acceptance criterion.

- [ ] **Step 1: Audit the completed browser contract**

Read both new journeys and confirm they assert all save-trust, unload, overwrite, banner,
reload, hierarchy, inspector, and accessibility requirements from the spec. Confirm the
tests create evidence at paths 28–30 and that no test depends on another test's page context.

- [ ] **Step 2: Run the complete editor browser file serially**

Run: `npx playwright test tests/editor-flow.ts --workers=1`

Expected: every editor-flow test passes, including the pre-existing soft-brick and quota
regressions plus both KIN-021 journeys.

- [ ] **Step 3: Resolve only browser-discovered KIN-021 defects**

For each defect, add the smallest focused unit regression when the behavior can be isolated,
then patch the owning Task 1–3 boundary. Do not weaken waits or assertions to hide failures.

- [ ] **Step 4: Run the complete KIN-021 verification gate**

Run serially, without concurrent heavy work:

```text
npm run test
npx tsc
npx biome check --formatter-enabled=false <all KIN-021 changed TypeScript/CSS files>
npm run build
npx playwright test tests/editor-flow.ts --workers=1
```

Expected: all unit tests, typecheck, build, scoped Biome, and editor browser journeys pass.
Record the repository-wide lint baseline separately; do not clean unrelated findings.

- [ ] **Step 5: Inspect all evidence images**

Use image inspection on 28, 29, and 30. Confirm the dirty dot/title, readable banner and
Dismiss button, visible hierarchy warning, selected row, and complete inspector explanation.

- [ ] **Step 6: Commit final verification fixes only if needed**

If final verification required a production/test correction, commit only that scoped fix:

```text
Address KIN-021 verification findings
```

If no files changed, record the verification commands without creating an empty commit.

- [ ] **Step 7: Independent review and completion**

Generate one review package from the pre-Task-1 commit through HEAD. Dispatch a fresh
GPT-5.6 SOL final reviewer for both spec compliance and code quality. Resolve all Critical
and Important findings with focused tests and re-review. Record Minor findings explicitly.
After a clean review, update `tasks/todo.md` and `.superpowers/sdd/progress.md` with commits,
verification results, screenshot paths, skipped native-dialog UI, and remaining risks.
