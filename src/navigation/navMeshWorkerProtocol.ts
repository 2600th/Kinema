import type { NavMesh, NodeRef } from "navcat";
import type { SoloNavMeshOptions } from "navcat/blocks";

export const KINEMA_NAV_MESH_OPTIONS: SoloNavMeshOptions = {
  cellSize: 0.15,
  cellHeight: 0.15,
  walkableRadiusVoxels: 2,
  walkableRadiusWorld: 0.3,
  walkableClimbVoxels: 4,
  walkableClimbWorld: 0.6,
  walkableHeightVoxels: 10,
  walkableHeightWorld: 1.5,
  walkableSlopeAngleDegrees: 45,
  borderSize: 0,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxSimplificationError: 1.3,
  maxEdgeLength: 12,
  maxVerticesPerPoly: 5,
  detailSampleDistance: 0.9,
  detailSampleMaxError: 0.15,
};

export type NavMeshWorkerRequest = {
  positions: Float32Array;
  indices: Uint32Array;
  seedPoint?: [number, number, number];
};

export type NavMeshWorkerSuccess = {
  ok: true;
  navMesh: NavMesh;
  reachableNodeRefs: NodeRef[] | null;
  generationMs: number;
};

export type NavMeshWorkerFailure = {
  ok: false;
  error: string;
};

export type NavMeshWorkerResponse = NavMeshWorkerSuccess | NavMeshWorkerFailure;
