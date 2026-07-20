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

  it("keeps accepted VFX roots under level ownership instead of registering a second disposer", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");

    expect(source).not.toContain("this.vfxDisposeCallbacks.push(result.dispose)");
  });

  it("reuses scratch storage while orienting VFX billboards", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");

    expect(source).not.toContain("getWorldPosition(new THREE.Vector3())");
  });

  it("gives the VFX station sign a stable cross-renderer inspection name", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");

    expect(source).toMatch(
      /this\.createSectionLabel\(\s*getVfxStationLabel\(this\.supportsAdvancedGpuEffects\),\s*new THREE\.Vector3\(0, 3\.2, zVfx \+ 6\),\s*11\.4,\s*2\.15,\s*"VFX_StationSign",\s*\)/,
    );
    expect(source.match(/"VFX_StationSign"/g)).toHaveLength(1);
  });

  it("defers navigation worker readiness instead of blocking procedural load", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");

    expect(source).toContain("this.createNavcatBay(zNavigation, bayTopY)");
    expect(source).not.toContain("await this.createNavcatBay(zNavigation, bayTopY)");
    expect(source).toContain("void generation");
    expect(source).toContain("this.onNavigationReady?.(");
  });

  it("uses primitive collision for known sphere, cylinder, rotated-box, and stair sites", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");

    expect(source).toContain("createFixedBall(mesh.position, 0.8, 0.7)");
    expect(source).toContain("createFixedCylinder(mesh.position, height * 0.5, radius)");
    expect(source).toContain("roughPlane.quaternion");
    expect(source).toContain("slope.quaternion");
    expect(source).toContain("new THREE.Vector3(width, rise, run)");
  });
});
