/**
 * Gateway registry — resolves the gateway for a payment at runtime.
 *
 * Server-only: reads secrets from process.env inside the adapters. Exactly one
 * provider is active (`payment_providers.is_active`), selected explicitly by a
 * Super Admin. Paystack is the default when nothing is marked active. There is
 * no currency-based provider routing and no silent provider switching.
 */
import { paystackAdapter } from "./paystack";
import { flutterwaveAdapter } from "./flutterwave";
import { createMonnifyAdapter } from "./monnify";
import { isGatewaySlug, type GatewayAdapter, type GatewayConfig, type GatewaySlug } from "./types";
import { loadGatewaySecrets } from "./secrets.server";
import { DEFAULT_GATEWAY } from "./metadata";

export interface ResolvedGateway {
  slug: GatewaySlug;
  adapter: GatewayAdapter;
  config: GatewayConfig;
  environment: "test" | "live" | null;
}

export function getAdapter(slug: GatewaySlug, config: GatewayConfig = {}): GatewayAdapter {
  if (slug === "paystack") return paystackAdapter;
  if (slug === "flutterwave") return flutterwaveAdapter;
  return createMonnifyAdapter(config);
}

/** Which gateway did the admin explicitly activate? Falls back to Paystack. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readActiveGatewaySlug(db: any): Promise<GatewaySlug> {
  try {
    const { data } = await db
      .from("payment_providers")
      .select("slug")
      .eq("is_active", true)
      .eq("enabled", true)
      .maybeSingle();
    if (data && isGatewaySlug(data.slug)) return data.slug;
  } catch {
    /* fall back to the default gateway */
  }
  return DEFAULT_GATEWAY;
}

/**
 * Resolve the single active gateway for a checkout.
 *
 * The customer's display currency never chooses the provider. Whether that
 * currency can be settled directly is handled later by `resolveChargePlan`,
 * which converts the displayed total to one of the merchant/gateway settlement
 * currencies (NGN for the current Paystack account) without changing provider.
 */

export async function resolveActiveGateway(
  db: any,
  _displayCurrency?: string,
): Promise<ResolvedGateway> {
  await loadGatewaySecrets(db);
  const slug = await readActiveGatewaySlug(db);
  let config: GatewayConfig = {};
  try {
    const { data } = await db
      .from("payment_providers")
      .select("config")
      .eq("slug", slug)
      .maybeSingle();
    config = (data?.config ?? {}) as GatewayConfig;
  } catch {
    /* credentials come from secrets; config is optional */
  }

  const adapter = getAdapter(slug, config);
  if (!adapter.isConfigured()) {
    throw new Error("Payments are temporarily unavailable. Please contact support.");
  }
  return { slug, adapter, config, environment: adapter.environment() };
}

/** Which gateway processed a given reference — used by verify + receipts. */

export async function resolveGatewayForReference(
  db: any,
  reference: string,
): Promise<ResolvedGateway> {
  await loadGatewaySecrets(db);
  let slug: GatewaySlug = DEFAULT_GATEWAY;
  try {
    const { data: pay } = await db
      .from("tool_payments")
      .select("payment_gateway")
      .eq("paystack_reference", reference)
      .maybeSingle();
    if (pay && isGatewaySlug(pay.payment_gateway)) slug = pay.payment_gateway;
    else {
      const { data: order } = await db
        .from("tool_orders")
        .select("payment_gateway")
        .eq("paystack_reference", reference)
        .maybeSingle();
      if (order && isGatewaySlug(order.payment_gateway)) slug = order.payment_gateway;
    }
  } catch {
    /* default paystack */
  }
  let config: GatewayConfig = {};
  if (slug === "monnify") {
    try {
      const { data } = await db
        .from("payment_providers")
        .select("config")
        .eq("slug", "monnify")
        .maybeSingle();
      config = (data?.config ?? {}) as GatewayConfig;
    } catch {
      /* ignore */
    }
  }
  const adapter = getAdapter(slug, config);
  return { slug, adapter, config, environment: adapter.environment() };
}
