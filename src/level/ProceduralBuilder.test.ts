import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function getSectionLabelInstructions(): string[] {
  const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");
  return [...source.matchAll(/this\.createSectionLabel\(\s*("(?:\\.|[^"\\])*")/g)].map((match) => JSON.parse(match[1]));
}

describe("procedural showcase instructions", () => {
  it("keeps remappable control guidance binding-neutral", () => {
    const instructions = getSectionLabelInstructions().join("\n");

    expect(instructions).not.toMatch(/\b(?:W\/S|Space|F|C|LMB)\b/);
    expect(instructions).toContain("Interact");
    expect(instructions).toContain("Primary");
    expect(instructions).toContain("Crouch");
  });
});
