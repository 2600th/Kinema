import { describe, expect, it } from "vitest";
import {
  isAppleMobileBrowser,
  resolveViewportMetrics,
  shouldShowLandscapeHint,
  shouldUseCompatibilityRenderer,
} from "./mobilePlatform";

describe("mobilePlatform", () => {
  it("detects iPhone-class browsers", () => {
    expect(
      isAppleMobileBrowser({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.0.0 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("detects iPadOS desktop user agents via touch points", () => {
    expect(
      isAppleMobileBrowser({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("does not classify Android devices as Apple mobile browsers", () => {
    expect(
      isAppleMobileBrowser({
        userAgent:
          "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    ).toBe(false);
  });

  it("prefers visualViewport dimensions when available", () => {
    expect(
      resolveViewportMetrics({
        innerWidth: 390,
        innerHeight: 844,
        visualViewport: { width: 844, height: 390 },
      }),
    ).toEqual({
      width: 844,
      height: 390,
      orientation: "landscape",
    });
  });

  it("falls back to innerWidth and innerHeight when visualViewport is unavailable", () => {
    expect(
      resolveViewportMetrics({
        innerWidth: 390,
        innerHeight: 844,
      }),
    ).toEqual({
      width: 390,
      height: 844,
      orientation: "portrait",
    });
  });

  it("shows a landscape hint only for Apple mobile browsers in portrait", () => {
    const iPhoneLike = {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.0.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    };

    expect(
      shouldShowLandscapeHint(iPhoneLike, {
        innerWidth: 390,
        innerHeight: 844,
      }),
    ).toBe(true);
    expect(
      shouldShowLandscapeHint(iPhoneLike, {
        innerWidth: 844,
        innerHeight: 390,
      }),
    ).toBe(false);
    expect(shouldUseCompatibilityRenderer(iPhoneLike)).toBe(true);
  });
});
