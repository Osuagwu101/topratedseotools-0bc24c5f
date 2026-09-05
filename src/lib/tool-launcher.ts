/** Reusable Launch Tool service. */
import { toast } from "sonner";
import type { Tool } from "@/lib/tools-data";
import type { ToolSetting } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";
import { startSessionOnlyOneClickAuth } from "@/lib/session-only-access.functions";
import { startSneakWriteDirectSso } from "@/lib/direct-sso.functions";
import { validateSneakWriteLaunchUrl } from "@/lib/direct-sso-url";
import {
  PHRASLY_VIEWER_PATH,
  PHRASLY_VIEWER_STORAGE_KEY,
  isAllowedBrowserUseLiveUrl,
  resolveBrowserViewport,
  type BrowserViewerLaunch,
} from "@/lib/browser-viewer";

function validateClientLaunchUrl(toolSlug: string, rawUrl: string) {
  if (toolSlug === "sneakwrite") return new URL(validateSneakWriteLaunchUrl(rawUrl));
  const launchUrl = new URL(rawUrl);
  if (launchUrl.protocol !== "https:")
    throw new Error("The secure login service returned an invalid launch URL.");
  return launchUrl;
}

export interface LaunchResult {
  status: "launched" | "error";
  launchUrl?: string;
  message?: string;
  expiresAt?: string;
  error?: string;
}

export async function launchTool(
  tool: Tool,
  setting?: Pick<ToolSetting, "one_click_auth_enabled" | "official_login_url" | "launch_mode">,
  options?: { grantAccess?: boolean },
): Promise<LaunchResult> {
  const useOneClick = !!setting?.one_click_auth_enabled;
  const mode = setting?.launch_mode ?? "new_tab";

  if (useOneClick) {
    let handoffWindow: Window | null = null;
    if (mode !== "same_tab") {
      const features = mode === "popup" ? "width=1100,height=800" : undefined;
      handoffWindow = window.open(
        "about:blank",
        mode === "popup" ? `launch-${tool.slug}` : "_blank",
        features,
      );
      if (handoffWindow) {
        try {
          handoffWindow.opener = null;
        } catch {
          /* browser-controlled */
        }
        try {
          handoffWindow.document.title = `Opening ${tool.name}…`;
          handoffWindow.document.body.innerHTML =
            '<div style="font-family:system-ui;padding:32px;color:#334155">Preparing secure login…</div>';
        } catch {
          /* best effort */
        }
      }
    }
    const toastId = `launch-${tool.slug}`;
    toast.loading(`Preparing secure ${tool.name} login…`, { id: toastId });
    try {
      const viewport = resolveBrowserViewport(window.innerWidth, window.innerHeight);
      const result =
        tool.slug === "sneakwrite"
          ? await startSneakWriteDirectSso({ data: { tool_slug: "sneakwrite" } })
          : await startSessionOnlyOneClickAuth({
              data: {
                tool_slug: tool.slug,
                grant_access: !!options?.grantAccess,
                viewport_width: viewport.width,
                viewport_height: viewport.height,
              },
            });
      const launchUrl = validateClientLaunchUrl(tool.slug, result.launch_url);
      toast.success(`${tool.name} is ready`, { id: toastId, duration: 1800 });

      const isPhraslyBrowserUse = tool.slug === "phrasly" && result.provider === "browser_use";
      if (isPhraslyBrowserUse && !isAllowedBrowserUseLiveUrl(launchUrl.toString())) {
        throw new Error("The secure login service returned an invalid Phrasly viewer URL.");
      }

      const targetWindow =
        mode === "same_tab" || !handoffWindow || handoffWindow.closed ? window : handoffWindow;

      if (isPhraslyBrowserUse) {
        const expiresAt =
          "expires_at" in result && typeof result.expires_at === "string"
            ? result.expires_at
            : new Date(Date.now() + 30 * 60_000).toISOString();
        const viewerLaunch: BrowserViewerLaunch = {
          toolSlug: "phrasly",
          provider: "browser_use",
          liveUrl: launchUrl.toString(),
          expiresAt,
        };
        targetWindow.sessionStorage.setItem(
          PHRASLY_VIEWER_STORAGE_KEY,
          JSON.stringify(viewerLaunch),
        );
        targetWindow.location.href = PHRASLY_VIEWER_PATH;
        return { status: "launched", launchUrl: PHRASLY_VIEWER_PATH, expiresAt };
      }

      if (mode === "same_tab") window.location.href = launchUrl.toString();
      else if (handoffWindow && !handoffWindow.closed)
        handoffWindow.location.href = launchUrl.toString();
      else window.location.href = launchUrl.toString();
      return {
        status: "launched",
        launchUrl: launchUrl.toString(),
        expiresAt:
          "expires_at" in result && typeof result.expires_at === "string"
            ? result.expires_at
            : undefined,
      };
    } catch (err) {
      if (handoffWindow && !handoffWindow.closed) handoffWindow.close();
      const errorMsg =
        err instanceof Error ? err.message : "One-Click Login failed. Please try again.";
      toast.error(errorMsg, { id: toastId, duration: 5000 });
      return { status: "error", error: errorMsg };
    }
  }

  const url = tool.domain ? `https://${tool.domain}` : (setting?.official_login_url ?? null);
  if (!url) {
    const errorMsg = "This tool doesn't have a launch URL configured yet.";
    toast.error(errorMsg);
    return { status: "error", error: errorMsg };
  }
  supabase.auth.getUser().then(({ data }) => {
    if (data.user)
      supabase
        .from("tool_usage")
        .insert({ tool_slug: tool.slug, user_id: data.user.id })
        .then(() => undefined);
  });
  toast.loading("Redirecting to the official website…", {
    id: `launch-${tool.slug}`,
    duration: 1800,
  });
  try {
    if (mode === "same_tab") window.location.href = url;
    else if (mode === "popup") {
      const w = window.open(
        url,
        `launch-${tool.slug}`,
        "noopener,noreferrer,width=1100,height=800",
      );
      if (!w) window.open(url, "_blank", "noopener,noreferrer");
    } else window.open(url, "_blank", "noopener,noreferrer");
    return { status: "launched", launchUrl: url };
  } catch {
    const errorMsg = "Could not open the login page. Please try again.";
    toast.error(errorMsg);
    return { status: "error", error: errorMsg };
  }
}
