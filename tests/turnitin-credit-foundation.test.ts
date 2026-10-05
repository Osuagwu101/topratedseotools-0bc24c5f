/**
 * Turnitin Phase 3 — isolated prepaid credit/data foundation.
 * Run: bun tests/turnitin-credit-foundation.test.ts
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
  "supabase/migrations/20261004213000_turnitin_credit_foundation.sql",
  "utf8",
);
const normalized = migration.toLowerCase();

for (const table of [
  "turnitin_credit_purchases",
  "turnitin_credit_batches",
  "turnitin_credit_ledger",
  "turnitin_jobs",
  "turnitin_reports",
]) {
  assert(
    normalized.includes(`create table if not exists public.${table}`),
    `creates isolated ${table} table`,
  );
}

assert(
  migration.includes("unit_amount_ngn integer not null default 2300") &&
    migration.includes("_purchase.paid_at + interval '7 days'"),
  "credits use ₦2,300 as the foundation price and expire seven days after payment",
);

assert(
  migration.includes("turnitin_credit_batches_accounting_chk") &&
    migration.includes("available_credits +") &&
    migration.includes("reserved_credits +") &&
    migration.includes("consumed_credits +") &&
    migration.includes("expired_credits +") &&
    migration.includes("refunded_credits"),
  "credit batch accounting cannot silently create or lose credits",
);

for (const fn of [
  "turnitin_expire_user_credits",
  "turnitin_grant_paid_purchase",
  "turnitin_reserve_credit",
  "turnitin_consume_reserved_credit",
  "turnitin_release_reserved_credit",
  "turnitin_refund_consumed_credit",
  "turnitin_my_credit_summary",
]) {
  assert(
    normalized.includes(`function public.${fn}`),
    `defines ${fn}`,
  );
}

assert(
  migration.includes("order by b.expires_at, b.created_at") &&
    migration.includes("for update skip locked") &&
    migration.includes("'TURNITIN_NO_CREDIT'"),
  "reservation spends the oldest valid credit first and locks against concurrent double-spend",
);

assert(
  migration.includes("available_credits = available_credits - 1") &&
    migration.includes("reserved_credits = reserved_credits + 1") &&
    migration.includes("'reserve:' || _job_id::text"),
  "reserve moves exactly one credit from available to reserved with an idempotent reservation version",
);

assert(
  migration.includes("reserved_credits = reserved_credits - 1") &&
    migration.includes("consumed_credits = consumed_credits + 1") &&
    migration.includes("upstream_submission_id = _upstream_submission_id") &&
    migration.includes("status = 'queued'"),
  "credit is consumed only when an accepted upstream submission ID is recorded",
);

assert(
  migration.includes("if _batch.expires_at > now() then") &&
    migration.includes("available_credits = available_credits + 1") &&
    migration.includes("expired_credits = expired_credits + 1"),
  "pre-acceptance release restores a still-valid credit but does not resurrect an already expired one",
);

assert(
  migration.includes("source = 'refund'") &&
    migration.includes("now() + interval '7 days'") &&
    migration.includes("'refund_grant'") &&
    migration.includes("credit_state = 'refunded'"),
  "a completely failed accepted job receives one fresh seven-day replacement credit",
);

assert(
  migration.includes("turnitin_jobs_user_filename_idx") &&
    migration.includes("lower(original_filename)"),
  "job history is indexed for document-name search",
);

assert(
  migration.includes("report_type text not null check (report_type in ('similarity','ai'))") &&
    migration.includes("unique(job_id, report_type)") &&
    migration.includes("ai_unavailable_reason"),
  "job/report model supports separate similarity and AI results including AI-unavailable cases",
);

assert(
  migration.includes("enable row level security") &&
    migration.includes("grant select on table public.turnitin_jobs to authenticated") &&
    migration.includes("public.has_role(auth.uid(), 'admin')") &&
    migration.includes("grant all on table public.turnitin_jobs to service_role"),
  "Turnitin tables are RLS-protected with customer/admin reads and server-side mutation authority",
);

for (const fnSig of [
  "turnitin_expire_user_credits(uuid)",
  "turnitin_grant_paid_purchase(uuid)",
  "turnitin_reserve_credit(uuid, uuid)",
  "turnitin_consume_reserved_credit(uuid, uuid, text)",
  "turnitin_release_reserved_credit(uuid, uuid, text)",
  "turnitin_refund_consumed_credit(uuid, uuid, text)",
]) {
  assert(
    normalized.includes(`revoke all on function public.${fnSig} from public, anon, authenticated`) &&
      normalized.includes(`grant execute on function public.${fnSig} to service_role`),
    `${fnSig} remains server-only`,
  );
}

for (const forbidden of [
  "alter table public.tool_orders",
  "alter table public.tool_payments",
  "alter table public.user_subscriptions",
  "alter table public.stealthwriter",
  "alter table public.phrasly",
  "alter table public.chatgpt",
  "update public.tool_orders",
  "update public.tool_payments",
]) {
  assert(
    !normalized.includes(forbidden),
    `migration does not touch unrelated live surface: ${forbidden}`,
  );
}

console.log(
  `turnitin-credit-foundation: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
