export function clampFiniteNumber(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

export interface CasStrengthMutationResult {
  nextValue: number;
  requiresRebuild: boolean;
}

export function resolveCasStrengthMutation(
  currentValue: number,
  nextValue: number,
): CasStrengthMutationResult {
  const wasZero = currentValue === 0;
  const isZero = nextValue === 0;
  return {
    nextValue,
    requiresRebuild: wasZero !== isZero,
  };
}
