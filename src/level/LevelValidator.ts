import type { ParsedNode } from './MeshParser';

/**
 * Validates parsed level data and logs warnings for malformed or missing metadata.
 */
export class LevelValidator {
  /** Run validation and log warnings. */
  validate(parsed: ParsedNode[], levelName: string): void {
    const spawnPoints = parsed.filter((p) => p.type === 'spawnpoint');
    if (spawnPoints.length === 0) {
      console.warn(`[LevelValidator] "${levelName}": No spawn point found. Player will use default position.`);
    } else if (spawnPoints.length > 1) {
      console.warn(`[LevelValidator] "${levelName}": Multiple spawn points (${spawnPoints.length}). Using first.`);
    }

    const colliders = parsed.filter((p) => p.type === 'collider');
    for (const entry of colliders) {
      if (entry.mass !== null && entry.mass !== 0) {
        console.warn(
          `[LevelValidator] "${levelName}": Collider "${entry.object.name}" has mass=${entry.mass}; using static collider.`,
        );
      }
      if (!entry.mesh) {
        console.warn(`[LevelValidator] "${levelName}": Collider "${entry.object.name}" is not a mesh; skipping.`);
      }
    }

    const sensors = parsed.filter((p) => p.type === 'sensor');
    for (const entry of sensors) {
      if (!entry.mesh) {
        console.warn(`[LevelValidator] "${levelName}": Sensor "${entry.object.name}" is not a mesh; skipping.`);
      }
    }
  }
}
