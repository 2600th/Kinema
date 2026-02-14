import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

export interface EditorObject {
  id: string;
  name: string;
  mesh: THREE.Object3D;
  body?: RAPIER.RigidBody;
  collider?: RAPIER.Collider;
  source: { type: 'primitive' | 'glb' | 'sprite'; asset?: string; primitive?: string };
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
}
