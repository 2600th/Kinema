import { expect, test } from "@playwright/test";
import { waitForGrounded } from "./helpers/kinema";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("mobile touch controls stay active without pointer lock and can trigger a jump", async ({ page }) => {
  test.setTimeout(120_000);

  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => {
    runtimeErrors.push(String(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });

  await page.goto("/?station=movement", { waitUntil: "domcontentloaded" });
  await waitForGrounded(page);

  await expect(page.locator(".touch-zone--left")).toBeVisible();
  await expect(page.locator(".touch-zone--right")).toBeVisible();
  await expect(page.getByRole("group", { name: "Movement joystick" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Camera joystick" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Jump" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sprint" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Interact" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crouch" })).toBeVisible();
  await expect(page.locator(".touch-controls-container")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(".hud-collectible-chip")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(".hud-health-chip")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#hud-status-lane")).toHaveAttribute("aria-hidden", "false");

  const tokenStyles = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const touch = document.querySelector<HTMLElement>(".touch-controls-container");
    const hud = document.querySelector<HTMLElement>(".hud-objective-region");
    return {
      accent: root.getPropertyValue("--k-accent").trim(),
      accentHover: root.getPropertyValue("--k-accent-hover").trim(),
      accentCyan: root.getPropertyValue("--k-accent-cyan").trim(),
      touchZ: touch ? getComputedStyle(touch).zIndex : null,
      hudZ: hud ? getComputedStyle(hud).zIndex : null,
    };
  });
  expect(tokenStyles).toEqual({
    accent: "#7b6cff",
    accentHover: "#ff79ba",
    accentCyan: "#62e6ff",
    touchZ: "1000",
    hudZ: "1000",
  });

  await page.keyboard.press("Tab");
  const sprintButton = page.getByRole("button", { name: "Sprint" });
  await expect(sprintButton).toBeFocused();
  await expect
    .poll(() =>
      sprintButton.evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor} / ${style.outlineOffset}`;
      }),
    )
    .toBe("2px solid rgb(98, 230, 255) / 2px");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
  await expect(page.locator(".touch-controls-container")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".touch-controls-container")).toHaveAttribute("inert", "");
  await expect(page.locator(".hud-collectible-chip")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".hud-health-chip")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#hud-status-lane")).toHaveAttribute("aria-hidden", "true");

  await page.keyboard.press("Escape");
  await expect(page.locator(".touch-controls-container")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(".touch-controls-container")).not.toHaveAttribute("inert", "");
  await expect(page.locator(".hud-collectible-chip")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(".hud-health-chip")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#hud-status-lane")).toHaveAttribute("aria-hidden", "false");

  await expect.poll(async () => page.evaluate(() => document.pointerLockElement === null)).toBe(true);

  const jumpButton = page.getByRole("button", { name: "Jump" });
  await jumpButton.tap();

  const jumped = await page.evaluate(() => window.__KINEMA__.waitFor("p.vy > 0.5 && p.state !== 'idle'", 4_000));
  expect(jumped).toBe(true);
  await waitForGrounded(page);

  await jumpButton.evaluate((button) => (button as HTMLButtonElement).click());
  const semanticJumped = await page.evaluate(() =>
    window.__KINEMA__.waitFor("p.vy > 0.5 && p.state !== 'idle'", 4_000),
  );
  expect(semanticJumped).toBe(true);
  await waitForGrounded(page);

  await page.evaluate(() => window.__KINEMA__.clearInteractionEvents());
  const movementBox = await page.getByRole("group", { name: "Movement joystick" }).boundingBox();
  const sprintBox = await sprintButton.boundingBox();
  expect(movementBox).not.toBeNull();
  expect(sprintBox).not.toBeNull();
  if (!movementBox || !sprintBox) throw new Error("Missing touch control geometry");
  const touchSession = await page.context().newCDPSession(page);
  const movementPoint = {
    x: movementBox.x + movementBox.width / 2,
    y: movementBox.y + movementBox.height / 2,
    id: 1,
  };
  const sprintPoint = {
    x: sprintBox.x + sprintBox.width / 2,
    y: sprintBox.y + sprintBox.height / 2,
    id: 2,
  };
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [movementPoint, sprintPoint],
  });
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...movementPoint, y: movementPoint.y - 55 }, sprintPoint],
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__KINEMA__.getInteractionEvents().some((event) => event.type === "player:sprintStarted"),
      ),
    )
    .toBe(true);
  await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touchSession.detach();
  await expect.poll(async () => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});
