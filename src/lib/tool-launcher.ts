/**
 * Reusable Launch Tool service.
 *
 * SneakWrite is an owned tool, so its One-Click Login uses a direct, short-lived
 * SSO handoff and does not start Browser Use / Cloudflare. Other tools keep the
 * existing remote-browser login path. Stored login credentials are never
 * returned to this client module.
 */
import { toast } from "sonner";
import type { Tool } from "@/lib/tools-data";
import type { ToolSetting } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";
import { startOneClickAuth } from "@/lib/browser-auth.functions";
import { startGrantedOneClickAuth } from "@/lib/grant-access.functions";
import { startSneakWriteDirectSso } from "@/lib/direct-sso.functions";

const SNEAKWRITE_AUTH_ORIGIN = "https://rsnxhzlqxivpnpryzesu.supabase.co";
const SNEAKWRITE_AUTH_PATH = "/auth/v1/verify";

function validateClientLaunchUrl(toolSlug: string, rawUrl: string) {
  const launchUrl = new URL(rawUrl);
  if (launchUrl.protocol !== "https:") {
    throw new Error("The secure login service returned an invalid launch URL.");
  }
  if (
    toolSlug === "sneakwrite" &&
    (launchUrl.origin !== SNEAKWRITE_AUTH_ORIGIN || launchUrl.pathname !== SNEAKWRITE_AUTH_PATH)
  ) {
    throw new Error("The secure login service returned an invalid SneakWrite launch URL.");
  }
  return launchUrl;
}

export async function launchTool(
  tool: Tool,
  setting?: Pick<
    ToolSetting,
    "one_click_auth_enabled" | "official_login_url" | "launch_mode"
  >,
  options?: { grantAccess?: boolean },
): Promise<void> {
  const useOneClick = !!setting?.one_click_auth_enabled;
  const mode = setting?.launch_mode ?? "new_tab";

  if (useOneClick) {
    let handoffWindow: Window | null = null;
    if (mode !== "same_tab") {
      const features = mode === "popup" ? "width=1100,height=800" : undefined;
      handoffWindow = window.open("about:blank", mode === "popup" ? `launch-${tool.slug}` : "_blank", features);
      if (handoffWindow) {
        try { handoffWindow.opener = null; } catch { /* browser-controlled */ }
        try {
          handoffWindow.document.title = `Opening ${tool.name}…`;
          handoffWindow.document.body.innerHTML =
            '<div style="font-family:system-ui;padding:32px;color:#334155">Preparing secure login…</div>';
        } catch { /* cross-browser best effort */ }
      }
    }

    const toastId = `launch-${tool.slug}`;
    toast.loading(`Preparing secure ${tool.name} login…`, { id: toastId });
    try {
      const result = tool.slug === "sneakwrite"
        ? await startSneakWriteDirectSso({ data: { tool_slug: "sneakwrite" } })
        : options?.grantAccess
          ? await startGrantedOneClickAuth({ data: { tool_slug: tool.slug } })
          : await startOneClickAuth({ data: { tool_slug: tool.slug } });
      const launchUrl = validateClientLaunchUrl(tool.slug, result.launch_url);

      toast.success(`${tool.name} is ready`, { id: toastId, duration: 1800 });
      if (mode === "same_tab") {
        window.location.href = launchUrl.toString();
      } else if (handoffWindow && !handoffWindow.closed) {
        handoffWindow.location.href = launchUrl.toString();
      } else {
        window.location.href = launchUrl.toString();
      }
    } catch (err) {
      if (handoffWindow && !handoffWindow.closed) handoffWindow.close();
      toast.error(err instanceof Error ? err.message : "One-Click Login failed. Please try again.", {
        id: toastId,
        duration: 5000,
      });
    }
    return;
  }

  const url = tool.domain ? `https://${tool.domain}` : setting?.official_login_url ?? null;
  if (!url) {
    toast.error("This tool doesn't have a launch URL configured yet.");
    return;
  }

  supabase.auth.getUser().then(({ data }) => {
    if (data.user) {
      supabase
        .from("tool_usage")
        .insert({ tool_slug: tool.slug, user_id: data.user.id })
        .then(() => undefined);
    }
  });

  toast.loading("Redirecting to the official website…", {
    id: `launch-${tool.slug}`,
    duration: 1800,
  });

  try {
    if (mode === "same_tab") {
      window.location.href = url;
    } else if (mode === "popup") {
      const w = window.open(url, `launch-${tool.slug}`, "noopener,noreferrer,width=1100,height=800");
      if (!w) window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch {
    toast.error("Could not open the login page. Please try again.");
  }
}
