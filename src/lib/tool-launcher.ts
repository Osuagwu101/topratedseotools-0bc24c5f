/**
 * Reusable Launch Tool service.
 *
 * Given a tool + its resolved settings, opens the correct destination
 * for the current viewer without ever attempting to sign the user in
 * automatically. Every subscriber authenticates with their own account
 * on the official website.
 *
 * Designed so future providers (OAuth, OIDC, SAML, magic links) can
 * plug in behind `setting.auth_provider` without changing any caller.
 */
import { toast } from "sonner";
import type { Tool } from "@/lib/tools-data";
import type { ToolSetting } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";

export function launchTool(
  tool: Tool,
  setting?: Pick<
    ToolSetting,
    "one_click_auth_enabled" | "official_login_url" | "launch_mode"
  >,
): void {
  // Best-effort usage log.
  supabase.auth.getUser().then(({ data }) => {
    if (data.user) {
      supabase
        .from("tool_usage")
        .insert({ tool_slug: tool.slug, user_id: data.user.id })
        .then(() => undefined);
    }
  });

  const useOneClick = !!setting?.one_click_auth_enabled;
  const url = useOneClick
    ? setting?.official_login_url ?? null
    : tool.domain
      ? `https://${tool.domain}`
      : null;

  if (!url) {
    toast.error("This tool doesn't have a launch URL configured yet.");
    return;
  }

  toast.loading("Redirecting to the official website…", {
    id: `launch-${tool.slug}`,
    duration: 1800,
  });

  const mode = setting?.launch_mode ?? "new_tab";
  try {
    if (mode === "same_tab") {
      window.location.href = url;
    } else if (mode === "popup") {
      const w = window.open(
        url,
        `launch-${tool.slug}`,
        "noopener,noreferrer,width=1100,height=800",
      );
      if (!w) window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch {
    toast.error("Could not open the login page. Please try again.");
  }
}
