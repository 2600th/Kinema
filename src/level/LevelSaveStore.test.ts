import type { LevelDataV2 } from "@editor/LevelSerializer";
import { beforeEach, describe, expect, it } from "vitest";
import { LevelSaveStore } from "./LevelSaveStore";

const INDEX_KEY = "kinema_level_index";

class LocalStorageMock implements Storage {
  private store = new Map<string, string>();
  /** Keys whose writes should fail with QuotaExceededError. */
  failKeys = new Set<string>();
  /** Error to throw when writing a generated level-data key. */
  failLevelWriteWith: Error | null = null;
  /** Keys whose writes should fail with a generic storage error. */
  errorKeys = new Set<string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    if (key !== INDEX_KEY && key.startsWith("kinema_level_") && this.failLevelWriteWith) {
      throw this.failLevelWriteWith;
    }
    if (this.errorKeys.has(key)) {
      throw new Error("storage unavailable");
    }
    if (this.failKeys.has(key)) {
      throw new DOMException("quota", "QuotaExceededError");
    }
    this.store.set(key, value);
  }
}

function makeLevel(name: string): LevelDataV2 {
  return {
    version: 2,
    name,
    created: "2026-06-12T00:00:00.000Z",
    modified: "2026-06-12T00:00:00.000Z",
    spawnPoint: { position: [0, 2, 0] },
    objects: [],
  };
}

let storage: LocalStorageMock;

describe("LevelSaveStore", () => {
  beforeEach(() => {
    storage = new LocalStorageMock();
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      writable: true,
      configurable: true,
    });
  });

  it("round-trips a saved level through list and load", () => {
    expect(LevelSaveStore.save(makeLevel("Alpha"))).toEqual({ ok: true });
    const list = LevelSaveStore.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Alpha");
    const loaded = LevelSaveStore.load(list[0].key);
    expect(loaded?.name).toBe("Alpha");
  });

  it("reuses the existing key when re-saving the same level name", () => {
    LevelSaveStore.save(makeLevel("Alpha"));
    const firstKey = LevelSaveStore.list()[0].key;
    LevelSaveStore.save(makeLevel("Alpha"));
    const list = LevelSaveStore.list();
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe(firstKey);
  });

  it("returns null for a missing key without touching the index", () => {
    LevelSaveStore.save(makeLevel("Alpha"));
    expect(LevelSaveStore.load("kinema_level_nope")).toBeNull();
    expect(LevelSaveStore.list()).toHaveLength(1);
  });

  it("prunes the blob and index entry when level data is corrupt", () => {
    LevelSaveStore.save(makeLevel("Alpha"));
    const key = LevelSaveStore.list()[0].key;
    storage.setItem(key, "{not json");

    expect(LevelSaveStore.load(key)).toBeNull();
    // Corrupt entry must not keep appearing in the level list.
    expect(LevelSaveStore.list()).toHaveLength(0);
    expect(storage.getItem(key)).toBeNull();
  });

  it("still returns null for corrupt data if pruning the index hits quota", () => {
    LevelSaveStore.save(makeLevel("Alpha"));
    const key = LevelSaveStore.list()[0].key;
    storage.setItem(key, "{not json");
    storage.failKeys.add(INDEX_KEY);

    expect(LevelSaveStore.load(key)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it("removes the orphaned data blob when the index write hits quota for a new level", () => {
    storage.failKeys.add(INDEX_KEY);
    expect(LevelSaveStore.save(makeLevel("Alpha"))).toEqual({ ok: false, reason: "quota" });

    // Neither an index entry nor an unindexed blob may survive; otherwise the
    // level is invisible to the UI but permanently occupies storage.
    expect(LevelSaveStore.list()).toHaveLength(0);
    let blobCount = 0;
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith("kinema_level_") && k !== INDEX_KEY) blobCount++;
    }
    expect(blobCount).toBe(0);
  });

  it("keeps existing level data when the index write hits quota on overwrite", () => {
    LevelSaveStore.save(makeLevel("Alpha"));
    const key = LevelSaveStore.list()[0].key;
    storage.failKeys.add(INDEX_KEY);
    const updated = makeLevel("Alpha");
    updated.modified = "2026-06-13T00:00:00.000Z";
    expect(LevelSaveStore.save(updated)).toEqual({ ok: false, reason: "quota" });

    // The data write succeeded and the key is still indexed (stale meta is
    // acceptable; losing the level is not).
    expect(LevelSaveStore.load(key)?.modified).toBe("2026-06-13T00:00:00.000Z");
    expect(LevelSaveStore.list()[0]?.key).toBe(key);
  });

  it("returns quota when the level data write is rejected", () => {
    storage.failLevelWriteWith = new DOMException("quota", "QuotaExceededError");

    expect(LevelSaveStore.save(makeLevel("Alpha"))).toEqual({ ok: false, reason: "quota" });
    expect(LevelSaveStore.list()).toHaveLength(0);
  });

  it("returns error for non-quota storage failures", () => {
    storage.failLevelWriteWith = new Error("storage unavailable");
    expect(LevelSaveStore.save(makeLevel("Alpha"))).toEqual({ ok: false, reason: "error" });

    storage.failLevelWriteWith = null;
    storage.errorKeys.add(INDEX_KEY);
    expect(LevelSaveStore.save(makeLevel("Beta"))).toEqual({ ok: false, reason: "error" });
    expect(LevelSaveStore.list()).toHaveLength(0);
  });
});
