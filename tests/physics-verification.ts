import { expect, type Page, test } from "@playwright/test";
import { getPlayer, waitForGrounded, waitForLoadingGone } from "./helpers/kinema";

const SLOPES_URL = "/?station=slopes";

async function waitForReady(page: Page): Promise<void> {
  await page.goto(SLOPES_URL, { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
  await waitForGrounded(page);
}

async function monitorPlayerAboveY(page: Page, minY: number, durationMs: number): Promise<boolean> {
  return page.evaluate(
    async ({ threshold, duration }) => {
      const start = performance.now();
      while (performance.now() - start < duration) {
        const p = window.__KINEMA__.player;
        if (!p || p.position.y <= threshold) return false;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return true;
    },
    { threshold: minY, duration: durationMs },
  );
}

function installImpactToastObserver(): void {
  const stateWindow = window as unknown as Window & { __KINEMA_IMPACT_TOASTS__: string[] };
  stateWindow.__KINEMA_IMPACT_TOASTS__ = [];
  const recordImpactToasts = (root: ParentNode): void => {
    const candidates = [
      ...(root instanceof Element && root.matches(".hud-status-card") ? [root] : []),
      ...root.querySelectorAll(".hud-status-card"),
    ];
    for (const candidate of candidates) {
      if (candidate.textContent?.trim() === "Impact!") {
        stateWindow.__KINEMA_IMPACT_TOASTS__.push("Impact!");
      }
    }
  };
  const beginObserving = (): void => {
    if (!document.documentElement) {
      requestAnimationFrame(beginObserving);
      return;
    }
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) recordImpactToasts(node);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  beginObserving();
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
    const slopeMaxAngle = await page.evaluate(() => window.__KINEMA__.config?.slopeMaxAngle ?? null);
    expect(slopeMaxAngle).not.toBeNull();
    expect(slopeMaxAngle).toBeCloseTo(0.785, 2);
  });

  test("player stays above void threshold during movement on slopes station", async ({ page }) => {
    await page.evaluate(() => window.__KINEMA__.simulateMove(0, 1, 120));
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
    const kinemaAvailable = await page.evaluate(() => Boolean(window.__KINEMA__));
    expect(kinemaAvailable).toBe(true);

    const realErrors = consoleErrors.filter((e) => !e.includes("favicon") && !e.includes("404"));
    expect(realErrors).toHaveLength(0);
  });

  test("ten fresh throw stations suppress physics-settle impact toasts", async ({ browser }, testInfo) => {
    test.setTimeout(420_000);

    for (let load = 0; load < 10; load += 1) {
      const context = await browser.newContext();
      await context.addInitScript(installImpactToastObserver);

      try {
        const page = await context.newPage();
        await page.goto("/?station=throw", { waitUntil: "domcontentloaded" });
        await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
        await waitForLoadingGone(page);
        await waitForGrounded(page);
        await page.waitForTimeout(1_700);

        const impactToastHistory = await page.evaluate(() => {
          const stateWindow = window as unknown as Window & { __KINEMA_IMPACT_TOASTS__: string[] };
          return stateWindow.__KINEMA_IMPACT_TOASTS__;
        });
        expect(impactToastHistory, `fresh load ${load + 1}`).toEqual([]);
        await expect(page.locator("#hud-status-lane .hud-status-card", { hasText: "Impact!" })).toHaveCount(0);
        if (load === 9) {
          await page.screenshot({ path: testInfo.outputPath("throw-station-clean-impact-lane.png") });
        }
      } finally {
        await context.close();
      }
    }
  });

  test("a real post-grace prop throw emits one impact toast without a support-force flood", async ({ page }) => {
    await page.addInitScript(installImpactToastObserver);
    await page.goto("/?station=throw", { waitUntil: "domcontentloaded" });
    const canvas = page.locator("canvas");
    await canvas.waitFor({ state: "visible", timeout: 60_000 });
    await waitForLoadingGone(page);
    await waitForGrounded(page);
    await page.waitForTimeout(1_700);
    await canvas.click({ force: true, position: { x: 640, y: 360 } });

    await page.evaluate(() => {
      window.__KINEMA__.teleportPlayer({ x: -6.65, y: -0.25, z: 73.7 });
      window.__KINEMA__.setCameraLook(-0.08, 0);
    });
    await waitForGrounded(page);
    await page.keyboard.press("f");
    await expect.poll(() => page.evaluate(() => window.__KINEMA__.player.state)).toBe("carry");

    await page.evaluate(() => window.__KINEMA__.setCameraLook(0.05, -0.26));
    await canvas.dispatchEvent("mousedown", { button: 0 });
    await expect.poll(() => page.evaluate(() => window.__KINEMA__.player.state)).not.toBe("carry");
    await page.evaluate(() => window.dispatchEvent(new MouseEvent("mouseup", { button: 0 })));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stateWindow = window as unknown as Window & { __KINEMA_IMPACT_TOASTS__: string[] };
          return stateWindow.__KINEMA_IMPACT_TOASTS__.length;
        }),
        { timeout: 10_000 },
      )
      .toBe(1);
    await page.waitForTimeout(1_500);
    expect(
      await page.evaluate(() => {
        const stateWindow = window as unknown as Window & { __KINEMA_IMPACT_TOASTS__: string[] };
        return stateWindow.__KINEMA_IMPACT_TOASTS__;
      }),
    ).toEqual(["Impact!"]);
  });
});
