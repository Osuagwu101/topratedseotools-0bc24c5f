export const PHRASLY_VIEWER_PATH = "/tools/phrasly";
export const PHRASLY_VIEWER_STORAGE_KEY = "toprated:browser-viewer:phrasly";

export type BrowserViewport = {
  width: number;
  height: number;
};

export type BrowserViewerLaunch = {
  toolSlug: "phrasly";
  provider: "browser_use";
  liveUrl: string;
  expiresAt: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Choose the remote browser's initial viewport from the writer's available
 * screen. Browser Use does not automatically turn a fixed desktop viewport
 * into a mobile one, so this must be supplied when the session is created.
 */
export function resolveBrowserViewport(clientWidth: number, clientHeight: number): BrowserViewport {
  const safeWidth = Number.isFinite(clientWidth) ? clientWidth : 1440;
  const safeHeight = Number.isFinite(clientHeight) ? clientHeight : 900;
  const mobile = safeWidth < 768;

  if (mobile) {
    return {
      width: clamp(safeWidth, 320, 480),
      height: clamp(safeHeight - 64, 568, 960),
    };
  }

  return {
    width: clamp(safeWidth, 1024, 1600),
    height: clamp(safeHeight - 80, 700, 1000),
  };
}

export function isAllowedBrowserUseLiveUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === "live.browser-use.com" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function parsePhraslyViewerLaunch(
  raw: string | null,
  now = Date.now(),
): BrowserViewerLaunch | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BrowserViewerLaunch>;
    const expiry = new Date(String(value.expiresAt ?? "")).getTime();
    if (
      value.toolSlug !== "phrasly" ||
      value.provider !== "browser_use" ||
      !isAllowedBrowserUseLiveUrl(String(value.liveUrl ?? "")) ||
      !Number.isFinite(expiry) ||
      expiry <= now
    ) {
      return null;
    }
    return value as BrowserViewerLaunch;
  } catch {
    return null;
  }
}
