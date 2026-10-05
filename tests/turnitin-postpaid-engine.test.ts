/**
 * Turnitin V2 Phase 4 — Postpaid account engine.
 * Run: bun tests/turnitin-postpaid-engine.test.ts
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
  "supabase/migrations/20261005093000_turnitin_postpaid_engine.sql",
  "utf8",
);
const migrationSqlOnly = migration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const adminFns = readFileSync(
  "src/lib/turnitin-postpaid.functions.ts",
  "utf8",
);
const jobs = readFileSync(
  "src/lib/turnitin-jobs.functions.ts",
  "utf8",
);
const workspaceFns = readFileSync(
  "src/lib/turnitin.functions.ts",
  "utf8",
);
const workspace = readFileSync(
  "src/components/turnitin/TurnitinWorkspace.tsx",
  "utf8",
);
const customerAdmin = readFileSync(
  "src/routes/admin.customers.$userId.tsx",
  "utf8",
);

assert(
  migration.includes("create table if not exists public.turnitin_account_settings") &&
    migration.includes("billing_mode text not null default 'prepaid'") &&
    migration.includes("postpaid_rate_ngn integer"),
  "account settings add an isolated prepaid/postpaid billing mode with negotiated rate",
);

assert(
  migration.includes("create table if not exists public.turnitin_postpaid_rate_history") &&
    migration.includes("previous_rate_ngn") &&
    migration.includes("new_rate_ngn") &&
    migration.includes("effective_at"),
  "negotiated Postpaid rate changes have immutable history",
);

assert(
  migration.includes("create table if not exists public.turnitin_postpaid_account_events") &&
    migration.includes("'postpaid_enabled'") &&
    migration.includes("'postpaid_disabled'") &&
    migration.includes("'rate_changed'"),
  "Postpaid enable/disable/rate changes have permanent account-event history",
);

assert(
  migration.includes("alter table public.turnitin_jobs") &&
    migration.includes("billing_mode text not null default 'prepaid'"),
  "each Turnitin job freezes whether it belongs to the prepaid or Postpaid lifecycle",
);

assert(
  migration.includes("create table if not exists public.turnitin_postpaid_charges") &&
    migration.includes("constraint turnitin_postpaid_charges_job_uid unique (job_id)") &&
    migration.includes("rate_ngn integer not null") &&
    migration.includes("amount_ngn integer not null"),
  "each accepted Postpaid job can create at most one immutable-rate financial charge",
);

assert(
  migration.includes("turnitin_charge_postpaid_job") &&
    migration.includes("_settings.postpaid_rate_ngn") &&
    migration.includes("rate_ngn,") &&
    migration.includes("amount_ngn,"),
  "Postpaid charge atomically snapshots the currently agreed rate at acceptance",
);

assert(
  migration.includes("TURNITIN_POSTPAID_ALREADY_ENABLED_USE_RATE_UPDATE") &&
    migration.includes("turnitin_update_postpaid_rate"),
  "later rate changes use a dedicated history-preserving path instead of rewriting account activation",
);

assert(
  migration.includes("TURNITIN_POSTPAID_SUPER_ADMIN_REQUIRED") &&
    migration.includes("coalesce(r.is_super_admin, false)"),
  "database independently restricts Postpaid enable/disable to Super Admin",
);

assert(
  adminFns.includes("async function assertSuperAdmin") &&
    adminFns.includes("Forbidden — Super Admin only") &&
    adminFns.includes("adminSetTurnitinPostpaidStatus"),
  "server-side status control also requires Super Admin",
);

assert(
  adminFns.includes("adminUpdateTurnitinPostpaidRate") &&
    adminFns.includes("await assertAdmin(context)") &&
    adminFns.includes('"turnitin_update_postpaid_rate"'),
  "active Admin may update an already-enabled customer's negotiated rate",
);

assert(
  migration.includes("TURNITIN_POSTPAID_OUTSTANDING_BALANCE") &&
    migration.includes("TURNITIN_POSTPAID_ACTIVE_JOBS"),
  "returning a customer to Prepaid is blocked by outstanding debt or active Postpaid jobs",
);

assert(
  jobs.includes("getTurnitinBillingMode") &&
    jobs.includes('billing_mode: billing.billingMode') &&
    jobs.includes('if (billing.billingMode === "prepaid")') &&
    jobs.includes('"turnitin_reserve_credit"'),
  "job creation preserves the existing credit reservation only for prepaid accounts",
);

assert(
  jobs.includes('job.billing_mode === "postpaid"') &&
    jobs.includes('"turnitin_charge_postpaid_job"') &&
    jobs.includes('"turnitin_consume_reserved_credit"'),
  "Originality acceptance branches to Postpaid charge or prepaid credit consumption without duplicating the adapter",
);

assert(
  jobs.includes('"turnitin_void_postpaid_charge"') &&
    jobs.includes('"turnitin_refund_consumed_credit"'),
  "accepted total failure voids Postpaid debt while preserving the prepaid refund path",
);

assert(
  migration.includes("if _charge.paid_amount_ngn > 0") &&
    migration.includes("TURNITIN_POSTPAID_PAID_CHARGE_CANNOT_VOID"),
  "Postpaid failure logic never silently voids money already settled",
);

assert(
  workspaceFns.includes("billing_mode: TurnitinBillingMode") &&
    workspaceFns.includes("postpaid_rate_ngn") &&
    workspaceFns.includes("outstanding_ngn"),
  "customer workspace data exposes billing mode, agreed rate and Postpaid outstanding state",
);

assert(
  workspace.includes('const isPostpaid = account.billing_mode === "postpaid"') &&
    workspace.includes("!isPostpaid && summary.available_credits < 1") &&
    workspace.includes("No credit required."),
  "Postpaid users may submit at zero credits while prepaid zero-credit blocking remains intact",
);

assert(
  workspace.includes("Saved prepaid credits") &&
    workspace.includes("Not consumed while Postpaid is active"),
  "existing prepaid credits remain visible and untouched for Postpaid users",
);

assert(
  workspace.includes("You do not need to buy prepaid checks while Postpaid is active") &&
    workspace.includes("Each accepted document is billed at your agreed rate"),
  "Postpaid customers are not pushed through the prepaid Buy Checks checkout",
);

assert(
  customerAdmin.includes("<TurnitinPostpaidCard") &&
    customerAdmin.includes("Enable Postpaid account") &&
    customerAdmin.includes("Update agreed rate") &&
    customerAdmin.includes("Return customer to Prepaid"),
  "Admin customer page exposes the Postpaid management experience",
);

assert(
  customerAdmin.includes("Only a Super Admin can convert a customer to Postpaid") &&
    customerAdmin.includes("data.caller.isSuperAdmin"),
  "ordinary Admin UI cannot enable or disable Postpaid status",
);

assert(
  customerAdmin.includes("Existing charges keep their original rate permanently"),
  "Admin UI explicitly communicates the immutable historical-rate rule",
);

for (const forbidden of ["tool_orders", "tool_payments", "subscription_status"]) {
  assert(
    !migrationSqlOnly.includes(forbidden) && !adminFns.includes(forbidden),
    `Postpaid engine remains isolated from ordinary subscription/payment surface: ${forbidden}`,
  );
}

assert(
  !migration.includes("turnitin_postpaid_settlements") &&
    !migration.includes("turnitin_postpaid_allocations"),
  "Phase 4 does not prematurely implement Phase 5 settlement/allocation tables",
);

console.log(`turnitin-postpaid-engine: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
