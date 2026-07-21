/**
 * Legacy-fallback + Private-hidden decision tests for the account pool.
 *
 * These lock the invariants the customer dashboard depends on:
 *  - Post-migration Shared orders never see legacy `tool_credentials`.
 *  - An awaiting-assignment customer receives `null` (UI: "Awaiting…").
 *  - Pre-migration Shared orders keep working via the legacy vault.
 *  - Private orders stay pending until fulfilment even if a private
 *    account has already been reserved in the pool.
 *  - A fulfilled private order with an assigned account exposes it.
 *  - Updating the pool row propagates because credentials are read live
 *    from the joined account (single source of truth).
 *  - One-click launches use the assigned account.
 *
 * Run: bun tests/account-pool-fallback.test.ts
 */
import { resolveOrderCredentials, LEGACY_CREDENTIAL_CUTOFF_ISO } from "../src/lib/access.functions";

let passed = 0,
  failed = 0;
const failures: string[] = [];
function assert(cond: any, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(msg);
    console.error("  ✗", msg);
  }
}

const cutoff = LEGACY_CREDENTIAL_CUTOFF_ISO;
const beforeCutoff = new Date(Date.parse(cutoff) - 60_000).toISOString();
const afterCutoff = new Date(Date.parse(cutoff) + 60_000).toISOString();
const legacy = { email: "legacy@x.com", password: "legacyPW", login_url: "https://x", login_notes: null };
const assigned = { email: "pool@x.com", password: "poolPW", login_url: "https://x", login_notes: null };

console.log("account-pool-fallback");

// 1. New paid Shared order with no assignment => no legacy credentials.
{
  const r = resolveOrderCredentials({
    order: { id: "o1", tool_slug: "t", access_type: "shared", fulfilment_status: "not_required", created_at: afterCutoff, admin_notes: null },
    assignment: null,
    legacyCredential: legacy,
  });
  assert(r === null, "new Shared order with no assignment sees no legacy credentials");
}

// 2. Awaiting-assignment customer (no assignment, no legacy) => null.
{
  const r = resolveOrderCredentials({
    order: { id: "o2", tool_slug: "t", access_type: "shared", fulfilment_status: "not_required", created_at: afterCutoff, admin_notes: null },
    assignment: null,
    legacyCredential: null,
  });
  assert(r === null, "awaiting-assignment => null so UI can show the waiting message");
}

// 3. Pre-migration Shared order with no assignment keeps working via legacy vault.
{
  const r = resolveOrderCredentials({
    order: { id: "o3", tool_slug: "t", access_type: "shared", fulfilment_status: "not_required", created_at: beforeCutoff, admin_notes: null },
    assignment: null,
    legacyCredential: legacy,
  });
  assert(r?.email === "legacy@x.com", "pre-migration Shared order still sees legacy credentials");
}

// 4. Private order in pending fulfilment => never revealed, even with an assignment.
{
  const r = resolveOrderCredentials({
    order: { id: "op1", tool_slug: "t", access_type: "private", fulfilment_status: "pending", created_at: afterCutoff, admin_notes: null },
    assignment: assigned,
    legacyCredential: null,
  });
  assert(r === null, "Private + pending fulfilment hides the reserved account");
}

// 5. Private order fulfilled + assigned => credentials shown.
{
  const r = resolveOrderCredentials({
    order: { id: "op2", tool_slug: "t", access_type: "private", fulfilment_status: "active", created_at: afterCutoff, admin_notes: null },
    assignment: assigned,
    legacyCredential: null,
  });
  assert(r?.email === "pool@x.com", "Private + active fulfilment reveals the assigned account");
}

// 6. Updating the pool row propagates: resolver returns whatever the join provided.
{
  const updated = { ...assigned, password: "rotated" };
  const r = resolveOrderCredentials({
    order: { id: "o4", tool_slug: "t", access_type: "shared", fulfilment_status: "not_required", created_at: afterCutoff, admin_notes: null },
    assignment: updated,
    legacyCredential: legacy,
  });
  assert(r?.password === "rotated", "pool credential rotation is what customers see");
}

// 7. One-click launch uses the assigned account: shared assignment beats legacy.
{
  const r = resolveOrderCredentials({
    order: { id: "o5", tool_slug: "t", access_type: "shared", fulfilment_status: "not_required", created_at: beforeCutoff, admin_notes: null },
    assignment: assigned,
    legacyCredential: legacy,
  });
  assert(r?.email === "pool@x.com", "assignment always beats legacy fallback (one-click uses pool)");
}

// 8. Private manual fulfilment (admin_notes only, no pool row) still works when active.
{
  const r = resolveOrderCredentials({
    order: { id: "op3", tool_slug: "t", access_type: "private", fulfilment_status: "active", created_at: afterCutoff, admin_notes: "manual notes" },
    assignment: null,
    legacyCredential: null,
  });
  assert(r?.login_notes === "manual notes", "manual-fulfilled Private orders still deliver admin_notes");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.error("  •", f);
  process.exit(1);
}
