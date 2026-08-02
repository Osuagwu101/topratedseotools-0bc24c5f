/**
 * Gateway registry — resolves the gateway for a payment at runtime.
 *
 * Server-only: reads secrets from process.env inside the adapters. Routing is
 * automatic and currency-driven (NGN → Paystack, everything else →
 * Flutterwave); there is no admin-controlled "active gateway".
 */
import { paystackAdapter } from "./paystack";
import { flutterwaveAdapter } from "./flutterwave";
import { createMonnifyAdapter } from "./monnify";
import { isGatewaySlug, type GatewayAdapter, type GatewayConfig, type GatewaySlug } from "./types";
import { loadGatewaySecrets } from "./secrets.server";
import { gatewayForCurrency } from "@/lib/gateway-routing";

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

/**
 * Resolve the gateway for a checkout from the currency being charged.
 * Falls back to Paystack if the routed gateway is not configured yet, so a
 * customer is never stranded on a half-configured provider.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveGatewayForCurrency(db: any, currency: string): Promise<ResolvedGateway> {
  // Admin-entered credentials live in the database — hydrate them first.
  await loadGatewaySecrets(db);
  const slug: GatewaySlug = gatewayForCurrency(currency);
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
    if (slug !== "paystack" && paystackAdapter.isConfigured()) {
      return { slug: "paystack", adapter: paystackAdapter, config: {}, environment: paystackAdapter.environment() };
    }
    throw new Error("Payments are temporarily unavailable. Please contact support.");
  }
  return { slug, adapter, config, environment: adapter.environment() };
}


/** Which gateway processed a given reference — used by verify + receipts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveGatewayForReference(db: any, reference: string): Promise<ResolvedGateway> {
  await loadGatewaySecrets(db);
  let slug: GatewaySlug = "paystack";
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
