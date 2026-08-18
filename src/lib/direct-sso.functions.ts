/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEGACY_CREDENTIAL_CUTOFF_ISO } from "@/lib/access.functions";
import { createSneakWriteSsoLaunch } from "@/lib/direct-sso.server";

function isUnexpired(expiresAt: string | null | undefined) {
  return !expiresAt || new Date(expiresAt).getTime() > Date.now();
}

async function resolveGrantAccount(admin: any, userId: string) {
  const { data: grants, error } = await admin
    .from("tool_access_grants")
    .select("id, account_id, expires_at, status, granted_at")
    .eq("user_id", userId)
    .eq("tool_slug", "sneakwrite")
    .eq("status", "active")
    .order("granted_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);

  const grant = (grants ?? []).find((row: any) => isUnexpired(row.expires_at));
  if (!grant?.account_id) return null;

  const { data: account, error: accountError } = await admin
    .from("tool_accounts")
    .select("id, login_email, enabled, status, expires_at")
    .eq("id", grant.account_id)
    .maybeSingle();
  if (accountError) throw new Error(accountError.message);
  if (!account?.enabled || account.status !== "working" || !isUnexpired(account.expires_at)) {
    throw new Error("The assigned SneakWrite account is not available. Contact Admin.");
  }

  const email = String(account.login_email ?? "").trim();
  if (!email) throw new Error("The assigned SneakWrite account email is missing. Contact Admin.");
  return { accountId: account.id as string, email };
}

async function resolvePaidAccount(admin: any, userId: string) {
  const { data: orders, error } = await admin
    .from("tool_orders")
    .select("id, access_type, fulfilment_status, expires_at, created_at")
    .eq("user_id", userId)
    .eq("tool_slug", "sneakwrite")
    .eq("status", "approved")
    .eq("payment_status", "successful")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);

  const order = (orders ?? []).find((row: any) => {
    if (!isUnexpired(row.expires_at)) return false;
    if (row.access_type === "private" && row.fulfilment_status !== "active") return false;
    return true;
  });
  if (!order) return null;

  const { data: assignment } = await admin
    .from("tool_account_assignments")
    .select("account_id")
    .eq("order_id", order.id)
    .eq("status", "active")
    .maybeSingle();

  if (assignment?.account_id) {
    const { data: account, error: accountError } = await admin
      .from("tool_accounts")
      .select("id, login_email, enabled, status, expires_at")
      .eq("id", assignment.account_id)
      .maybeSingle();
    if (accountError) throw new Error(accountError.message);
    if (account?.enabled && account.status === "working" && isUnexpired(account.expires_at)) {
      const email = String(account.login_email ?? "").trim();
      if (email) return { accountId: account.id as string, email };
    }
  }

  if (order.access_type !== "private" && order.created_at < LEGACY_CREDENTIAL_CUTOFF_ISO) {
    const { data: legacy } = await admin
      .from("tool_credentials")
      .select("login_email")
      .eq("tool_slug", "sneakwrite")
      .maybeSingle();
    const email = String(legacy?.login_email ?? "").trim();
    if (email) return { accountId: null, email };
  }

  throw new Error("A working SneakWrite account has not been assigned yet. Contact Admin.");
}

export const startSneakWriteDirectSso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tool_slug: z.literal("sneakwrite") }).parse(input))
  .handler(async ({ context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const { data: setting, error: settingError } = await (admin as any)
      .from("tool_settings")
      .select("enabled, one_click_auth_enabled")
      .eq("tool_slug", "sneakwrite")
      .maybeSingle();
    if (settingError) throw new Error(settingError.message);
    if (setting?.enabled === false || !setting?.one_click_auth_enabled) {
      throw new Error("One-Click Login is not enabled for SneakWrite.");
    }

    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { count } = await (admin as any)
      .from("direct_sso_tickets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("tool_slug", "sneakwrite")
      .gte("created_at", since);
    if ((count ?? 0) >= 5) {
      throw new Error("Too many SneakWrite launch attempts. Please wait a few minutes and try again.");
    }

    const account =
      (await resolveGrantAccount(admin as any, context.userId)) ??
      (await resolvePaidAccount(admin as any, context.userId));
    if (!account) throw new Error("An active SneakWrite subscription or access grant is required.");

    const launched = await createSneakWriteSsoLaunch(admin as any, {
      userId: context.userId,
      accountId: account.accountId,
      targetEmail: account.email,
    });

    await (admin as any)
      .from("tool_usage")
      .insert({ tool_slug: "sneakwrite", user_id: context.userId });

    return {
      ok: true,
      provider: launched.provider,
      launch_url: launched.launchUrl,
      expires_at: launched.expiresAt,
    };
  });
