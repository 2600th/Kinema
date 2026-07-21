import { describe, expect, it } from "vitest";
import { SHOWCASE_NON_INTERACTIVE_BAY_CLASSIFICATIONS } from "./showcaseBayClassification";

describe("showcase bay checklist classifications", () => {
  it("classifies Materials as a passive exhibit with non-applicable interaction feedback", () => {
    expect(SHOWCASE_NON_INTERACTIVE_BAY_CLASSIFICATIONS.materials).toEqual({
      kind: "passive",
      interaction: "N/A",
      audio: "N/A",
      reset: "N/A",
    });
  });
});
