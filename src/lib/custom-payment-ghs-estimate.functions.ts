import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BANK_OF_GHANA_FX_URL = "https://www.bog.gov.gh/treasury-and-the-markets/daily-interbank-fx-rates/";
const FALLBACK_NGN_RATE_URL = "https://open.er-api.com/v6/latest/NGN";

export interface NgnGhsEstimateRate {
  /** Ghana cedis for one Nigerian naira. */
  ngn_to_ghs: number;
  /** Nigerian naira for one Ghana cedi. */
  ngn_per_ghs: number;
  source: "bank_of_ghana" | "exchange_rate_api";
  source_label: string;
  as_of: string | null;
  retrieved_at: string;
}

export interface ParsedBankOfGhanaRate {
  ngn_per_ghs: number;
  as_of: string | null;
}

/**
 * Parse the direct GHSNGN row from the Bank of Ghana interbank table.
 * The table shape is: Date | Naira | GHSNGN | Buying | Selling | Mid Rate.
 * We use the mid rate for a neutral estimate because the customer's card
 * issuer/network ultimately determines the actual authorization conversion.
 */
export function parseBankOfGhanaGhsNgn(html: string): ParsedBankOfGhanaRate | null {
  const text = String(html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const row = text.match(
    /(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+Naira\s+GHSNGN\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/i,
  );
  if (!row) return null;

  const mid = Number(row[4]);
  if (!Number.isFinite(mid) || mid < 20 || mid > 500) return null;
  return { ngn_per_ghs: mid, as_of: row[1] ?? null };
}

export function estimateGhsFromNgn(amountNgn: number, rate: Pick<NgnGhsEstimateRate, "ngn_to_ghs">): number {
  const amount = Number(amountNgn);
  const multiplier = Number(rate.ngn_to_ghs);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return Math.round(amount * multiplier * 100) / 100;
}

async function assertSuperAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (roleError) throw new Error(roleError.message);
  if (!isAdmin) throw new Error("Forbidden");

  const { data: isSuper, error: superError } = await context.supabase.rpc("is_super_admin", {
    _user_id: context.userId,
  });
  if (superError) throw new Error(superError.message);
  if (!isSuper) throw new Error("Only a Super Admin can view Custom Payment estimates.");
}

async function fromBankOfGhana(): Promise<NgnGhsEstimateRate> {
  const res = await fetch(BANK_OF_GHANA_FX_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "TopRatedSEOTools/1.0 CustomPaymentFXEstimate",
    },
  });
  if (!res.ok) throw new Error(`Bank of Ghana returned ${res.status}`);

  const parsed = parseBankOfGhanaGhsNgn(await res.text());
  if (!parsed) throw new Error("Could not read GHSNGN from Bank of Ghana.");

  return {
    ngn_to_ghs: 1 / parsed.ngn_per_ghs,
    ngn_per_ghs: parsed.ngn_per_ghs,
    source: "bank_of_ghana",
    source_label: "Bank of Ghana interbank GHS/NGN reference",
    as_of: parsed.as_of,
    retrieved_at: new Date().toISOString(),
  };
}

async function fromExchangeRateApi(): Promise<NgnGhsEstimateRate> {
  const res = await fetch(FALLBACK_NGN_RATE_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Exchange-rate provider returned ${res.status}`);
  const body = await res.json() as {
    result?: string;
    rates?: Record<string, number>;
    time_last_update_utc?: string;
  };
  const ngnToGhs = Number(body.rates?.GHS);
  if (body.result !== "success" || !Number.isFinite(ngnToGhs) || ngnToGhs <= 0) {
    throw new Error("Exchange-rate provider returned no usable NGN/GHS rate.");
  }

  return {
    ngn_to_ghs: ngnToGhs,
    ngn_per_ghs: 1 / ngnToGhs,
    source: "exchange_rate_api",
    source_label: "Daily NGN/GHS market reference",
    as_of: body.time_last_update_utc ?? null,
    retrieved_at: new Date().toISOString(),
  };
}

export const adminGetNgnGhsEstimateRate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    try {
      return await fromBankOfGhana();
    } catch {
      return await fromExchangeRateApi();
    }
  });
