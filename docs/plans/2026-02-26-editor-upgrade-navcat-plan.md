# Editor Upgrade + Navcat Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade Kinema's level editor with quick-brush placement, scene hierarchy, material editing, and polished dark-theme UI, then integrate navcat navigation mesh pathfinding as a showcase station.

**Architecture:** Modular panel system — each editor panel is a self-contained DOM class coordinated by a thin EditorManager. Vanilla TypeScript + DOM, EventBus communication. Navcat integrated as `src/navigation/` module with crowd simulation + debug overlay.

**Tech Stack:** Three.js WebGPU, Rapier physics, navcat (pathfinding), vanilla TS DOM panels

---

## Task 1: Install navcat + Create Foundation Files

**Files:**
- Modify: `package.json` — add navcat dependency
- Create: `src/editor/styles/editor.css` — dark theme stylesheet
- Create: `src/editor/panels/EditorPanel.ts` — base panel class
- Modify: `src/editor/EditorObject.ts` — extend data model

**Step 1: Install navcat**

```bash
npm install navcat
```

**Step 2: Create editor.css dark theme**

Create `src/editor/styles/editor.css` with all CSS classes for the dark floating-panel theme. Design tokens:
- Panel: `background: rgba(12, 16, 24, 0.88); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px`
- Text: `color: #c8d0dc`
- Accent: `#00bcd4` (Kinema cyan)
- Inputs: `background: rgba(255,255,255,0.08)`
- Buttons: pill-shaped, hover glow
- Scrollbar: thin, semi-transparent

Include classes for: `.ke-panel`, `.ke-toolbar`, `.ke-hierarchy`, `.ke-inspector`, `.ke-brush-bar`, `.ke-btn`, `.ke-btn-active`, `.ke-input`, `.ke-slider`, `.ke-color-picker`, `.ke-tree-row`, `.ke-tree-row-selected`, `.ke-section-header`, `.ke-context-menu`, `.ke-status-bar`.

**Step 3: Create EditorPanel base class**

Create `src/editor/panels/EditorPanel.ts`:
```typescript
export abstract class EditorPanel {
  protected container: HTMLDivElement;
  protected collapsed = false;
  protected visible = false;

  constructor(protected id: string, protected title: string) {
    this.container = document.createElement('div');
    this.container.className = `ke-panel ke-panel-${id}`;
    this.container.style.display = 'none';
  }

  show(): void { this.container.style.display = ''; this.visible = true; }
  hide(): void { this.container.style.display = 'none'; this.visible = false; }
  toggle(): void { this.visible ? this.hide() : this.show(); }
  toggleCollapse(): void { this.collapsed = !this.collapsed; this.onCollapse(this.collapsed); }
  getElement(): HTMLDivElement { return this.container; }

  abstract build(): void;
  abstract update(): void;
  protected onCollapse(_collapsed: boolean): void {}

  dispose(): void {
    this.container.remove();
  }
}
```

**Step 4: Extend EditorObject data model**

Modify `src/editor/EditorObject.ts` — add hierarchy, visibility, lock, and material fields:
```typescript
export interface EditorObject {
  id: string;
  name: string;
  mesh: THREE.Object3D;
  body?: RAPIER.RigidBody;
  collider?: RAPIER.Collider;
  source: { type: 'primitive' | 'glb' | 'sprite' | 'brush'; asset?: string; primitive?: string; brush?: string };
  transform: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };
  parentId: string | null;
  children: string[];
  visible: boolean;
  locked: boolean;
  material?: {
    color: string;
    roughness: number;
    metalness: number;
    emissive: string;
    emissiveIntensity: number;
    opacity: number;
  };
  brushParams?: Record<string, number>;
  physicsType: 'static' | 'dynamic' | 'kinematic';
}
```

**Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: Clean (no errors from new files since they're not imported yet)

**Step 6: Commit**

```bash
git add -A && git commit -m "feat(editor): add foundation - CSS theme, EditorPanel base, EditorObject model"
```

---

## Task 2: Brush System — Interface + Block/Floor/Pillar Brushes

**Files:**
- Create: `src/editor/brushes/Brush.ts` — brush interface
- Create: `src/editor/brushes/BlockBrush.ts`
- Create: `src/editor/brushes/FloorBrush.ts`
- Create: `src/editor/brushes/PillarBrush.ts`

**Step 1: Create Brush interface**

Create `src/editor/brushes/Brush.ts`:
```typescript
import * as THREE from 'three';

export interface BrushParams {
  anchor: THREE.Vector3;
  current: THREE.Vector3;
  normal: THREE.Vector3;
  height: number;
}

export interface BrushDefinition {
  id: string;
  label: string;
  shortcut: string;
  icon: string; // SVG path data

  /** Build preview geometry from current placement params */
  buildPreviewGeometry(params: BrushParams): THREE.BufferGeometry;

  /** Compute world transform for preview/final mesh */
  computeTransform(params: BrushParams): { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };

  /** Get default material for this brush */
  getDefaultMaterial(): THREE.MeshStandardMaterial;
}

export function snapValue(value: number, step: number): number {
  const s = Math.max(1e-6, Math.abs(step));
  return Math.round(value / s) * s;
}

export function computeRectFootprint(anchor: THREE.Vector3, current: THREE.Vector3): { width: number; depth: number; center: THREE.Vector3 } {
  const diff = current.clone().sub(anchor);
  const width = Math.max(0.1, Math.abs(diff.x));
  const depth = Math.max(0.1, Math.abs(diff.z));
  const center = anchor.clone().add(current).multiplyScalar(0.5);
  center.y = anchor.y;
  return { width, depth, center };
}
```

**Step 2: Create BlockBrush, FloorBrush, PillarBrush**

Each brush implements `BrushDefinition`. Block creates BoxGeometry, Floor creates thin BoxGeometry (height 0.1), Pillar creates CylinderGeometry. All use `computeRectFootprint` for positioning.

Pattern for BlockBrush:
```typescript
export const BlockBrush: BrushDefinition = {
  id: 'block', label: 'Block', shortcut: '1', icon: '...',
  buildPreviewGeometry(params) {
    const { width, depth } = computeRectFootprint(params.anchor, params.current);
    const h = Math.max(0.1, Math.abs(params.height));
    return new THREE.BoxGeometry(width, h, depth);
  },
  computeTransform(params) {
    const { center } = computeRectFootprint(params.anchor, params.current);
    const h = params.height;
    const position = center.clone();
    position.y += h / 2;
    return { position, quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) };
  },
  getDefaultMaterial() {
    return new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.7, metalness: 0 });
  },
};
```

**Step 3: Verify**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(editor): add brush system - Block, Floor, Pillar brushes"
```

---

## Task 3: Brush System — Stairs, Ramp, DoorFrame, Spawn, Trigger Brushes

**Files:**
- Create: `src/editor/brushes/StairsBrush.ts` — parametric stairs (stepCount, width, totalHeight)
- Create: `src/editor/brushes/RampBrush.ts` — inclined slope geometry
- Create: `src/editor/brushes/DoorFrameBrush.ts` — wall opening with frame (left pillar + right pillar + lintel)
- Create: `src/editor/brushes/SpawnBrush.ts` — gizmo-only marker (arrow mesh)
- Create: `src/editor/brushes/TriggerBrush.ts` — wireframe box (no collider)
- Create: `src/editor/brushes/index.ts` — registry of all brushes

**Key geometry patterns:**

StairsBrush: Generate N box steps stacked, each step = BoxGeometry merged via BufferGeometryUtils.mergeGeometries.

RampBrush: Custom geometry — a triangular prism (6 vertices, 8 triangles).

DoorFrameBrush: Three boxes merged — left pillar, right pillar, lintel. Opening ratio is configurable.

SpawnBrush: ConeGeometry pointing up (visual marker only, no physics).

TriggerBrush: BoxGeometry with wireframe material (EdgesGeometry + LineSegments).

**Brush registry** (`index.ts`):
```typescript
import { BlockBrush } from './BlockBrush';
// ... all brushes
export const BRUSH_REGISTRY: BrushDefinition[] = [BlockBrush, FloorBrush, PillarBrush, StairsBrush, RampBrush, DoorFrameBrush, SpawnBrush, TriggerBrush];
export function getBrushById(id: string): BrushDefinition | undefined { return BRUSH_REGISTRY.find(b => b.id === id); }
```

**Step: Verify + Commit**

Run: `npx tsc --noEmit` → clean
```bash
git add -A && git commit -m "feat(editor): add Stairs, Ramp, DoorFrame, Spawn, Trigger brushes"
```

---

## Task 4: ToolbarPanel — Top Floating Toolbar

**Files:**
- Create: `src/editor/panels/ToolbarPanel.ts`

**Design:** Floating dark pill at top-center with button groups:
- Group 1: [Save] [Load] [Undo] [Redo]
- Group 2: [Snap] [Grid]
- Group 3: [W] [E] [R] (translate/rotate/scale mode)

Each button uses `ke-btn` / `ke-btn-active` CSS classes. Toolbar emits events via callbacks passed in constructor.

**Interface:**
```typescript
export class ToolbarPanel extends EditorPanel {
  constructor(callbacks: {
    onSave: () => void;
    onLoad: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onToggleSnap: () => void;
    onToggleGrid: () => void;
    onSetMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  });

  setActiveMode(mode: string): void;
  setSnapActive(active: boolean): void;
  setGridActive(active: boolean): void;
}
```

Build DOM imperatively: `createElement('div')`, `className`, `textContent`, `addEventListener`. No framework.

**Verify + Commit**

---

## Task 5: BrushPanel — Bottom Floating Brush Bar

**Files:**
- Create: `src/editor/panels/BrushPanel.ts`

**Design:** Floating dark pill at bottom-center. Shows all 8 brushes as icon buttons. Active brush highlighted with accent border. Clicking a brush activates placement mode.

```typescript
export class BrushPanel extends EditorPanel {
  constructor(onBrushSelected: (brushId: string | null) => void);
  setActiveBrush(brushId: string | null): void;
}
```

Each brush button shows: SVG icon + label below. Active state: `ke-btn-active` with cyan left border.

**Verify + Commit**

---

## Task 6: HierarchyPanel — Scene Tree

**Files:**
- Create: `src/editor/panels/HierarchyPanel.ts`

**Design:** Left floating panel (width ~240px). Contains:
- Header: "Scene" label + object count
- Search filter input
- Scrollable tree of EditorObjects
- Each row: indent spacer + icon + name + hover actions (eye/lock icons)

**Key features:**
- Tree rows indented by depth (`paddingLeft = depth * 16`)
- Click row → select object → emit `editor:selectionChanged`
- Click eye icon → toggle visibility → `mesh.visible = !mesh.visible`
- Click lock icon → toggle lock → prevents selection
- Search input filters by name (case-insensitive substring match)
- Right-click → context menu: Rename, Delete, Duplicate, Group, Ungroup
- Drag row → reorder (set `parentId`, update `children[]`)

**Context menu:** Absolutely positioned div with `.ke-context-menu` class. Hidden by default, shown on right-click at mouse position. Dismissed on click-away.

```typescript
export class HierarchyPanel extends EditorPanel {
  constructor(callbacks: {
    onSelect: (id: string | null) => void;
    onDelete: (id: string) => void;
    onDuplicate: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onToggleVisible: (id: string) => void;
    onToggleLock: (id: string) => void;
    onReparent: (childId: string, newParentId: string | null) => void;
    onGroup: (ids: string[]) => void;
    onUngroup: (groupId: string) => void;
  });

  setObjects(objects: EditorObject[]): void;
  setSelection(id: string | null): void;
  update(): void;
}
```

**Verify + Commit**

---

## Task 7: InspectorPanel — Transform + Material Editor

**Files:**
- Create: `src/editor/panels/InspectorPanel.ts`

**Design:** Right floating panel (width ~280px). Two collapsible sections:

**Transform Section:**
- Header: "Transform" with collapse toggle
- Position X/Y/Z: number inputs (class `ke-input`, width ~70px each)
- Rotation X/Y/Z: number inputs (display in degrees)
- Scale X/Y/Z: number inputs
- Physics type: `<select>` dropdown (Static/Dynamic/Kinematic)

**Material Section:**
- Header: "Material" with collapse toggle
- Color: `<input type="color">` with hex display
- Roughness: `<input type="range" min="0" max="1" step="0.01">` with value display
- Metalness: same range slider pattern
- Emissive: color picker + intensity range slider
- Opacity: range slider 0-1

**Behavior:**
- Number inputs fire `onTransformChange` callback on `input` event (live updates)
- Material inputs fire `onMaterialChange` callback
- When no selection: shows "No selection" placeholder
- Physics dropdown fires `onPhysicsTypeChange`

```typescript
export class InspectorPanel extends EditorPanel {
  constructor(callbacks: {
    onTransformChange: (id: string, transform: {...}) => void;
    onMaterialChange: (id: string, material: {...}) => void;
    onPhysicsTypeChange: (id: string, type: string) => void;
  });

  setSelection(obj: EditorObject | null): void;
  update(): void;
}
```

**Verify + Commit**

---

## Task 8: Rewrite EditorManager — Slim Coordinator

**Files:**
- Modify: `src/editor/EditorManager.ts` — major rewrite

**Key changes:**

1. **Remove** old EditorUI, AssetBrowser references
2. **Add** panel instances: ToolbarPanel, BrushPanel, HierarchyPanel, InspectorPanel
3. **Add** brush placement state machine:
   - `placementPhase: 'idle' | 'position' | 'placed'`
   - `activeBrush: BrushDefinition | null`
   - `previewMesh: THREE.Mesh | null`
   - `placementAnchor: THREE.Vector3 | null`
4. **Add** placement workflow:
   - In `position` phase: raycast to ground, snap to grid, update preview mesh position
   - On click: create actual mesh + collider, push to undo stack, select it, return to `idle`
5. **Add** hierarchy operations: group/ungroup, reparent, rename, duplicate
6. **Add** material editing: apply material changes to selected mesh
7. **Wire** all panels to EditorManager callbacks
8. **Inject** editor.css stylesheet on first toggle

**Placement flow (simplified from three-maps — single click instead of multi-stage drag):**
1. User clicks brush in BrushPanel → `activeBrush` set, `placementPhase = 'position'`
2. Mouse move → raycast to floor → update preview mesh position (snapped)
3. Left click → create mesh at preview position with default size → auto-select → gizmo active
4. User adjusts via gizmo/inspector as needed
5. Right click or Escape → cancel placement

**CSS injection:**
```typescript
private injectStyles(): void {
  if (document.getElementById('ke-editor-styles')) return;
  const link = document.createElement('link');
  link.id = 'ke-editor-styles';
  link.rel = 'stylesheet';
  link.href = new URL('./styles/editor.css', import.meta.url).href;
  document.head.appendChild(link);
}
```

**Verify**: `npx tsc --noEmit` + `npx vite build` both clean

**Commit**

---

## Task 9: Upgrade LevelSerializer to v2 Format

**Files:**
- Modify: `src/editor/LevelSerializer.ts`

**Changes:**
1. Update `LevelData` interface to v2 (add `parentId`, `material`, `brushParams`, `physicsType`)
2. Add `upgradeLevelData(data)` — auto-converts v1 → v2 on load
3. Serialize material properties from MeshStandardMaterial
4. Serialize brush params for brush-sourced objects
5. On load: recreate materials from saved properties, set physics types

**v2 format** (as described in design doc):
```typescript
export interface LevelDataV2 {
  version: 2;
  name: string;
  created: string;
  modified: string;
  spawnPoint: { position: [number, number, number] };
  objects: SerializedObjectV2[];
}

export interface SerializedObjectV2 {
  id: string;
  name: string;
  parentId: string | null;
  source: { type: 'primitive' | 'glb' | 'sprite' | 'brush'; asset?: string; primitive?: string; brush?: string };
  transform: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };
  physics: { type: 'static' | 'dynamic' | 'kinematic' };
  material?: { color: string; roughness: number; metalness: number; emissive: string; emissiveIntensity: number; opacity: number };
  brushParams?: Record<string, number>;
}
```

**Verify + Commit**

---

## Task 10: Delete Old EditorUI + AssetBrowser

**Files:**
- Delete: `src/editor/EditorUI.ts`
- Delete: `src/editor/AssetBrowser.ts`
- Modify: `src/editor/EditorManager.ts` — remove imports to deleted files

The old UI/AssetBrowser are fully replaced by the new panel system. Clean up any remaining references.

**Verify**: `npx tsc --noEmit` + `npx vite build` clean

**Commit**

---

## Task 11: NavMeshManager + NavAgent

**Files:**
- Create: `src/navigation/NavMeshManager.ts`
- Create: `src/navigation/NavAgent.ts`

**NavMeshManager:**
```typescript
import { generateSoloNavMesh } from 'navcat/blocks';
import { getPositionsAndIndices, createNavMeshHelper } from 'navcat/three';

export class NavMeshManager {
  private navMesh: NavMesh | null = null;
  private debugHelper: { object: THREE.Object3D; dispose: () => void } | null = null;

  generate(meshes: THREE.Mesh[]): void {
    const [positions, indices] = getPositionsAndIndices(meshes);
    const result = generateSoloNavMesh({ positions, indices }, {
      cellSize: 0.15, cellHeight: 0.15,
      walkableRadiusVoxels: 1, walkableRadiusWorld: 0.15,
      walkableClimbVoxels: 4, walkableClimbWorld: 0.6,
      walkableHeightVoxels: 10, walkableHeightWorld: 1.5,
      walkableSlopeAngleDegrees: 45,
      borderSize: 4, minRegionArea: 8, mergeRegionArea: 20,
      maxSimplificationError: 1.3, maxEdgeLength: 12, maxVerticesPerPoly: 5,
      detailSampleDistance: 0.9, detailSampleMaxError: 0.15,
    });
    this.navMesh = result.navMesh;
  }

  getNavMesh(): NavMesh | null { return this.navMesh; }

  toggleDebug(scene: THREE.Scene): void { /* create/remove navmesh wireframe overlay */ }

  dispose(): void { /* cleanup */ }
}
```

**NavAgent:**
```typescript
export class NavAgent {
  readonly mesh: THREE.Mesh; // Orange capsule
  private agentId: number;
  private targetPosition: THREE.Vector3 | null = null;
  private pathLine: THREE.Line | null = null;

  constructor(scene: THREE.Scene, position: THREE.Vector3) {
    // Create capsule mesh with orange material
    // Add to scene
  }

  setTarget(position: THREE.Vector3): void { this.targetPosition = position.clone(); }

  updateVisual(): void {
    // Sync mesh position to crowd agent position
    // Update path line visualization
  }

  dispose(scene: THREE.Scene): void { /* cleanup */ }
}
```

**Verify + Commit**

---

## Task 12: NavPatrolSystem + NavDebugOverlay

**Files:**
- Create: `src/navigation/NavPatrolSystem.ts`
- Create: `src/navigation/NavDebugOverlay.ts`

**NavPatrolSystem:**
- Creates crowd via `crowd.create()`
- Spawns 4-6 NavAgents at random walkable positions via `findRandomPoint()`
- Each agent given patrol waypoints — when reaching target, picks new random point
- `update(dt)` calls `crowd.update()`, then updates each NavAgent visual
- Handles agent targeting: `requestMoveTarget()` on the crowd

**NavDebugOverlay:**
- Creates navmesh wireframe visualization via `createNavMeshHelper()`
- Shows/hides on N key press
- Optional: show path lines for each agent

**Verify + Commit**

---

## Task 13: Integrate Navcat into LevelManager

**Files:**
- Modify: `src/level/LevelManager.ts` — add navcat showcase station
- Modify: `src/level/ShowcaseLayout.ts` — update futureA label
- Modify: `src/Game.ts` — wire NavPatrolSystem update

**Changes to LevelManager:**
1. Add `private navPatrolSystem: NavPatrolSystem | null = null`
2. In `buildProceduralLevel()`, after creating the corridor floor, add a `createNavcatBay()` method at `futureA` station (Z=-240)
3. `createNavcatBay()`:
   - Creates platform/signage for the station
   - Collects floor meshes within the station area
   - Instantiates `NavMeshManager`, generates navmesh from floor geometry
   - Instantiates `NavPatrolSystem` with 5 agents
4. In `fixedUpdate()`: update navPatrolSystem
5. In `unload()`: dispose navPatrolSystem

**Changes to ShowcaseLayout:**
- Rename `futureA` to `navigation` (update label text)

**Changes to Game.ts:**
- Pass navPatrolSystem update through the game loop

**Input handling:**
- N key → toggle navmesh debug overlay
- T key → enter target mode (click floor to redirect nearest agent)

**Verify**: `npx tsc --noEmit` + `npx vite build` clean

**Commit**

---

## Task 14: Browser Verification — Editor

**Steps:**
1. Add temporary `__kinema` debug global to main.ts
2. Navigate to `http://localhost:5174`
3. Click Play to load level
4. Press F1 to open editor
5. Verify:
   - Dark floating toolbar at top
   - Brush bar at bottom
   - Hierarchy panel at left (populated with level objects)
   - Inspector at right (shows transform when object selected)
6. Click a brush → verify ghost preview follows mouse
7. Click to place → verify object appears with collider
8. Select placed object → verify transform gizmo + inspector update
9. Change material color → verify mesh updates
10. Save level → verify JSON download
11. Take screenshots of each state

---

## Task 15: Browser Verification — Navcat

**Steps:**
1. Navigate to navcat station (Z=-240)
2. Verify: 4-6 orange capsule agents patrolling
3. Press N → verify navmesh wireframe overlay appears
4. Press T → click floor → verify nearest agent redirects to clicked position
5. Verify agents avoid each other (crowd simulation)
6. Take screenshots

---

## Task 16: Cleanup + Delete References

**Steps:**
1. Remove `__kinema` debug global from main.ts
2. Run `npx tsc --noEmit` — clean
3. Run `npx vite build` — clean
4. Delete `D:\Github\Kinema\refrences\` directory (three-maps + navcat)
5. Final commit

```bash
rm -rf D:/Github/Kinema/refrences
git add -A && git commit -m "feat: editor upgrade + navcat integration complete, remove references"
```
