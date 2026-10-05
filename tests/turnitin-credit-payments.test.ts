/**
 * Turnitin Phase 6 — isolated credit payments.
 * Run: bun tests/turnitin-credit-payments.test.ts
 */
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) passed++;
  else {
    failed++;
    failures.push(message);
    console.error("  ✗", message);
  }
}

const migration = readFileSync(
  "supabase/migrations/20261005024500_turnitin_credit_payments.sql",
  "utf8",
);
const pricing = readFileSync("src/lib/turnitin-pricing.ts", "utf8");
const functions = readFileSync(
  "src/lib/turnitin-credit-payments.functions.ts",
  "utf8",
);
const webhook = readFileSync(
  "src/lib/turnitin-credit-payments.webhook.ts",
  "utf8",
);
const workspace = readFileSync(
  "src/components/turnitin/TurnitinWorkspace.tsx",
  "utf8",
);
const paystackRoute = readFileSync(
  "src/routes/api.public.webhooks.paystack.ts",
  "utf8",
);
const flutterwaveRoute = readFileSync(
  "src/routes/api.public.webhooks.flutterwave.ts",
  "utf8",
);
const monnifyRoute = readFileSync(
  "src/routes/api.public.webhooks.monnify.ts",
  "utf8",
);

assert(
  pricing.includes("TURNITIN_CREDIT_UNIT_PRICE_NGN = 2300") &&
    pricing.includes("TURNITIN_CREDIT_MAX_QUANTITY = 500") &&
    pricing.includes("turnitinCreditTotalNgn"),
  "server and UI share one fixed ₦2,300 credit price with a bounded quantity",
);

assert(
  migration.includes("turnitin_finalize_credit_purchase") &&
    migration.includes("for update") &&
    migration.includes("if _purchase.status = 'paid' then") &&
    migration.includes("turnitin_grant_paid_purchase"),
  "database finalization locks the purchase and is idempotent before granting credits",
);

assert(
  migration.includes("_paid + interval '7 days'") &&
    migration.includes("payment_currency = 'NGN'") &&
    migration.includes("verified_at = now()"),
  "verified purchases receive their own seven-day validity window in NGN",
);

assert(
  migration.includes(
    "revoke all on function public.turnitin_finalize_credit_purchase",
  ) &&
    migration.includes("to service_role"),
  "credit payment finalization remains server-only",
);

for (const forbidden of [
  "alter table public.tool_orders",
  "alter table public.tool_payments",
  "update public.tool_orders",
  "update public.tool_payments",
  "insert into public.tool_orders",
  "insert into public.tool_payments",
]) {
  assert(
    !migration.toLowerCase().includes(forbidden),
    `payment migration does not touch normal commerce table: ${forbidden}`,
  );
}

assert(
  functions.includes("resolveActiveGateway") &&
    functions.includes('currency: "NGN"') &&
    functions.includes("TURNITIN_CREDIT_UNIT_PRICE_NGN") &&
    functions.includes("turnitinCreditTotalNgn(quantity)"),
  "checkout uses the already-active gateway but derives the NGN amount only on the server",
);

assert(
  functions.includes('.from("turnitin_credit_purchases")') &&
    functions.includes('kind: "turnitin_credit_purchase"') &&
    functions.includes("turnitin_purchase_id") &&
    functions.includes("unit_amount_ngn"),
  "checkout creates a dedicated Turnitin purchase with strongly identifying gateway metadata",
);

assert(
  functions.includes("payments_paused") &&
    functions.includes("maintenance_mode") &&
    functions.includes('tool_slug", "turnitin"'),
  "Turnitin checkout respects existing global payment/maintenance controls and tool availability",
);

assert(
  functions.includes("validateVerifiedPayment") &&
    functions.includes("metadata.turnitin_purchase_id") &&
    functions.includes("metadata.user_id") &&
    functions.includes("metadata.quantity") &&
    functions.includes("metadata.unit_amount_ngn"),
  "browser-return verification checks amount, currency, ownership and metadata before granting",
);

assert(
  functions.includes("turnitin_finalize_credit_purchase") &&
    webhook.includes("turnitin_finalize_credit_purchase"),
  "both browser return and signed webhook converge on the same atomic finalizer",
);


assert(
  functions.includes("requested_amount") &&
    functions.includes("verifiedProductAmount") &&
    functions.includes("tx.requested_amount == null ? Number(tx.amount) : Number(tx.requested_amount)") &&
    functions.includes("verifiedProductAmount < expectedMinor"),
  "browser-return verification uses Paystack requested_amount when customer fees make the charged amount higher",
);

assert(
  webhook.includes("verified.requested_amount == null") &&
    webhook.includes("verifiedProductAmount < expectedMinor") &&
    !webhook.includes("Number(normalized.data.amount) !== expectedMinor"),
  "webhook rejects underpayment while allowing gateway fees above the requested Turnitin amount",
);

assert(
  webhook.includes("verifyWebhook") &&
    webhook.includes("adapter.verify(") &&
    webhook.includes("verifyByTransactionId") &&
    webhook.includes("expectedMinor"),
  "webhook requires a valid signature and authoritative gateway re-verification",
);

assert(
  webhook.includes('metadata.kind === "turnitin_credit_purchase"') &&
    webhook.includes("TURNITIN_CREDIT_UNIT_PRICE_NGN") &&
    webhook.includes('toUpperCase() !== "NGN"'),
  "webhook accepts only Turnitin-credit events with the exact server price/currency contract",
);

for (const route of [paystackRoute, flutterwaveRoute, monnifyRoute]) {
  assert(
    route.includes("tryHandleTurnitinCreditWebhook") &&
      route.includes("handlePaystackWebhook"),
    "each existing gateway routes Turnitin-credit events first and preserves the normal webhook pipeline",
  );
}

assert(
  paystackRoute.includes("tryHandleCustomPaymentWebhook") &&
    flutterwaveRoute.includes("tryHandleCustomPaymentWebhook"),
  "existing Custom Payments interception remains intact",
);

assert(
  workspace.includes("initializeTurnitinCreditPurchase") &&
    workspace.includes("verifyTurnitinCreditPurchase") &&
    workspace.includes("turnitin-credit-reference") &&
    workspace.includes("active-gateway"),
  "workspace starts checkout, remembers the reference and verifies the return through the existing gateway",
);


assert(
  functions.includes("reconcileLatestTurnitinCreditPurchase") &&
    functions.includes('.eq("status", "pending")') &&
    functions.includes(".order(\"created_at\", { ascending: false })"),
  "customer recovery action locates only the signed-in user's latest pending Turnitin purchase",
);

assert(
  workspace.includes("Retry last payment verification") &&
    workspace.includes("reconcileLatestTurnitinCreditPurchase"),
  "workspace exposes a safe retry action for already-paid pending purchases",
);

assert(
  workspace.includes("One-time payment only") &&
    workspace.includes("seven days") &&
    workspace.includes("Existing tool subscriptions are not used"),
  "customer copy clearly describes the isolated one-time credit model",
);

for (const forbidden of [
  "tool_orders",
  "tool_payments",
  "pricing_option_id",
  "billing_period",
  "recurring_subscription",
  "coupon_code",
]) {
  assert(
    !functions.includes(forbidden) && !webhook.includes(forbidden),
    `Turnitin credit payments do not couple to subscription checkout field: ${forbidden}`,
  );
}

console.log(
  `turnitin-credit-payments: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
