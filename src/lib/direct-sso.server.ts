/* eslint-disable @typescript-eslint/no-explicit-any */
import { LEGACY_CREDENTIAL_CUTOFF_ISO } from "@/lib/access.functions";
import { validateSneakWriteLaunchUrl } from "@/lib/direct-sso-url";

const SNEAKWRITE_DIRECT_SSO_ENDPOINT = "https://sneakwrite.net/api/sso/toprated-account-link";
const MAX_LAUNCH_ATTEMPTS = 5;
const LAUNCH_WINDOW_MS = 5 * 60_000;

function isUnexpired(expiresAt: string | null | undefined) {
  return !expiresAt || new Date(expiresAt).getTime() > Date.now();
}

type DirectAccount = { email: string; password: string };

async function resolveGrantAccount(admin: any, userId: string): Promise<DirectAccount | null> {
  const { data: grants, error } = await admin
    .from("tool_access_grants")
    .select("id, account_id, expires_at, status, granted_at")
    .eq("user_id", userId)
    .eq("tool_slug", "sneakwrite")
    .eq("status", "active")
    .order("granted_at", { ascending: false })
    .limit(10);
  if (error) throw new Error("SneakWrite access could not be checked. Please try again.");

  const grant = (grants ?? []).find((row: any) => isUnexpired(row.expires_at));
  if (!grant?.account_id) return null;

  const { data: account, error: accountError } = await admin
    .from("tool_accounts")
    .select("login_email, login_password, enabled, status, expires_at")
    .eq("id", grant.account_id)
    .maybeSingle();
  if (accountError)
    throw new Error("SneakWrite account assignment could not be checked. Please try again.");
  if (!account?.enabled || account.status !== "working" || !isUnexpired(account.expires_at)) {
    throw new Error("The assigned SneakWrite account is not available. Contact Admin.");
  }

  const email = String(account.login_email ?? "").trim();
  const password = String(account.login_password ?? "");
  if (!email || !password) {
    throw new Error("The assigned SneakWrite login is incomplete. Contact Admin.");
  }
  return { email, password };
}

async function resolvePaidAccount(admin: any, userId: string): Promise<DirectAccount | null> {
  const { data: orders, error } = await admin
    .from("tool_orders")
    .select("id, access_type, fulfilment_status, expires_at, created_at")
    .eq("user_id", userId)
    .eq("tool_slug", "sneakwrite")
    .eq("status", "approved")
    .eq("payment_status", "successful")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error)
    throw new Error("SneakWrite subscription access could not be checked. Please try again.");

  const order = (orders ?? []).find((row: any) => {
    if (!isUnexpired(row.expires_at)) return false;
    if (row.access_type === "private" && row.fulfilment_status !== "active") return false;
    return true;
  });
  if (!order) return null;

  const { data: assignment, error: assignmentError } = await admin
    .from("tool_account_assignments")
    .select("account_id")
    .eq("order_id", order.id)
    .eq("status", "active")
    .maybeSingle();
  if (assignmentError)
    throw new Error("SneakWrite account assignment could not be checked. Please try again.");

  if (assignment?.account_id) {
    const { data: account, error: accountError } = await admin
      .from("tool_accounts")
      .select("login_email, login_password, enabled, status, expires_at")
      .eq("id", assignment.account_id)
      .maybeSingle();
    if (accountError)
      throw new Error("SneakWrite account assignment could not be checked. Please try again.");
    if (account?.enabled && account.status === "working" && isUnexpired(account.expires_at)) {
      const email = String(account.login_email ?? "").trim();
      const password = String(account.login_password ?? "");
      if (email && password) return { email, password };
    }
  }

  if (order.access_type !== "private" && order.created_at < LEGACY_CREDENTIAL_CUTOFF_ISO) {
    const { data: legacy, error: legacyError } = await admin
      .from("tool_credentials")
      .select("login_email, login_password")
      .eq("tool_slug", "sneakwrite")
      .maybeSingle();
    if (legacyError)
      throw new Error("SneakWrite legacy access could not be checked. Please try again.");
    const email = String(legacy?.login_email ?? "").trim();
    const password = String(legacy?.login_password ?? "");
    if (email && password) return { email, password };
  }

  throw new Error("A working SneakWrite account has not been assigned yet. Contact Admin.");
}

async function requestSneakWriteActionLink(account: DirectAccount) {
  let response: Response;
  try {
    response = await fetch(SNEAKWRITE_DIRECT_SSO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email: account.email, password: account.password }),
      redirect: "follow",
    });
  } catch {
    throw new Error("SneakWrite secure sign-in is temporarily unavailable. Please try again.");
  }

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    launch_url?: string;
    error?: string;
  } | null;
  if (!response.ok || !payload?.ok || !payload.launch_url) {
    if (response.status === 401) {
      throw new Error("The saved SneakWrite login is no longer valid. Contact Admin.");
    }
    if (response.status === 429) {
      throw new Error(
        "SneakWrite secure sign-in is temporarily rate-limited. Please wait a moment and try again.",
      );
    }
    throw new Error("SneakWrite secure sign-in could not be created. Please try again.");
  }

  return validateSneakWriteLaunchUrl(payload.launch_url);
}

export async function createSneakWriteDirectSsoForUser(userId: string) {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

  const { data: setting, error: settingError } = await (admin as any)
    .from("tool_settings")
    .select("enabled, one_click_auth_enabled")
    .eq("tool_slug", "sneakwrite")
    .maybeSingle();
  if (settingError)
    throw new Error("SneakWrite launch settings could not be checked. Please try again.");
  if (setting?.enabled === false || !setting?.one_click_auth_enabled) {
    throw new Error("One-Click Login is not enabled for SneakWrite.");
  }

  const since = new Date(Date.now() - LAUNCH_WINDOW_MS).toISOString();
  const { count, error: rateLimitError } = await (admin as any)
    .from("tool_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("tool_slug", "sneakwrite")
    .gte("used_at", since);
  if (rateLimitError) {
    throw new Error("SneakWrite launch protection could not be checked. Please try again.");
  }
  if ((count ?? 0) >= MAX_LAUNCH_ATTEMPTS) {
    throw new Error(
      "Too many SneakWrite launch attempts. Please wait a few minutes and try again.",
    );
  }

  const account =
    (await resolveGrantAccount(admin as any, userId)) ??
    (await resolvePaidAccount(admin as any, userId));
  if (!account) throw new Error("An active SneakWrite subscription or access grant is required.");

  const { error: usageError } = await (admin as any)
    .from("tool_usage")
    .insert({ tool_slug: "sneakwrite", user_id: userId });
  if (usageError) {
    throw new Error("SneakWrite launch could not be recorded. Please try again.");
  }

  const launchUrl = await requestSneakWriteActionLink(account);
  return {
    ok: true,
    provider: "direct_sso" as const,
    launch_url: launchUrl,
    expires_at: null,
  };
}
