export type BrowserViewport = {
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Choose the remote browser's initial viewport from the writer's available
 * screen for tools that still use the shared browser framework.
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
