import type { ShowcaseStationKey } from "./ShowcaseLayout";

export type ShowcaseNonInteractiveBayKey = Extract<ShowcaseStationKey, "materials" | "vfx" | "futureA">;

export interface ShowcaseNonInteractiveBayClassification {
  readonly kind: "passive" | "reserved";
  readonly interaction: "N/A";
  readonly audio: "N/A";
  readonly reset: "N/A";
}

export const SHOWCASE_NON_INTERACTIVE_BAY_CLASSIFICATIONS = {
  materials: { kind: "passive", interaction: "N/A", audio: "N/A", reset: "N/A" },
  vfx: { kind: "passive", interaction: "N/A", audio: "N/A", reset: "N/A" },
  futureA: { kind: "reserved", interaction: "N/A", audio: "N/A", reset: "N/A" },
} as const satisfies Readonly<Record<ShowcaseNonInteractiveBayKey, ShowcaseNonInteractiveBayClassification>>;
