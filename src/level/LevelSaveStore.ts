import type { LevelDataV2 } from '@editor/LevelSerializer';

export interface LevelSaveMeta {
  key: string;
  name: string;
  modified: string;
  objectCount: number;
}

const INDEX_KEY = 'kinema_level_index';
const LEVEL_PREFIX = 'kinema_level_';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Persists editor levels in localStorage with an index/data pattern.
 */
export class LevelSaveStore {
  /** Return metadata for all saved levels (most-recently-modified first). */
  static list(): LevelSaveMeta[] {
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw) as LevelSaveMeta[];
      return arr.sort((a, b) => b.modified.localeCompare(a.modified));
    } catch {
      return [];
    }
  }

  /** Save (or overwrite) a level. Generates key from name if new. */
  static save(data: LevelDataV2): void {
    const index = LevelSaveStore.list();
    let key = LEVEL_PREFIX + slugify(data.name || 'untitled');

    // If the slug already exists under a different display name, disambiguate
    // so two levels with similar names don't silently overwrite each other.
    const collision = index.find((m) => m.key === key);
    if (collision && collision.name !== data.name) {
      let suffix = 2;
      while (index.some((m) => m.key === `${key}-${suffix}`)) {
        suffix++;
      }
      key = `${key}-${suffix}`;
    }

    localStorage.setItem(key, JSON.stringify(data));

    const existing = index.findIndex((m) => m.key === key);
    const meta: LevelSaveMeta = {
      key,
      name: data.name,
      modified: data.modified,
      objectCount: data.objects.length,
    };
    if (existing >= 0) {
      index[existing] = meta;
    } else {
      index.push(meta);
    }
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  }

  /** Load full level data by key. Returns null if missing or corrupt. */
  static load(key: string): LevelDataV2 | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as LevelDataV2;
    } catch {
      return null;
    }
  }

  /** Delete a level by key. */
  static delete(key: string): void {
    localStorage.removeItem(key);
    const index = LevelSaveStore.list().filter((m) => m.key !== key);
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  }
}
