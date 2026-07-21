import type { PlayerController } from "@character/PlayerController";
import type { FrameStats } from "@core/GameLoop";
import type { GamepadMenuAction, InputSource, InputState } from "@core/types";
import type { GraphicsProfile } from "@core/UserSettings";
import type { ColliderShapeStats, LevelManager, LoadStats } from "@level/LevelManager";
import type { RendererDebugFlags } from "@renderer/rendererState";
import type { CoinDebugEntry } from "@systems/CoinCollectibleSystem";
import type { GrabGoalDebugState } from "@systems/GrabGoalSystem";
import type { ParticleSystem } from "@systems/ParticleSystem";
import type { HealthDebugState } from "@systems/PlayerHealthSystem";
import type { HazardDebugEntry } from "@systems/SpikeHazardSystem";
import type { CarDebugState, CarSteeringDebugTrace } from "@vehicle/CarController";

export interface KinemaVector3 {
  x: number;
  y: number;
  z: number;
}

export function isFixedWorldCollider(collider: {
  isSensor(): boolean;
  parent(): { isFixed(): boolean } | null;
}): boolean {
  return !collider.isSensor() && (collider.parent()?.isFixed() ?? true);
}

export interface KinemaQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface KinemaCameraPose {
  position: KinemaVector3;
  quaternion: KinemaQuaternion;
}

export interface KinemaRendererMemoryState {
  geometries: number;
  textures: number;
}

export type KinemaVehicleDebugState = CarDebugState;
export type KinemaVehicleSteeringTrace = CarSteeringDebugTrace;
export type KinemaVfxDebugState = ReturnType<LevelManager["getVfxDebugState"]> &
  ReturnType<ParticleSystem["getDebugState"]>;

export interface KinemaPlayerState {
  position: KinemaVector3;
  velocity: KinemaVector3;
  isGrounded: boolean;
  ropeAttached: boolean;
  state: string;
  verticalVelocity: number;
}

export interface KinemaPlayerMotionCapture {
  active: boolean;
  samples: number;
  maxVerticalVelocity: number;
  maxY: number;
  minX: number;
}

export interface KinemaVehicleState {
  id: string;
  active: boolean;
  position: KinemaVector3;
  velocity: KinemaVector3;
  rotation: KinemaQuaternion;
  debug?: KinemaVehicleDebugState;
}

export interface KinemaDynamicBodyState {
  name: string;
  position: KinemaVector3;
  velocity: KinemaVector3;
  rotation: KinemaQuaternion;
}

export interface KinemaCheckpointState {
  id: string;
  position: KinemaVector3;
}

export interface KinemaNavAgentState {
  id: string;
  position: KinemaVector3;
}

export interface KinemaNavigationDebugState {
  overlayAvailable: boolean;
  overlayVisible: boolean;
  targetAvailable: boolean;
  targetMode: boolean;
}

export interface KinemaEditorPhysicsSyncCounters {
  poseSyncs: number;
  colliderDescriptorBuilds: number;
  colliderReplacements: number;
}

export interface KinemaEditorWorkspaceObjectSnapshot {
  id: string;
  name: string;
  meshUuid: string;
  parentId: string | null;
  children: string[];
  visible: boolean;
  locked: boolean;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  source: {
    type: "primitive" | "glb" | "sprite" | "brush";
    asset?: string;
    primitive?: string;
    brush?: string;
  };
  material?: {
    color: string;
    roughness: number;
    metalness: number;
    emissive: string;
    emissiveIntensity: number;
    opacity: number;
  };
  physicsType: "static" | "dynamic" | "kinematic";
}

export interface KinemaEditorWorkspaceSnapshot {
  selectedId: string | null;
  objects: KinemaEditorWorkspaceObjectSnapshot[];
}

export interface KinemaLevelObjectState {
  name: string;
  visible: boolean;
  labelText: string | null;
  position: KinemaVector3;
  size: KinemaVector3;
  material: {
    transparent: boolean;
    opacity: number;
    blending: number;
    depthWrite: boolean;
    emissive: string | null;
    emissiveIntensity: number | null;
  } | null;
}

export type KinemaInteractionEvent =
  | { type: "interaction:triggered"; id: string; outcome?: string }
  | { type: "interaction:doorToggled"; id: string; open: boolean }
  | { type: "objective:beaconActivated"; id: string }
  | { type: "interaction:ropeAttached"; id: string }
  | { type: "interaction:ropeReleased"; id: string }
  | { type: "player:sprintStarted" }
  | { type: "player:ladderAttached" }
  | { type: "player:ladderReleased" }
  | { type: "vehicle:boostChanged"; active: boolean }
  | { type: "collectible:allCollected"; count: number; total: number }
  | { type: "objective:completed"; id: string; text: string; position?: KinemaVector3 };

/** Complete contract for the development-only browser automation surface. */
export interface KinemaDebugApi {
  getFrameStats(): FrameStats;
  resetFrameStats(): void;
  getRendererMemoryState(): KinemaRendererMemoryState;
  getLastLoadStats(): LoadStats | null;
  getColliderShapeStats(): ColliderShapeStats;
  castWorldRay(
    origin: KinemaVector3,
    direction: KinemaVector3,
    maxToi: number,
    options?: { fixedOnly?: boolean },
  ): { timeOfImpact: number; normal: KinemaVector3 } | null;
  restartCurrentRun(): Promise<void>;
  readonly player: KinemaPlayerState;
  readonly config: Readonly<PlayerController["config"]>;
  simulateJump(): void;
  simulateCrouch(): void;
  simulateGamepadMenuInput(action: GamepadMenuAction): void;
  getInputSource(): InputSource;
  setCameraLook(pitch: number, yaw: number): void;
  getCameraPose(): KinemaCameraPose;
  freezeForCapture(): Promise<void>;
  listReviewSpawns(): string[];
  teleportToReviewSpawn(key: string): boolean;
  startPlayerMotionCapture(): void;
  stopPlayerMotionCapture(): KinemaPlayerMotionCapture;
  simulateMove(moveX: number, moveY: number, frames?: number): void;
  simulateHoldInteract(frames?: number): void;
  clearSimulatedInput(): void;
  listVehicles(): string[];
  getVehicleState(id: string): KinemaVehicleState | null;
  enableVehicleSteeringDebug(
    id: string,
    options?: { capacity?: number; autoLog?: boolean; label?: string | null },
  ): KinemaVehicleSteeringTrace | null;
  disableVehicleSteeringDebug(id: string): KinemaVehicleSteeringTrace | null;
  clearVehicleSteeringDebug(id: string): KinemaVehicleSteeringTrace | null;
  getVehicleSteeringDebug(id: string): KinemaVehicleSteeringTrace | null;
  dumpVehicleSteeringDebug(id: string): KinemaVehicleSteeringTrace | null;
  getDynamicBodyState(name: string): KinemaDynamicBodyState | null;
  getNavAgentStates(): KinemaNavAgentState[];
  getNavigationDebugState(): KinemaNavigationDebugState;
  getVfxDebugState(): KinemaVfxDebugState;
  getGrabGoalState(): GrabGoalDebugState;
  placeGrabCubeOnGoal(name?: string): boolean;
  getLevelObjectState(name: string): KinemaLevelObjectState | null;
  getGraphicsProfile(): GraphicsProfile;
  getRendererDebugFlags(): Readonly<RendererDebugFlags>;
  setGraphicsProfile(profile: GraphicsProfile): Promise<GraphicsProfile>;
  forceVehicleTransform(id: string, position: KinemaVector3, yaw?: number, rotation?: KinemaQuaternion): boolean;
  forceVehicleVelocity(id: string, velocity: KinemaVector3): boolean;
  enterVehicle(id: string): boolean;
  resetVehicle(id: string): boolean;
  simulateVehicleInput(input: Partial<InputState>, frames?: number): void;
  getCollectibleCount(): number;
  getCollectibleTotal(): number;
  getActiveCheckpoint(): KinemaCheckpointState | null;
  getHealth(): HealthDebugState;
  listCollectibles(): CoinDebugEntry[];
  listHazards(): HazardDebugEntry[];
  teleportToCollectible(id?: string): boolean;
  teleportToHazard(id?: string): boolean;
  teleportToCheckpoint(): boolean;
  teleportPlayer(position: KinemaVector3): boolean;
  forcePlayerPosition(position: KinemaVector3): boolean;
  openEditor(): Promise<void>;
  closeEditor(): void;
  isEditorActive(): boolean;
  isPlayTesting(): boolean;
  getEditorObjectCount(): number;
  getEditorSaveEventCount(): number;
  getEditorDocumentState(): { name: string; dirty: boolean };
  getEditorSnapshot(): KinemaEditorWorkspaceSnapshot;
  setEditorCameraPose(pose: KinemaCameraPose): boolean;
  getEditorPhysicsSyncCounters(): KinemaEditorPhysicsSyncCounters;
  resetEditorPhysicsSyncCounters(): void;
  getEditorUnloadProtectionState(): { registered: boolean; lastPrevented: boolean };
  getInteractionEvents(): KinemaInteractionEvent[];
  clearInteractionEvents(): void;
  editorUndo(): void;
  editorRedo(): void;
  startPlayTest(): void;
  stopPlayTest(): Promise<void>;
  loadExternalEditorLevel(name: string): Promise<void>;
  evictEditorAsset(assetPath: string): void;
  waitFor(predicate: string, timeoutMs?: number): Promise<boolean>;
}
