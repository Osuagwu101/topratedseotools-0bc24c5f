// Phase 5 tests. Run: node --test --experimental-strip-types tests/turnitin-phase5-billing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceState, monthlyPeriod, validatePeriod, reconcile, customerBalances, chargeOutstanding,
  type Charge, type Settlement, type Allocation, type Invoice, type InvoiceLine } from "../src/lib/turnitin-postpaid-billing.ts";

const ch = (o: Partial<Charge>): Charge => ({ id: "c1", user_id: "u1", job_id: "j1", rate_ngn: 500, amount_ngn: 500,
  paid_amount_ngn: 0, status: "unpaid", charged_at: "2026-10-05T10:00:00Z", ...o });
const st = (o: Partial<Settlement>): Settlement => ({ id: "s1", user_id: "u1", amount_ngn: 500, allocated_amount_ngn: 500,
  status: "confirmed", payment_reference: "ref1", gateway_reference: null, gateway_transaction_id: null,
  confirmed_at: "2026-10-06T00:00:00Z", failed_at: null, ...o });
const inv: Invoice = { id: "i1", invoice_ref: "INV-1", user_id: "u1", period_start: "2026-10-01", period_end: "2026-11-01",
  amount_due_ngn: 1000, status: "due", issued_at: "2026-11-01T00:00:00Z", due_at: null };
const lines: InvoiceLine[] = [
  { id: "l1", invoice_id: "i1", charge_id: "a", amount_ngn: 500, rate_ngn_at_use: 500 },
  { id: "l2", invoice_id: "i1", charge_id: "b", amount_ngn: 500, rate_ngn_at_use: 500 }];
const after = new Date("2026-11-10T00:00:00Z"), during = new Date("2026-10-20T00:00:00Z");
const map = (...cs: Charge[]) => new Map(cs.map((c) => [c.id, c]));

test("voided charges never count as outstanding", () => {
  assert.equal(chargeOutstanding(ch({ status: "void", amount_ngn: 500 })), 0);
  assert.equal(chargeOutstanding(ch({ paid_amount_ngn: 700 })), 0);
  assert.equal(chargeOutstanding(ch({ paid_amount_ngn: 200 })), 300);
});

test("invoice states: not_due, due, partially_paid, overdue, settled, voided", () => {
  const unpaid = map(ch({ id: "a" }), ch({ id: "b" }));
  assert.equal(invoiceState(inv, lines, unpaid, during).state, "not_due");
  assert.equal(invoiceState(inv, lines, unpaid, after).state, "due");
  assert.equal(invoiceState(inv, lines, map(ch({ id: "a", paid_amount_ngn: 500, status: "paid" }), ch({ id: "b" })), after).state, "partially_paid");
  assert.equal(invoiceState({ ...inv, due_at: "2026-11-05T00:00:00Z" }, lines, unpaid, after).state, "overdue");
  assert.equal(invoiceState(inv, lines, map(ch({ id: "a", paid_amount_ngn: 500 }), ch({ id: "b", paid_amount_ngn: 500 })), after).state, "settled");
  assert.equal(invoiceState({ ...inv, status: "voided" }, lines, unpaid, after).state, "voided");
  assert.equal(invoiceState(inv, lines, map(ch({ id: "a", status: "void" }), ch({ id: "b", status: "void" })), after).state, "voided");
});

test("no due-date policy is assumed: without due_at an invoice is never overdue", () => {
  assert.notEqual(invoiceState(inv, lines, map(ch({ id: "a" }), ch({ id: "b" })), new Date("2027-06-01")).state, "overdue");
});

test("unpaid invoice is never settled; overpayment on one line does not cover another", () => {
  const r = invoiceState(inv, lines, map(ch({ id: "a", paid_amount_ngn: 900 }), ch({ id: "b" })), after);
  assert.equal(r.paid, 500); assert.equal(r.outstanding, 500); assert.notEqual(r.state, "settled");
});

test("statement history uses the rate stored at time of use", () => {
  const r = invoiceState(inv, [{ ...lines[0], amount_ngn: 400, rate_ngn_at_use: 400 }], map(ch({ id: "a", amount_ngn: 400, rate_ngn: 400 })), after);
  assert.equal(r.billed, 400);
});

test("monthly period and period validation", () => {
  assert.deepEqual(monthlyPeriod(new Date("2026-02-15T12:00:00Z")), { start: "2026-02-01", end: "2026-03-01" });
  assert.deepEqual(monthlyPeriod(new Date("2026-12-31T23:00:00Z")), { start: "2026-12-01", end: "2027-01-01" });
  const now = new Date("2026-10-24");
  assert.doesNotThrow(() => validatePeriod("2026-09-01", "2026-10-01", now));
  assert.throws(() => validatePeriod("2026-10-01", "2026-09-01", now));
  assert.throws(() => validatePeriod("2026-12-01", "2027-01-01", now));
  assert.throws(() => validatePeriod("2026-01-01", "2026-12-01", now));
  assert.throws(() => validatePeriod("01/10/2026", "2026-11-01", now));
});

test("clean books produce no errors (matches production invariants)", () => {
  const ex = reconcile({ charges: [ch({ paid_amount_ngn: 500, status: "paid" })], settlements: [st({})],
    allocations: [{ id: "a1", settlement_id: "s1", charge_id: "c1", amount_ngn: 500 }], jobIds: new Set(["j1"]) });
  assert.deepEqual(ex.filter((e) => e.severity === "error"), []);
});

test("reconciliation detects every required exception class", () => {
  const charges = [ch({ id: "c1", paid_amount_ngn: 300, status: "unpaid" }), ch({ id: "c2", user_id: "u2", job_id: null }),
    ch({ id: "c3", status: "void" }), ch({ id: "c4", paid_amount_ngn: 900, status: "paid" })];
  const settlements = [st({ id: "s1", allocated_amount_ngn: 100 }), st({ id: "s2", payment_reference: "ref1", amount_ngn: 1000, allocated_amount_ngn: 0 }),
    st({ id: "s3", status: "failed", payment_reference: "ref3", allocated_amount_ngn: 50 }), st({ id: "s4", amount_ngn: -5, allocated_amount_ngn: 0, payment_reference: "r4" })];
  const allocations: Allocation[] = [{ id: "a1", settlement_id: "s1", charge_id: "c1", amount_ngn: 300 },
    { id: "a2", settlement_id: "s1", charge_id: "c2", amount_ngn: 0 }, { id: "a3", settlement_id: "s3", charge_id: "c3", amount_ngn: 50 },
    { id: "a4", settlement_id: "s1", charge_id: "c4", amount_ngn: 900 }];
  const kinds = new Set(reconcile({ charges, settlements, allocations, jobIds: new Set(["j1"]),
    invoices: [inv], lines: [{ ...lines[0], charge_id: "c2" }, { ...lines[1], charge_id: "missing", amount_ngn: 300 }] }).map((e) => e.kind));
  for (const k of ["charge_without_job", "charge_paid_mismatch", "settlement_allocation_mismatch", "unallocated_payment",
    "duplicate_gateway_reference", "cross_customer_allocation", "negative_amount", "overpayment", "allocation_to_void_charge",
    "conflicting_charge_state", "conflicting_settlement_state", "invoice_total_mismatch", "invoice_line_mismatch"])
    assert.ok(kinds.has(k as any), "missing " + k);
});

test("customer balances exclude voided charges and report unallocated payments", () => {
  const b = customerBalances([ch({ id: "c1" }), ch({ id: "c2", status: "void" }), ch({ id: "c3", paid_amount_ngn: 200 })],
    [st({ amount_ngn: 1000 })], [{ id: "a1", settlement_id: "s1", charge_id: "c3", amount_ngn: 200 }]);
  assert.equal(b[0].outstanding, 800); assert.equal(b[0].voidedCharges, 1); assert.equal(b[0].unallocated, 800);
});
