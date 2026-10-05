/**
 * Turnitin V2 Phase 3 — Admin manual prepaid credit grants.
 * Run: bun tests/turnitin-admin-credits.test.ts
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
  "supabase/migrations/20261005090000_turnitin_admin_credit_grants.sql",
  "utf8",
);
const functions = readFileSync(
  "src/lib/turnitin-admin-credits.functions.ts",
  "utf8",
);
const customerPage = readFileSync(
  "src/routes/admin.customers.$userId.tsx",
  "utf8",
);

assert(
  migration.includes("create table if not exists public.turnitin_admin_credit_grants") &&
    migration.includes("granted_by uuid") &&
    migration.includes("reason text not null") &&
    migration.includes("expires_at timestamptz not null"),
  "manual grants have a dedicated immutable audit record with actor, reason and expiry",
);

assert(
  migration.includes("source,") &&
    migration.includes("'admin'") &&
    migration.includes("turnitin_credit_batches") &&
    migration.includes("turnitin_credit_ledger"),
  "manual grants reuse the existing Turnitin batch and ledger model",
);

assert(
  migration.includes("turnitin_admin_grant_credits") &&
    migration.includes("security definer") &&
    migration.includes("grant execute on function public.turnitin_admin_grant_credits") &&
    migration.includes("to service_role"),
  "manual credit mutation is atomic and service-role only",
);

assert(
  migration.includes("TURNITIN_GRANT_ADMIN_FORBIDDEN") &&
    migration.includes("r.role = 'admin'") &&
    migration.includes("r.is_active"),
  "database function independently verifies the recorded grant actor is an active Admin",
);

assert(
  migration.includes("TURNITIN_GRANT_QUANTITY_INVALID") &&
    migration.includes("TURNITIN_GRANT_EXPIRY_INVALID") &&
    migration.includes("TURNITIN_GRANT_REASON_INVALID"),
  "database validates quantity, future expiry and required reason",
);

assert(
  migration.includes("'grant-admin:' || _grant_id::text") &&
    migration.includes("available_delta") &&
    migration.includes("_quantity"),
  "manual grant writes an idempotency-labelled immutable credit ledger entry",
);

for (const forbidden of [
  "tool_orders",
  "tool_payments",
  "pricing_option_id",
  "billing_period",
  "subscription_status",
]) {
  assert(
    !migration.includes(forbidden) && !functions.includes(forbidden),
    `manual Turnitin credits do not touch normal subscription/payment surface: ${forbidden}`,
  );
}

assert(
  functions.includes("async function assertAdmin") &&
    functions.includes('rpc("has_role"') &&
    functions.includes('"_role": "admin"') === false &&
    functions.includes('_role: "admin"'),
  "server functions require the existing Admin role before privileged access",
);

assert(
  functions.includes("adminGrantTurnitinCredits") &&
    functions.includes('"turnitin_admin_grant_credits"') &&
    functions.includes("_admin_id: context.userId"),
  "server grant records the authenticated Admin as the actor",
);

assert(
  functions.includes("adminGetTurnitinCreditControls") &&
    functions.includes("turnitin_credit_batches") &&
    functions.includes("turnitin_admin_credit_grants") &&
    functions.includes("availableCredits") &&
    functions.includes("nextExpiryAt"),
  "Admin can read the customer's current Turnitin credit state and grant history",
);

assert(
  functions.includes("turnitin_credits_granted") &&
    functions.includes("customer_admin_audit"),
  "manual grant also records a customer-level Admin audit event",
);

assert(
  customerPage.includes("<TurnitinCreditsCard") &&
    customerPage.includes("Turnitin prepaid credits") &&
    customerPage.includes("Grant credits manually"),
  "customer Admin page exposes an isolated Turnitin credit card",
);

assert(
  customerPage.includes('type="number"') &&
    customerPage.includes('type="datetime-local"') &&
    customerPage.includes("Reason / note"),
  "Admin grant UI captures quantity, expiry and required reason",
);

assert(
  customerPage.includes("7 * 24 * 60 * 60 * 1000") &&
    customerPage.includes("Defaults to seven days from now"),
  "manual grant expiry defaults to seven days while remaining editable",
);

assert(
  customerPage.includes("Manual grant history") &&
    customerPage.includes("g.grantedByLabel") &&
    customerPage.includes("g.reason"),
  "Admin UI displays permanent recent grant history with actor and reason",
);

assert(
  customerPage.includes("do not create a subscription, payment, or") &&
    customerPage.includes("normal tool order"),
  "Admin copy makes clear manual credits are not fake subscriptions or payments",
);

console.log(`turnitin-admin-credits: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
