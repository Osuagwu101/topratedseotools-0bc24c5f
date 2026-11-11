/**
 * Phase 4 core orchestration. Dependency-injected (no "@/..." imports) so the
 * whole flow — including DB failures and concurrent requests — is testable.
 */
import {
  classifyGateway, decideCreditAction, isAlreadyRestoredError, localStatusFor,
  type GatewayProbe, type GatewayState, type CreditDecision,
} from "./turnitin-gateway-policy.ts";

export interface JobRow {
  id: string; user_id: string; status: string | null; credit_state: string | null;
  billing_mode: string | null; upstream_submission_id: string | null; upstream_status?: string | null;
}

export interface AuditRecord {
  action: string; success: boolean; jobId: string; reason?: string | null;
  details: Record<string, unknown>;
}

export interface CoreDeps {
  loadJob(jobId: string): Promise<JobRow | null>;
  probe(job: JobRow): Promise<GatewayProbe | null>;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ error: { message: string } | null; data?: unknown }>;
  markFailed(jobId: string, upstreamStatus: string | null): Promise<void>;
  /** Must throw if it cannot persist when strict = true. */
  audit(rec: AuditRecord, strict: boolean): Promise<void>;
  actorId: string;
  now(): string;
}

// Live CHECK constraint: credit_state IN ('none','reserved','consumed','refunded').
export const RESTORED_STATES = new Set(["refunded", "none"]);
const RPC_FOR: Record<string, string> = {
  refund_consumed_credit: "turnitin_refund_consumed_credit",
  release_reserved_credit: "turnitin_release_reserved_credit",
  void_postpaid_charge: "turnitin_void_postpaid_charge",
};

export interface VerifyResult {
  jobId: string; customerId: string; localStatus: string | null; creditState: string | null;
  billingMode: string | null; gatewayState: GatewayState; upstreamStatus: string | null;
  decision: CreditDecision; checkedAt: string; correlationId: string;
}

export function validateIds(jobId: string, correlationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error("Invalid job identifier.");
  if (!/^[0-9a-zA-Z-]{8,64}$/.test(correlationId)) throw new Error("Invalid correlation reference.");
}

export async function verifyJob(deps: CoreDeps, jobId: string, correlationId: string): Promise<VerifyResult> {
  validateIds(jobId, correlationId);
  const job = await deps.loadJob(jobId);
  if (!job) throw new Error("Job not found.");
  const probe = await deps.probe(job);
  const gatewayState = classifyGateway(job, probe);
  const decision = decideCreditAction(job, gatewayState);
  const result: VerifyResult = {
    jobId: job.id, customerId: job.user_id, localStatus: job.status, creditState: job.credit_state,
    billingMode: job.billing_mode, gatewayState, upstreamStatus: probe?.upstreamStatus ?? null,
    decision, checkedAt: deps.now(), correlationId,
  };
  await deps.audit({ action: "turnitin_job_gateway_verified", success: true, jobId: job.id, details: {
    correlationId, customerId: job.user_id, previousStatus: job.status, newStatus: job.status,
    gatewayOutcome: gatewayState, upstreamStatus: result.upstreamStatus, probeError: probe?.kind === "error" ? (probe.errorCode ?? probe.httpStatus ?? "error") : null,
    action: "verify_only", creditChange: 0,
  } }, false);
  return result;
}

export type RestoreOutcome = "restored" | "already_restored";
type RestoreResult = VerifyResult & { outcome: RestoreOutcome; creditStateAfter: string | null };

// Per-job in-process mutex: concurrent requests are serialised so later ones
// re-read the job and see it is already restored (the DB row lock remains the
// cross-process guarantee against double credit).
const jobLocks = new Map<string, Promise<unknown>>();
export async function restoreJobCredit(
  deps: CoreDeps, jobId: string, reason: string, correlationId: string,
): Promise<RestoreResult> {
  const prev = jobLocks.get(jobId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => restoreJobCreditUnlocked(deps, jobId, reason, correlationId));
  jobLocks.set(jobId, run);
  try { return await run; } finally { if (jobLocks.get(jobId) === run) jobLocks.delete(jobId); }
}

async function restoreJobCreditUnlocked(
  deps: CoreDeps, jobId: string, reason: string, correlationId: string,
): Promise<RestoreResult> {
  validateIds(jobId, correlationId);
  const why = String(reason ?? "").trim();
  if (why.length < 10 || why.length > 500) throw new Error("Enter a reason between 10 and 500 characters.");

  const job = await deps.loadJob(jobId);
  if (!job) throw new Error("Job not found.");
  // Always re-verify live; never trust a client-side or cached gateway result.
  const probe = await deps.probe(job);
  const gatewayState = classifyGateway(job, probe);
  const decision = decideCreditAction(job, gatewayState);
  const base = { correlationId, customerId: job.user_id, previousStatus: job.status,
    previousCreditState: job.credit_state, gatewayOutcome: gatewayState, upstreamStatus: probe?.upstreamStatus ?? null };

  if (!decision.eligible) {
    await deps.audit({ action: "turnitin_credit_restore_refused", success: false, jobId, reason: why,
      details: { ...base, newStatus: job.status, action: decision.action, creditChange: 0, explanation: decision.explanation } }, false);
    throw new Error(decision.explanation);
  }

  // Fail closed: if the intent cannot be audited, change nothing.
  await deps.audit({ action: "turnitin_credit_restore_started", success: true, jobId, reason: why,
    details: { ...base, action: decision.action, creditChange: 0 } }, true);

  const note = `Admin ${deps.actorId} [${correlationId}]: ${why}`;
  const { error, data } = await deps.rpc(RPC_FOR[decision.action], { _user_id: job.user_id, _job_id: job.id, _reason: note });

  let outcome: RestoreOutcome = "restored";
  // Live semantics (verified in production 2026-10-23):
  //  - release returns false when the credit is no longer reserved (already released -> 'none')
  //  - void returns false when no postpaid charge exists for the job
  if (!error && data === false) {
    const latest = await deps.loadJob(jobId);
    if (decision.action === "release_reserved_credit" && latest && latest.credit_state !== "reserved") {
      outcome = "already_restored";
    } else {
      const msg = decision.action === "void_postpaid_charge"
        ? "No postpaid charge exists for this job; nothing was changed."
        : "The credit was not released; nothing was changed.";
      await deps.audit({ action: "turnitin_credit_restore_failed", success: false, jobId, reason: why,
        details: { ...base, newStatus: job.status, action: decision.action, creditChange: 0, error: msg } }, false);
      throw new Error(msg);
    }
  } else if (error) {
    const after = await deps.loadJob(jobId);
    const alreadyDone = isAlreadyRestoredError(error.message) ||
      (after && after.credit_state !== job.credit_state && RESTORED_STATES.has(String(after.credit_state)));
    if (!alreadyDone) {
      await deps.audit({ action: "turnitin_credit_restore_failed", success: false, jobId, reason: why,
        details: { ...base, newStatus: job.status, action: decision.action, creditChange: 0, error: error.message } }, false);
      throw new Error(`Credit restore failed; nothing was changed. ${error.message}`);
    }
    outcome = "already_restored";
  }

  const newLocal = localStatusFor(gatewayState);
  if (newLocal && job.status !== newLocal) await deps.markFailed(job.id, probe?.upstreamStatus ?? null);
  const after = await deps.loadJob(jobId);
  // A refund returned without error can still be an idempotent no-op (refund fn returns the existing batch).
  if (outcome === "restored" && job.credit_state === "refunded") outcome = "already_restored";

  await deps.audit({ action: "turnitin_credit_restore_completed", success: true, jobId, reason: why, details: {
    ...base, newStatus: after?.status ?? job.status, newCreditState: after?.credit_state ?? null,
    action: decision.action, outcome,
    creditChange: outcome === "restored" ? (decision.action === "void_postpaid_charge" ? "postpaid_charge_voided" : 1) : 0,
  } }, false);

  return { jobId: job.id, customerId: job.user_id, localStatus: after?.status ?? job.status, creditState: job.credit_state,
    billingMode: job.billing_mode, gatewayState, upstreamStatus: probe?.upstreamStatus ?? null, decision,
    checkedAt: deps.now(), correlationId, outcome, creditStateAfter: after?.credit_state ?? null };
}
