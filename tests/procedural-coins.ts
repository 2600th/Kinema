import { expect, test, type Page } from "@playwright/test";

type CoinDebugEntry = {
  id: string;
  station: string;
  value: number;
  position: { x: number; y: number; z: number };
};

async function waitForRuntimeReady(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__KINEMA__), undefined, { timeout: 60_000 });
  const grounded = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 60_000));
  expect(grounded).toBe(true);
}

async function getCoinCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__KINEMA__.getCollectibleCount());
}

async function listCoins(page: Page): Promise<CoinDebugEntry[]> {
  return page.evaluate(() => (window as any).__KINEMA__.listCollectibles());
}

async function collectCoin(page: Page, id?: string): Promise<void> {
  const teleported = await page.evaluate((coinId) => (window as any).__KINEMA__.teleportToCollectible(coinId), id);
  expect(teleported).toBe(true);
}

test.describe("Procedural Coins", () => {
  test("collecting coins increments the runtime collectible count and removes them from the debug list", async ({ page }) => {
    await waitForRuntimeReady(page, "/?spawn=entrance");

    expect(await getCoinCount(page)).toBe(0);

    const initialCoins = await listCoins(page);
    expect(initialCoins.length).toBeGreaterThan(8);

    const [firstCoin, secondCoin] = initialCoins;
    expect(firstCoin).toBeDefined();
    expect(secondCoin).toBeDefined();

    await collectCoin(page, firstCoin.id);
    await page.waitForFunction(() => (window as any).__KINEMA__.getCollectibleCount() === 1, undefined, { timeout: 10_000 });

    let remaining = await listCoins(page);
    expect(remaining.some((coin) => coin.id === firstCoin.id)).toBe(false);

    await collectCoin(page, secondCoin.id);
    await page.waitForFunction(() => (window as any).__KINEMA__.getCollectibleCount() === 2, undefined, { timeout: 10_000 });

    remaining = await listCoins(page);
    expect(remaining.some((coin) => coin.id === secondCoin.id)).toBe(false);
    expect(remaining.length).toBe(initialCoins.length - 2);
  });

  test("direct station loads spawn only that station's coin subset", async ({ page }) => {
    await waitForRuntimeReady(page, "/?station=door");

    expect(await getCoinCount(page)).toBe(0);
    const stationCoins = await listCoins(page);
    expect(stationCoins.length).toBeGreaterThan(0);
    expect(stationCoins.every((coin) => coin.station === "door")).toBe(true);
  });
});
