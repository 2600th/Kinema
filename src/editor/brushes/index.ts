import type { BrushDefinition } from './Brush';
import { BlockBrush } from './BlockBrush';
import { FloorBrush } from './FloorBrush';
import { PillarBrush } from './PillarBrush';
import { StairsBrush } from './StairsBrush';
import { RampBrush } from './RampBrush';
import { DoorFrameBrush } from './DoorFrameBrush';
import { SpawnBrush } from './SpawnBrush';
import { TriggerBrush } from './TriggerBrush';

export const BRUSH_REGISTRY: BrushDefinition[] = [
  BlockBrush, FloorBrush, PillarBrush, StairsBrush,
  RampBrush, DoorFrameBrush, SpawnBrush, TriggerBrush,
];

export function getBrushById(id: string): BrushDefinition | undefined {
  return BRUSH_REGISTRY.find(b => b.id === id);
}
