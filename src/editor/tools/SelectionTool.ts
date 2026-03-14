import type { EditorTool, EditorToolContext } from './EditorTool';

/**
 * Default tool: click to select objects, gizmo transform with undo recording.
 */
export class SelectionTool implements EditorTool {
  readonly id = 'selection';

  onPointerDown(ctx: EditorToolContext, e: MouseEvent): boolean {
    if (e.button !== 0) return false;

    // Don't run selection raycast while transform gizmo is being dragged
    if (ctx.gizmo.controls.dragging) return false;

    this.selectAtPointer(ctx, e.clientX, e.clientY);
    return true;
  }

  /* ---- Internals ---- */

  private selectAtPointer(ctx: EditorToolContext, clientX: number, clientY: number): void {
    const rect = ctx.canvas.getBoundingClientRect();
    ctx.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ctx.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    ctx.raycaster.setFromCamera(ctx.mouse, ctx.camera);

    const meshes = ctx.editorObjects
      .filter((obj) => !obj.locked)
      .map((obj) => obj.mesh);
    const hits = ctx.raycaster.intersectObjects(meshes, true);

    if (!hits.length) {
      ctx.setSelection(null);
      return;
    }

    const mesh = hits[0].object;
    const target = ctx.editorObjects.find(
      (obj) => obj.mesh === mesh || obj.mesh.getObjectById(mesh.id) !== undefined,
    );
    ctx.setSelection(target ?? null);
  }
}
