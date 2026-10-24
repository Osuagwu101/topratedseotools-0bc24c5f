/**
 * Phase 5 — postpaid billing rules. PURE (no I/O) so it is unit-testable.
 * Live value sets (verified 2026-10-23):
 *   charges.status      : unpaid | partially_paid | paid | void
 *   invoices.status     : not_due | due | partially_paid | overdue | settled | voided
 *   settlements.status  : pending | confirmed | failed (others treated as non-confirmed)
 * Amounts are NGN integers/numerics. Nothing here mutates data.
 */

export interface Charge { id: string; user_id: string; job_id: string | null; rate_ngn: number; amount_ngn: number;
  paid_amount_ngn: number; status: string; charged_at: string | null; voided_at?: string | null; }
export interface Settlement { id: string; user_id: string; amount_ngn: number; allocated_amount_ngn: number; status: string;
  payment_reference: string | null; gateway_reference: string | null; gateway_transaction_id: string | null;
  confirmed_at: string | null; failed_at: string | null; created_at?: string | null; }
export interface Allocation { id: string; settlement_id: string; charge_id: string; amount_ngn: number; }
export interface Invoice { id: string; invoice_ref: string; user_id: string; period_start: string; period_end: string;
  amount_due_ngn: number; status: string; issued_at: string | null; due_at: string | null; }
export interface InvoiceLine { id: string; invoice_id: string; charge_id: string; amount_ngn: number; rate_ngn_at_use: number; }

const n = (v: unknown) => Number(v ?? 0) || 0;
export const isVoid = (c: Pick<Charge, "status">) => c.status === "void";
export const isConfirmed = (s: Pick<Settlement, "status">) => s.status === "confirmed";

/** Outstanding on one charge: never negative, zero when voided. */
export function chargeOutstanding(c: Charge): number {
  return isVoid(c) ? 0 : Math.max(0, n(c.amount_ngn) - n(c.paid_amount_ngn));
}

export type InvoiceState = "not_due" | "due" | "partially_paid" | "overdue" | "settled" | "voided";

/**
 * Derived invoice status. Paid amount comes from the charges on its lines (capped per line),
 * so an invoice is never shown as settled without matching payments recorded on those charges.
 *  - voided: invoice voided, or every line's charge is voided
 *  - settled: nothing outstanding
 *  - not_due: billing period has not ended yet
 *  - overdue: a due date exists, it has passed, and something is still outstanding
 *  - partially_paid / due: otherwise (no due date => never overdue; no due-date policy is assumed)
 */
export function invoiceState(inv: Invoice, lines: InvoiceLine[], chargesById: Map<string, Charge>, now: Date): {
  state: InvoiceState; billed: number; paid: number; outstanding: number; } {
  if (inv.status === "voided") return { state: "voided", billed: n(inv.amount_due_ngn), paid: 0, outstanding: 0 };
  let billed = 0, paid = 0, live = 0;
  for (const l of lines) {
    const c = chargesById.get(l.charge_id);
    if (!c || isVoid(c)) continue;
    live++;
    const amt = n(l.amount_ngn); billed += amt; paid += Math.min(amt, n(c.paid_amount_ngn));
  }
  if (lines.length > 0 && live === 0) return { state: "voided", billed: 0, paid: 0, outstanding: 0 };
  const outstanding = Math.max(0, billed - paid);
  if (outstanding === 0) return { state: "settled", billed, paid, outstanding };
  if (now < new Date(inv.period_end + "T00:00:00Z")) return { state: "not_due", billed, paid, outstanding };
  if (inv.due_at && now > new Date(inv.due_at)) return { state: "overdue", billed, paid, outstanding };
  return { state: paid > 0 ? "partially_paid" : "due", billed, paid, outstanding };
}

/** Calendar-month billing period containing `ref` (UTC): [start, end) as YYYY-MM-DD. */
export function monthlyPeriod(ref: Date): { start: string; end: string } {
  const s = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const e = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}

export function validatePeriod(start: string, end: string, now: Date): void {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(start) || !re.test(end)) throw new Error("Dates must be YYYY-MM-DD.");
  const s = new Date(start + "T00:00:00Z"), e = new Date(end + "T00:00:00Z");
  if (isNaN(+s) || isNaN(+e) || e <= s) throw new Error("The period end must be after the start.");
  if ((+e - +s) / 86400000 > 92) throw new Error("A billing period cannot be longer than 92 days.");
  if (s > now) throw new Error("A billing period cannot start in the future.");
}

export type ExceptionKind =
  | "charge_without_job" | "charge_paid_mismatch" | "settlement_allocation_mismatch" | "unallocated_payment"
  | "duplicate_gateway_reference" | "cross_customer_allocation" | "negative_amount" | "overpayment"
  | "allocation_to_void_charge" | "conflicting_charge_state" | "conflicting_settlement_state"
  | "invoice_total_mismatch" | "invoice_line_mismatch";

export interface ReconException { kind: ExceptionKind; severity: "error" | "warning" | "info"; userId: string | null;
  ref: string; detail: string; }

export function reconcile(input: { charges: Charge[]; settlements: Settlement[]; allocations: Allocation[];
  invoices?: Invoice[]; lines?: InvoiceLine[]; jobIds?: Set<string> }): ReconException[] {
  const out: ReconException[] = [];
  const add = (kind: ExceptionKind, severity: ReconException["severity"], userId: string | null, ref: string, detail: string) =>
    out.push({ kind, severity, userId, ref, detail });
  const chargeById = new Map(input.charges.map((c) => [c.id, c]));
  const settleById = new Map(input.settlements.map((s) => [s.id, s]));
  const allocByCharge = new Map<string, number>(), allocBySettle = new Map<string, number>();
  for (const a of input.allocations) {
    allocByCharge.set(a.charge_id, (allocByCharge.get(a.charge_id) ?? 0) + n(a.amount_ngn));
    allocBySettle.set(a.settlement_id, (allocBySettle.get(a.settlement_id) ?? 0) + n(a.amount_ngn));
    if (n(a.amount_ngn) < 0) add("negative_amount", "error", null, a.id, `Allocation ${a.id} is negative.`);
    const c = chargeById.get(a.charge_id), s = settleById.get(a.settlement_id);
    if (c && s && c.user_id !== s.user_id) add("cross_customer_allocation", "error", s.user_id, a.id,
      `Payment ${s.id} (customer ${s.user_id}) is allocated to charge ${c.id} of customer ${c.user_id}.`);
    if (c && isVoid(c)) add("allocation_to_void_charge", "warning", c.user_id, a.id, `Allocation to voided charge ${c.id}.`);
    if (s && !isConfirmed(s)) add("conflicting_settlement_state", "error", s.user_id, a.id, `Allocation from a ${s.status} payment ${s.id}.`);
  }
  for (const c of input.charges) {
    const alloc = allocByCharge.get(c.id) ?? 0, paid = n(c.paid_amount_ngn), amt = n(c.amount_ngn);
    if (!c.job_id || (input.jobIds && !input.jobIds.has(c.job_id))) add("charge_without_job", "error", c.user_id, c.id, `Charge ${c.id} has no matching submission.`);
    if (amt < 0 || paid < 0 || n(c.rate_ngn) < 0) add("negative_amount", "error", c.user_id, c.id, `Charge ${c.id} has a negative amount.`);
    if (paid !== alloc) add("charge_paid_mismatch", "error", c.user_id, c.id, `Charge ${c.id}: recorded paid ₦${paid} but allocations total ₦${alloc}.`);
    if (paid > amt && !isVoid(c)) add("overpayment", "warning", c.user_id, c.id, `Charge ${c.id} is overpaid by ₦${paid - amt}.`);
    const expect = isVoid(c) ? "void" : paid >= amt && amt > 0 ? "paid" : paid > 0 ? "partially_paid" : "unpaid";
    if (c.status !== expect && !(isVoid(c))) add("conflicting_charge_state", "warning", c.user_id, c.id, `Charge ${c.id} is "${c.status}" but its payments imply "${expect}".`);
  }
  const refSeen = new Map<string, string>();
  for (const s of input.settlements) {
    const alloc = allocBySettle.get(s.id) ?? 0;
    if (n(s.amount_ngn) < 0) add("negative_amount", "error", s.user_id, s.id, `Payment ${s.id} is negative.`);
    if (n(s.allocated_amount_ngn) !== alloc) add("settlement_allocation_mismatch", "error", s.user_id, s.id, `Payment ${s.id}: recorded allocated ₦${n(s.allocated_amount_ngn)} but allocations total ₦${alloc}.`);
    if (alloc > n(s.amount_ngn)) add("overpayment", "error", s.user_id, s.id, `Payment ${s.id} allocates more than it received.`);
    if (isConfirmed(s) && n(s.amount_ngn) - alloc > 0) add("unallocated_payment", "info", s.user_id, s.id, `Payment ${s.id} has ₦${n(s.amount_ngn) - alloc} not yet allocated.`);
    if (isConfirmed(s) && !s.confirmed_at) add("conflicting_settlement_state", "warning", s.user_id, s.id, `Payment ${s.id} is confirmed without a confirmation time.`);
    if (s.status === "failed" && alloc > 0) add("conflicting_settlement_state", "error", s.user_id, s.id, `Failed payment ${s.id} has allocations.`);
    for (const r of [s.payment_reference, s.gateway_reference, s.gateway_transaction_id]) {
      if (!r) continue;
      const prev = refSeen.get(r);
      if (prev && prev !== s.id) add("duplicate_gateway_reference", "error", s.user_id, s.id, `Reference ${r} is used by payments ${prev} and ${s.id}.`);
      else refSeen.set(r, s.id);
    }
  }
  const linesByInv = new Map<string, InvoiceLine[]>();
  for (const l of input.lines ?? []) linesByInv.set(l.invoice_id, [...(linesByInv.get(l.invoice_id) ?? []), l]);
  for (const inv of input.invoices ?? []) {
    const ls = linesByInv.get(inv.id) ?? [];
    const sum = ls.reduce((t, l) => t + n(l.amount_ngn), 0);
    if (Math.abs(sum - n(inv.amount_due_ngn)) > 0.005) add("invoice_total_mismatch", "error", inv.user_id, inv.invoice_ref, `Invoice ${inv.invoice_ref} total ₦${n(inv.amount_due_ngn)} differs from its lines ₦${sum}.`);
    for (const l of ls) {
      const c = chargeById.get(l.charge_id);
      if (!c) add("invoice_line_mismatch", "error", inv.user_id, inv.invoice_ref, `Invoice ${inv.invoice_ref} line references a missing charge.`);
      else if (c.user_id !== inv.user_id) add("cross_customer_allocation", "error", inv.user_id, inv.invoice_ref, `Invoice ${inv.invoice_ref} contains another customer's charge ${c.id}.`);
      else if (Math.abs(n(c.amount_ngn) - n(l.amount_ngn)) > 0.005) add("invoice_line_mismatch", "warning", inv.user_id, inv.invoice_ref, `Invoice ${inv.invoice_ref} line for charge ${c.id} differs from the charge amount.`);
    }
  }
  return out;
}

/** Per-customer balance summary from raw rows. */
export function customerBalances(charges: Charge[], settlements: Settlement[], allocations: Allocation[]) {
  const allocBySettle = new Map<string, number>();
  for (const a of allocations) allocBySettle.set(a.settlement_id, (allocBySettle.get(a.settlement_id) ?? 0) + n(a.amount_ngn));
  const m = new Map<string, { userId: string; billed: number; paid: number; outstanding: number; openCharges: number;
    voidedCharges: number; confirmedPayments: number; unallocated: number }>();
  const get = (u: string) => m.get(u) ?? (m.set(u, { userId: u, billed: 0, paid: 0, outstanding: 0, openCharges: 0, voidedCharges: 0, confirmedPayments: 0, unallocated: 0 }), m.get(u)!);
  for (const c of charges) {
    const r = get(c.user_id);
    if (isVoid(c)) { r.voidedCharges++; continue; }
    r.billed += n(c.amount_ngn); r.paid += Math.min(n(c.amount_ngn), n(c.paid_amount_ngn));
    const o = chargeOutstanding(c); r.outstanding += o; if (o > 0) r.openCharges++;
  }
  for (const s of settlements) if (isConfirmed(s)) {
    const r = get(s.user_id); r.confirmedPayments += n(s.amount_ngn);
    r.unallocated += Math.max(0, n(s.amount_ngn) - (allocBySettle.get(s.id) ?? 0));
  }
  return [...m.values()].sort((a, b) => b.outstanding - a.outstanding);
}
