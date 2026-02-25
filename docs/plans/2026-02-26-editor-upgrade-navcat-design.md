# Editor Upgrade + Navcat Integration Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade Kinema's level editor with quick-brush placement, scene hierarchy, material editing, and polished dark-theme UI (inspired by three-maps reference), then integrate navcat navigation mesh pathfinding as a showcase station.

**Architecture:** Modular panel system — each editor panel is a self-contained class coordinated by a thin EditorManager. Vanilla TypeScript + DOM, EventBus communication. Navcat integrated as a new `src/navigation/` module with crowd simulation + debug overlay.

**Tech Stack:** Three.js WebGPU, Rapier physics, navcat (pathfinding), vanilla TS DOM panels

---

## 1. Architecture & File Structure

### Editor Modules

```
src/editor/
├── EditorManager.ts          ← Slim coordinator (rewrite)
├── EditorObject.ts           ← Extended with hierarchy fields
├── panels/
│   ├── EditorPanel.ts        ← Base class (DOM container, show/hide/collapse)
│   ├── ToolbarPanel.ts       ← Top bar: mode, tools, file ops
│   ├── HierarchyPanel.ts     ← Scene tree with drag/drop
│   ├── InspectorPanel.ts     ← Transform + Material editing
│   └── BrushPanel.ts         ← Bottom bar: parametric shapes
├── brushes/
│   ├── Brush.ts              ← Base brush interface
│   ├── CubeBrush.ts          ← Walls, platforms, ceilings, cover
│   ├── CylinderBrush.ts      ← Columns, barrels, obstacles
│   ├── StairsBrush.ts        ← Parametric staircase
│   ├── DoorBrush.ts          ← Wall opening with frame
│   ├── RampBrush.ts          ← Inclined slope
│   ├── FloorBrush.ts         ← Thin walkable surfaces
│   ├── SpawnBrush.ts         ← Spawn point marker (no geometry)
│   └── TriggerBrush.ts       ← Invisible trigger volume
├── TransformGizmo.ts         ← Keep existing
├── FreeCamera.ts             ← Keep existing
├── CommandHistory.ts         ← Keep existing
├── LevelSerializer.ts        ← Upgrade to v2 format
├── SnapGrid.ts               ← Keep existing
└── styles/
    └── editor.css             ← Dark theme styles
```

### Navigation Modules

```
src/navigation/
├── NavMeshManager.ts         ← Generate + hold navmesh from floor geometry
├── NavAgent.ts               ← Single AI agent (capsule mesh + crowd agent)
├── NavPatrolSystem.ts        ← Patrol waypoints + agent update loop
└── NavDebugOverlay.ts        ← Wireframe navmesh + path visualization
```

### Communication

Panels communicate via existing EventBus:
- `editor:selectionChanged` — when user selects object
- `editor:objectAdded` / `editor:objectRemoved` — brush placement / delete
- `editor:hierarchyChanged` — reparenting, grouping
- `editor:materialChanged` — material property edits
- `editor:brushSelected` — brush mode activated

## 2. Quick Brush System

### Available Brushes

| Brush | Purpose | Parameters |
|-------|---------|------------|
| Block | Walls, platforms, ceilings, cover | width, height, depth |
| Floor | Walkable ground surfaces | width, depth (thin) |
| Stairs | Vertical traversal | width, stepCount, totalHeight |
| Ramp | Smooth inclined surfaces | width, depth, rise |
| Pillar | Columns, barrels, obstacles | radius, height, sides |
| Door Frame | Wall opening w/ frame | width, height, thickness |
| Spawn Point | Player spawn marker | (no geometry — gizmo only) |
| Trigger Zone | Invisible trigger volume | width, height, depth |

### Placement Workflow

1. Select brush from bottom bar (or press 1-8)
2. Move mouse — ghost preview snaps to grid on ground plane
3. Click to place at that position
4. Object immediately selected with transform gizmo active
5. Adjust in inspector if needed

### Physics Integration

- Blocks, floors, ramps, stairs, door frames → **static** Rapier colliders
- Pillars → **static** by default, toggleable to **dynamic** in inspector
- Spawn points, trigger zones → no collider (metadata only)

## 3. Scene Hierarchy Panel

Left floating panel showing scene tree:

```
▼ Scene
  ▶ Corridor
    Floor
    Wall_Left
    Wall_Right
  ▶ Props
    Crate_1
    Barrel_2
  SpawnPoint
```

### Features

- Tree with expand/collapse for groups
- Click to select → highlights in 3D view + shows gizmo
- Drag/drop reparenting onto groups
- Eye icon → visibility toggle
- Lock icon → prevents selection/editing
- Right-click context menu: Rename, Delete, Duplicate, Group, Ungroup
- Text filter at top

### Data Model

`EditorObject` extended with: `parentId`, `children[]`, `visible`, `locked`, `name`.

## 4. Inspector Panel + Material Editor

Right floating panel with collapsible sections:

### Transform Section

- Position X/Y/Z number inputs with drag-to-scrub
- Rotation X/Y/Z in degrees
- Scale X/Y/Z
- Physics type dropdown: Static / Dynamic / Kinematic

### Material Section

- Color picker (HTML5 `<input type="color">`)
- Roughness slider 0-1
- Metalness slider 0-1
- Emissive color picker + intensity slider
- Opacity slider 0-1 (enables transparency when < 1)

Changes applied immediately to `MeshStandardMaterial`. Saved in level file.

## 5. Visual Polish (Dark Theme)

Single `editor.css` file injected when editor opens.

### Design Tokens

- Panel background: `rgba(12, 16, 24, 0.88)` + `backdrop-filter: blur(12px)`
- Text: `#c8d0dc`
- Accent: `#00bcd4` (Kinema cyan)
- Hover: `rgba(0, 188, 212, 0.15)`
- Selected: `rgba(0, 188, 212, 0.25)` + left border accent
- Inputs: `rgba(255,255,255,0.08)` background
- Buttons: pill-shaped, subtle border, hover glow
- Icons: inline SVG, 16px
- Transitions: 150ms ease

## 6. Navcat Integration

### Showcase Station

Placed at `futureA` station (Z=-240) in the showcase corridor.

### Features

- NavMesh generated from corridor floor geometry at level load
- 4-6 capsule NPCs patrol random waypoints via `navcat/blocks` crowd simulation
- Press **N** → toggle navmesh debug overlay (wireframe polygons)
- Press **T** → target mode: click floor to redirect nearest agent
- Agents use `findSmoothPath()` for natural curved paths
- Crowd sim handles inter-agent avoidance
- Visual: cyan path trails, orange agent capsules, green destination markers

### Integration Points

- `LevelManager.getFloorMeshes()` exposes floor geometry
- `NavMeshManager` uses `getPositionsAndIndices()` from `navcat/three`
- `generateSoloNavMesh()` builds mesh once at level load
- Agents updated in `fixedUpdate()` alongside other systems

## 7. Save Format (v2)

```json
{
  "version": 2,
  "name": "my-level",
  "created": "2026-02-26T...",
  "modified": "2026-02-26T...",
  "spawnPoint": { "position": [0, 2, 0] },
  "objects": [
    {
      "id": "uuid",
      "name": "Wall_Left",
      "parentId": "group-uuid",
      "source": { "type": "brush", "brush": "block" },
      "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "physics": { "type": "static" },
      "material": {
        "color": "#808080",
        "roughness": 0.7,
        "metalness": 0.0,
        "emissive": "#000000",
        "emissiveIntensity": 0,
        "opacity": 1.0
      },
      "brushParams": { "width": 1, "height": 3, "depth": 0.3 }
    }
  ]
}
```

Backwards-compatible: auto-upgrades v1 files on load.

## References

- `refrences/three-maps/` — Editor UI patterns, brush system, file format
- `refrences/navcat/` — Pathfinding library, crowd simulation, Three.js helpers
