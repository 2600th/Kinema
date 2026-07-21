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

  it("gives every primary station sign a stable cross-renderer inspection name", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");
    const expectedNames = [
      "StationSign_steps",
      "StationSign_slopes",
      "StationSign_movement",
      "StationSign_doubleJump",
      "StationSign_grab",
      "StationSign_throw",
      "StationSign_door",
      "StationSign_vehicles",
      "StationSign_platformsMoving",
      "StationSign_platformsPhysics",
      "StationSign_materials",
      "StationSign_vfx",
      "StationSign_navigation",
      "StationSign_futureA",
    ];

    for (const name of expectedNames) expect(source.match(new RegExp(`"${name}"`, "g"))).toHaveLength(1);
  });

  it("authors named step-limit and steep-slope readability cues", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");

    expect(source).toMatch(/this\.createFixedStaticBox\(\s*"StepsTooTallCue",\s*new THREE\.Vector3\(4, 0\.45, 2\.4\)/);
    expect(source).toContain('"StepsTooTallLabel"');
    expect(source).toContain('steepMarker.name = "SlopesTooSteepMarker"');
    expect(source).toContain('"SlopesTooSteepLabel"');
  });

  it("keeps vehicle and navigation signs binding-neutral", () => {
    const instructions = getSectionLabelInstructions();

    expect(instructions).toContain("Vehicles\nInteract to enter / exit • Controls adapt to input");
    expect(instructions).toContain("Navigation\nNavMesh • Crowd Patrol • Dynamic Targets");
    expect(instructions.join("\n")).not.toMatch(/N=debug|T=target/);
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

  it("uses the shared grounded spawn base for full and isolated showcase loads", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");

    expect(source).toContain("SHOWCASE_GROUNDED_SPAWN_Y");
    expect(source).not.toContain("position: new THREE.Vector3(0, 2, showcaseCenterZ + SHOWCASE_ENTRANCE_START_Z)");
    expect(source).not.toContain("position: new THREE.Vector3(ox, 2 + oy, targetZ + 10 + oz)");
  });

  it("reuses the named perimeter treatment for corridor and isolated station floors", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");

    expect(source).toMatch(/this\.addPerimeterTreatment\(\s*"ShowcaseBoundaryWall"/);
    expect(source).toMatch(/this\.addPerimeterTreatment\(\s*"StationBoundaryWall"/);
    expect(source).toContain("`${namePrefix}_LTrim`");
    expect(source).toContain("`${namePrefix}_EndTrim`");
  });

  it("keeps only the end-landmark core and crown independent from fog", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");

    expect(source).toContain('landmark.name = "ShowcaseEndLandmark"');
    expect(source).toContain('body.name = "ShowcaseEndLandmarkBody"');
    expect(source).toContain('core.name = "ShowcaseEndLandmarkCore"');
    expect(source).toContain('crown.name = "ShowcaseEndLandmarkCrown"');
    expect(source.match(/fog: false/g)).toHaveLength(2);
  });

  it("adds alternating corridor wayfinding signs without changing isolated station labels", () => {
    const source = readFileSync(new URL("./ProceduralBuilder.ts", import.meta.url), "utf8");

    expect(source).toContain("SHOWCASE_STATION_ORDER.slice(1)");
    expect(source).toContain("`Wayfinding_${key}`");
    expect(source).toContain("side * 16");
  });
});
