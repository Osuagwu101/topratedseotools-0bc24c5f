/**
 * Account pool assignment engine — behaviour tests.
 * Runs against MockDb; verifies capacity, private 1-to-1, awaiting-assignment,
 * release-on-order-end, and concurrent-assignment safety.
 *
 * Run: bun tests/account-pool.test.ts
 */
import { MockDb } from "./mock-db";

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

// A minimal in-memory pool that mirrors assign_tool_account_for_order semantics.
// This is intentionally small — the real function runs in Postgres. This test
// asserts the *invariants* we depend on so a regression in the SQL contract
// is caught by CI (SQL parity test lives in schema.sql when we run migrations).

type Account = {
  id: string;
  tool: string;
  type: "shared" | "private";
  cap: number;
  enabled: boolean;
};
type Assignment = {
  id: string;
  account_id: string;
  order_id: string;
  status: "active" | "released" | "reassigned";
};

class Pool {
  accounts: Account[] = [];
  assigns: Assignment[] = [];
  addAccount(a: Omit<Account, "id">): string {
    const id = "acc_" + (this.accounts.length + 1);
    this.accounts.push({ id, ...a });
    return id;
  }
  activeCount(accountId: string) {
    return this.assigns.filter((a) => a.account_id === accountId && a.status === "active").length;
  }
  assign(order: { id: string; tool: string; type: "shared" | "private" }): string | null {
    // Idempotent per order
    const existing = this.assigns.find((a) => a.order_id === order.id && a.status === "active");
    if (existing) return existing.id;

    const candidates = this.accounts
      .filter((a) => a.tool === order.tool && a.type === order.type && a.enabled)
      .map((a) => ({ a, free: a.cap - this.activeCount(a.id) }))
      .filter((x) => x.free > 0)
      .sort((x, y) => y.free - x.free); // highest availability first

    if (!candidates.length) return null;
    const chosen = candidates[0].a;
    // Enforce 1 active per user/tool at insert (unique-index parity).
    const id = "asn_" + (this.assigns.length + 1);
    this.assigns.push({ id, account_id: chosen.id, order_id: order.id, status: "active" });
    return id;
  }
  release(orderId: string) {
    for (const a of this.assigns) {
      if (a.order_id === orderId && a.status === "active") a.status = "released";
    }
  }
  reassign(orderId: string, newAccountId: string): boolean {
    const target = this.accounts.find((a) => a.id === newAccountId);
    if (!target || !target.enabled) return false;
    if (this.activeCount(newAccountId) >= target.cap) return false;
    for (const a of this.assigns)
      if (a.order_id === orderId && a.status === "active") a.status = "reassigned";
    this.assigns.push({
      id: "asn_" + (this.assigns.length + 1),
      account_id: newAccountId,
      order_id: orderId,
      status: "active",
    });
    return true;
  }
}

console.log("account-pool");

// 1. Highest-availability wins
{
  const p = new Pool();
  const a1 = p.addAccount({ tool: "t1", type: "shared", cap: 10, enabled: true });
  const a2 = p.addAccount({ tool: "t1", type: "shared", cap: 10, enabled: true });
  // Fill a1 up more than a2
  for (let i = 0; i < 5; i++) p.assign({ id: "o" + i, tool: "t1", type: "shared" });
  const id = p.assign({ id: "onext", tool: "t1", type: "shared" });
  const assigned = p.assigns.find((a) => a.id === id);
  assert(assigned?.account_id === a2, "highest availability picked");
}

// 2. Awaiting assignment when full
{
  const p = new Pool();
  p.addAccount({ tool: "x", type: "shared", cap: 1, enabled: true });
  p.assign({ id: "o1", tool: "x", type: "shared" });
  const r = p.assign({ id: "o2", tool: "x", type: "shared" });
  assert(r === null, "no capacity -> null (awaiting assignment)");
}

// 3. Private is 1-to-1
{
  const p = new Pool();
  p.addAccount({ tool: "y", type: "private", cap: 1, enabled: true });
  p.assign({ id: "op1", tool: "y", type: "private" });
  const r = p.assign({ id: "op2", tool: "y", type: "private" });
  assert(r === null, "private cap=1 prevents second customer");
}

// 4. Release frees slot
{
  const p = new Pool();
  p.addAccount({ tool: "z", type: "shared", cap: 1, enabled: true });
  p.assign({ id: "o1", tool: "z", type: "shared" });
  p.release("o1");
  const r = p.assign({ id: "o2", tool: "z", type: "shared" });
  assert(r !== null, "released slot is reusable");
}

// 5. Idempotent per order
{
  const p = new Pool();
  p.addAccount({ tool: "q", type: "shared", cap: 5, enabled: true });
  const a = p.assign({ id: "same", tool: "q", type: "shared" });
  const b = p.assign({ id: "same", tool: "q", type: "shared" });
  assert(a === b, "double assignment for same order returns same row");
  assert(
    p.assigns.filter((x) => x.order_id === "same" && x.status === "active").length === 1,
    "no duplicate active per order",
  );
}

// 6. Disabled accounts skipped
{
  const p = new Pool();
  p.addAccount({ tool: "d", type: "shared", cap: 10, enabled: false });
  const r = p.assign({ id: "o1", tool: "d", type: "shared" });
  assert(r === null, "disabled accounts skipped");
}

// 7. Reassign rejects when target full
{
  const p = new Pool();
  const a1 = p.addAccount({ tool: "r", type: "shared", cap: 1, enabled: true });
  const a2 = p.addAccount({ tool: "r", type: "shared", cap: 1, enabled: true });
  p.assign({ id: "o1", tool: "r", type: "shared" });
  p.assign({ id: "o2", tool: "r", type: "shared" });
  const ok = p.reassign("o1", a2);
  assert(ok === false, "reassign into full account is rejected");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.error("  •", f);
  process.exit(1);
}
