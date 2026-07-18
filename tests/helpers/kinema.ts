import type { Page } from "@playwright/test";
import type { KinemaDebugApi } from "../../src/core/KinemaDebugApi";

export const KINEMA_TIMEOUT_MS = 60_000;

declare global {
  interface Window {
    __KINEMA__: KinemaDebugApi;
  }
}

export async function waitForKinema(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__KINEMA__), undefined, {
    timeout: KINEMA_TIMEOUT_MS,
  });
}

export async function waitForGrounded(page: Page): Promise<void> {
  await waitForKinema(page);
  const grounded = await page.evaluate(
    (timeoutMs) => window.__KINEMA__.waitFor("p.isGrounded === true", timeoutMs),
    KINEMA_TIMEOUT_MS,
  );
  if (!grounded) {
    throw new Error(`Player did not become grounded within ${KINEMA_TIMEOUT_MS} ms`);
  }
}

export async function waitForLoadingGone(page: Page): Promise<void> {
  await page.locator(".loading-screen").waitFor({ state: "hidden", timeout: KINEMA_TIMEOUT_MS });
}

export async function getPlayer(page: Page): Promise<KinemaDebugApi["player"]> {
  await waitForKinema(page);
  return page.evaluate(() => {
    return window.__KINEMA__.player;
  });
}
