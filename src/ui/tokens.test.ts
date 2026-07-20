import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);

function source(relativePath: string): string {
  const path = fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|ts)$/.test(entry.name) && path !== THIS_FILE ? [path] : [];
  });
}

describe("shared UI design tokens", () => {
  it("defines the canonical palette, spacing, typography, and exact global stacking scale", () => {
    const tokens = source("src/ui/tokens.css");
    expect(tokens).toContain("--k-accent: #7b6cff");
    expect(tokens).toContain("--k-accent-rgb: 123, 108, 255");
    expect(tokens).toContain("--k-accent-hover: #ff79ba");
    expect(tokens).toContain("--k-accent-hover-rgb: 255, 121, 186");
    expect(tokens).toContain("--k-accent-cyan: #62e6ff");
    expect(tokens).toContain("--k-accent-cyan-rgb: 98, 230, 255");
    expect(tokens).toContain("--k-text: #ffffff");
    expect(tokens).toContain("--k-muted:");
    expect(tokens).toContain("--k-bg-surface: #0c1020");
    expect(tokens).toContain("--k-bg-deep: #060911");
    expect(tokens).toContain("--k-bg-ink: #020307");
    for (const [step, pixels] of [
      [1, 4],
      [2, 8],
      [3, 12],
      [4, 16],
      [5, 24],
      [6, 32],
    ]) {
      expect(tokens).toContain(`--k-space-${step}: ${pixels}px`);
    }
    expect(tokens.replace(/\s+/g, " ")).toContain(
      '--k-font-body: "Outfit", "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    );
    for (const [name, value] of [
      ["canvas", 0],
      ["ui", 10],
      ["fade", 100],
      ["damage", 999],
      ["hud", 1000],
      ["touch", 1000],
      ["editor-default", 1000],
      ["death", 1100],
      ["debug", 1100],
      ["death-particles", 1101],
      ["menu", 1200],
      ["hint", 1250],
      ["loading", 1300],
      ["editor-context", 2000],
      ["editor-panels", 10000],
      ["editor-playtest", 10001],
      ["fatal", 99999],
    ]) {
      expect(tokens).toContain(`--k-z-${name}: ${value}`);
    }
  });

  it("loads the token source once before inline and application styles", () => {
    const html = source("index.html");
    const tokenLink = html.indexOf('href="/src/ui/tokens.css"');
    expect(tokenLink).toBeGreaterThan(-1);
    expect(tokenLink).toBeLessThan(html.indexOf("<style>"));
    expect(tokenLink).toBeLessThan(html.indexOf('src="/src/main.ts"'));
    expect(html).toContain("display=swap");
  });

  it("removes the divergent touch/death triad from all source files", () => {
    const oldTriad =
      /#(?:7b2fff|ff6b9d|00d2ff)\b|rgba?\(\s*(?:123\s*,\s*47\s*,\s*255|255\s*,\s*107\s*,\s*157|0\s*,\s*210\s*,\s*255)\b/i;
    const offenders = sourceFiles(`${REPO_ROOT}/src`)
      .filter((path) => oldTriad.test(readFileSync(path, "utf8")))
      .map((path) => relative(REPO_ROOT, path));
    expect(offenders).toEqual([]);
  });

  it("keeps canonical UI triad definitions in the shared token source", () => {
    const canonicalTriad =
      /#(?:7b6cff|ff79ba|62e6ff)\b|rgba?\(\s*(?:123\s*,\s*108\s*,\s*255|255\s*,\s*121\s*,\s*186|98\s*,\s*230\s*,\s*255)\b/i;
    const allowed = new Set([
      "src/input/VirtualJoystick.test.ts",
      "src/input/VirtualJoystick.ts",
      "src/level/ProceduralBuilder.ts",
      "src/ui/tokens.css",
    ]);
    const offenders = sourceFiles(`${REPO_ROOT}/src`)
      .map((path) => ({ path, relativePath: relative(REPO_ROOT, path).replaceAll("\\", "/") }))
      .filter(({ relativePath }) => !allowed.has(relativePath))
      .filter(({ path }) => canonicalTriad.test(readFileSync(path, "utf8")))
      .map(({ relativePath }) => relativePath);
    expect(offenders).toEqual([]);
  });

  it("uses shared steps for matching spacing declarations on every CSS surface", () => {
    const sharedStepLiteral =
      /^(?:\s*)(?:gap|row-gap|column-gap|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|inset(?:-[a-z-]+)?|top|right|bottom|left)\s*:[^;{}]*(?<![\d-])(?:4|8|12|16|24|32)px\b/im;
    for (const path of [
      "src/ui/menus/menus.css",
      "src/ui/components/hud.css",
      "src/input/touch-controls.css",
      "src/editor/styles/editor.css",
    ]) {
      expect(source(path), path).not.toMatch(sharedStepLiteral);
      expect(source(path), path).toContain("var(--k-space-");
    }
    expect(source("src/ui/UIManager.ts")).toContain("max(var(--k-space-4)");
    expect(source("src/ui/components/LoadingScreen.ts")).toContain('padding: "40px var(--k-space-5)"');
    expect(source("src/ui/components/DebugPanel.ts")).toContain("padding:var(--k-space-3)");
  });

  it("aliases existing surface variables and resolves the canvas palette from root tokens", () => {
    const menus = source("src/ui/menus/menus.css");
    const editor = source("src/editor/styles/editor.css");
    const touch = source("src/input/touch-controls.css");
    const joystick = source("src/input/VirtualJoystick.ts");
    expect(menus).toContain("--menu-accent: var(--k-accent)");
    expect(menus).toContain("--menu-accent-hover: var(--k-accent-hover)");
    expect(menus).toContain("--menu-accent-cyan: var(--k-accent-cyan)");
    expect(menus).toContain("--font-body: var(--k-font-body)");
    expect(menus).toContain("var(--k-bg-surface) 0%");
    expect(menus).toContain("var(--k-bg-deep) 68%");
    expect(menus).toContain("var(--k-bg-ink) 100%");
    expect(editor).toContain("--ke-accent: var(--k-accent-cyan)");
    expect(editor).toContain("--ke-accent-2: var(--k-accent)");
    expect(editor).toContain("--ke-accent-3: var(--k-accent-hover)");
    expect(editor).toContain("--ke-font: var(--k-font-body)");
    expect(touch).toContain("font-family: var(--k-font-body)");
    expect(joystick).toContain("getComputedStyle(document.documentElement).getPropertyValue(name)");
    expect(joystick).toContain('typeof document === "undefined"');
    expect(joystick).toContain('readToken("--k-accent")');
    expect(joystick).toContain('readToken("--k-accent-hover")');
  });

  it("replaces every global z-index literal with the shared semantic layer", () => {
    const checks: Array<[string, RegExp]> = [
      ["index.html", /z-index:\s*10\s*;/],
      ["src/renderer/rendererBootstrap.ts", /zIndex\s*=\s*"0"|zIndex:\s*"99999"/],
      ["src/main.ts", /z-index:99999/],
      ["src/ui/components/FadeScreen.ts", /z-index:\s*100\s*;/],
      ["src/ui/components/hud.css", /z-index:\s*(?:999|1000)\s*;/],
      ["src/input/touch-controls.css", /z-index:\s*1000\s*;/],
      ["src/ui/components/DeathEffect.ts", /z-index:\s*1100\s*;|zIndex:\s*"1101"/],
      ["src/ui/components/DebugPanel.ts", /z-index:1100/],
      ["src/ui/menus/menus.css", /z-index:\s*1200\s*;/],
      ["src/ui/UIManager.ts", /zIndex:\s*"1250"/],
      ["src/ui/components/LoadingScreen.ts", /zIndex:\s*"1300"/],
      ["src/editor/styles/editor.css", /z-index:\s*(?:1000|2000)\s*;/],
      ["src/editor/panels/BrushPanel.ts", /zIndex:\s*"10000"/],
      ["src/editor/panels/HierarchyPanel.ts", /zIndex:\s*"10000"/],
      ["src/editor/panels/InspectorPanel.ts", /zIndex:\s*"10000"/],
      ["src/editor/panels/ToolbarPanel.ts", /zIndex:\s*"10000"/],
      ["src/editor/EditorManager.ts", /zIndex:\s*"10001"/],
    ];
    const offenders = checks.filter(([path, pattern]) => pattern.test(source(path))).map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
