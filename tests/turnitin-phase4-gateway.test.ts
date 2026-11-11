// Phase 4 tests. Run: node --test --experimental-strip-types tests/turnitin-phase4-gateway.test.ts
// Uses an in-memory fake that mimics the SQL functions' row-lock + idempotency rules.
// No real customer data or balances are touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyGateway, decideCreditAction } from "../src/lib/turnitin-gateway-policy.ts";
import { verifyJob, restoreJobCredit, type CoreDeps, type JobRow, type AuditRecord } from "../src/lib/turnitin-admin-gateway.core.ts";
import { assertAdminRole } from "../src/lib/turnitin-admin-gate.ts";

const J = "11111111-1111-4111-8111-111111111111";
const C = "corr-0001-abcd";
const R = "Provider confirmed failure in test";

function makeWorld(job: Partial<JobRow>, probe: any, opts: { rpcFail?: boolean; auditFail?: boolean } = {}) {
  const row: JobRow = { id: J, user_id: "u1", status: "failed", credit_state: "consumed", billing_mode: "prepaid",
    upstream_submission_id: "sub-9", ...job };
  const ledger: string[] = []; const audits: AuditRecord[] = [];
  let lock = Promise.resolve();
  const deps: CoreDeps = {
    actorId: "admin-1", now: () => "2026-10-23T00:00:00Z",
    loadJob: async () => ({ ...row }),
    probe: async () => probe,
    markFailed: async () => { row.status = "failed"; },
    audit: async (rec, strict) => { if (opts.auditFail && strict) throw new Error("audit down"); audits.push(rec); },
    rpc: async (fn) => {
      // Serialise like SELECT ... FOR UPDATE on the job row.
      let release!: () => void; const prev = lock; lock = new Promise((r) => (release = r)); await prev;
      try {
        await new Promise((r) => setTimeout(r, 5));
        if (opts.rpcFail) return { error: { message: "connection reset by peer" } };
        // Mirrors live definitions (pg_get_functiondef, 2026-10-23).
        if (fn === "turnitin_refund_consumed_credit") {
          if (row.credit_state === "refunded") return { error: null, data: "existing-batch" };
          if (row.credit_state !== "consumed") return { error: { message: "TURNITIN_CREDIT_NOT_CONSUMED" } };
          row.credit_state = "refunded"; ledger.push("refund:" + row.id); return { error: null, data: "new-batch" };
        }
        if (fn === "turnitin_release_reserved_credit") {
          if (row.credit_state !== "reserved") return { error: null, data: false };
          row.credit_state = "none"; ledger.push("release:" + row.id); return { error: null, data: true };
        }
        return { error: { message: "unexpected " + fn } };
      } finally { release(); }
    },
  };
  return { row, ledger, audits, deps };
}
const found = (s: string) => ({ kind: "found", upstreamStatus: s });

test("1 successful submission: never refunded", async () => {
  const w = makeWorld({ status: "completed" }, found("completed"));
  const v = await verifyJob(w.deps, J, C);
  assert.equal(v.gatewayState, "completed"); assert.equal(v.decision.eligible, false);
  await assert.rejects(restoreJobCredit(w.deps, J, R, C)); assert.equal(w.ledger.length, 0);
});

test("2 confirmed failed submission: one credit restored + audited", async () => {
  const w = makeWorld({}, found("failed"));
  const r = await restoreJobCredit(w.deps, J, R, C);
  assert.equal(r.outcome, "restored"); assert.deepEqual(w.ledger, ["refund:" + J]);
  const done = w.audits.find((a) => a.action === "turnitin_credit_restore_completed")!;
  for (const k of ["correlationId", "customerId", "previousStatus", "newStatus", "gatewayOutcome", "action", "creditChange"])
    assert.ok(k in done.details, "audit missing " + k);
});

test("3 still-processing submission: not refunded", async () => {
  for (const s of ["processing", "queued", "pending"]) {
    const w = makeWorld({ status: "processing" }, found(s));
    await assert.rejects(restoreJobCredit(w.deps, J, R, C)); assert.equal(w.ledger.length, 0);
  }
});

test("4 gateway timeout: nothing changes", async () => {
  const w = makeWorld({}, { kind: "error", errorCode: "ETIMEDOUT" });
  const v = await verifyJob(w.deps, J, C); assert.equal(v.gatewayState, "gateway_unavailable");
  await assert.rejects(restoreJobCredit(w.deps, J, R, C), /could not be reached/); assert.equal(w.ledger.length, 0);
});

test("5 unknown gateway status / missing submission: nothing changes", async () => {
  for (const p of [{ kind: "not_found" }, found("weird_state")]) {
    const w = makeWorld({}, p);
    assert.equal((await verifyJob(w.deps, J, C)).gatewayState, "unknown");
    await assert.rejects(restoreJobCredit(w.deps, J, R, C)); assert.equal(w.ledger.length, 0);
  }
});

test("6 first legitimate refund succeeds", async () => {
  const w = makeWorld({}, found("failed"));
  assert.equal((await restoreJobCredit(w.deps, J, R, C)).creditStateAfter, "refunded");
});

test("7 repeated refund attempt adds no credit", async () => {
  const w = makeWorld({}, found("failed"));
  await restoreJobCredit(w.deps, J, R, C);
  await assert.rejects(restoreJobCredit(w.deps, J, R, C), /already been restored/);
  assert.equal(w.ledger.length, 1);
});

test("8 concurrent refund requests restore exactly once", async () => {
  const w = makeWorld({}, found("failed"));
  const res = await Promise.allSettled(Array.from({ length: 8 }, () => restoreJobCredit(w.deps, J, R, C)));
  assert.equal(w.ledger.length, 1);
  const ok = res.filter((x) => x.status === "fulfilled").map((x: any) => x.value.outcome);
  assert.equal(ok.filter((o) => o === "restored").length, 1);
});

test("9 unauthorized administrator attempt is rejected", () => {
  assert.throws(() => assertAdminRole({ data: false, error: null }), /Administrator access required/);
  assert.throws(() => assertAdminRole({ data: null, error: { message: "x" } }), /Administrator access required/);
  assert.doesNotThrow(() => assertAdminRole({ data: true, error: null }));
});

test("10 database operation failure: no credit, failure audited, audit outage blocks change", async () => {
  const w = makeWorld({}, found("failed"), { rpcFail: true });
  await assert.rejects(restoreJobCredit(w.deps, J, R, C), /nothing was changed/);
  assert.equal(w.ledger.length, 0); assert.ok(w.audits.some((a) => a.action === "turnitin_credit_restore_failed"));
  const w2 = makeWorld({}, found("failed"), { auditFail: true });
  await assert.rejects(restoreJobCredit(w2.deps, J, R, C)); assert.equal(w2.ledger.length, 0);
});

test("11 ledger reconciliation: restores match restored jobs", async () => {
  const w = makeWorld({}, found("failed"));
  await Promise.allSettled([restoreJobCredit(w.deps, J, R, C), restoreJobCredit(w.deps, J, R, C)]);
  const restoredJobs = w.row.credit_state === "refunded" ? 1 : 0;
  assert.equal(w.ledger.filter((l) => l.startsWith("refund:")).length, restoredJobs);
});

test("12 existing refunded job is recognised, not refunded again", async () => {
  const w = makeWorld({ credit_state: "refunded" }, found("failed"));
  assert.equal(decideCreditAction(w.row, "failed").eligible, false);
  await assert.rejects(restoreJobCredit(w.deps, J, R, C), /already been restored/); assert.equal(w.ledger.length, 0);
});

test("pre-acceptance failure releases reserved credit; in-flight upload does not", async () => {
  const w = makeWorld({ upstream_submission_id: null, credit_state: "reserved", status: "failed" }, null);
  assert.equal((await restoreJobCredit(w.deps, J, R, C)).creditStateAfter, "none");
  const w2 = makeWorld({ upstream_submission_id: null, credit_state: "reserved", status: "uploading" }, null);
  await assert.rejects(restoreJobCredit(w2.deps, J, R, C)); assert.equal(w2.ledger.length, 0);
});

test("age alone never implies failure", () => {
  assert.equal(classifyGateway({ status: "queued", credit_state: "consumed", billing_mode: "prepaid", upstream_submission_id: "s" }, found("queued")), "queued");
});

test("release returning false (already released elsewhere) is not counted as a new restore", async () => {
  const w = makeWorld({ upstream_submission_id: null, credit_state: "reserved", status: "failed" }, null);
  const realLoad = w.deps.loadJob; let first = true;
  // First read sees 'reserved'; another process releases it before our RPC runs.
  w.deps.loadJob = async (id) => { const j = await realLoad(id); if (first) { first = false; w.row.credit_state = "none"; } return j; };
  const r = await restoreJobCredit(w.deps, J, R, C);
  assert.equal(r.outcome, "already_restored"); assert.equal(w.ledger.length, 0);
});

test("postpaid void returning false (no charge) fails safely", async () => {
  const w = makeWorld({ billing_mode: "postpaid", credit_state: "none" }, found("failed"));
  w.deps.rpc = async () => ({ error: null, data: false });
  await assert.rejects(restoreJobCredit(w.deps, J, R, C), /No postpaid charge/);
  assert.ok(w.audits.some((a) => a.action === "turnitin_credit_restore_failed"));
});
