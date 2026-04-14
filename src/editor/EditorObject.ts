import type RAPIER from "@dimforge/rapier3d-compat";
import type * as THREE from "three";

export interface EditorObject {
  id: string;
  name: string;
  mesh: THREE.Object3D;
  body?: RAPIER.RigidBody;
  collider?: RAPIER.Collider;
  source: {
    type: "primitive" | "glb" | "sprite" | "brush";
    asset?: string;
    primitive?: string;
    brush?: string;
  };
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  parentId?: string | null;
  children?: string[];
  visible?: boolean;
  locked?: boolean;
  material?: {
    color: string;
    roughness: number;
    metalness: number;
    emissive: string;
    emissiveIntensity: number;
    opacity: number;
  };
  brushParams?: Record<string, number>;
  physicsType?: "static" | "dynamic" | "kinematic";
  /** Spawn point tag — only meaningful for spawn brushes (e.g. 'player', 'ai', 'item'). */
  spawnTag?: string;
}
