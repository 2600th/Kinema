import { expect, type Page, test } from "@playwright/test";
import { waitForGrounded } from "./helpers/kinema";

type CoinDebugEntry = {
  id: string;
  station: string;
  value: number;
  position: { x: number; y: number; z: number };
};

async function waitForRuntimeReady(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("canvas[data-engine]").waitFor({ state: "visible", timeout: 60_000 });
  await waitForGrounded(page);
}

async function getCoinCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__KINEMA__.getCollectibleCount());
}

async function listCoins(page: Page): Promise<CoinDebugEntry[]> {
  return page.evaluate(() => window.__KINEMA__.listCollectibles());
}

async function collectCoin(page: Page, id?: string): Promise<void> {
  const teleported = await page.evaluate((coinId) => window.__KINEMA__.teleportToCollectible(coinId), id);
  expect(teleported).toBe(true);
}

async function collectEveryCoin(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const api = window.__KINEMA__;
    const total = api.getCollectibleTotal();
    const progress: string[] = [];
    for (let expected = 1; expected <= total; expected++) {
      const coin = api.listCollectibles()[0];
      if (!coin || !api.teleportToCollectible(coin.id)) {
        throw new Error(`Unable to teleport to collectible ${expected}/${total}`);
      }
      await new Promise<void>((resolve) => {
        const check = () => {
          if (api.getCollectibleCount() >= expected) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
      progress.push(document.querySelector(".collectible-count")?.textContent ?? "");
    }
    return progress;
  });
}

test.describe("Procedural Coins", () => {
  test("collecting coins increments the runtime collectible count and removes them from the debug list", async ({
    page,
  }) => {
    await waitForRuntimeReady(page, "/?spawn=entrance");

    expect(await getCoinCount(page)).toBe(0);
    expect(await page.evaluate(() => window.__KINEMA__.getCollectibleTotal())).toBe(70);
    await expect(page.locator(".collectible-count")).toHaveText("0/70");

    const initialCoins = await listCoins(page);
    expect(initialCoins.length).toBeGreaterThan(8);

    const [firstCoin, secondCoin] = initialCoins;
    expect(firstCoin).toBeDefined();
    expect(secondCoin).toBeDefined();

    await collectCoin(page, firstCoin.id);
    await page.waitForFunction(() => window.__KINEMA__.getCollectibleCount() === 1, undefined, {
      timeout: 10_000,
    });

    let remaining = await listCoins(page);
    expect(remaining.some((coin) => coin.id === firstCoin.id)).toBe(false);

    await collectCoin(page, secondCoin.id);
    await page.waitForFunction(() => window.__KINEMA__.getCollectibleCount() === 2, undefined, {
      timeout: 10_000,
    });

    remaining = await listCoins(page);
    expect(remaining.some((coin) => coin.id === secondCoin.id)).toBe(false);
    expect(remaining.length).toBe(initialCoins.length - 2);
  });

  test("collects the full showcase total and celebrates 70/70 exactly at completion", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await waitForRuntimeReady(page, "/?spawn=entrance");
    await page.evaluate(() => window.__KINEMA__.clearInteractionEvents());

    const progress = await collectEveryCoin(page);

    expect(progress).toEqual(Array.from({ length: 70 }, (_, index) => `${index + 1}/70`));
    await expect(page.locator(".collectible-count")).toHaveText("70/70");
    await expect(page.locator(".hud-collectible-chip")).toHaveClass(/is-all-collected/);
    await expect(page.locator(".hud-status-card", { hasText: "All 70 collectibles collected!" })).toHaveCount(1);
    expect(
      await page.evaluate(
        () =>
          window.__KINEMA__.getInteractionEvents().filter((event) => event.type === "collectible:allCollected").length,
      ),
    ).toBe(1);
    const frameStats = await page.evaluate(() => window.__KINEMA__.getFrameStats());
    expect(frameStats.samples).toBeGreaterThan(0);
    expect(Number.isFinite(frameStats.p95)).toBe(true);
    await testInfo.attach("kin025-celebration-frame-stats", {
      body: Buffer.from(JSON.stringify(frameStats, null, 2)),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath("kin025-70-of-70-celebration.png") });
    await page.locator(".hud-collectible-chip").screenshot({
      path: testInfo.outputPath("kin025-70-of-70-chip.png"),
    });
  });

  test("direct station loads spawn only that station's coin subset", async ({ page }) => {
    await waitForRuntimeReady(page, "/?station=door");

    expect(await getCoinCount(page)).toBe(0);
    expect(await page.evaluate(() => window.__KINEMA__.getCollectibleTotal())).toBe(5);
    await expect(page.locator(".collectible-count")).toHaveText("0/5");
    const stationCoins = await listCoins(page);
    expect(stationCoins.length).toBeGreaterThan(0);
    expect(stationCoins.every((coin) => coin.station === "door")).toBe(true);
  });

  test("reserved bay exposes zero collectible total and no debug collectibles", async ({ page }) => {
    await waitForRuntimeReady(page, "/?station=futureA");

    expect(await getCoinCount(page)).toBe(0);
    expect(await page.evaluate(() => window.__KINEMA__.getCollectibleTotal())).toBe(0);
    await expect(page.locator(".collectible-count")).toHaveText("0/0");
    expect(await listCoins(page)).toEqual([]);
  });

  test("compat renderer completes an isolated station through the same celebration path", async ({ page }) => {
    await waitForRuntimeReady(page, "/?station=door&forceWebGL=1");

    const progress = await collectEveryCoin(page);

    expect(progress).toEqual(["1/5", "2/5", "3/5", "4/5", "5/5"]);
    await expect(page.locator(".hud-collectible-chip")).toHaveClass(/is-all-collected/);
    await expect(page.locator(".hud-status-card", { hasText: "All 5 collectibles collected!" })).toHaveCount(1);
    expect(await page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().activeBackend)).toBe("WebGLRenderer");
  });
});
