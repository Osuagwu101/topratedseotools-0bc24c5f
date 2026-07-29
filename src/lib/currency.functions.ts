/**
 * Server functions for currency configuration & exchange-rate refresh.
 *
 * Public read: `getPublicCurrencyConfig` returns settings + cached rates.
 * Admin write: `refreshExchangeRates`, `updateCurrencySettings`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { CURRENCY_META, isSupportedCurrency, type SupportedCurrency } from "./currency-convert";

const DEFAULT_RATE_URL = "https://api.exchangerate.host/latest";

function serverPublic() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export interface PublicCurrencyConfig {
  switching_enabled: boolean;
  surcharge_enabled: boolean;
  surcharge_percent: number;
  supported_currencies: SupportedCurrency[];
  rates: Array<{
    currency: SupportedCurrency;
    rate: number;
    fetched_at: string | null;
    stale: boolean;
  }>;
}

export const getPublicCurrencyConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicCurrencyConfig> => {
    const db = serverPublic();
    const { data: settings } = await db
      .from("currency_settings")
      .select("switching_enabled, surcharge_enabled, surcharge_percent, supported_currencies")
      .eq("id", true)
      .maybeSingle();

    const supported = ((settings?.supported_currencies as string[] | null) ?? [
      "NGN", "GHS", "KES", "ZAR", "USD",
    ]).filter(isSupportedCurrency);

    const { data: rows } = await db
      .from("exchange_rates")
      .select("quote_currency, rate, fetched_at, expires_at")
      .eq("base_currency", "NGN");

    const now = Date.now();
    const rates: PublicCurrencyConfig["rates"] = supported.map((code) => {
      if (code === "NGN") return { currency: code, rate: 1, fetched_at: null, stale: false };
      const row = (rows ?? []).find((r) => (r as any).quote_currency === code) as any;
      if (!row) return { currency: code, rate: 0, fetched_at: null, stale: true };
      const stale = row.expires_at ? new Date(row.expires_at).getTime() < now : false;
      return {
        currency: code,
        rate: Number(row.rate) || 0,
        fetched_at: row.fetched_at ?? null,
        stale,
      };
    });

    return {
      switching_enabled: settings?.switching_enabled ?? true,
      surcharge_enabled: settings?.surcharge_enabled ?? true,
      surcharge_percent: Number(settings?.surcharge_percent ?? 3),
      supported_currencies: supported,
      rates,
    };
  },
);

async function assertAdmin(supabase: any, userId: string) {
  const { data: ok } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!ok) throw new Error("Forbidden");
}

export const refreshExchangeRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const url = process.env.EXCHANGE_RATE_URL ?? DEFAULT_RATE_URL;
    const symbols = ["GHS", "KES", "ZAR", "USD"];
    const res = await fetch(`${url}?base=NGN&symbols=${symbols.join(",")}`);
    if (!res.ok) throw new Error(`Rate provider returned ${res.status}`);
    const body = (await res.json()) as { rates?: Record<string, number>; date?: string };
    const rates = body.rates ?? {};

    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 3600 * 1000);
    const upserts: any[] = [];
    const logs: any[] = [];
    for (const code of symbols) {
      const rate = Number(rates[code]);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      upserts.push({
        base_currency: "NGN",
        quote_currency: code,
        rate,
        source: "exchangerate.host",
        fetched_at: now.toISOString(),
        expires_at: expires.toISOString(),
      });
      logs.push({
        base_currency: "NGN",
        quote_currency: code,
        rate,
        source: "exchangerate.host",
        fetched_at: now.toISOString(),
      });
    }
    if (upserts.length) {
      await supabaseAdmin
        .from("exchange_rates")
        .upsert(upserts, { onConflict: "base_currency,quote_currency" });
      await supabaseAdmin.from("exchange_rate_logs").insert(logs);
    }
    return { ok: true, updated: upserts.length };
  });

export const updateCurrencySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        switching_enabled: z.boolean().optional(),
        surcharge_enabled: z.boolean().optional(),
        surcharge_percent: z.number().min(0).max(25).optional(),
        supported_currencies: z
          .array(z.enum(["NGN", "GHS", "KES", "ZAR", "USD"]))
          .min(1)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = { updated_by: context.userId, updated_at: new Date().toISOString() };
    if (data.switching_enabled !== undefined) patch.switching_enabled = data.switching_enabled;
    if (data.surcharge_enabled !== undefined) patch.surcharge_enabled = data.surcharge_enabled;
    if (data.surcharge_percent !== undefined) patch.surcharge_percent = data.surcharge_percent;
    if (data.supported_currencies !== undefined) patch.supported_currencies = data.supported_currencies;
    await supabaseAdmin.from("currency_settings").update(patch).eq("id", true);
    return { ok: true };
  });

export const listExchangeRateLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data } = await context.supabase
      .from("exchange_rate_logs")
      .select("*")
      .order("fetched_at", { ascending: false })
      .limit(100);
    return { rows: data ?? [] };
  });

// Re-export for consumer convenience.
export { CURRENCY_META };
export type { SupportedCurrency };
