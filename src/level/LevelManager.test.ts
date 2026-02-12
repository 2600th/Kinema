import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { LevelManager } from './LevelManager';

describe('LevelManager spawn handling', () => {
  const defaultSpawn = new THREE.Vector3(0, 2, 0);
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('resets spawn to default before loading GLTF levels', async () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    const staleSpawn = new THREE.Vector3(9, 9, 9);
    (manager as any).spawnPoint = { position: staleSpawn };

    vi.spyOn(manager as any, 'loadGLTF').mockResolvedValue(undefined);
    await manager.load('custom-level');

    expect(manager.getSpawnPoint().position.equals(defaultSpawn)).toBe(true);
  });

  it('resets spawn to default on unload', () => {
    const scene = new THREE.Scene();
    const physicsWorld = {
      world: {},
      removeCollider: vi.fn(),
      removeBody: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    const manager = new LevelManager(scene, physicsWorld as any, eventBus as any);
    (manager as any).spawnPoint = { position: new THREE.Vector3(4, 7, -2) };
    (manager as any).currentLevelName = 'custom-level';

    manager.unload();

    expect(manager.getSpawnPoint().position.equals(defaultSpawn)).toBe(true);
  });
});
