import { expect, type Page, test } from "@playwright/test";
import { getShowcaseBayTopY, getShowcaseStationZ } from "../src/level/ShowcaseLayout";
import { waitForGrounded } from "./helpers/kinema";

test.describe.configure({ mode: "serial" });

const DOOR_BEACON_PLAYER_POSITION = {
  x: 4,
  y: getShowcaseBayTopY() + 0.325,
  z: getShowcaseStationZ("door"),
};

test("objective beacon requires a full hold and shows charge feedback", async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  await page.goto("/?station=door", { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 15_000 });
  await waitForGrounded(page);

  await page.evaluate((position) => {
    window.__KINEMA__.teleportPlayer(position);
    window.__KINEMA__.setCameraLook(-0.08, 0);
  }, DOOR_BEACON_PLAYER_POSITION);

  const prompt = page.locator("#hud-prompt");
  await expect(prompt).toContainText("Activate Beacon");

  await page.evaluate(() => {
    window.__KINEMA__.simulateHoldInteract(320);
  });

  await page.waitForFunction(
    () => {
      const el = document.getElementById("hud-hold");
      const progress = Number.parseFloat(el?.style.getPropertyValue("--hold-progress") || "0");
      return el?.classList.contains("is-visible") && progress > 0.08 && progress < 1;
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.screenshot({ path: testInfo.outputPath("beacon-charge-mid.png") });

  await page.evaluate(() => {
    window.__KINEMA__.clearSimulatedInput();
  });

  await page.waitForFunction(
    () => {
      const el = document.getElementById("hud-hold");
      return (
        !el?.classList.contains("is-visible") && document.getElementById("hud-prompt")?.textContent?.includes("Hold F")
      );
    },
    undefined,
    { timeout: 12_000 },
  );

  await page.evaluate(() => {
    window.__KINEMA__.clearInteractionEvents();
    window.__KINEMA__.simulateHoldInteract(720);
  });

  await page.waitForFunction(
    () => {
      const hold = document.getElementById("hud-hold");
      return (
        !hold?.classList.contains("is-visible") &&
        window.__KINEMA__.getInteractionEvents().some((event) => event.type === "objective:beaconActivated")
      );
    },
    undefined,
    { timeout: 90_000 },
  );

  await expect(prompt).not.toHaveClass(/is-visible/);
  await page.screenshot({ path: testInfo.outputPath("beacon-charge-complete.png") });
});

const CHECKPOINT_PLAYER_POSITION = {
  x: 10,
  y: getShowcaseBayTopY() + 0.325,
  z: getShowcaseStationZ("door"),
};

async function completeProceduralBeacon(page: Page, url: string, useSimulatedInput = false): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
  await waitForGrounded(page);
  await expect(page.locator("#hud-objective")).toContainText("Reach a checkpoint");

  await page.evaluate((position) => {
    window.__KINEMA__.clearInteractionEvents();
    window.__KINEMA__.teleportPlayer(position);
  }, CHECKPOINT_PLAYER_POSITION);
  await expect(page.locator("#hud-objective")).toContainText("Activate the beacon", { timeout: 15_000 });

  await page.evaluate((position) => {
    window.__KINEMA__.teleportPlayer(position);
    window.__KINEMA__.setCameraLook(-0.08, 0);
  }, DOOR_BEACON_PLAYER_POSITION);
  await expect(page.locator("#hud-prompt")).toContainText("Activate Beacon", { timeout: 15_000 });

  await page.locator("canvas").click({ position: { x: 960, y: 540 }, force: true });
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.tagName ?? null)).toBe("CANVAS");
  await page.evaluate((simulate) => {
    if (simulate) {
      window.__KINEMA__.simulateHoldInteract(720);
      return;
    }
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF", key: "f", bubbles: true }));
  }, useSimulatedInput);
  try {
    await page.waitForFunction(
      () => window.__KINEMA__.getInteractionEvents().some((event) => event.type === "objective:beaconActivated"),
      undefined,
      { timeout: useSimulatedInput ? 120_000 : 60_000 },
    );
  } finally {
    await page.evaluate((simulate) => {
      if (simulate) {
        window.__KINEMA__.clearSimulatedInput();
        return;
      }
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyF", key: "f", bubbles: true }));
    }, useSimulatedInput);
  }

  await expect(page.locator("#hud-objective")).toContainText("All objectives complete", { timeout: 15_000 });
  await expect(page.locator(".hud-status-card").filter({ hasText: "All objectives complete" })).toBeVisible();
  await expect(page.locator("#hud-prompt")).not.toHaveClass(/is-visible/);

  const events = await page.evaluate(() => window.__KINEMA__.getInteractionEvents());
  expect(events.filter((event) => event.type === "objective:beaconActivated")).toEqual([
    { type: "objective:beaconActivated", id: "beacon1" },
  ]);
  expect(events).toContainEqual({ type: "interaction:triggered", id: "beacon1", outcome: "activated" });

  await page.evaluate((position) => {
    window.__KINEMA__.teleportPlayer({ ...position, x: position.x + 12 });
    window.__KINEMA__.teleportPlayer(position);
  }, DOOR_BEACON_PLAYER_POSITION);
  await page.waitForTimeout(250);
  await expect(page.locator("#hud-prompt")).not.toHaveClass(/is-visible/);
  expect(
    await page.evaluate(
      () =>
        window.__KINEMA__.getInteractionEvents().filter((event) => event.type === "objective:beaconActivated").length,
    ),
  ).toBe(1);
}

for (const rendererCase of [
  { name: "default renderer", url: "/?spawn=door", backend: null, simulate: false },
  {
    name: "forced WebGL compatibility renderer",
    url: "/?spawn=door&forceWebGL=1",
    backend: "WebGLRenderer",
    simulate: true,
  },
] as const) {
  test(`full procedural beacon lifecycle completes on the ${rendererCase.name}`, async ({ page }, testInfo) => {
    test.setTimeout(rendererCase.simulate ? 300_000 : 180_000);
    await completeProceduralBeacon(page, rendererCase.url, rendererCase.simulate);
    if (rendererCase.backend) {
      expect(await page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().activeBackend)).toBe(
        rendererCase.backend,
      );
    }
    if (!rendererCase.backend) {
      await page.screenshot({ path: testInfo.outputPath("procedural-objectives-complete.png") });
    }
  });
}

test.describe("touch beacon activation", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("holding the touch interact control activates and retires the beacon", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/?station=door", { waitUntil: "domcontentloaded" });
    await waitForGrounded(page);
    await page.evaluate((position) => {
      window.__KINEMA__.clearInteractionEvents();
      window.__KINEMA__.teleportPlayer(position);
      window.__KINEMA__.setCameraLook(-0.08, 0);
    }, DOOR_BEACON_PLAYER_POSITION);
    const interact = page.locator(".touch-btn--interact");
    await expect(interact).toBeVisible();
    await expect(page.locator("#hud-prompt")).toContainText("Activate Beacon");

    const box = await interact.boundingBox();
    if (!box) throw new Error("Touch interact button has no layout box");
    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    try {
      await page.waitForFunction(
        () => window.__KINEMA__.getInteractionEvents().some((event) => event.type === "objective:beaconActivated"),
        undefined,
        { timeout: 60_000 },
      );
    } finally {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }

    await expect(page.locator("#hud-prompt")).not.toHaveClass(/is-visible/, { timeout: 15_000 });
    expect(await page.evaluate(() => window.__KINEMA__.getInteractionEvents())).toContainEqual({
      type: "interaction:triggered",
      id: "beacon1",
      outcome: "activated",
    });
  });
});
