import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
});

test("landscape touch controls stay within the viewport and avoid button overlap on iPhone-like browsers", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () =>
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.0.0 Mobile/15E148 Safari/604.1",
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "iPhone",
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5,
    });
  });

  await page.goto("/?station=movement", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__KINEMA__), undefined, { timeout: 60_000 });

  await expect(page.locator(".touch-zone--left")).toBeVisible();
  await expect(page.locator(".touch-zone--right")).toBeVisible();
  await expect(page.locator(".touch-zone--buttons")).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const getRect = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        };

        const intersects = (
          a:
            | {
                left: number;
                top: number;
                right: number;
                bottom: number;
              }
            | null,
          b:
            | {
                left: number;
                top: number;
                right: number;
                bottom: number;
              }
            | null,
        ) => {
          if (!a || !b) return false;
          return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        };

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const left = getRect(".touch-zone--left");
        const right = getRect(".touch-zone--right");
        const buttons = getRect(".touch-zone--buttons");
        const sprint = getRect(".touch-zone--sprint");

        return {
          viewport: { width: viewportWidth, height: viewportHeight },
          allVisible: Boolean(
            left &&
              right &&
              buttons &&
              sprint &&
              left.left >= 0 &&
              left.top >= 0 &&
              left.right <= viewportWidth &&
              left.bottom <= viewportHeight &&
              right.left >= 0 &&
              right.top >= 0 &&
              right.right <= viewportWidth &&
              right.bottom <= viewportHeight &&
              buttons.left >= 0 &&
              buttons.top >= 0 &&
              buttons.right <= viewportWidth &&
              buttons.bottom <= viewportHeight &&
              sprint.left >= 0 &&
              sprint.top >= 0 &&
              sprint.right <= viewportWidth &&
              sprint.bottom <= viewportHeight,
          ),
          joystickWidths: {
            left: left?.width ?? 0,
            right: right?.width ?? 0,
          },
          overlaps: {
            buttonsRight: intersects(buttons, right),
            sprintLeft: intersects(sprint, left),
          },
        };
      }),
    )
    .toMatchObject({
      viewport: { width: 844, height: 390 },
      allVisible: true,
      overlaps: {
        buttonsRight: false,
        sprintLeft: false,
      },
    });

  const joystickWidths = await page.evaluate(() => {
    const left = document.querySelector(".touch-zone--left")?.getBoundingClientRect();
    const right = document.querySelector(".touch-zone--right")?.getBoundingClientRect();
    return { left: left?.width ?? 0, right: right?.width ?? 0 };
  });
  expect(joystickWidths.left).toBeGreaterThan(120);
  expect(joystickWidths.right).toBeGreaterThan(120);
});
