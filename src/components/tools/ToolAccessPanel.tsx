/**
 * ToolAccessPanel — centralized paywall/access gate for a single tool page.
 *
 * Renders one of four states derived from three inputs:
 *   1. tool_settings.enabled            → "Currently unavailable"
 *   2. tool_settings.access_level       → who is required
 *   3. auth + getMyAccess()             → is the current viewer allowed?
 *
 * States:
 *   • disabled           — admin toggled the tool off
 *   • sign_in_required   — visitor clicked Launch; must log in
 *   • paywall            — logged-in user without an active order for this tool
 *   • granted            — user has access, show "Launch tool"
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Lock, LogIn, Rocket, ShieldAlert, Sparkles } from "lucide-react";
import type { Tool } from "@/lib/tools-data";
import type { ToolAccessLevel, ToolSetting } from "@/lib/access.functions";
import { getMyAccess } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";
import { launchTool } from "@/lib/tool-launcher";

interface Props {
  tool: Tool;
  setting: ToolSetting | undefined;
  isAuthenticated: boolean;
}

const DEFAULT_SETTING: Omit<ToolSetting, "tool_slug"> = {
  enabled: true,
  access_level: "purchased",
  one_click_auth_enabled: false,
  official_login_url: null,
  auth_provider: null,
  launch_mode: "new_tab",
  display_manual_credentials: true,
};

export function ToolAccessPanel({ tool, setting, isAuthenticated }: Props) {
  const effective = setting ?? { tool_slug: tool.slug, ...DEFAULT_SETTING };

  // Only fetch access when a) we need it AND b) the user is signed in.
  const shouldFetchAccess =
    isAuthenticated && effective.enabled && effective.access_level === "purchased";
  const { data: accessData } = useQuery({
    queryKey: ["my-access"],
    queryFn: () => getMyAccess(),
    enabled: shouldFetchAccess,
    staleTime: 30_000,
  });
  const hasPurchased =
    accessData?.access.some((a) => a.tool_slug === tool.slug) ?? false;

  const state = resolveState(effective.enabled, effective.access_level, isAuthenticated, hasPurchased);

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-card">
      {state === "disabled" && (
        <StateBlock
          icon={ShieldAlert}
          title="Currently unavailable"
          body="This tool is temporarily disabled by the admin. Check back soon."
        />
      )}

      {state === "sign_in_required" && (
        <StateBlock
          icon={LogIn}
          title="Sign in to launch"
          body={
            effective.access_level === "logged_in"
              ? "This tool is free for logged-in members. Sign in to continue."
              : "Sign in, then subscribe to unlock this tool."
          }
        >
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
            >
              <LogIn className="h-4 w-4" /> Sign in
            </Link>
            <Link
              to="/register"
              className="inline-flex items-center rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Create free account
            </Link>
          </div>
        </StateBlock>
      )}

      {state === "paywall" && (
        <StateBlock
          icon={Lock}
          title="Subscribe to unlock"
          body="This is a premium tool. Purchase access below — the admin activates it as soon as payment is confirmed."
        >
          <ul className="mt-4 grid gap-2 text-sm">
            {[
              "Instant activation once payment is confirmed",
              "Full features, no shared limits",
              "Cancel or downgrade anytime",
              "Priority support from our team",
            ].map((b) => (
              <li key={b} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {b}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to="/order/$slug"
              params={{ slug: tool.slug }}
              className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" /> Subscribe to {tool.name}
            </Link>
            <Link
              to="/pricing"
              className="inline-flex items-center rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Compare pricing
            </Link>
          </div>
        </StateBlock>
      )}

      {state === "granted" && (
        <StateBlock
          icon={Rocket}
          title="You have access"
          body={
            effective.one_click_auth_enabled
              ? "Click below to continue to the official website and sign in using your own account."
              : "Your subscription is active for this tool. Launch it below."
          }
        >
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => launchTool(tool, effective)}
              className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
            >
              <Rocket className="h-4 w-4" /> Launch {tool.name}
            </button>
            <Link
              to="/orders"
              className="inline-flex items-center rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              My subscriptions
            </Link>
          </div>
        </StateBlock>
      )}
    </div>
  );
}

type State = "disabled" | "sign_in_required" | "paywall" | "granted";
function resolveState(
  enabled: boolean,
  level: ToolAccessLevel,
  isAuth: boolean,
  hasPurchased: boolean,
): State {
  if (!enabled) return "disabled";
  if (level === "public") return "granted";
  if (level === "logged_in") return isAuth ? "granted" : "sign_in_required";
  // purchased
  if (!isAuth) return "sign_in_required";
  return hasPurchased ? "granted" : "paywall";
}

function launchTool(tool: Tool) {
  // Record usage (best-effort — do not block the launch on errors).
  supabase.auth.getUser().then(({ data }) => {
    if (data.user) {
      supabase
        .from("tool_usage")
        .insert({ tool_slug: tool.slug, user_id: data.user.id })
        .then(() => undefined);
    }
  });
  // Placeholder launch: open the official brand site. Later this can point
  // to an embedded or SSO-tokenized version of the tool.
  window.open(`https://${tool.domain}`, "_blank", "noopener");
}

function StateBlock({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: typeof Lock;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}
