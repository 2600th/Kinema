import { writeFile } from "node:fs/promises";
import { type Browser, expect, type Page, type TestInfo, test } from "@playwright/test";
import type { GraphicsProfile } from "../src/core/UserSettings";
import { waitForGrounded } from "./helpers/kinema";

async function waitForGameReady(page: Page, station = "vehicles"): Promise<void> {
  await page.goto(`/?station=${station}`, { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
  await waitForGrounded(page);
}

async function hasParticleRuntimeLoaded(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType("resource");
    return entries.some((entry) => /GameParticles|ParticlePool|ParticlePresets/i.test(entry.name));
  });
}

async function createProfilePage(browser: Browser, profile: GraphicsProfile) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript((selectedProfile) => {
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    localStorage.setItem("kinema.user-settings.v1", JSON.stringify({ graphicsProfile: selectedProfile }));
  }, profile);
  return { context, page: await context.newPage() };
}

async function observeVfxProfile(browser: Browser, profile: GraphicsProfile, testInfo: TestInfo) {
  const direct = await (async () => {
    const { context, page } = await createProfilePage(browser, profile);
    try {
      await waitForGameReady(page, "vfx");
      await page.waitForFunction(
        (selectedProfile) => window.__KINEMA__.getVfxDebugState().buildProfile === selectedProfile,
        profile,
        { timeout: 60_000 },
      );
      await page.waitForFunction(() => window.__KINEMA__.getFrameStats().samples >= 30, undefined, {
        timeout: 60_000,
      });
      await page.evaluate(() => window.__KINEMA__.resetFrameStats());
      await page.waitForFunction(() => window.__KINEMA__.getFrameStats().samples >= 30, undefined, {
        timeout: 60_000,
      });

      const observation = await page.evaluate(() => ({
        vfx: window.__KINEMA__.getVfxDebugState(),
        frameStats: window.__KINEMA__.getFrameStats(),
        backend: window.__KINEMA__.getRendererDebugFlags().activeBackend,
      }));
      const heapSamples: number[] = [];
      const rendererMemorySamples: Array<{ geometries: number; textures: number }> = [];
      if (profile === "cinematic") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Performance.enable");
        for (let cycle = 0; cycle < 3; cycle++) {
          await page.evaluate(() => window.__KINEMA__.restartCurrentRun());
          await page.waitForFunction(
            () => window.__KINEMA__.getVfxDebugState().buildProfile === "cinematic",
            undefined,
            { timeout: 60_000 },
          );
          await cdp.send("HeapProfiler.collectGarbage");
          const metrics = await cdp.send("Performance.getMetrics");
          heapSamples.push(metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0);
          rendererMemorySamples.push(await page.evaluate(() => window.__KINEMA__.getRendererMemoryState()));
        }
        await cdp.detach();
      }

      return { ...observation, heapSamples, rendererMemorySamples };
    } finally {
      await context.close();
    }
  })();

  const { context, page } = await createProfilePage(browser, profile);
  try {
    await page.goto("/?spawn=vfx", { waitUntil: "domcontentloaded" });
    await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
    await page.locator(".loading-screen").waitFor({ state: "hidden", timeout: 180_000 });
    await waitForGrounded(page);
    await page.waitForFunction(
      (selectedProfile) => window.__KINEMA__.getVfxDebugState().buildProfile === selectedProfile,
      profile,
      { timeout: 60_000 },
    );
    const visualVfx = await page.evaluate(() => window.__KINEMA__.getVfxDebugState());
    await page.screenshot({ path: testInfo.outputPath(`kin026-vfx-${profile}.png`) });

    return { ...direct, visualVfx };
  } finally {
    await context.close();
  }
}

test.describe("VFX Particle System", () => {
  test("particle runtime is ready before the first jump and landing stays stable", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await waitForGameReady(page);

    await page.waitForFunction(
      () => {
        const entries = performance.getEntriesByType("resource");
        return entries.some((entry) => /GameParticles|ParticlePool|ParticlePresets/i.test(entry.name));
      },
      undefined,
      { timeout: 10_000 },
    );
    await page.evaluate(() => window.__KINEMA__.simulateJump());

    const airborne = await page.evaluate(() => window.__KINEMA__.waitFor("p.vy > 0.5 && !p.isGrounded", 10_000));
    expect(airborne).toBe(true);
    const landed = await page.evaluate(() => window.__KINEMA__.waitFor("p.isGrounded === true", 15_000));
    expect(landed).toBe(true);

    const afterLoad = await hasParticleRuntimeLoaded(page);
    expect(afterLoad).toBe(true);

    const fatalErrors = errors.filter((e) => e.includes("Fatal") || e.includes("Uncaught") || e.includes("WebGL"));
    expect(fatalErrors).toHaveLength(0);
  });

  test("movement path remains stable and triggers gameplay-speed motion state", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await waitForGameReady(page);

    const before = await page.evaluate(() => window.__KINEMA__.player.position);
    await page.evaluate(() => window.__KINEMA__.simulateMove(0, 1, 120));

    const movedFastEnough = await page.evaluate(() =>
      window.__KINEMA__.waitFor("Math.hypot(p.vx, p.vz) > 0.35 && p.isGrounded", 10_000),
    );
    expect(movedFastEnough).toBe(true);

    const after = await page.evaluate(() => window.__KINEMA__.player.position);
    const delta = Math.hypot(after.x - before.x, after.z - before.z);
    expect(delta).toBeGreaterThan(0.05);

    const fatalErrors = errors.filter((e) => e.includes("Fatal") || e.includes("Uncaught") || e.includes("WebGL"));
    expect(fatalErrors).toHaveLength(0);
  });

  test("repeated jump and landing cycles stay stable with particle runtime loaded", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await waitForGameReady(page);

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.__KINEMA__.simulateJump());
      const airborne = await page.evaluate(() => window.__KINEMA__.waitFor("p.vy > 0.5 && !p.isGrounded", 10_000));
      expect(airborne).toBe(true);
      const landed = await page.evaluate(() => window.__KINEMA__.waitFor("p.isGrounded === true", 15_000));
      expect(landed).toBe(true);
    }

    const runtimeLoaded = await hasParticleRuntimeLoaded(page);
    expect(runtimeLoaded).toBe(true);

    const fatalErrors = errors.filter((e) => e.includes("Fatal") || e.includes("Uncaught") || e.includes("WebGL"));
    expect(fatalErrors).toHaveLength(0);
  });

  test("vfx station keeps a performance-safe fire core and lightning strike assets wired in", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("kinema.user-settings.v1", JSON.stringify({ graphicsProfile: "performance" }));
    });

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await waitForGameReady(page, "vfx");
    await page.waitForFunction(() => window.__KINEMA__.getGraphicsProfile?.() === "performance", undefined, {
      timeout: 10_000,
    });

    const fireCore = await page.evaluate(() => window.__KINEMA__.getLevelObjectState("VFX_FireCore"));
    expect(fireCore).not.toBeNull();
    if (!fireCore) throw new Error("VFX fire core was not loaded");
    expect(fireCore.visible).toBe(true);
    expect(fireCore.material).not.toBeNull();
    if (!fireCore.material) throw new Error("VFX fire core material was not loaded");
    expect(fireCore.material.blending).toBe(1);
    expect(fireCore.material.opacity).toBeGreaterThan(0);

    const bolt = await page.evaluate(() => window.__KINEMA__.getLevelObjectState("VFX_LightningBolt1"));
    const flashLight = await page.evaluate(() => window.__KINEMA__.getLevelObjectState("VFX_LightningFlashLight"));
    const strikeGlow = await page.evaluate(() => window.__KINEMA__.getLevelObjectState("VFX_LightningStrikeGlow"));
    const strikeColumn = await page.evaluate(() => window.__KINEMA__.getLevelObjectState("VFX_LightningStrikeColumn"));
    expect(bolt).not.toBeNull();
    if (!bolt) throw new Error("VFX lightning bolt was not loaded");
    expect(bolt.material).not.toBeNull();
    if (!bolt.material) throw new Error("VFX lightning bolt material was not loaded");
    expect(bolt.material.emissive).not.toBeNull();
    expect(bolt.material.emissiveIntensity).toBeGreaterThan(0);
    expect(flashLight).not.toBeNull();
    expect(strikeGlow).toBeNull();
    expect(strikeColumn).toBeNull();

    const fatalErrors = errors.filter((e) => e.includes("Fatal") || e.includes("Uncaught") || e.includes("WebGL"));
    expect(fatalErrors).toHaveLength(0);

    const webGpuShaderErrors = errors.filter((e) => e.includes("WGSL") || e.includes("Invalid ShaderModule"));
    expect(webGpuShaderErrors).toHaveLength(0);
  });

  test("performance and cinematic profiles build exact ambient budgets with frame evidence", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(420_000);
    const performanceProfile = await observeVfxProfile(browser, "performance", testInfo);
    const cinematicProfile = await observeVfxProfile(browser, "cinematic", testInfo);

    expect(performanceProfile.vfx.density).toBe(0.35);
    expect(performanceProfile.vfx.ambient).toMatchObject({
      configured: 119,
      embers: 14,
      rain: 70,
      orbit: 35,
    });
    expect(cinematicProfile.vfx.density).toBe(1);
    expect(cinematicProfile.vfx.ambient).toMatchObject({
      configured: 340,
      embers: 40,
      rain: 200,
      orbit: 100,
    });
    expect(performanceProfile.visualVfx.ambient).toMatchObject({
      configured: 1120,
      sparkles: { configuredCount: 140 },
      motes: 21,
      grassBlades: 840,
      embers: 14,
      rain: 70,
      orbit: 35,
    });
    expect(cinematicProfile.visualVfx.ambient).toMatchObject({
      configured: 3200,
      sparkles: { configuredCount: 400 },
      motes: 60,
      grassBlades: 2400,
      embers: 40,
      rain: 200,
      orbit: 100,
    });
    expect(performanceProfile.vfx.ambient.configured).toBeLessThan(cinematicProfile.vfx.ambient.configured);
    expect(cinematicProfile.heapSamples).toHaveLength(3);
    expect(cinematicProfile.heapSamples.every((sample) => sample > 0)).toBe(true);
    expect(Math.max(...cinematicProfile.heapSamples) - Math.min(...cinematicProfile.heapSamples)).toBeLessThan(
      20 * 1024 * 1024,
    );
    expect(cinematicProfile.rendererMemorySamples).toHaveLength(3);
    for (const key of ["geometries", "textures"] as const) {
      const samples = cinematicProfile.rendererMemorySamples.map((sample) => sample[key]);
      expect(samples.every((sample) => Number.isInteger(sample) && sample >= 0)).toBe(true);
      expect(Math.max(...samples) - Math.min(...samples)).toBeLessThanOrEqual(8);
    }

    for (const observation of [performanceProfile, cinematicProfile]) {
      expect(observation.backend).toMatch(/^WebGPU/);
      expect(observation.frameStats.samples).toBeGreaterThanOrEqual(30);
      expect(Number.isFinite(observation.frameStats.p95)).toBe(true);
    }
    expect(performanceProfile.frameStats.p95).toBeLessThanOrEqual(cinematicProfile.frameStats.p95 * 1.1 + 2);
    const evidencePath = testInfo.outputPath("kin026-vfx-profile-observations.json");
    await writeFile(evidencePath, JSON.stringify({ performanceProfile, cinematicProfile }, null, 2));
    await testInfo.attach("kin026-vfx-profile-observations", {
      path: evidencePath,
      contentType: "application/json",
    });
  });
});
