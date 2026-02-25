import type { EditorObject } from './EditorObject';

/* ======================================================================
 *  V1 types (legacy — kept for migration)
 * ====================================================================== */

export interface LevelDataV1 {
  version: 1;
  name: string;
  spawnPoint: {
    position: [number, number, number];
    rotation: [number, number, number];
  };
  environment: { hdr: string; intensity: number; blur: number };
  objects: SerializedObjectV1[];
}

export interface SerializedObjectV1 {
  id: string;
  name: string;
  source: {
    type: 'primitive' | 'glb' | 'sprite' | 'brush';
    asset?: string;
    primitive?: string;
    brush?: string;
  };
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  physics?: {
    type: 'static' | 'dynamic' | 'kinematic';
    mass?: number;
    shape: string;
  };
  userData?: Record<string, unknown>;
}

/* ======================================================================
 *  V2 types (current)
 * ====================================================================== */

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
  source: {
    type: 'primitive' | 'glb' | 'sprite' | 'brush';
    asset?: string;
    primitive?: string;
    brush?: string;
  };
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  physics: { type: 'static' | 'dynamic' | 'kinematic' };
  material?: {
    color: string;
    roughness: number;
    metalness: number;
    emissive: string;
    emissiveIntensity: number;
    opacity: number;
  };
  brushParams?: Record<string, number>;
}

/** Public alias — always points to the latest format. */
export type LevelData = LevelDataV2;
export type SerializedObject = SerializedObjectV2;

/* ======================================================================
 *  Serializer
 * ====================================================================== */

export class LevelSerializer {
  /* ------------------------------------------------------------------ */
  /*  Serialize editor state → v2 JSON                                  */
  /* ------------------------------------------------------------------ */

  static serialize(name: string, objects: EditorObject[]): LevelDataV2 {
    const now = new Date().toISOString();
    return {
      version: 2,
      name,
      created: now,
      modified: now,
      spawnPoint: { position: [0, 2, 0] },
      objects: objects.map((obj) => ({
        id: obj.id,
        name: obj.name,
        parentId: obj.parentId ?? null,
        source: obj.source,
        transform: obj.transform,
        physics: {
          type:
            obj.physicsType ??
            (obj.body?.isDynamic()
              ? 'dynamic'
              : obj.body?.isKinematic()
                ? 'kinematic'
                : 'static'),
        },
        material: obj.material,
        brushParams: obj.brushParams,
      })),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Download                                                          */
  /* ------------------------------------------------------------------ */

  static download(data: LevelDataV2): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name || 'level'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------------ */
  /*  Load from file — always returns v2                                */
  /* ------------------------------------------------------------------ */

  static loadFromFile(file: File): Promise<LevelDataV2 | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed: unknown = JSON.parse(String(reader.result));
          resolve(LevelSerializer.upgradeLevelData(parsed));
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  v1 → v2 migration                                                 */
  /* ------------------------------------------------------------------ */

  static upgradeLevelData(data: unknown): LevelDataV2 | null {
    if (data == null || typeof data !== 'object') return null;

    const raw = data as Record<string, unknown>;

    if (raw.version === 2) return data as LevelDataV2;

    if (raw.version === 1) {
      const v1 = data as LevelDataV1;
      const now = new Date().toISOString();
      return {
        version: 2,
        name: v1.name,
        created: now,
        modified: now,
        spawnPoint: { position: v1.spawnPoint.position },
        objects: v1.objects.map((obj) => ({
          id: obj.id,
          name: obj.name,
          parentId: null,
          source: obj.source,
          transform: obj.transform,
          physics: { type: obj.physics?.type ?? 'static' },
          material: undefined,
          brushParams: undefined,
        })),
      };
    }

    return null;
  }
}
