import { expect, test } from "@playwright/test";
import { waitForGrounded, waitForLoadingGone } from "./helpers/kinema";

test.describe("showcase rollout validation", () => {
  test.describe.configure({ mode: "serial" });

  test("grab goal completes and restores the delivered cube pose", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/?station=grab", { waitUntil: "domcontentloaded" });
    await waitForLoadingGone(page);
    await waitForGrounded(page);

    const goalObjects = await page.evaluate(() =>
      ["GrabGoalOutline", "GrabGoalCore", "GrabGoalLabel"].map((name) =>
        window.__KINEMA__.getLevelObjectState(name),
      ),
    );
    expect(goalObjects).toHaveLength(3);
    expect(goalObjects.every((object) => object?.visible)).toBe(true);
    expect(goalObjects[2]?.labelText).toBe("Deliver a cube\nTarget resets automatically");

    await expect
      .poll(async () => {
        const state = await page.evaluate(() => window.__KINEMA__.getDynamicBodyState("PushCubeS_dyn"));
        return state ? Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) : Number.POSITIVE_INFINITY;
      })
      .toBeLessThan(0.01);

    const authored = await page.evaluate(() => window.__KINEMA__.getDynamicBodyState("PushCubeS_dyn"));
    expect(authored).not.toBeNull();
    if (!authored) throw new Error("PushCubeS was not available in the isolated grab station");
    expect(authored.rotation).toBeDefined();

    await page.evaluate(() => window.__KINEMA__.clearInteractionEvents());
    expect(await page.evaluate(() => window.__KINEMA__.placeGrabCubeOnGoal("PushCubeS"))).toBe(true);

    await expect
      .poll(() => page.evaluate(() => window.__KINEMA__.getGrabGoalState().phase), { timeout: 60_000 })
      .toBe("completed");
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.__KINEMA__
              .getInteractionEvents()
              .some(
                (event) =>
                  event.type === "objective:completed" &&
                  event.id === "grab-delivery" &&
                  event.text === "Cube delivered" &&
                  event.position !== undefined,
              ),
          ),
        { timeout: 60_000 },
      )
      .toBe(true);
    expect(await page.evaluate(() => window.__KINEMA__.getGrabGoalState())).toMatchObject({
      phase: "completed",
      activeCube: "PushCubeS",
      completions: 1,
    });

    await expect
      .poll(() => page.evaluate(() => window.__KINEMA__.getGrabGoalState().phase), { timeout: 60_000 })
      .toBe("ready");
    const restored = await page.evaluate(() => window.__KINEMA__.getDynamicBodyState("PushCubeS_dyn"));
    expect(restored).not.toBeNull();
    if (!restored) throw new Error("PushCubeS was not restored after goal completion");
    for (const component of ["x", "y", "z"] as const) {
      expect(Math.abs(restored.position[component] - authored.position[component])).toBeLessThanOrEqual(1e-3);
    }
    for (const component of ["x", "y", "z", "w"] as const) {
      expect(Math.abs(restored.rotation[component] - authored.rotation[component])).toBeLessThanOrEqual(1e-3);
    }
  });
});
