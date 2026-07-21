/**
 * Access-Health pure helpers — behaviour tests.
 * Run: bun tests/access-health.test.ts
 */
import {
  classifyHealth,
  buildAccountAlerts,
  planBulkReassignment,
  summariseByTool,
  isExpiringSoon,
  DEFAULT_ALERT_SETTINGS,
  type AlertInputAccount,
  type AlertInputOrder,
  type AlertSettings,
} from "../src/lib/access-health";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: any, msg: string) {
  if (cond) { passed++; } else { failed++; failures.push(msg); console.error("  ✗", msg); }
}

const now = Date.parse("2026-08-01T00:00:00Z");
const settings: AlertSettings = { ...DEFAULT_ALERT_SETTINGS };

function acc(o: Partial<AlertInputAccount>): AlertInputAccount {
  return {
    id: o.id ?? "a1", tool_slug: o.tool_slug ?? "quillbot", label: o.label ?? "A",
    status: o.status ?? "working", enabled: o.enabled ?? true, expires_at: o.expires_at ?? null,
    active_count: o.active_count ?? 0, max_capacity: o.max_capacity ?? 10, fill_pct: 0,
    needs_capacity_review: o.needs_capacity_review ?? false,
  } as any;
}

console.log("access-health");

// 1. almost-full at 80% (default)
{
  const a = acc({ active_count: 8, max_capacity: 10, fill_pct: 80 });
  assert(classifyHealth(a, settings, now) === "almost_full", "8/10 => almost_full at default 80%");
}
// 2. full when active >= cap
{
  const a = acc({ active_count: 10, max_capacity: 10, fill_pct: 100 });
  assert(classifyHealth(a, settings, now) === "full", "10/10 => full");
}
// 3. expiring soon within window
{
  const in5 = new Date(now + 5 * 86400_000).toISOString();
  const a = acc({ expires_at: in5, active_count: 3, max_capacity: 10 });
  assert(isExpiringSoon(a, settings, now), "5d ahead expiring soon at 7d window");
  const in20 = new Date(now + 20 * 86400_000).toISOString();
  assert(!isExpiringSoon({ expires_at: in20 } as any, settings, now), "20d ahead not expiring");
}
// 4. expired classifies as expired regardless of status
{
  const past = new Date(now - 3600_000).toISOString();
  const a = acc({ expires_at: past, active_count: 2, max_capacity: 10 });
  assert(classifyHealth(a, settings, now) === "expired", "past expires_at => expired");
}
// 5. disabled classifies as disabled
{
  const a = acc({ enabled: false });
  assert(classifyHealth(a, settings, now) === "disabled", "disabled");
}
// 6. login_failed / password_changed => login_problem
{
  assert(classifyHealth(acc({ status: "login_failed" }), settings, now) === "login_problem", "login_failed => login_problem");
  assert(classifyHealth(acc({ status: "password_changed" }), settings, now) === "login_problem", "password_changed => login_problem");
}
// 7. unhealthy alert lists affected customer count
{
  const accounts = [acc({ id: "aa", status: "login_failed", active_count: 4, max_capacity: 10, fill_pct: 40 })];
  const alerts = buildAccountAlerts(accounts, [], settings, now);
  const lp = alerts.find((x) => x.kind === "login_problem");
  assert(lp && lp.affected_customers === 4, "login_problem alert reports 4 affected customers");
}
// 8. disabled-with-customers alert
{
  const accounts = [acc({ id: "aa", enabled: false, active_count: 2, max_capacity: 5 })];
  const alerts = buildAccountAlerts(accounts, [], settings, now);
  assert(alerts.some((x) => x.kind === "disabled_with_customers"), "disabled + customers => alert");
}
// 9. awaiting-assignment alert for paid orders
{
  const orders: AlertInputOrder[] = [{ id: "o1", tool_slug: "quillbot", user_id: "u1", access_type: "shared", created_at: new Date(now).toISOString() }];
  const alerts = buildAccountAlerts([], orders, settings, now);
  assert(alerts.some((x) => x.kind === "awaiting_assignment" && x.order_id === "o1"), "awaiting_assignment alert emitted");
}
// 10. needs_capacity_review alert
{
  const accounts = [acc({ id: "aa", needs_capacity_review: true })];
  const alerts = buildAccountAlerts(accounts, [], settings, now);
  assert(alerts.some((x) => x.kind === "needs_capacity_review"), "review alert emitted");
}
// 11. per-tool summary
{
  const accounts = [
    acc({ id: "a1", tool_slug: "t", active_count: 10, max_capacity: 10, fill_pct: 100 }),
    acc({ id: "a2", tool_slug: "t", active_count: 2, max_capacity: 5, fill_pct: 40 }),
  ];
  const [s] = summariseByTool(accounts, [], settings, now);
  assert(s.totalAccounts === 2 && s.full === 1 && s.healthy === 1 && s.assigned === 12 && s.available === 3, "per-tool summary counts");
}
// 12. bulk plan respects capacity and skips unhealthy/disabled/expired
{
  const plan = planBulkReassignment(["o1", "o2", "o3"], [
    { id: "t1", available: 1, enabled: true, health: "available", expires_at: null },
    { id: "t2", available: 5, enabled: false, health: "available", expires_at: null }, // disabled -> skipped
    { id: "t3", available: 3, enabled: true, health: "login_problem", expires_at: null }, // unhealthy -> skipped
    { id: "t4", available: 1, enabled: true, health: "available", expires_at: new Date(now - 1).toISOString() }, // expired -> skipped
  ], now);
  const filled = plan.assignments.filter((a) => a.target_account_id !== null);
  assert(filled.length === 1 && filled[0].target_account_id === "t1", "bulk plan uses only t1");
  assert(plan.remainingAwaiting.length === 2, "2 orders remain awaiting");
}
// 13. bulk plan never overfills
{
  const plan = planBulkReassignment(["o1","o2","o3","o4"], [
    { id: "t1", available: 2, enabled: true, health: "available", expires_at: null },
    { id: "t2", available: 1, enabled: true, health: "almost_full", expires_at: null },
  ], now);
  const perTarget: Record<string, number> = {};
  for (const a of plan.assignments) if (a.target_account_id) perTarget[a.target_account_id] = (perTarget[a.target_account_id] ?? 0) + 1;
  assert((perTarget.t1 ?? 0) <= 2 && (perTarget.t2 ?? 0) <= 1, "no target overfilled");
  assert(plan.remainingAwaiting.length === 1, "1 order remains awaiting");
}
// 14. custom almostFullPct threshold
{
  const s = { ...settings, almostFullPct: 50 };
  const a = acc({ active_count: 5, max_capacity: 10, fill_pct: 50 });
  assert(classifyHealth(a, s, now) === "almost_full", "custom 50% threshold");
}
// 15. suspended alert distinct from expired
{
  const alerts = buildAccountAlerts([acc({ id: "s1", status: "suspended", active_count: 1 })], [], settings, now);
  assert(alerts.some((x) => x.kind === "suspended"), "suspended alert");
}
// 16. deterministic alert keys (dedup contract)
{
  const a = acc({ id: "dup", active_count: 10, max_capacity: 10, fill_pct: 100 });
  const first = buildAccountAlerts([a], [], settings, now).find((x) => x.kind === "full");
  const second = buildAccountAlerts([a], [], settings, now).find((x) => x.kind === "full");
  assert(first?.key === second?.key && first?.key === "account:dup:full", "alert keys stable for dedup");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { for (const f of failures) console.error("  •", f); process.exit(1); }
