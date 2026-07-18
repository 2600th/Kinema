import type { PlayerController } from "@character/PlayerController";
import type { FrameStats } from "@core/GameLoop";
import type { InputState } from "@core/types";
import type { GraphicsProfile } from "@core/UserSettings";
import type { LoadStats } from "@level/LevelManager";
import type { RendererDebugFlags } from "@renderer/rendererState";
import type { CoinDebugEntry } from "@systems/CoinCollectibleSystem";
import type { HealthDebugState } from "@systems/PlayerHealthSystem";
import type { HazardDebugEntry } from "@systems/SpikeHazardSystem";
import type { CarDebugState, CarSteeringDebugTrace } from "@vehicle/CarController";

export interface KinemaVector3 {
  x: number;
  y: number;
  z: number;
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

export type KinemaVehicleDebugState = CarDebugState;
export type KinemaVehicleSteeringTrace = CarSteeringDebugTrace;

export interface KinemaPlayerState {
  position: KinemaVector3;
  velocity: KinemaVector3;
  isGrounded: boolean;
  ropeAttached: boolean;
  state: string;
  verticalVelocity: number;
}

export interface KinemaVehicleState {
  id: string;
  active: boolean;
  position: KinemaVector3;
  velocity: KinemaVector3;
  debug?: KinemaVehicleDebugState;
}

export interface KinemaDynamicBodyState {
  name: string;
  position: KinemaVector3;
  velocity: KinemaVector3;
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

export interface KinemaLevelObjectState {
  name: string;
  visible: boolean;
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

/** Complete contract for the development-only browser automation surface. */
export interface KinemaDebugApi {
  getFrameStats(): FrameStats;
  getLastLoadStats(): LoadStats | null;
  readonly player: KinemaPlayerState;
  readonly config: Readonly<PlayerController["config"]>;
  simulateJump(): void;
  simulateCrouch(): void;
  setCameraLook(pitch: number, yaw: number): void;
  getCameraPose(): KinemaCameraPose;
  freezeForCapture(): Promise<void>;
  listReviewSpawns(): string[];
  teleportToReviewSpawn(key: string): boolean;
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
  getLevelObjectState(name: string): KinemaLevelObjectState | null;
  getGraphicsProfile(): GraphicsProfile;
  getRendererDebugFlags(): Readonly<RendererDebugFlags>;
  setGraphicsProfile(profile: GraphicsProfile): Promise<GraphicsProfile>;
  forceVehicleTransform(id: string, position: KinemaVector3, yaw?: number): boolean;
  forceVehicleVelocity(id: string, velocity: KinemaVector3): boolean;
  enterVehicle(id: string): boolean;
  resetVehicle(id: string): boolean;
  simulateVehicleInput(input: Partial<InputState>, frames?: number): void;
  getCollectibleCount(): number;
  getHealth(): HealthDebugState;
  listCollectibles(): CoinDebugEntry[];
  listHazards(): HazardDebugEntry[];
  teleportToCollectible(id?: string): boolean;
  teleportToHazard(id?: string): boolean;
  teleportPlayer(position: KinemaVector3): boolean;
  forcePlayerPosition(position: KinemaVector3): boolean;
  openEditor(): Promise<void>;
  closeEditor(): void;
  isEditorActive(): boolean;
  isPlayTesting(): boolean;
  getEditorObjectCount(): number;
  getEditorSaveEventCount(): number;
  editorUndo(): void;
  editorRedo(): void;
  startPlayTest(): void;
  stopPlayTest(): Promise<void>;
  waitFor(predicate: string, timeoutMs?: number): Promise<boolean>;
}
