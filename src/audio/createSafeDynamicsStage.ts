import * as Tone from "tone";

type CompressorNode = Tone.Compressor | Tone.Gain;
type LimiterNode = Tone.Limiter | Tone.Gain;

export interface SafeDynamicsStage {
  compressor: CompressorNode;
  limiter: LimiterNode;
  degraded: boolean;
}

/**
 * Some WebKit-family environments reject Tone's dynamics nodes during bootstrap.
 * Fall back to pass-through gain nodes so audio remains optional instead of fatal.
 */
export function createSafeDynamicsStage(
  label: string,
  compressorOptions: ConstructorParameters<typeof Tone.Compressor>[0],
  limiterThreshold: ConstructorParameters<typeof Tone.Limiter>[0],
): SafeDynamicsStage {
  let compressor: CompressorNode;
  try {
    compressor = new Tone.Compressor(compressorOptions);
  } catch (error) {
    console.warn(`[Audio] ${label} compressor unavailable; bypassing dynamics stage.`, error);
    return {
      compressor: new Tone.Gain(1),
      limiter: new Tone.Gain(1),
      degraded: true,
    };
  }

  try {
    return {
      compressor,
      limiter: new Tone.Limiter(limiterThreshold),
      degraded: false,
    };
  } catch (error) {
    console.warn(`[Audio] ${label} limiter unavailable; bypassing limiter.`, error);
    return {
      compressor,
      limiter: new Tone.Gain(1),
      degraded: true,
    };
  }
}
