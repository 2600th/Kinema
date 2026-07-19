# KIN-022 Reversible Editor Mutations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every editor mutation undoable, make delete subtree-safe, preserve the live editor camera/document across F1, and rebuild colliders only for effective-scale changes.

**Architecture:** Typed command builders capture immutable before/after state and call a narrow mutation host implemented by `EditorManager`. `EditorDocument` owns deterministic hierarchy snapshots; `EditorManager` owns Three/Rapier/LevelManager transactions. Preview stays outside history and one commit enters history.

**Tech Stack:** TypeScript 5.9, Three.js 0.183, Rapier 0.19, Vitest 4, Playwright, Biome, Vite 8.

## Global Constraints

- Preserve `LevelDataV2`, KIN-021 load/dirty/resource guarantees, and existing undoable actions.
- Failed/no-op execute, undo, or redo must not change history stacks or dirty state.
- Preserve exact local transforms, document/sibling order, hierarchy arrays, material heterogeneity, selection, physics, and LevelManager tracking.
- Preview never creates history or collider descriptors; commits occur once at explicit panel/gizmo boundaries.
- Plain F1 retains live object identities and history; genuine loads and playtest reconstruction clear stale history.
- Do not add dependencies or modify the level serialization schema.
- Run browser tests serially and restore nondeterministic evidence rewrites before each commit.

---

### Task 1: Add Reversible Command State And History Finalization

**Files:**
- Create: `src/editor/EditorCommands.ts`
- Create: `src/editor/EditorCommands.test.ts`
- Modify: `src/editor/CommandHistory.ts`
- Modify: `src/editor/CommandHistory.test.ts`

**Interfaces:**
- Produces `EditorTransformState`, `EditorMaterialState`, `EditorMutationHost`, `CommandBuildResult`, and `createStateCommand`.
- Extends `Command` with optional `discard(): void` used by later detached-resource commands.

- [ ] **Step 1: Write RED history-finalization tests**

```ts
it("discards applied commands on eviction and redo invalidation", () => {
  const discarded: string[] = [];
  const history = new CommandHistory();
  for (let index = 0; index < 51; index += 1) {
    history.push({ execute: () => true, undo: () => true, discard: () => discarded.push(String(index)) });
  }
  expect(discarded).toEqual(["0"]);
  history.undo();
  history.push({ execute: () => true, undo: () => true });
  expect(discarded).toContain("50");
});

it("isolates discard exceptions while clearing both stacks", () => {
  const history = new CommandHistory();
  history.push({ execute: () => true, undo: () => true, discard: () => { throw new Error("boom"); } });
  history.undo();
  expect(() => history.clear()).not.toThrow();
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/editor/CommandHistory.test.ts`

Expected: discard assertions fail because `Command` and `CommandHistory` have no cleanup lifecycle.

- [ ] **Step 3: Implement discard-safe history lifecycle**

```ts
export interface Command {
  execute(): void | boolean;
  undo(): void | boolean;
  discard?(): void;
}

private discard(command: Command): void {
  try { command.discard?.(); }
  catch (error) { console.error("[Editor] Command cleanup failed:", error); }
}
```

Call `discard` for the evicted oldest undo entry, every invalidated redo entry after a successful push, and both stacks during `clear()`. Do not discard after failed execute/undo/redo.

- [ ] **Step 4: Write RED generic command-builder tests**

```ts
it("applies immutable before and after state", () => {
  const applied: EditorTransformState[] = [];
  const before = freezeTransform([0, 0, 0], [0, 0, 0], [1, 1, 1]);
  const after = freezeTransform([1, 2, 3], [0, 1, 0], [2, 2, 2]);
  const command = createStateCommand(before, after, (state) => { applied.push(state); return true; });
  expect(command.execute()).toBe(true);
  expect(command.undo()).toBe(true);
  expect(applied).toEqual([after, before]);
});
```

- [ ] **Step 5: Implement immutable state types and builder**

```ts
export type EditorTransformState = Readonly<{
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: readonly [number, number, number];
}>;

export function createStateCommand<T>(before: T, after: T, apply: (value: T) => boolean): Command {
  return { execute: () => apply(after), undo: () => apply(before) };
}
```

Add the typed host/build-result contracts from the design without Three/Rapier imports.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run src/editor/CommandHistory.test.ts src/editor/EditorCommands.test.ts && npx tsc`

Expected: all focused tests pass.

Commit:

```powershell
git add src/editor/CommandHistory.ts src/editor/CommandHistory.test.ts src/editor/EditorCommands.ts src/editor/EditorCommands.test.ts
git commit -m "Add reversible editor command state"
```

---

### Task 2: Make Delete Subtree-Safe And Finalizable

**Files:**
- Modify: `src/editor/EditorDocument.ts`
- Create: `src/editor/EditorDocument.subtree.test.ts`
- Modify: `src/editor/EditorCommands.ts`
- Modify: `src/editor/EditorCommands.test.ts`
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/EditorManager.test.ts`

**Interfaces:**
- Produces `EditorSubtreeNodeSnapshot`, `EditorSubtreeSnapshot`, `captureSubtree`, `removeSubtree`, and `restoreSubtree`.
- Produces `buildDeleteSubtreeCommand(host, rootId)` and consumes `Command.discard()`.

- [ ] **Step 1: Write RED deterministic subtree tests**

```ts
it("captures parent-first and removes leaf-first without dangling parents", () => {
  const { document, root, child, grandchild, sibling } = buildDeepDocument();
  const snapshot = document.captureSubtree(root.id);
  expect(snapshot?.nodes.map((node) => node.object.id)).toEqual([root.id, child.id, grandchild.id]);
  expect(document.removeSubtree(snapshot!)).toBe(true);
  expect(document.objects.map((object) => object.id)).toEqual([sibling.id]);
  expect(document.objects.every((object) => object.parentId === null || document.findById(object.parentId))).toBe(true);
});

it("restores exact order, local transforms, and child arrays", () => {
  const before = projectDocument(document);
  const snapshot = document.captureSubtree(root.id)!;
  document.removeSubtree(snapshot);
  document.restoreSubtree(snapshot);
  expect(projectDocument(document)).toEqual(before);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/editor/EditorDocument.subtree.test.ts`

Expected: missing subtree methods.

- [ ] **Step 3: Implement iterative subtree primitives**

```ts
export interface EditorSubtreeNodeSnapshot {
  object: EditorObject;
  documentIndex: number;
  parentId: string | null;
  children: readonly string[];
  localTransform: EditorTransformState;
}

captureSubtree(rootId: string): EditorSubtreeSnapshot | null {
  const root = this.findById(rootId);
  if (!root) return null;
  const queue = [root];
  const nodes: EditorSubtreeNodeSnapshot[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const object = queue[index]!;
    nodes.push(snapshotNode(object, this.objects.indexOf(object)));
    for (const child of this.objects) if (child.parentId === object.id) queue.push(child);
  }
  return freezeSubtree(root, nodes);
}
```

Removal filters all captured IDs, removes the root from its external parent, and leaves internal Three parenting intact. Restore inserts entries by original index, applies exact local TRS/arrays, and uses `externalParent.add(root.mesh)`.

- [ ] **Step 4: Write RED manager transaction tests**

Test mixed static/dynamic nodes, per-node `RemovedLevelObjectTracking`, selected descendant, mid-remove failure, mid-restore failure, redo, and discard while applied versus undone.

```ts
expect(manager.deleteSubtree(root.id)).toBe(true);
expect(levelManager.getLevelObjects()).not.toContain(root.mesh);
expect(history.undo()).toBe(true);
expect(projectManager(manager)).toEqual(before);
expect(history.redo()).toBe(true);
history.clear();
expect(removeBody).toHaveBeenCalledTimes(physicsNodeCount);
```

- [ ] **Step 5: Implement delete command and manager host transaction**

Capture each node's tracking before leaf-first `removeLevelObject`. Disable retained bodies/colliders rather than destroy while the command is undoable. Undo restores document entries, tracking parent-first, enables physics, pose-syncs without collider rebuild, then publishes UI/events. `discard()` destroys retained physics only when the deletion is currently applied.

- [ ] **Step 6: Replace both delete entry points**

Route `deleteById` and Delete-key `deleteSelection` through `buildDeleteSubtreeCommand`; remove the old single-object command.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run src/editor/EditorDocument.subtree.test.ts src/editor/EditorCommands.test.ts src/editor/EditorManager.test.ts && npx tsc`

Commit:

```powershell
git add src/editor/EditorDocument.ts src/editor/EditorDocument.subtree.test.ts src/editor/EditorCommands.ts src/editor/EditorCommands.test.ts src/editor/EditorManager.ts src/editor/EditorManager.test.ts
git commit -m "Make editor deletion subtree-safe"
```

---

### Task 3: Route Scalar And Material Edits Through History

**Files:**
- Modify: `src/editor/EditorCommands.ts`
- Modify: `src/editor/EditorCommands.test.ts`
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/EditorManager.test.ts`
- Modify: `src/editor/panels/InspectorPanel.ts`
- Modify: `src/editor/panels/InspectorPanel.test.ts`

**Interfaces:**
- Produces rename, visibility, lock, and material commands.
- Material callback becomes `(id, state, phase: "preview" | "commit") => void`.

- [ ] **Step 1: Write RED scalar command round-trip tests**

```ts
for (const command of [rename, visibility, lock]) {
  expect(history.push(command)).toBe(true);
  expect(projectObject(target)).toEqual(command.afterProjection);
  expect(history.undo()).toBe(true);
  expect(projectObject(target)).toEqual(command.beforeProjection);
  expect(history.redo()).toBe(true);
}
```

Assert explicit values, selection restoration for hide/lock, no-op rejection, and one dirty notification per successful history boundary.

- [ ] **Step 2: Implement scalar builders and host methods**

Builders use `createStateCommand`. Host methods set exact name/visible/locked values, synchronize selection/gizmo/inspector, then hierarchy UI.

- [ ] **Step 3: Write RED heterogeneous-material preview/commit tests**

```ts
fireEvent.input(color, { target: { value: "#ff0000" } });
fireEvent.input(color, { target: { value: "#00ff00" } });
fireEvent.change(color);
expect(onMaterialChange.mock.calls.filter(([, , phase]) => phase === "commit")).toHaveLength(1);
```

Manager tests use two child materials with different original colors/roughness/transparent flags and prove undo restores each exact material plus `EditorObject.material`.

- [ ] **Step 4: Generalize inspector preview/commit binder**

```ts
bindEditEvents(input, preview, commit): void {
  input.addEventListener("input", preview);
  input.addEventListener("change", commitOnce);
  input.addEventListener("blur", commitOnce);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") commitOnce(); });
}
```

Use a pending-edit token so change/blur/Enter/pointer release does not duplicate a command.

- [ ] **Step 5: Implement exact material command**

Capture a deduplicated array of live `MeshStandardMaterial` snapshots including color, roughness,
metalness, emissive, emissiveIntensity, opacity, and transparent. Preview applies without history or dirty. Commit captures after, restores before, and pushes one command.

- [ ] **Step 6: Route callbacks and pending-edit boundaries**

Commit on normal selection change/save/playtest; cancel before destructive load and manager dispose. Route hierarchy rename/visibility/lock callbacks through history.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run src/editor/EditorCommands.test.ts src/editor/EditorManager.test.ts src/editor/panels/InspectorPanel.test.ts && npx tsc`

Commit:

```powershell
git add src/editor/EditorCommands.ts src/editor/EditorCommands.test.ts src/editor/EditorManager.ts src/editor/EditorManager.test.ts src/editor/panels/InspectorPanel.ts src/editor/panels/InspectorPanel.test.ts
git commit -m "Route editor property edits through history"
```

---

### Task 4: Make Transform And Physics-Type Commands Transactional

**Files:**
- Modify: `src/editor/EditorCommands.ts`
- Modify: `src/editor/EditorCommands.test.ts`
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/EditorManager.test.ts`
- Modify: `src/editor/EditorPhysicsSync.ts`
- Modify: `src/editor/EditorPhysicsSync.test.ts`

**Interfaces:**
- Produces `buildSetTransformCommand` and `buildSetPhysicsTypeCommand`.
- Transform host accepts a collider-rebuild predicate supplied in Task 6; use exact-scale comparison until then.

- [ ] **Step 1: Write RED inspector/gizmo transform history tests**

Preview three transforms, commit once, undo/redo exact local tuples and body pose. Inject collider replacement failure and assert transform, serialized state, physics, history, and dirty remain before.

```ts
manager.previewTransform(after);
expect(onMutation).not.toHaveBeenCalled();
manager.commitTransform(after);
expect(onMutation).toHaveBeenCalledOnce();
expect(history.undo()).toBe(true);
expect(snapshotTransform(target)).toEqual(before);
```

- [ ] **Step 2: Implement one transform command path**

Inspector commit and gizmo drag end both capture after, restore before, pose-sync, then push
`buildSetTransformCommand`. Execute/undo call the existing atomic `applyTransform` and propagate
`false` to CommandHistory.

- [ ] **Step 3: Write RED physics-type replacement tests**

Cover static→dynamic→undo→redo; allocation, collider, LevelManager publication, and old-resource retirement failures. Assert old handles/tracking survive failure and replacements are removed once.

- [ ] **Step 4: Implement atomic physics snapshots and command**

Build replacement body/collider and tracking before retiring current resources. Publish object and LevelManager references together; on failure restore current state and destroy replacement. Undo/redo recreate from the snapshot recipe, never reuse removed handles.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/editor/EditorCommands.test.ts src/editor/EditorManager.test.ts src/editor/EditorPhysicsSync.test.ts && npx tsc`

Commit:

```powershell
git add src/editor/EditorCommands.ts src/editor/EditorCommands.test.ts src/editor/EditorManager.ts src/editor/EditorManager.test.ts src/editor/EditorPhysicsSync.ts src/editor/EditorPhysicsSync.test.ts
git commit -m "Make editor transform and physics edits reversible"
```

---

### Task 5: Make Hierarchy Edits Reversible

**Files:**
- Modify: `src/editor/EditorCommands.ts`
- Modify: `src/editor/EditorCommands.test.ts`
- Modify: `src/editor/EditorDocument.ts`
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/EditorManager.test.ts`

**Interfaces:**
- Produces reparent, group, and ungroup commands with exact hierarchy snapshots.

- [ ] **Step 1: Write RED reparent tests**

Assert execute/undo/redo preserve document order, complete parent child arrays, exact local/world
transforms, selection, and physics pose. Reject self/cycle/shear/no-op without history or dirty.

- [ ] **Step 2: Implement deterministic hierarchy apply**

Capture affected parents' complete child arrays and the child's before/after parent/local TRS. Replay
with `parent.add(mesh)` and exact local values. Validate the initially derived after-state with the
KIN-021 attachment policy.

- [ ] **Step 3: Write RED group/ungroup identity tests**

```ts
const groupId = executeGroup();
history.undo();
history.redo();
expect(document.findById(groupId)).toBe(originalGroupObject);
expect(projectDocument(document)).toEqual(afterGroupProjection);
```

Cover multiple parents, selected group/child, child ordering, LevelManager registration, and failure rollback.

- [ ] **Step 4: Implement group/ungroup commands**

Create the group object once during command construction; retain its identity while undoable. Capture exact before/after topology and replay it. `discard()` finalizes only a detached group owned by the command.

- [ ] **Step 5: Route hierarchy callbacks and verify**

Run: `npx vitest run src/editor/EditorCommands.test.ts src/editor/EditorManager.test.ts src/editor/EditorDocument.test.ts && npx tsc`

Commit:

```powershell
git add src/editor/EditorCommands.ts src/editor/EditorCommands.test.ts src/editor/EditorDocument.ts src/editor/EditorManager.ts src/editor/EditorManager.test.ts
git commit -m "Make editor hierarchy edits reversible"
```

---

### Task 6: Rebuild Colliders Only For Effective Scale Changes

**Files:**
- Modify: `src/editor/EditorPhysicsSync.ts`
- Modify: `src/editor/EditorPhysicsSync.test.ts`
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/EditorManager.test.ts`
- Modify: `src/core/KinemaDebugApi.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Atomic sync consumes `shouldRebuildCollider(entry, nextPose)`.
- DEV API produces `{ poseSyncs, colliderDescriptorBuilds, colliderReplacements }` counters.

- [ ] **Step 1: Write RED per-entry rebuild tests**

```ts
expect(commitTranslation()).toEqual({ poseSyncs: 2, colliderDescriptorBuilds: 0, colliderReplacements: 0 });
expect(commitRotation()).toEqual({ poseSyncs: 2, colliderDescriptorBuilds: 0, colliderReplacements: 0 });
expect(commitScale()).toEqual({ poseSyncs: 2, colliderDescriptorBuilds: 2, colliderReplacements: 2 });
```

Test parent scale affects descendants, unchanged local scale with changed effective world scale, negative-scale sign flip, objects without colliders, and rollback.

- [ ] **Step 2: Implement effective-scale comparison**

```ts
export function effectiveScaleChanged(before: THREE.Vector3, after: THREE.Vector3, epsilon = 1e-6): boolean {
  return Math.abs(before.x - after.x) > epsilon ||
    Math.abs(before.y - after.y) > epsilon ||
    Math.abs(before.z - after.z) > epsilon;
}
```

Capture each subtree object's world scale before target application and compare with next pose during atomic preparation. Always pose-sync; prepare descriptors only for changed entries.

- [ ] **Step 3: Add counters and debug hooks**

Counters increment at actual body sync, descriptor construction, and successful replacement. Expose reset/get methods only on the existing development API.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/editor/EditorPhysicsSync.test.ts src/editor/EditorManager.test.ts && npx tsc`

Commit:

```powershell
git add src/editor/EditorPhysicsSync.ts src/editor/EditorPhysicsSync.test.ts src/editor/EditorManager.ts src/editor/EditorManager.test.ts src/core/KinemaDebugApi.ts src/main.ts
git commit -m "Avoid unnecessary editor collider rebuilds"
```

---

### Task 7: Preserve Live Document And Camera Across F1

**Files:**
- Modify: `src/editor/FreeCamera.ts`
- Create: `src/editor/FreeCamera.test.ts`
- Modify: `src/editor/EditorManager.ts`
- Modify: `src/editor/EditorManager.test.ts`
- Modify: `src/core/KinemaDebugApi.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces `FreeCameraPose`, `capturePose`, `restorePose`, `syncOrientationFromCamera`.
- Manager owns `editorCameraPose` and `documentNeedsRebuild`.

- [ ] **Step 1: Write RED camera unit tests**

```ts
const pose = camera.capturePose();
runtimeCamera.position.set(99, 99, 99);
camera.restorePose(pose);
expect(runtimeCamera.position.toArray()).toEqual(pose.position);
expect(runtimeCamera.quaternion.toArray()).toEqual(pose.quaternion);
```

Assert returned pose is cloned, repeated cycles are exact, and orientation sync does not add listeners.

- [ ] **Step 2: Implement explicit FreeCamera pose API**

```ts
capturePose(): FreeCameraPose { return freezePose(this.camera.position, this.camera.quaternion); }
restorePose(pose: FreeCameraPose): void { this.camera.position.fromArray(pose.position); this.camera.quaternion.fromArray(pose.quaternion); this.syncOrientationFromCamera(); }
syncOrientationFromCamera(): void { const e = _fcEnableEuler.setFromQuaternion(this.camera.quaternion, "YXZ"); this.pitch = e.x; this.yaw = e.y; }
```

- [ ] **Step 3: Write RED manager lifecycle tests**

Plain exit/enter retains pose, object identity, hierarchy arrays, lock/visibility, selection-safe state, and history. Genuine `level:loaded` resets pose and marks document stale. Playtest uses the same pose path.

- [ ] **Step 4: Implement manager pose and document-stale gates**

Capture before gameplay resumes in `exit`. Restore before `freeCamera.enable` in `enter`. Replace focus disable/enable with orientation sync. Remove duplicate playtest camera state. Rebuild wrappers only when `documentNeedsRebuild`; reconstruct hierarchy metadata from the tracked Three scene on required scans.

- [ ] **Step 5: Add development pose/snapshot hooks and verify**

Run: `npx vitest run src/editor/FreeCamera.test.ts src/editor/EditorManager.test.ts && npx tsc`

Commit:

```powershell
git add src/editor/FreeCamera.ts src/editor/FreeCamera.test.ts src/editor/EditorManager.ts src/editor/EditorManager.test.ts src/core/KinemaDebugApi.ts src/main.ts
git commit -m "Preserve editor workspace across toggles"
```

---

### Task 8: Add Browser And Performance Proof

**Files:**
- Modify: `tests/editor-flow.ts`
- Modify: `docs/audits/evidence/frame-baseline.md`
- Modify: `tasks/todo.md` (ignored task state only)
- Modify: `.superpowers/sdd/progress.md` (ignored progress state only)

**Interfaces:**
- Consumes editor projection, camera setter, and physics counters from Tasks 6–7.

- [ ] **Step 1: Add RED real-browser journey**

Use a valid authored root→child→grandchild fixture plus sibling. Through real hierarchy/inspector controls:

```ts
await editMaterialAndCommit(page, "#ff3366");
await page.keyboard.press("Control+Z");
expect(await getSelectedMaterial(page)).toEqual(originalMaterial);

await deleteHierarchyRow(page, "Root");
expect(await getEditorSnapshot(page)).toExcludeIds([rootId, childId, grandchildId]);
await page.keyboard.press("Control+Z");
expect(await getEditorSnapshot(page)).toEqual(beforeDelete);
await page.keyboard.press("Control+Y");

await setEditorCameraPose(page, expectedPose);
await page.keyboard.press("F1");
await page.keyboard.press("F1");
expect(await page.evaluate(() => window.__KINEMA__.getCameraPose())).toEqual(expectedPose);
```

Also save after deletion and assert no dangling `parentId` in the stored projection.

- [ ] **Step 2: Run RED browser journey serially**

Run: `npx playwright test tests/editor-flow.ts --grep "undoes every editor mutation" --workers=1`

Expected: failure at the first missing command/debug boundary before implementation integration is complete.

- [ ] **Step 3: Make only test-boundary integration fixes**

Correct selectors/debug typing or lifecycle waits; do not weaken assertions or bypass real UI mutation entry points.

- [ ] **Step 4: Record deterministic physics counter proof**

For translate, rotate, and scale scripted drags, reset counters before drag and assert:

```ts
expect(translate).toMatchObject({ colliderDescriptorBuilds: 0, colliderReplacements: 0 });
expect(rotate).toMatchObject({ colliderDescriptorBuilds: 0, colliderReplacements: 0 });
expect(scale.colliderReplacements).toBe(changedEffectiveScaleColliderCount);
```

- [ ] **Step 5: Record headed hardware performance evidence when available**

Use the same authored fixture and five repetitions per transform. Capture 600-frame KIN-001 windows and record p50, p95, max, longFrames, and release counter deltas in `frame-baseline.md`. If true WebGPU hardware remains unavailable, explicitly record the environment gap and do not present headless WebGL2 timing as representative.

- [ ] **Step 6: Run the full verification gate**

```powershell
npm run test
npx tsc
npx biome check --formatter-enabled=false --max-diagnostics=250 <all-touched-src-and-test-files>
npm run build
npx playwright test tests/editor-flow.ts --workers=1
```

Expected: units, typecheck, scoped Biome, build, and the KIN-022 browser journey pass. Preserve the known unrelated full editor-flow soft-brick/Tone baseline separately if it remains.

- [ ] **Step 7: Request final independent GPT-5.6 SOL review**

Generate an SDD review package for the entire KIN-022 range. Resolve every Critical/Important finding with RED/GREEN tests and repeat review until zero findings.

- [ ] **Step 8: Update durable state and commit browser proof**

```powershell
git add tests/editor-flow.ts docs/audits/evidence/frame-baseline.md
git commit -m "Verify KIN-022 editor workflows"
```

Mark `tasks/todo.md` DONE and append final commits, verification, risks, and environment-only gaps to `.superpowers/sdd/progress.md`.

## Plan Self-Review

- Spec coverage: all KIN-022 command rows, subtree delete, camera persistence, live-document F1 state,
  and scale-selective collider behavior map to Tasks 1–8.
- Placeholder scan: no TBD/TODO/"implement later" steps remain.
- Type consistency: state, host, subtree, pose, and counter names are defined before consumption.
- Scope: no multi-select, drag-to-size, primitive palette, schema, dependency, or unrelated renderer work.
