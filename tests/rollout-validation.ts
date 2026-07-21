import { expect, type Locator, type Page, test } from "@playwright/test";
import { DEFAULT_PLAYER_CONFIG, GRAVITY, MAX_PHYSICS_STEPS, PHYSICS_TIMESTEP } from "../src/core/constants";
import { getShowcaseBayTopY, getShowcaseStationZ, SHOWCASE_STATION_ORDER } from "../src/level/ShowcaseLayout";
import { SHOWCASE_NON_INTERACTIVE_BAY_CLASSIFICATIONS } from "../src/level/showcaseBayClassification";
import {
  waitForGamepadPoll,
  waitForGrounded,
  waitForInputRelease,
  waitForLoadingGone,
  waitForRenderFrame,
} from "./helpers/kinema";

const RENDERERS = [
  { name: "default", query: "", backend: "WebGPU (WebGL2 backend)", badge: "WebGPU / WebGL2" },
  {
    name: "webgpu-webgl2",
    query: "&forceWebGPUWebGL=1",
    backend: "WebGPU (WebGL2 backend)",
    badge: "WebGPU / WebGL2",
  },
  { name: "compat", query: "&forceWebGL=1", backend: "WebGLRenderer", badge: "WebGL" },
] as const;
const PROFILES = ["performance", "balanced", "cinematic"] as const;
const INPUTS = ["keyboard", "gamepad", "touch"] as const;
const DOOR_POSITION = { x: 0, y: getShowcaseBayTopY() + 0.325, z: getShowcaseStationZ("door") + 2 };
const THROW_PICKUP_POSITION = { x: -6.65, y: -0.25, z: getShowcaseStationZ("throw") + 3.7 };
const BACK_CHECKPOINT_POSITION = {
  x: 18,
  y: getShowcaseBayTopY() + 0.325,
  z: getShowcaseStationZ("vfx") - 15,
};
const BOOST_PAD_CONTACT_CLEARANCE = 0.01;
const COIN_VISUAL_RADIUS = 0.62;
const COIN_CLEARANCE_EPSILON = 0.01;
const DOOR_PROMPT_TIMEOUT_MS = 30_000;
const COIN_COLLECTION_SAMPLE_IDS: Partial<Record<(typeof SHOWCASE_STATION_ORDER)[number], string>> = {
  platformsMoving: "platformsMoving-coin-4",
  platformsPhysics: "platformsPhysics-coin-2",
};
// GrabGoalSystem resets in fixedUpdate before physics.step. One render frame can then run up to
// MAX_PHYSICS_STEPS (currently four) semi-implicit gravity steps, whose vertical displacements are
// g·dt², 2g·dt², ... N·g·dt². Their triangular sum bounds only browser-observed y drift; the exact
// unit reset remains unchanged, while horizontal position and quaternion checks stay strict.
const RESET_MAX_Y_DISPLACEMENT = GRAVITY * PHYSICS_TIMESTEP ** 2 * ((MAX_PHYSICS_STEPS * (MAX_PHYSICS_STEPS + 1)) / 2);
const VFX_PROFILE_TARGETS = {
  performance: {
    configured: 1120,
    sparkles: 140,
    motes: 21,
    grassBlades: 840,
    embers: 14,
    rain: 70,
    orbit: 35,
  },
  balanced: {
    configured: 2080,
    sparkles: 260,
    motes: 39,
    grassBlades: 1560,
    embers: 26,
    rain: 130,
    orbit: 65,
  },
  cinematic: {
    configured: 3200,
    sparkles: 400,
    motes: 60,
    grassBlades: 2400,
    embers: 40,
    rain: 200,
    orbit: 100,
  },
} as const;

type InputSource = (typeof INPUTS)[number];
type GamepadState = { activeButton: number | null; calls: number };

test.use({ hasTouch: true });

function installStandardGamepad(): void {
  const state: GamepadState = { activeButton: null, calls: 0 };
  Object.defineProperty(window, "__KINEMA_TEST_GAMEPAD__", { value: state, configurable: true });
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => {
      state.calls += 1;
      return [
        {
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 16 }, (_, index) => ({
            pressed: state.activeButton === index,
            touched: state.activeButton === index,
            value: state.activeButton === index ? 1 : 0,
          })),
          connected: true,
          id: "Kinema rollout standard gamepad",
          index: 0,
          mapping: "standard",
          timestamp: performance.now(),
          vibrationActuator: null,
        },
      ];
    },
  });
}

async function setGamepadButton(page: Page, button: number | null): Promise<void> {
  const previousCalls = await page.evaluate((activeButton) => {
    const state = (window as unknown as { __KINEMA_TEST_GAMEPAD__: GamepadState }).__KINEMA_TEST_GAMEPAD__;
    state.activeButton = activeButton;
    return state.calls;
  }, button);
  await waitForGamepadPoll(page, previousCalls);
}

async function dispatchTouch(button: Locator, type: "touchstart" | "touchend", identifier = 41): Promise<void> {
  await button.evaluate(
    (element, args) => {
      const rect = element.getBoundingClientRect();
      const touch = new Touch({
        identifier: args.identifier,
        target: element,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      });
      const activeTouches = args.type === "touchstart" ? [touch] : [];
      element.dispatchEvent(
        new TouchEvent(args.type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          changedTouches: [touch],
          targetTouches: activeTouches,
          touches: activeTouches,
        }),
      );
    },
    { identifier, type },
  );
}

async function releaseInputSource(page: Page, source: InputSource): Promise<void> {
  if (source === "gamepad") await setGamepadButton(page, null);
  if (source === "touch") {
    const interact = page.locator(".touch-btn--interact");
    if (await interact.evaluate((element) => element.classList.contains("active"))) {
      await dispatchTouch(interact, "touchend");
    }
  }
  await page.keyboard.up("KeyF");
}

async function activateInputSource(page: Page, source: InputSource): Promise<void> {
  if (source === "keyboard") {
    await page.keyboard.press("KeyZ");
    return;
  }
  if (source === "gamepad") {
    await setGamepadButton(page, 12);
    await setGamepadButton(page, null);
    return;
  }
  const crouch = page.locator(".touch-btn--crouch");
  await expect(crouch).toBeVisible();
  await dispatchTouch(crouch, "touchstart", 43);
  await dispatchTouch(crouch, "touchend", 43);
}

async function waitForStableGrounded(page: Page, message: string): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const deadline = performance.now() + 60_000;
          let consecutiveGroundedFrames = 0;
          const sample = () => {
            consecutiveGroundedFrames = window.__KINEMA__.player.isGrounded ? consecutiveGroundedFrames + 1 : 0;
            if (consecutiveGroundedFrames >= 5) {
              resolve(true);
              return;
            }
            if (performance.now() >= deadline) {
              resolve(false);
              return;
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    ),
    message,
  ).toBe(true);
}

async function pulseDoorAction(page: Page, source: InputSource): Promise<void> {
  if (source === "keyboard") {
    await page.keyboard.press("KeyF");
    await waitForRenderFrame(page);
    return;
  }
  if (source === "gamepad") {
    await setGamepadButton(page, 2);
    await setGamepadButton(page, null);
    return;
  }
  const interact = page.locator(".touch-btn--interact");
  await dispatchTouch(interact, "touchstart");
  await dispatchTouch(interact, "touchend");
  await waitForRenderFrame(page);
}

async function proveDoorActionAndReset(page: Page, source: InputSource): Promise<void> {
  await page.evaluate((position) => {
    window.__KINEMA__.clearInteractionEvents();
    window.__KINEMA__.teleportPlayer(position);
    window.__KINEMA__.setCameraLook(-0.08, 0);
  }, DOOR_POSITION);
  await waitForStableGrounded(page, `${source} door approach remains grounded across physics frames`);
  const expectedGlyph = source === "keyboard" ? "F" : source === "gamepad" ? "X" : "✋";
  await expect(page.locator("#hud-prompt")).toContainText(`${expectedGlyph} to Open Door`, {
    timeout: DOOR_PROMPT_TIMEOUT_MS,
  });

  await pulseDoorAction(page, source);
  await expect
    .poll(() => page.evaluate(() => window.__KINEMA__.getInteractionEvents()), { timeout: 60_000 })
    .toContainEqual({ type: "interaction:doorToggled", id: "door1", open: true });
  await expect(page.locator("#hud-prompt")).toContainText(`${expectedGlyph} to Close Door`, {
    timeout: DOOR_PROMPT_TIMEOUT_MS,
  });
  await waitForInputRelease(page);
  await expect
    .poll(() => page.evaluate(() => window.__KINEMA__.player.state), { timeout: 60_000 })
    .not.toBe("interact");

  await pulseDoorAction(page, source);
  await expect
    .poll(() => page.evaluate(() => window.__KINEMA__.getInteractionEvents()), { timeout: 60_000 })
    .toContainEqual({ type: "interaction:doorToggled", id: "door1", open: false });
  await waitForInputRelease(page);
  await expect
    .poll(() => page.evaluate(() => window.__KINEMA__.player.state), { timeout: 60_000 })
    .not.toBe("interact");
  await expect(page.locator("#hud-prompt")).toContainText(`${expectedGlyph} to Open Door`, {
    timeout: DOOR_PROMPT_TIMEOUT_MS,
  });
}

async function proveGrabGoalReset(page: Page): Promise<void> {
  const authored = await page.evaluate(() => window.__KINEMA__.getDynamicBodyState("PushCubeS_dyn"));
  expect(authored).not.toBeNull();
  expect(await page.evaluate(() => window.__KINEMA__.placeGrabCubeOnGoal("PushCubeS"))).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__KINEMA__.getGrabGoalState().phase), { timeout: 60_000 })
    .toBe("completed");
  const restored = await page.evaluate(
    () =>
      new Promise<ReturnType<typeof window.__KINEMA__.getDynamicBodyState>>((resolve) => {
        const deadline = performance.now() + 60_000;
        const sampleReset = () => {
          if (window.__KINEMA__.getGrabGoalState().phase === "ready") {
            resolve(window.__KINEMA__.getDynamicBodyState("PushCubeS_dyn"));
            return;
          }
          if (performance.now() >= deadline) {
            resolve(null);
            return;
          }
          requestAnimationFrame(sampleReset);
        };
        requestAnimationFrame(sampleReset);
      }),
  );
  expect(restored).not.toBeNull();
  if (!authored || !restored) return;
  for (const component of ["x", "z"] as const) {
    expect(Math.abs(restored.position[component] - authored.position[component])).toBeLessThanOrEqual(1e-3);
  }
  expect(Math.abs(restored.position.y - authored.position.y)).toBeLessThanOrEqual(RESET_MAX_Y_DISPLACEMENT);
  for (const component of ["x", "y", "z", "w"] as const) {
    expect(Math.abs(restored.rotation[component] - authored.rotation[component])).toBeLessThanOrEqual(1e-3);
  }
}

async function proveRealThrowRefill(page: Page): Promise<void> {
  const pickedIds: string[] = [];
  let pickedSlot: number | null = null;
  await page.evaluate(() => window.__KINEMA__.clearInteractionEvents());
  for (let cycle = 0; cycle < 4; cycle++) {
    let expectedActiveId: string | null = null;
    if (pickedSlot !== null) {
      const slot = pickedSlot;
      await expect
        .poll(
          () =>
            page.evaluate(
              (slotIndex) => window.__KINEMA__.getThrowablePoolDebugState().slots[slotIndex]?.activeId ?? null,
              slot,
            ),
          { message: `throw cycle ${cycle + 1} receives a real table refill`, timeout: 120_000 },
        )
        .not.toBeNull();
      expectedActiveId = await page.evaluate(
        (slotIndex) => window.__KINEMA__.getThrowablePoolDebugState().slots[slotIndex]?.activeId ?? null,
        slot,
      );
    }
    await page.evaluate((position) => {
      window.__KINEMA__.teleportPlayer(position);
      window.__KINEMA__.setCameraLook(-0.08, 0);
    }, THROW_PICKUP_POSITION);
    await waitForGrounded(page);
    await expect(page.locator("#hud-prompt")).toContainText("Pick Up", { timeout: 30_000 });
    await page.keyboard.down("KeyF");
    try {
      await expect
        .poll(() => page.evaluate(() => window.__KINEMA__.player.state), {
          message: `throw cycle ${cycle + 1} enters carry through real input`,
          timeout: 30_000,
        })
        .toBe("carry");
    } finally {
      await page.keyboard.up("KeyF");
      await waitForInputRelease(page);
    }
    await expect
      .poll(() =>
        page.evaluate(() => {
          const events = window.__KINEMA__.getInteractionEvents();
          return [...events].reverse().find((event) => event.type === "interaction:triggered")?.id ?? null;
        }),
      )
      .toMatch(/^throw-\d+-/);
    const pickedId = await page.evaluate(() => {
      const events = window.__KINEMA__.getInteractionEvents();
      return [...events].reverse().find((event) => event.type === "interaction:triggered")?.id ?? "";
    });
    if (expectedActiveId !== null) expect(pickedId).toBe(expectedActiveId);
    pickedIds.push(pickedId);
    pickedSlot ??= Number(pickedId.split("-")[1]);
    // Throw into the open corridor behind the pickup table so the body crosses the real recycle radius.
    await page.evaluate(() => window.__KINEMA__.setCameraLook(-0.18, Math.PI));
    await waitForRenderFrame(page);
    await waitForRenderFrame(page);
    await page.mouse.down({ button: "left" });
    try {
      await expect
        .poll(() => page.evaluate(() => window.__KINEMA__.player.state), {
          message: `throw cycle ${cycle + 1} exits carry through real primary input`,
          timeout: 30_000,
        })
        .not.toBe("carry");
    } finally {
      await page.mouse.up({ button: "left" });
      await waitForInputRelease(page);
    }
    if (cycle < 3 && pickedSlot !== null) {
      const slot = pickedSlot;
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ id, slotIndex }) =>
                window.__KINEMA__.getThrowablePoolDebugState().slots[slotIndex]?.reserveIds.includes(id) ?? false,
              { id: pickedId, slotIndex: slot },
            ),
          { message: `throw cycle ${cycle + 1} crosses the recycle boundary`, timeout: 120_000 },
        )
        .toBe(true);
    }
  }
  const pickedParts = pickedIds.map((id) => id.split("-").map(Number));
  expect(pickedParts.map(([, slot]) => slot)).toEqual(Array(4).fill(pickedParts[0]?.[1]));
  expect(new Set(pickedIds.slice(0, 3)).size).toBe(3);
  expect(pickedIds.slice(0, 3)).toContain(pickedIds[3]);
  await page.evaluate((position) => {
    window.__KINEMA__.teleportPlayer(position);
    window.__KINEMA__.setCameraLook(-0.08, 0);
  }, THROW_PICKUP_POSITION);
  await waitForGrounded(page);
  await expect(page.locator("#hud-prompt")).toContainText("Pick Up", { timeout: 30_000 });
}

async function proveCoinSupport(page: Page): Promise<void> {
  const coins = await page.evaluate(() => window.__KINEMA__.listCollectibles());
  expect(coins).toHaveLength(70);
  const samples = await page.evaluate(
    ({ entries, epsilon, radius }) => {
      const footprintOffsets = [
        { x: 0, z: 0 },
        { x: radius * 0.5, z: 0 },
        { x: -radius * 0.5, z: 0 },
        { x: 0, z: radius * 0.5 },
        { x: 0, z: -radius * 0.5 },
      ];
      return entries.map((coin) => ({
        id: coin.id,
        rays: footprintOffsets.map(({ x, z }) => {
          const top = { x: coin.position.x + x, y: coin.position.y + radius, z: coin.position.z + z };
          const bottomInside = {
            x: coin.position.x + x,
            y: coin.position.y - radius + epsilon,
            z: coin.position.z + z,
          };
          const bottom = { x: bottomInside.x, y: coin.position.y - radius, z: bottomInside.z };
          return {
            downClearance: window.__KINEMA__.castWorldRay(top, { x: 0, y: -1, z: 0 }, radius * 2 - epsilon, {
              fixedOnly: true,
            }),
            upClearance: window.__KINEMA__.castWorldRay(bottomInside, { x: 0, y: 1, z: 0 }, radius * 2 - epsilon, {
              fixedOnly: true,
            }),
            support: window.__KINEMA__.castWorldRay(bottom, { x: 0, y: -1, z: 0 }, 12, { fixedOnly: true }),
          };
        }),
      }));
    },
    { entries: coins, epsilon: COIN_CLEARANCE_EPSILON, radius: COIN_VISUAL_RADIUS },
  );
  for (const sample of samples) {
    for (const ray of sample.rays) {
      expect(ray.downClearance, `${sample.id} has downward visual clearance`).toBeNull();
      expect(ray.upClearance, `${sample.id} has upward visual clearance`).toBeNull();
      expect(ray.support, `${sample.id} has fixed-world support`).not.toBeNull();
      expect(ray.support?.normal.y ?? 0, `${sample.id} support faces upward`).toBeGreaterThan(0.5);
    }
  }
}

async function proveCoinCollection(page: Page): Promise<void> {
  for (const station of SHOWCASE_STATION_ORDER.filter((key) => key !== "futureA")) {
    const coin = await page.evaluate(
      ({ preferredId, stationKey }) => {
        const stationCoins = window.__KINEMA__
          .listCollectibles()
          .filter((entry) => entry.station === stationKey)
          .sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id));
        return (preferredId ? stationCoins.find((entry) => entry.id === preferredId) : stationCoins[0]) ?? null;
      },
      {
        preferredId: COIN_COLLECTION_SAMPLE_IDS[station] ?? null,
        stationKey: station,
      },
    );
    expect(coin, `${station} real collection sample`).not.toBeNull();
    if (!coin) continue;
    const engineCanvas = page.locator("canvas[data-engine]");
    if (
      !(await page.evaluate(
        () => document.pointerLockElement === document.querySelector<HTMLCanvasElement>("canvas[data-engine]"),
      ))
    ) {
      await engineCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.requestPointerLock());
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => document.pointerLockElement === document.querySelector<HTMLCanvasElement>("canvas[data-engine]"),
        ),
      )
      .toBe(true);
    const before = await page.evaluate(() => window.__KINEMA__.getCollectibleCount());
    // The moving station samples its static ground lane; moving-platform behavior is proved separately below.
    const approachOffset = 1.2;
    await page.evaluate(
      ({ target, offset }) => {
        window.__KINEMA__.teleportPlayer({ x: target.x + offset, y: target.y, z: target.z });
        window.__KINEMA__.setCameraLook(0, Math.PI / 2);
      },
      { offset: approachOffset, target: coin.position },
    );
    // Require a stable grounded window so a stale pre-teleport flag cannot pass this synchronization point.
    await waitForStableGrounded(page, `${station} approach remains grounded across physics frames`);
    expect(await page.evaluate(() => window.__KINEMA__.getCollectibleCount())).toBe(before);
    const preCollection = await page.evaluate(() => ({
      count: window.__KINEMA__.getCollectibleCount(),
      inputSource: window.__KINEMA__.getInputSource(),
      player: window.__KINEMA__.player,
      pointerLocked: document.pointerLockElement === document.querySelector<HTMLCanvasElement>("canvas[data-engine]"),
    }));
    await page.evaluate((target) => {
      const player = window.__KINEMA__.player.position;
      window.__KINEMA__.setCameraLook(0, Math.atan2(player.x - target.x, player.z - target.z));
    }, coin.position);
    await waitForRenderFrame(page);
    await waitForRenderFrame(page);
    let postCollection = preCollection;
    if (coin.position.y - preCollection.player.position.y > 0.9) {
      try {
        await page.keyboard.press("Space");
        await page.waitForFunction(
          ({ expectedCount, minimumY }) =>
            window.__KINEMA__.getCollectibleCount() === expectedCount ||
            window.__KINEMA__.player.position.y >= minimumY,
          { expectedCount: before + 1, minimumY: coin.position.y - 0.5 },
          { polling: "raf", timeout: 30_000 },
        );
      } catch (error) {
        postCollection = await page.evaluate(() => ({
          count: window.__KINEMA__.getCollectibleCount(),
          inputSource: window.__KINEMA__.getInputSource(),
          player: window.__KINEMA__.player,
          pointerLocked:
            document.pointerLockElement === document.querySelector<HTMLCanvasElement>("canvas[data-engine]"),
        }));
        throw new Error(
          `${station} jump evidence: ${JSON.stringify({
            approachOffset,
            candidate: coin,
            expectedCount: before + 1,
            postCollection,
            preCollection,
          })}`,
          { cause: error },
        );
      }
    }
    await page.keyboard.down("KeyW");
    try {
      try {
        await page.waitForFunction(
          (expectedCount) => window.__KINEMA__.getCollectibleCount() === expectedCount,
          before + 1,
          { polling: "raf", timeout: 30_000 },
        );
        await expect
          .poll(
            async () => {
              postCollection = await page.evaluate(() => ({
                count: window.__KINEMA__.getCollectibleCount(),
                inputSource: window.__KINEMA__.getInputSource(),
                player: window.__KINEMA__.player,
                pointerLocked:
                  document.pointerLockElement === document.querySelector<HTMLCanvasElement>("canvas[data-engine]"),
              }));
              return postCollection.count;
            },
            {
              message: `${station} real collection increments the count`,
              timeout: 5_000,
            },
          )
          .toBe(before + 1);
      } catch (error) {
        postCollection = await page.evaluate(() => ({
          count: window.__KINEMA__.getCollectibleCount(),
          inputSource: window.__KINEMA__.getInputSource(),
          player: window.__KINEMA__.player,
          pointerLocked:
            document.pointerLockElement === document.querySelector<HTMLCanvasElement>("canvas[data-engine]"),
        }));
        throw new Error(
          `${station} collection evidence: ${JSON.stringify({
            approachOffset,
            candidate: coin,
            expectedCount: before + 1,
            postCollection,
            preCollection,
          })}`,
          { cause: error },
        );
      }
    } finally {
      await page.keyboard.up("KeyW");
    }
  }
}

async function provePhysicsPlatformSafety(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({
    boost: window.__KINEMA__.getLevelObjectState("BoostPlatformStatic_col"),
    boundary: window.__KINEMA__.getLevelObjectState("ShowcaseBoundaryWall_L_col"),
  }));
  expect(geometry.boost).not.toBeNull();
  expect(geometry.boundary).not.toBeNull();
  if (!geometry.boost || !geometry.boundary) return;
  const launch = await page.evaluate(
    async ({ boost, boundary, capsuleExtent, contactClearance }) => {
      const k = window.__KINEMA__;
      const outerWallX = boundary.position.x - boundary.size.x * 0.5;
      const startY = boost.position.y + boost.size.y * 0.5 + capsuleExtent + contactClearance;
      k.setCameraLook(0, Math.PI / 2);
      k.startPlayerMotionCapture();
      k.simulateMove(0, 1, 600);
      k.teleportPlayer({ x: boost.position.x, y: startY, z: boost.position.z });
      return new Promise<{ crossed: boolean; health: number; launched: boolean; maxY: number }>((resolve) => {
        const startedAt = performance.now();
        let launched = false;
        const sample = () => {
          const player = k.player;
          launched ||= player.velocity.y > 5 || player.position.y > startY + 0.25;
          const crossed = player.position.x < outerWallX;
          const timedOut = performance.now() - startedAt > 30_000;
          if ((launched && player.isGrounded && performance.now() - startedAt > 1_000) || crossed || timedOut) {
            k.clearSimulatedInput();
            const capture = k.stopPlayerMotionCapture();
            resolve({
              crossed: crossed || capture.minX < outerWallX,
              health: k.getHealth().current,
              launched,
              maxY: capture.maxY,
            });
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    },
    {
      boost: geometry.boost,
      boundary: geometry.boundary,
      contactClearance: BOOST_PAD_CONTACT_CLEARANCE,
      capsuleExtent: DEFAULT_PLAYER_CONFIG.capsuleHalfHeight + DEFAULT_PLAYER_CONFIG.capsuleRadius,
    },
  );
  expect(launch.launched).toBe(true);
  expect(launch.maxY).toBeGreaterThan(2);
  expect(launch.crossed).toBe(false);
  expect(launch.health).toBe(3);
}

test.describe("showcase rollout validation", () => {
  test.describe.configure({ mode: "serial" });

  for (const rendererCase of RENDERERS) {
    test(`${rendererCase.name} produces all profile and input observations`, async ({ page }) => {
      test.setTimeout(1_200_000);
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.addInitScript(installStandardGamepad);
      await page.goto(`/?spawn=entrance${rendererCase.query}`, { waitUntil: "domcontentloaded" });
      const renderCanvas = page.locator("canvas[data-engine]");
      await renderCanvas.waitFor({ state: "visible", timeout: 60_000 });
      await waitForLoadingGone(page);
      await waitForGrounded(page);
      if (rendererCase.name === "default") {
        await proveCoinSupport(page);
        await proveCoinCollection(page);
      }
      await renderCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.requestPointerLock());
      await expect.poll(() => page.evaluate(() => document.pointerLockElement?.tagName ?? null)).toBe("CANVAS");
      await waitForRenderFrame(page);

      const observations: Array<{ renderer: string; profile: string; input: string; vfxConfigured: number }> = [];
      for (const profile of PROFILES) {
        expect(await page.evaluate((value) => window.__KINEMA__.setGraphicsProfile(value), profile)).toBe(profile);
        await expect
          .poll(() => page.evaluate(() => window.__KINEMA__.getRendererDebugFlags().graphicsProfile), {
            timeout: 60_000,
          })
          .toBe(profile);
        for (const input of INPUTS) {
          await releaseInputSource(page, input);
          await activateInputSource(page, input);
          await expect
            .poll(() => page.evaluate(() => window.__KINEMA__.getInputSource()), { timeout: 60_000 })
            .toBe(input);
          for (const spawn of ["steps", "movement"] as const) {
            expect(await page.evaluate((key) => window.__KINEMA__.teleportToReviewSpawn(key), spawn)).toBe(true);
            await waitForGrounded(page);
          }
          await test.step(`${profile}/${input} door action and reset`, () => proveDoorActionAndReset(page, input));
          const flags = await page.evaluate(() => window.__KINEMA__.getRendererDebugFlags());
          const vfxState = await page.evaluate(() => window.__KINEMA__.getVfxDebugState());
          expect(flags.activeBackend).toBe(rendererCase.backend);
          expect(flags.graphicsProfile).toBe(profile);
          expect(vfxState.selectedProfile).toBe(profile);
          expect(vfxState.selectedProfileTarget).toEqual(VFX_PROFILE_TARGETS[profile]);
          await expect(page.locator("#renderer-status-badge")).toHaveText(`${rendererCase.badge} · ${profile}`);
          observations.push({
            renderer: rendererCase.name,
            profile,
            input,
            vfxConfigured: vfxState.selectedProfileTarget.configured,
          });
          await releaseInputSource(page, input);
        }
      }
      expect(observations).toEqual(
        PROFILES.flatMap((profile) =>
          INPUTS.map((input) => ({
            renderer: rendererCase.name,
            profile,
            input,
            vfxConfigured: VFX_PROFILE_TARGETS[profile].configured,
          })),
        ),
      );

      const signs = await page.evaluate(
        (stations) => stations.map((station) => window.__KINEMA__.getLevelObjectState(`StationSign_${station}`)),
        SHOWCASE_STATION_ORDER,
      );
      expect(signs).toHaveLength(14);
      expect(signs.every((sign) => sign?.visible && sign.labelText)).toBe(true);
      const reviewStructures = await page.evaluate(
        (names) => {
          return Object.fromEntries(names.map((name) => [name, window.__KINEMA__.getLevelObjectState(name)]));
        },
        ["StepsTooTallCue_col", "SlopesTooSteepMarker", "GrabGoalOutline", "GrabGoalCore", "GrabGoalLabel"],
      );
      expect(reviewStructures.StepsTooTallCue_col?.visible).toBe(true);
      expect(reviewStructures.SlopesTooSteepMarker?.visible).toBe(true);
      expect(reviewStructures.GrabGoalOutline?.visible).toBe(true);
      expect(reviewStructures.GrabGoalCore?.visible).toBe(true);
      expect(reviewStructures.GrabGoalLabel?.visible).toBe(true);
      expect(await page.evaluate(() => window.__KINEMA__.getLevelObjectState("StepsTooTallLabel")?.labelText)).toBe(
        "Too tall — jump",
      );
      expect(await page.evaluate(() => window.__KINEMA__.getLevelObjectState("SlopesTooSteepLabel")?.labelText)).toBe(
        "Too steep — slide",
      );
      expect(await page.evaluate(() => window.__KINEMA__.getLevelObjectState("GrabGoalLabel")?.labelText)).toBe(
        "Deliver a cube\nTarget resets automatically",
      );
      expect(await page.evaluate(() => window.__KINEMA__.getLevelObjectState("StationSign_futureA")?.labelText)).toBe(
        "Reserved\nFuture demos",
      );
      expect(
        (await page.evaluate(() => window.__KINEMA__.listCollectibles())).filter((coin) => coin.station === "futureA"),
      ).toHaveLength(0);

      const vfx = await page.evaluate(() => ({
        state: window.__KINEMA__.getVfxDebugState(),
        label: window.__KINEMA__.getLevelObjectState("StationSign_vfx")?.labelText,
      }));
      expect(vfx.state.selectedProfile).toBe("cinematic");
      expect(vfx.state.buildProfile).toBe("balanced");
      expect(vfx.state.density).toBe(0.65);
      expect(vfx.state.selectedProfileTarget).toEqual(VFX_PROFILE_TARGETS.cinematic);
      expect(vfx.state.ambient).toMatchObject(
        rendererCase.backend === "WebGLRenderer"
          ? {
              configured: 299,
              sparkles: { configuredCount: 260 },
              motes: 39,
              grassBlades: 0,
              embers: 0,
              rain: 0,
              orbit: 0,
            }
          : {
              configured: 2080,
              sparkles: { configuredCount: 260 },
              motes: 39,
              grassBlades: 1560,
              embers: 26,
              rain: 130,
              orbit: 65,
            },
      );
      expect(vfx.label).toBe(
        rendererCase.backend === "WebGLRenderer"
          ? "Compatibility VFX\nTornado • Fire • Lasers • Lightning Ribbons • Scanner"
          : "Visual Effects\nDissolve • Fire & Smoke • Lightning & Rain • Glowing Ring",
      );

      if (rendererCase.name === "default") {
        expect(SHOWCASE_NON_INTERACTIVE_BAY_CLASSIFICATIONS.materials).toEqual({
          kind: "passive",
          interaction: "N/A",
          audio: "N/A",
          reset: "N/A",
        });
        await proveGrabGoalReset(page);
        await proveRealThrowRefill(page);

        const vehicleSign = await page.evaluate(
          () => window.__KINEMA__.getLevelObjectState("StationSign_vehicles")?.labelText,
        );
        expect(vehicleSign).toBe("Vehicles\nInteract to enter / exit • Controls adapt to input");
        const canonicalCar = await page.evaluate(() => {
          if (!window.__KINEMA__.resetVehicle("car-1")) return null;
          return window.__KINEMA__.getVehicleState("car-1");
        });
        expect(canonicalCar).not.toBeNull();
        expect(await page.evaluate(() => window.__KINEMA__.enterVehicle("car-1"))).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__KINEMA__.getVehicleState("car-1")?.active)).toBe(true);
        const displacedCar = await page.evaluate(() => {
          if (!window.__KINEMA__.forceVehicleTransform("car-1", { x: 14, y: 1, z: 10 })) return null;
          return window.__KINEMA__.getVehicleState("car-1");
        });
        expect(displacedCar).not.toBeNull();
        expect(
          Math.hypot(
            (displacedCar?.position.x ?? 0) - (canonicalCar?.position.x ?? 0),
            (displacedCar?.position.y ?? 0) - (canonicalCar?.position.y ?? 0),
            (displacedCar?.position.z ?? 0) - (canonicalCar?.position.z ?? 0),
          ),
        ).toBeGreaterThan(1);
        const resetCar = await page.evaluate(() => {
          if (!window.__KINEMA__.resetVehicle("car-1")) return null;
          return window.__KINEMA__.getVehicleState("car-1");
        });
        expect(resetCar).not.toBeNull();
        for (const component of ["x", "y", "z"] as const) {
          expect(resetCar?.position[component]).toBeCloseTo(canonicalCar?.position[component] ?? 0, 5);
        }
        for (const component of ["x", "y", "z", "w"] as const) {
          expect(resetCar?.rotation[component]).toBeCloseTo(canonicalCar?.rotation[component] ?? 0, 5);
        }
        await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ interactPressed: true }, 8));
        await expect
          .poll(() => page.evaluate(() => window.__KINEMA__.getVehicleState("car-1")?.active), { timeout: 10_000 })
          .toBe(false);
        await page.evaluate(() => window.__KINEMA__.clearSimulatedInput());
        await waitForGrounded(page);

        await activateInputSource(page, "gamepad");
        await expect.poll(() => page.evaluate(() => window.__KINEMA__.getInputSource())).toBe("gamepad");
        expect(await page.evaluate(() => window.__KINEMA__.enterVehicle("drone-1"))).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__KINEMA__.getVehicleState("drone-1")?.active)).toBe(true);
        await expect(
          page.locator("#hud-status-lane .hud-status-card", {
            hasText: "Right Stick ↑ / ↓ to change drone altitude",
          }),
        ).toBeVisible();
        await page.evaluate(() => window.__KINEMA__.simulateVehicleInput({ interactPressed: true }, 8));
        await expect
          .poll(() => page.evaluate(() => window.__KINEMA__.getVehicleState("drone-1")?.active), { timeout: 10_000 })
          .toBe(false);
        await page.evaluate(() => window.__KINEMA__.clearSimulatedInput());
        await setGamepadButton(page, null);
        await waitForGrounded(page);

        const platformStart = await page.evaluate(() => window.__KINEMA__.getLevelObjectState("SideMovePlatform_col"));
        expect(platformStart).not.toBeNull();
        const platformSamples = [platformStart?.position.x ?? Number.NaN];
        for (let sampleIndex = 0; sampleIndex < 2; sampleIndex++) {
          const previousX = platformSamples.at(-1) ?? Number.NaN;
          await page.waitForFunction(
            (previous) => {
              const x = window.__KINEMA__.getLevelObjectState("SideMovePlatform_col")?.position.x;
              return x != null && Number.isFinite(x) && Math.abs(x - previous) > 0.4;
            },
            previousX,
            { polling: 100, timeout: 20_000 },
          );
          const currentX = await page.evaluate(
            () => window.__KINEMA__.getLevelObjectState("SideMovePlatform_col")?.position.x ?? Number.NaN,
          );
          expect(Math.abs(currentX - previousX)).toBeGreaterThan(0.2);
          platformSamples.push(currentX);
        }
        for (const sample of platformSamples) {
          expect(Number.isFinite(sample)).toBe(true);
          expect(sample).toBeGreaterThanOrEqual(-17);
          expect(sample).toBeLessThanOrEqual(-7);
        }

        await provePhysicsPlatformSafety(page);
        await expect
          .poll(() => page.evaluate(() => window.__KINEMA__.getNavigationDebugState().targetAvailable), {
            timeout: 30_000,
          })
          .toBe(true);
        const agents = await page.evaluate(() => window.__KINEMA__.getNavAgentStates());
        expect(agents).toHaveLength(5);
        await expect
          .poll(
            () =>
              page.evaluate((before) => {
                const current = window.__KINEMA__.getNavAgentStates();
                return current.some((agent, index) => {
                  const start = before[index];
                  return (
                    start && Math.hypot(agent.position.x - start.position.x, agent.position.z - start.position.z) > 0.1
                  );
                });
              }, agents),
            { timeout: 30_000 },
          )
          .toBe(true);

        await page.evaluate((position) => window.__KINEMA__.teleportPlayer(position), BACK_CHECKPOINT_POSITION);
        await expect
          .poll(() => page.evaluate(() => window.__KINEMA__.getActiveCheckpoint()?.id ?? null))
          .toBe("showcase-checkpoint-back");
      }

      const knownToneSchedulingError = "Start time must be strictly greater than previous start time";
      expect(consoleErrors.filter((message) => !message.includes(knownToneSchedulingError))).toEqual([]);
      expect(pageErrors.filter((message) => !message.includes(knownToneSchedulingError))).toEqual([]);
    });
  }
});
