import { BlockBrush } from "./BlockBrush";
import type { BrushDefinition } from "./Brush";
import { DoorFrameBrush } from "./DoorFrameBrush";
import { FloorBrush } from "./FloorBrush";
import { PillarBrush } from "./PillarBrush";
import { RampBrush } from "./RampBrush";
import { SpawnBrush } from "./SpawnBrush";
import { StairsBrush } from "./StairsBrush";
import { TriggerBrush } from "./TriggerBrush";

export const BRUSH_REGISTRY: BrushDefinition[] = [
  BlockBrush,
  FloorBrush,
  PillarBrush,
  StairsBrush,
  RampBrush,
  DoorFrameBrush,
  SpawnBrush,
  TriggerBrush,
];

export function getBrushById(id: string): BrushDefinition | undefined {
  return BRUSH_REGISTRY.find((b) => b.id === id);
}
