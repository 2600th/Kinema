import { expect, test, type Page } from "@playwright/test";

const STATION_URL = "/?station=doubleJump";

type PlayerDebug = {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  isGrounded: boolean;
  state: string;
  verticalVelocity: number;
};

async function waitForReady(page: Page): Promise<void> {
  await page.goto(STATION_URL, { waitUntil: "domcontentloaded" });
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

async function simulateJump(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__KINEMA__.simulateJump());
}

async function waitForAirborne(page: Page): Promise<void> {
  const airborne = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.vy > 0.5 && !p.isGrounded", 10_000));
  expect(airborne).toBe(true);
}

async function waitForLanding(page: Page): Promise<void> {
  const landed = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.isGrounded === true", 15_000));
  expect(landed).toBe(true);
}

test.describe("Jump Mechanics", () => {
  test.beforeEach(async ({ page }) => {
    await waitForReady(page);
  });

  test("ground jump applies upward velocity", async ({ page }) => {
    const before = await getPlayer(page);
    expect(before.isGrounded).toBe(true);

    await simulateJump(page);
    await waitForAirborne(page);

    const after = await getPlayer(page);
    expect(after.velocity.y).toBeGreaterThan(0.5);
  });

  test("ground jump remains repeatable over multiple cycles", async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await simulateJump(page);
      await waitForAirborne(page);
      await waitForLanding(page);
    }
  });

  test("air jump adds new vertical impulse after the first jump", async ({ page }) => {
    await simulateJump(page);
    await waitForAirborne(page);
    const apexReady = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.vy < 2 && !p.isGrounded", 10_000));
    expect(apexReady).toBe(true);

    const beforeAirJump = await getPlayer(page);
    await simulateJump(page);
    const airJumped = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.vy > 2 && !p.isGrounded", 5_000));
    expect(airJumped).toBe(true);

    const afterAirJump = await getPlayer(page);
    expect(afterAirJump.velocity.y).toBeGreaterThan(beforeAirJump.velocity.y);
  });

  test("FSM enters airJump transient state and returns to air/ground states", async ({ page }) => {
    await simulateJump(page);
    const inAir = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.state === 'air'", 10_000));
    expect(inAir).toBe(true);

    const apexReady = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.vy < 2 && !p.isGrounded", 10_000));
    expect(apexReady).toBe(true);

    await simulateJump(page);
    const sawAirJump = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.state === 'airJump'", 5_000));
    expect(sawAirJump).toBe(true);

    const backToAir = await page.evaluate(() => (window as any).__KINEMA__.waitFor("p.state === 'air' && !p.isGrounded", 10_000));
    expect(backToAir).toBe(true);

    const landedInValidState = await page.evaluate(
      () => (window as any).__KINEMA__.waitFor("p.isGrounded && (p.state === 'idle' || p.state === 'move')", 15_000),
    );
    expect(landedInValidState).toBe(true);
  });
});
