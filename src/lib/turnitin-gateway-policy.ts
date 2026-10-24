/**
 * Phase 4 — Turnitin gateway re-verification and failed-job credit safety.
 * PURE module: no I/O, no "@/..." imports, so it is unit-testable with `node --test`.
 *
 * Rules (owner requirements):
 *  - Never infer failure from age alone, or from a timeout / unavailable gateway.
 *  - A submission missing from the provider's status list is UNKNOWN, not failed.
 *  - Credit is restored only after the provider itself confirms failure (or the
 *    job failed before the provider ever accepted it and the credit is still reserved).
 *  - Successful, queued, processing or unknown jobs are never refunded.
 *  - Usage credits are restored; money is never refunded here.
 */

export type GatewayState =
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "gateway_unavailable"
  | "unknown";

export type CreditAction =
  | "refund_consumed_credit"
  | "release_reserved_credit"
  | "void_postpaid_charge"
  | "none";

export interface JobSnapshot {
  status: string | null;
  credit_state: string | null;
  billing_mode: string | null;
  upstream_submission_id: string | null;
}

export interface GatewayProbe {
  kind: "found" | "not_found" | "error";
  upstreamStatus?: string | null;
  httpStatus?: number | null;
  errorCode?: string | null;
}

export function classifyGateway(job: JobSnapshot, probe: GatewayProbe | null): GatewayState {
  if (!job.upstream_submission_id) {
    return job.status === "uploading" || job.status === "pending" ? "uploading" : "unknown";
  }
  if (!probe || probe.kind === "error") return "gateway_unavailable";
  if (probe.kind === "not_found") return "unknown";
  const s = String(probe.upstreamStatus ?? "").trim().toLowerCase();
  if (s === "failed") return "failed";
  if (s === "queued" || s === "pending") return "queued";
  if (s === "completed" || s === "manual_completed") return "completed";
  if (s === "processing" || s === "in_progress" || s === "running") return "processing";
  return "unknown";
}

export interface CreditDecision {
  action: CreditAction;
  eligible: boolean;
  explanation: string;
}

export function decideCreditAction(job: JobSnapshot, state: GatewayState): CreditDecision {
  const credit = String(job.credit_state ?? "");
  const postpaid = job.billing_mode === "postpaid";

  if (!job.upstream_submission_id) {
    if (!postpaid && credit === "reserved" && job.status === "failed") {
      return { action: "release_reserved_credit", eligible: true,
        explanation: "The upload failed before the provider accepted it. The reserved credit can be released." };
    }
    if (credit === "reserved" && job.status !== "failed") {
      return { action: "none", eligible: false,
        explanation: "The upload has not been confirmed as failed. Leave it until it finishes or fails." };
    }
    return { action: "none", eligible: false,
      explanation: "No provider submission exists and no reserved credit is outstanding." };
  }

  if (state === "failed") {
    if (postpaid) {
      return { action: "void_postpaid_charge", eligible: true,
        explanation: "The provider confirmed failure. The postpaid charge for this job can be voided." };
    }
    if (credit === "consumed") {
      return { action: "refund_consumed_credit", eligible: true,
        explanation: "The provider confirmed failure. The consumed credit can be restored." };
    }
    if (credit === "refunded") {
      return { action: "none", eligible: false, explanation: "The credit for this job has already been restored." };
    }
    if (credit === "reserved") {
      return { action: "release_reserved_credit", eligible: true,
        explanation: "The provider confirmed failure and the credit is still reserved. It can be released." };
    }
    return { action: "none", eligible: false, explanation: `Credit state "${credit}" needs manual reconciliation.` };
  }

  const why: Record<GatewayState, string> = {
    completed: "The provider reports this check as completed. No credit is restored.",
    queued: "The provider still has this check queued. Do not restore credit yet.",
    processing: "The provider is still processing this check. Do not restore credit yet.",
    uploading: "The upload is still in progress.",
    gateway_unavailable: "The provider could not be reached. Nothing was changed; try again later.",
    unknown: "The provider did not return a status for this submission. Nothing was changed; manual review needed.",
    failed: "",
  };
  return { action: "none", eligible: false, explanation: why[state] };
}

export function isAlreadyRestoredError(message: string | null | undefined): boolean {
  return /ALREADY_(REFUNDED|RELEASED|VOIDED)|already (refunded|released|voided)/i.test(String(message ?? ""));
}

export function localStatusFor(state: GatewayState): string | null {
  return state === "failed" ? "failed" : null;
}
