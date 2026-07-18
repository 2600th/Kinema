import type { LevelDataV2 } from "@editor/LevelSerializer";

export interface LevelSaveMeta {
  key: string;
  name: string;
  modified: string;
  objectCount: number;
}

export type LevelSaveResult = { ok: true } | { ok: false; reason: "quota" | "error" };

const INDEX_KEY = "kinema_level_index";
const LEVEL_PREFIX = "kinema_level_";

function getSaveFailureReason(error: unknown): "quota" | "error" {
  return error instanceof DOMException && error.name === "QuotaExceededError" ? "quota" : "error";
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

  /** Save (or overwrite) a level. Reuses existing key for known levels; generates UUID key for new ones. */
  static save(data: LevelDataV2): LevelSaveResult {
    const index = LevelSaveStore.list();

    // For existing levels, reuse the stored key so we don't create duplicates.
    const existingEntry = index.find((m) => m.name === data.name);
    const key = existingEntry ? existingEntry.key : LEVEL_PREFIX + crypto.randomUUID();

    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
      const reason = getSaveFailureReason(err);
      if (reason === "quota") {
        console.error("[LevelSaveStore] Storage quota exceeded — level not saved.", err);
      } else {
        console.error("[LevelSaveStore] Level data write failed.", err);
      }
      return { ok: false, reason };
    }

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
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    } catch (err) {
      const reason = getSaveFailureReason(err);
      if (reason === "quota") {
        console.error("[LevelSaveStore] Storage quota exceeded — level index not updated.", err);
      } else {
        console.error("[LevelSaveStore] Level index write failed.", err);
      }
      if (!existingEntry) {
        // A new level whose index entry failed to write would be invisible
        // to the UI and re-saved under a fresh UUID each time, stranding
        // storage. Remove the orphaned data blob instead.
        try {
          localStorage.removeItem(key);
        } catch (cleanupErr) {
          console.error("[LevelSaveStore] Failed to remove an unindexed level blob.", cleanupErr);
        }
      }
      return { ok: false, reason };
    }
    return { ok: true };
  }

  /** Load full level data by key. Returns null if missing or corrupt. */
  static load(key: string): LevelDataV2 | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LevelDataV2;
    } catch (err) {
      // Corrupt blob (distinct from missing): prune it and its index entry so
      // the level list doesn't keep offering a level that can never load.
      console.error(`[LevelSaveStore] Corrupt level data for "${key}" — removing entry.`, err);
      try {
        LevelSaveStore.delete(key);
      } catch (deleteErr) {
        console.error(`[LevelSaveStore] Failed to prune corrupt level entry for "${key}".`, deleteErr);
        try {
          localStorage.removeItem(key);
        } catch {
          // Best-effort cleanup only; callers still receive null for corrupt data.
        }
      }
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
