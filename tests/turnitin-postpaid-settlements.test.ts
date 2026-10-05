/**
 * Turnitin V2 Phase 5 — Postpaid settlements and allocation.
 * Run: bun tests/turnitin-postpaid-settlements.test.ts
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
  "supabase/migrations/20261005100000_turnitin_postpaid_settlements.sql",
  "utf8",
);
const functions = readFileSync(
  "src/lib/turnitin-postpaid-settlements.functions.ts",
  "utf8",
);
const webhook = readFileSync(
  "src/lib/turnitin-postpaid-settlements.webhook.ts",
  "utf8",
);
const workspace = readFileSync(
  "src/components/turnitin/TurnitinWorkspace.tsx",
  "utf8",
);
const adminPage = readFileSync(
  "src/routes/admin.customers.$userId.tsx",
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
  migration.includes(
    "create table if not exists public.turnitin_postpaid_settlements",
  ) &&
    migration.includes("amount_ngn integer not null") &&
    migration.includes("allocated_amount_ngn integer not null default 0") &&
    migration.includes("method text not null") &&
    migration.includes("status text not null default 'pending'"),
  "Postpaid money received is stored in a permanent settlement ledger",
);

assert(
  migration.includes(
    "create table if not exists public.turnitin_postpaid_allocations",
  ) &&
    migration.includes("settlement_id uuid not null") &&
    migration.includes("charge_id uuid not null") &&
    migration.includes("amount_ngn integer not null"),
  "settlement-to-charge allocations have their own permanent ledger",
);

assert(
  migration.includes(
    "create unique index if not exists turnitin_postpaid_one_pending_website_uidx",
  ) &&
    migration.includes("where method = 'website' and status = 'pending'"),
  "a customer cannot open multiple concurrent website settlement checkouts",
);

assert(
  migration.includes("turnitin_apply_postpaid_settlement") &&
    migration.includes(
      "order by c.charged_at asc, c.created_at asc, c.id asc",
    ) &&
    migration.includes("_allocation := least(_remaining, _charge_remaining)"),
  "confirmed settlements allocate partial/full money to oldest unpaid checks first",
);

assert(
  migration.includes("status = case") &&
    migration.includes("then 'paid'") &&
    migration.includes("else 'partially_paid'"),
  "charge status is updated accurately after partial or full allocation",
);

assert(
  migration.includes("turnitin_record_manual_postpaid_settlement") &&
    migration.includes(
      "_method not in ('bank_transfer','whatsapp','offline','other')",
    ) &&
    migration.includes("TURNITIN_POSTPAID_SETTLEMENT_EXCEEDS_OUTSTANDING"),
  "Admin manual settlements support agreed offline methods and reject overpayment",
);

assert(
  migration.includes("TURNITIN_POSTPAID_ONLINE_SETTLEMENT_PENDING") &&
    migration.includes("method = 'website'") &&
    migration.includes("status = 'pending'"),
  "manual settlement is blocked while an online settlement is awaiting verification",
);

assert(
  migration.includes("turnitin_finalize_postpaid_settlement") &&
    migration.includes("TURNITIN_POSTPAID_SETTLEMENT_REFERENCE_MISMATCH") &&
    migration.includes("turnitin_apply_postpaid_settlement"),
  "verified website settlement finalization checks the reference and converges on the same allocator",
);

assert(
  functions.includes("initializeTurnitinPostpaidSettlement") &&
    functions.includes("resolveActiveGateway") &&
    functions.includes('kind: "turnitin_postpaid_settlement"') &&
    functions.includes("amountMinor: majorToMinor(data.amountNgn)"),
  "customer online Postpaid settlement reuses the active gateway infrastructure",
);

assert(
  functions.includes("verifyTurnitinPostpaidSettlement") &&
    functions.includes("validateVerifiedSettlement") &&
    functions.includes("requested_amount") &&
    functions.includes('"turnitin_finalize_postpaid_settlement"'),
  "browser return verifies gateway status, amount, currency and metadata before allocation",
);

assert(
  functions.includes("reconcileLatestTurnitinPostpaidSettlement") &&
    functions.includes('.eq("method", "website")') &&
    functions.includes('.eq("status", "pending")'),
  "customer can safely reconcile an already-paid pending website settlement",
);

assert(
  functions.includes("adminRecordTurnitinPostpaidSettlement") &&
    functions.includes('"turnitin_record_manual_postpaid_settlement"') &&
    functions.includes("turnitin_postpaid_settlement_recorded"),
  "Admin settlement action uses the atomic database allocator and customer audit log",
);

assert(
  functions.includes("adminGetTurnitinPostpaidLedger") &&
    functions.includes("documentName") &&
    functions.includes("settlements") &&
    functions.includes("allocations"),
  "Admin can review charges, document names, settlements and allocation history",
);

assert(
  webhook.includes("tryHandleTurnitinPostpaidSettlementWebhook") &&
    webhook.includes("verifyWebhook") &&
    webhook.includes("verifyByTransactionId") &&
    webhook.includes('"turnitin_finalize_postpaid_settlement"'),
  "signed gateway webhooks independently verify and finalize Postpaid settlements",
);

for (const route of [paystackRoute, flutterwaveRoute, monnifyRoute]) {
  assert(
    route.includes("tryHandleTurnitinPostpaidSettlementWebhook") &&
      route.includes("turnitinPostpaid"),
    "each supported gateway routes Postpaid settlement webhooks before ordinary checkout handling",
  );
}

assert(
  workspace.includes("initializeTurnitinPostpaidSettlement") &&
    workspace.includes("turnitin-postpaid-settlement-reference") &&
    workspace.includes("settlePostpaidBalance") &&
    workspace.includes("Retry last Postpaid payment verification"),
  "Postpaid customer page supports online full/partial settlement and recovery",
);

assert(
  workspace.includes("Settlement history") &&
    workspace.includes("allocatedAmountNgn") &&
    workspace.includes("Confirmed money is allocated to your oldest unpaid checks first"),
  "customer sees permanent Postpaid settlement history and allocation behavior",
);

assert(
  adminPage.includes("Record settlement") &&
    adminPage.includes("Bank transfer") &&
    adminPage.includes("WhatsApp settlement") &&
    adminPage.includes("Offline settlement"),
  "Admin UI supports bank, WhatsApp and offline settlement recording",
);

assert(
  adminPage.includes("Postpaid check ledger") &&
    adminPage.includes("Settlement history") &&
    adminPage.includes("row.documentName") &&
    adminPage.includes("row.paidAmountNgn"),
  "Admin UI exposes check-level debt and permanent settlement history",
);

for (const forbidden of [
  "insert into public.tool_orders",
  "update public.tool_orders",
  "insert into public.tool_payments",
  "update public.tool_payments",
]) {
  assert(
    !migration.toLowerCase().includes(forbidden) &&
      !functions.toLowerCase().includes(forbidden),
    `Postpaid settlements remain isolated from normal tool commerce: ${forbidden}`,
  );
}

assert(
  !migration.toLowerCase().includes("delete from public.turnitin_postpaid"),
  "Phase 5 never clears financial history by deleting Postpaid charges or settlements",
);

console.log(
  `turnitin-postpaid-settlements: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
