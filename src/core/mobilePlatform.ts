export interface PlatformNavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

export interface ViewportMetricsLike {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: {
    width: number;
    height: number;
  } | null;
}

export interface ResolvedViewportMetrics {
  width: number;
  height: number;
  orientation: "landscape" | "portrait";
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Detect iPhone/iPad-class browsers, including iPadOS desktop user agents.
 * These browsers share WebKit viewport and GPU behavior that benefits from
 * the compatibility renderer path and extra resize handling.
 */
export function isAppleMobileBrowser(navigatorLike: PlatformNavigatorLike): boolean {
  const userAgent = navigatorLike.userAgent ?? "";
  const platform = navigatorLike.platform ?? "";
  const maxTouchPoints = navigatorLike.maxTouchPoints ?? 0;

  if (/iPad|iPhone|iPod/i.test(userAgent) || /iPad|iPhone|iPod/i.test(platform)) {
    return true;
  }

  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function shouldUseCompatibilityRenderer(navigatorLike: PlatformNavigatorLike): boolean {
  return isAppleMobileBrowser(navigatorLike);
}

export function resolveViewportMetrics(viewportLike: ViewportMetricsLike): ResolvedViewportMetrics {
  const visualViewportWidth = viewportLike.visualViewport?.width;
  const visualViewportHeight = viewportLike.visualViewport?.height;

  const width = isPositiveFinite(visualViewportWidth) ? visualViewportWidth : Math.max(1, viewportLike.innerWidth);
  const height = isPositiveFinite(visualViewportHeight) ? visualViewportHeight : Math.max(1, viewportLike.innerHeight);

  return {
    width,
    height,
    orientation: width >= height ? "landscape" : "portrait",
  };
}

export function shouldShowLandscapeHint(
  navigatorLike: PlatformNavigatorLike,
  viewportLike: ViewportMetricsLike,
): boolean {
  return isAppleMobileBrowser(navigatorLike) && resolveViewportMetrics(viewportLike).orientation === "portrait";
}
