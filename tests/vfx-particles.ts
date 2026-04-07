import { expect, test, type Page } from "@playwright/test";

async function waitForGameReady(page: Page): Promise<void> {
  await page.goto("/?station=vehicles", { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__KINEMA__), undefined, { timeout: 60_000 });
  const grounded = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 60_000));
  expect(grounded).toBe(true);
}

async function hasParticleRuntimeLoaded(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType("resource");
    return entries.some((entry) => /GameParticles|ParticlePool|ParticlePresets/i.test(entry.name));
  });
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
    await page.evaluate(() => (window as any).__KINEMA__.simulateJump());

    const airborne = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.vy > 0.5 && !p.isGrounded", 10_000));
    expect(airborne).toBe(true);
    const landed = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 15_000));
    expect(landed).toBe(true);

    const afterLoad = await hasParticleRuntimeLoaded(page);
    expect(afterLoad).toBe(true);

    const fatalErrors = errors.filter(
      (e) => e.includes("Fatal") || e.includes("Uncaught") || e.includes("WebGL"),
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test("movement path remains stable and triggers gameplay-speed motion state", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await waitForGameReady(page);

    const before = await page.evaluate(() => (window as any).__KINEMA__.player.position);
    await page.evaluate(() => (window as any).__KINEMA__.simulateMove(0, 1, 120));

    const movedFastEnough = await page.evaluate(
      () => (window as any).__KINEMA__.waitFor("Math.hypot(p.vx, p.vz) > 0.35 && p.isGrounded", 10_000),
    );
    expect(movedFastEnough).toBe(true);

    const after = await page.evaluate(() => (window as any).__KINEMA__.player.position);
    const delta = Math.hypot(after.x - before.x, after.z - before.z);
    expect(delta).toBeGreaterThan(0.05);

    const fatalErrors = errors.filter(
      (e) => e.includes("Fatal") || e.includes("Uncaught") || e.includes("WebGL"),
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test("repeated jump and landing cycles stay stable with particle runtime loaded", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await waitForGameReady(page);

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => (window as any).__KINEMA__.simulateJump());
      const airborne = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.vy > 0.5 && !p.isGrounded", 10_000));
      expect(airborne).toBe(true);
      const landed = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 15_000));
      expect(landed).toBe(true);
    }

    const runtimeLoaded = await hasParticleRuntimeLoaded(page);
    expect(runtimeLoaded).toBe(true);

    const fatalErrors = errors.filter(
      (e) => e.includes("Fatal") || e.includes("Uncaught") || e.includes("WebGL"),
    );
    expect(fatalErrors).toHaveLength(0);
  });
});
