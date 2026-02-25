import type { EditorObject } from './EditorObject';

export interface LevelData {
  version: 1;
  name: string;
  spawnPoint: {
    position: [number, number, number];
    rotation: [number, number, number];
  };
  environment: { hdr: string; intensity: number; blur: number };
  objects: SerializedObject[];
}

export interface SerializedObject {
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

export class LevelSerializer {
  static serialize(name: string, objects: EditorObject[]): LevelData {
    return {
      version: 1,
      name,
      spawnPoint: {
        position: [0, 2, 0],
        rotation: [0, 0, 0],
      },
      environment: {
        hdr: 'Room Environment',
        intensity: 1,
        blur: 0.2,
      },
      objects: objects.map((obj) => ({
        id: obj.id,
        name: obj.name,
        source: obj.source,
        transform: obj.transform,
        physics: obj.body
          ? {
              type: obj.body.isKinematic()
                ? 'kinematic'
                : obj.body.isDynamic()
                  ? 'dynamic'
                  : 'static',
              mass: obj.body.mass(),
              shape: 'unknown',
            }
          : undefined,
      })),
    };
  }

  static download(data: LevelData): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name || 'level'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static loadFromFile(file: File): Promise<LevelData | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          resolve(parsed as LevelData);
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
  }
}
