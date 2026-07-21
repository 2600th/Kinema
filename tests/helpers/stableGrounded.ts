export function advanceStableGroundedFrameCount(consecutiveFrames: number, isGrounded: boolean): number {
  return isGrounded ? consecutiveFrames + 1 : 0;
}
