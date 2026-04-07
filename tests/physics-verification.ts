import { expect, test, type Page } from "@playwright/test";

const SLOPES_URL = "/?station=slopes";

type PlayerDebug = {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  isGrounded: boolean;
  state: string;
};

async function waitForReady(page: Page): Promise<void> {
  await page.goto(SLOPES_URL, { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__KINEMA__), undefined, { timeout: 60_000 });
  const grounded = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 60_000));
  expect(grounded).toBe(true);
}

async function getPlayer(page: Page): Promise<PlayerDebug> {
  const player = await page.evaluate(() => (window as any).__KINEMA__.player);
  expect(player).not.toBeNull();
  return player as PlayerDebug;
}

async function monitorPlayerAboveY(page: Page, minY: number, durationMs: number): Promise<boolean> {
  return page.evaluate(
    async ({ threshold, duration }) => {
      const start = performance.now();
      while (performance.now() - start < duration) {
        const p = (window as any).__KINEMA__?.player;
        if (!p || p.position.y <= threshold) return false;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return true;
    },
    { threshold: minY, duration: durationMs },
  );
}

test.describe("Physics Verification", () => {
  test.beforeEach(async ({ page }) => {
    await waitForReady(page);
  });

  test("player spawns grounded on slopes station", async ({ page }) => {
    const player = await getPlayer(page);
    expect(player.isGrounded).toBe(true);
    expect(player.position.y).toBeGreaterThan(-5);
  });

  test("slope max angle remains 45 degrees (0.785 rad)", async ({ page }) => {
    const slopeMaxAngle = await page.evaluate(() => (window as any).__KINEMA__?.config?.slopeMaxAngle ?? null);
    expect(slopeMaxAngle).not.toBeNull();
    expect(slopeMaxAngle).toBeCloseTo(0.785, 2);
  });

  test("player stays above void threshold during movement on slopes station", async ({ page }) => {
    await page.evaluate(() => (window as any).__KINEMA__.simulateMove(0, 1, 120));
    const stayedSafe = await monitorPlayerAboveY(page, -10, 4_000);
    expect(stayedSafe).toBe(true);
  });
});

test.describe("Bootstrap Verification", () => {
  test("slopes station starts without fatal runtime errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await waitForReady(page);
    const kinemaAvailable = await page.evaluate(() => Boolean((window as any).__KINEMA__));
    expect(kinemaAvailable).toBe(true);

    const realErrors = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("404"),
    );
    expect(realErrors).toHaveLength(0);
  });
});
