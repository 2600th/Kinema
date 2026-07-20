const DISABLED_WARMUP_VALUES = /^(?:0|false)$/i;

/** Resolve the immutable bootstrap shader-warmup escape hatch. */
export function resolveShaderWarmupEnabled(params: URLSearchParams): boolean {
  return !DISABLED_WARMUP_VALUES.test(params.get("warmup") ?? "");
}
