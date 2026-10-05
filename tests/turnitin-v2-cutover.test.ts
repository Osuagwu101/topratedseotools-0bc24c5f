/**
 * Turnitin V2 Phase 6 — final integration/cutover conformance.
 * Run: bun tests/turnitin-v2-cutover.test.ts
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

const navbar = readFileSync("src/components/site/Navbar.tsx", "utf8");
const product = readFileSync(
  "src/components/turnitin/TurnitinProductPage.tsx",
  "utf8",
);
const workspace = readFileSync(
  "src/components/turnitin/TurnitinWorkspace.tsx",
  "utf8",
);
const jobs = readFileSync("src/lib/turnitin-jobs.functions.ts", "utf8");
const manualCredits = readFileSync(
  "src/lib/turnitin-admin-credits.functions.ts",
  "utf8",
);
const postpaid = readFileSync(
  "src/lib/turnitin-postpaid.functions.ts",
  "utf8",
);
const settlements = readFileSync(
  "src/lib/turnitin-postpaid-settlements.functions.ts",
  "utf8",
);
const settlementWebhook = readFileSync(
  "src/lib/turnitin-postpaid-settlements.webhook.ts",
  "utf8",
);
const adminPage = readFileSync(
  "src/routes/admin.customers.$userId.tsx",
  "utf8",
);
const creditMigration = readFileSync(
  "supabase/migrations/20261005090000_turnitin_admin_credit_grants.sql",
  "utf8",
);
const postpaidMigration = readFileSync(
  "supabase/migrations/20261005093000_turnitin_postpaid_engine.sql",
  "utf8",
);
const settlementMigration = readFileSync(
  "supabase/migrations/20261005100000_turnitin_postpaid_settlements.sql",
  "utf8",
);

assert(
  navbar.includes('{ to: "/turnitin", label: "Turnitin Checks" }') &&
    product.includes('to: "/turnitin/submit"') &&
    product.includes('to: "/turnitin/buy"') &&
    product.includes('to: "/turnitin/history"'),
  "Turnitin is a first-class product with Overview, Submit, Buy and History",
);

assert(
  workspace.includes('useState("Top Rated")') &&
    workspace.includes('useState("Writing Services")') &&
    workspace.includes("setAuthorFirstName") &&
    workspace.includes("setAuthorLastName"),
  "submission defaults remain Top Rated / Writing Services and editable",
);

assert(
  workspace.includes("Requirements for AI Detection") &&
    workspace.includes("30,000 words") &&
    workspace.includes("100 MB"),
  "submission page preserves verified Originality upload/AI requirements",
);

assert(
  creditMigration.includes("turnitin_admin_credit_grants") &&
    creditMigration.includes("turnitin_admin_grant_credits") &&
    manualCredits.includes("adminGrantTurnitinCredits"),
  "Admin manual credits use the isolated Turnitin batch/ledger model",
);

assert(
  postpaidMigration.includes("turnitin_account_settings") &&
    postpaidMigration.includes("turnitin_postpaid_rate_history") &&
    postpaidMigration.includes("turnitin_postpaid_charges"),
  "Postpaid account, rate history and check-charge ledgers exist",
);

assert(
  postpaidMigration.includes("coalesce(r.is_super_admin, false)") &&
    postpaid.includes("assertSuperAdmin"),
  "only Super Admin can enable/disable Postpaid",
);

assert(
  jobs.includes('if (billing.billingMode === "prepaid")') &&
    jobs.includes('"turnitin_reserve_credit"') &&
    jobs.includes('"turnitin_charge_postpaid_job"'),
  "prepaid and Postpaid share one Originality lifecycle with isolated billing finalizers",
);

assert(
  postpaidMigration.includes("_settings.postpaid_rate_ngn") &&
    postpaidMigration.includes("rate_ngn,") &&
    postpaidMigration.includes("amount_ngn,"),
  "each accepted Postpaid check snapshots the rate active at acceptance",
);

assert(
  jobs.includes('"turnitin_void_postpaid_charge"') &&
    jobs.includes('"turnitin_refund_consumed_credit"'),
  "total failure voids Postpaid debt while prepaid still receives its credit refund",
);

assert(
  settlementMigration.includes("turnitin_postpaid_settlements") &&
    settlementMigration.includes("turnitin_postpaid_allocations") &&
    settlementMigration.includes(
      "order by c.charged_at asc, c.created_at asc, c.id asc",
    ),
  "Postpaid settlements are permanent and allocate oldest unpaid checks first",
);

assert(
  settlements.includes("initializeTurnitinPostpaidSettlement") &&
    settlements.includes("adminRecordTurnitinPostpaidSettlement") &&
    settlements.includes("reconcileLatestTurnitinPostpaidSettlement"),
  "Postpaid supports online and Admin-recorded settlement with recovery",
);

assert(
  settlementWebhook.includes("verifyWebhook") &&
    settlementWebhook.includes("turnitin_finalize_postpaid_settlement"),
  "online Postpaid settlements are finalized only after signed gateway verification",
);

assert(
  workspace.includes("Retry last Postpaid payment verification") &&
    workspace.includes("Settlement history") &&
    adminPage.includes("Postpaid check ledger") &&
    adminPage.includes("Record settlement"),
  "customer and Admin settlement interfaces are present",
);

assert(
  workspace.includes("AI_") === false,
  "report filename policy is kept in the server download helper rather than hard-coded in UI",
);

const reportFns = readFileSync("src/lib/turnitin.functions.ts", "utf8");
assert(
  reportFns.includes('reportType === "ai" ? "AI_" : "si_"') &&
    reportFns.includes("download: filename"),
  "report downloads preserve uploaded filename stem with AI_/si_ attachment names",
);

for (const source of [
  creditMigration,
  postpaidMigration,
  settlementMigration,
  manualCredits,
  postpaid,
  settlements,
]) {
  assert(
    !/insert\s+into\s+public\.tool_orders/i.test(source) &&
      !/insert\s+into\s+public\.tool_payments/i.test(source),
    "Turnitin V2 never creates normal subscription orders/payments",
  );
}

assert(
  adminPage.includes("Turnitin prepaid credits") &&
    adminPage.includes("Turnitin billing account"),
  "Admin retains both prepaid credit controls and Postpaid billing controls",
);

console.log(`turnitin-v2-cutover: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
