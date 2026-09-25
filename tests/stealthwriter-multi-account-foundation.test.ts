/**
 * Phase 1 — StealthWriter multi-account foundation.
 *
 * This is intentionally structural only: Account 1 mirrors the existing
 * working vault, Account 2 is reserved but unconfigured, and customer routing
 * remains on the legacy single-account path until a later approved phase.
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
  "supabase/migrations/20260925083000_stealthwriter_multi_account_foundation.sql",
  "utf8",
);
const sessionFn = readFileSync(
  "src/lib/stealthwriter-session.functions.ts",
  "utf8",
);
const proxy = readFileSync(
  "src/lib/stealthwriter-proxy.server.ts",
  "utf8",
);

assert(
  migration.includes("create table if not exists public.stealthwriter_provider_accounts"),
  "creates the provider-account vault",
);
assert(
  migration.includes("'account_1'") &&
    migration.includes("'Account 1'") &&
    migration.includes("'account_2'") &&
    migration.includes("'Account 2'"),
  "reserves stable Account 1 and Account 2 slots",
);
assert(
  migration.includes("from public.tool_authorized_sessions") &&
    migration.includes("where tool_slug = 'stealthwriter'"),
  "migrates the existing working StealthWriter session into Account 1",
);
assert(
  migration.includes("sync_stealthwriter_account_1_from_legacy") &&
    migration.includes("after insert or update on public.tool_authorized_sessions"),
  "keeps Account 1 synchronized while the legacy vault remains live",
);
assert(
  migration.includes("enable row level security") &&
    migration.includes("from public, anon, authenticated") &&
    migration.includes("to service_role"),
  "keeps provider-account secrets server-only",
);
assert(
  migration.includes("status <> 'stored' or encrypted_payload is not null"),
  "a configured account cannot exist without encrypted session material",
);

// Phase boundary: current production admin/proxy code remains untouched.
assert(
  sessionFn.includes('.from("tool_authorized_sessions")') &&
    sessionFn.includes('{ onConflict: "tool_slug" }'),
  "current admin replacement remains on the proven legacy write path in Phase 1",
);
assert(
  proxy.includes('.from("tool_authorized_sessions")') &&
    !proxy.includes('provider_account_key'),
  "Phase 1 does not introduce customer routing or assignment",
);

console.log(
  `stealthwriter-multi-account-foundation: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
