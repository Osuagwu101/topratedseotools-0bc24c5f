/**
 * Access Health — admin_alert email behaviour.
 * Verifies: template contract (no credential fields), stable dedup keys,
 * resolution when the underlying condition is fixed, enabled/disabled
 * queueing, and badge-count filtering.
 *
 * Run: bun tests/admin-alert-emails.test.ts
 */
import {
  buildAccountAlerts,
  DEFAULT_ALERT_SETTINGS,
  type AlertInputAccount,
  type AlertInputOrder,
  type AlertKind,
  type AccountAlert,
} from "../src/lib/access-health";
import { renderTemplate } from "../src/lib/email/templates";
import { MockDb } from "./mock-db";
import { queueEmail } from "../src/lib/email/queue";

let passed = 0,
  failed = 0;
const failures: string[] = [];
function assert(cond: any, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error("  ✗", msg);
  }
}

const settings = {
  ...DEFAULT_ALERT_SETTINGS,
  emailsEnabled: true,
  emailRecipients: ["ops@example.com"],
};
const now = Date.parse("2026-08-01T00:00:00Z");

function acc(o: Partial<AlertInputAccount>): AlertInputAccount {
  return {
    id: o.id ?? "a1",
    tool_slug: o.tool_slug ?? "quillbot",
    label: o.label ?? "A",
    status: o.status ?? "working",
    enabled: o.enabled ?? true,
    expires_at: o.expires_at ?? null,
    active_count: o.active_count ?? 0,
    max_capacity: o.max_capacity ?? 10,
    fill_pct: 0,
    needs_capacity_review: o.needs_capacity_review ?? false,
  } as any;
}

console.log("admin_alert email behaviour");

// 1. Template renders with expected variables and no credential leaks.
{
  // Mirror of the html_body in the seed migration.
  const tpl = `<p>Alert: {{title}} ({{level}})</p><p>{{body}}</p>
<p>Tool {{tool_slug}} / Account {{account_label}} / Affected {{affected_customers}}</p>
<p><a href="{{admin_link}}">Open Access Health</a></p><p>Raised {{raised_at}}</p>`;
  const rendered = renderTemplate(tpl, {
    title: "Full: quillbot · Pool A",
    level: "critical",
    body: "Account is at 10/10.",
    tool_slug: "quillbot",
    account_label: "Pool A",
    affected_customers: 10,
    admin_link: "https://topratedseotools.com/admin/access-health",
    raised_at: "2026-08-01T00:00:00.000Z",
  });
  assert(rendered.includes("Full: quillbot"), "title rendered");
  assert(rendered.includes("critical"), "level rendered");
  assert(rendered.includes("Pool A"), "account label rendered");
  assert(rendered.includes("Affected 10"), "affected count rendered");
  assert(rendered.includes("/admin/access-health"), "admin link rendered");
  assert(rendered.includes("2026-08-01"), "timestamp rendered");

  const banned = ["password", "login_email", "otp", "cookie", "session_token", "card", "cvv"];
  for (const b of banned)
    assert(!rendered.toLowerCase().includes(b), `template must not contain "${b}"`);
}

// 2. Alert keys are stable → dedup contract holds across calls.
{
  const a = acc({ id: "acc-x", active_count: 10, max_capacity: 10, fill_pct: 100 });
  const k1 = buildAccountAlerts([a], [], settings, now).find((x) => x.kind === "full")?.key;
  const k2 = buildAccountAlerts([a], [], settings, now).find((x) => x.kind === "full")?.key;
  assert(k1 && k1 === k2 && k1 === "account:acc-x:full", "dedup keys stable across snapshots");
}

// 3. Fixing capacity resolves the full-account alert (no more alert emitted).
{
  const full = acc({ id: "acc-y", active_count: 10, max_capacity: 10, fill_pct: 100 });
  const fixed = { ...full, max_capacity: 20, fill_pct: 50 };
  const before = buildAccountAlerts([full], [], settings, now).some((x) => x.kind === "full");
  const after = buildAccountAlerts([fixed], [], settings, now).some((x) => x.kind === "full");
  assert(before && !after, "full alert disappears after capacity increased");
}

// 4. Reassigning all customers off an unhealthy account resolves the alert.
{
  const bad = acc({ id: "acc-z", status: "login_failed", active_count: 3, max_capacity: 10 });
  const drained = { ...bad, active_count: 0 };
  const before = buildAccountAlerts([bad], [], settings, now).some(
    (x) => x.kind === "customers_on_unhealthy_account",
  );
  const after = buildAccountAlerts([drained], [], settings, now).some(
    (x) => x.kind === "customers_on_unhealthy_account",
  );
  assert(before && !after, "unhealthy-with-customers alert clears when drained");
}

// 5. Assigning a waiting customer resolves the awaiting alert.
{
  const orders: AlertInputOrder[] = [
    {
      id: "o1",
      tool_slug: "quillbot",
      user_id: "u1",
      access_type: "shared",
      created_at: new Date(now).toISOString(),
    },
  ];
  const before = buildAccountAlerts([], orders, settings, now).some(
    (x) => x.kind === "awaiting_assignment",
  );
  const after = buildAccountAlerts([], [], settings, now).some(
    (x) => x.kind === "awaiting_assignment",
  );
  assert(before && !after, "awaiting alert clears after assignment");
}

// 6. Confirming capacity resolves needs_capacity_review.
{
  const flagged = acc({ id: "acc-r", needs_capacity_review: true });
  const before = buildAccountAlerts([flagged], [], settings, now).some(
    (x) => x.kind === "needs_capacity_review",
  );
  const after = buildAccountAlerts(
    [{ ...flagged, needs_capacity_review: false }],
    [],
    settings,
    now,
  ).some((x) => x.kind === "needs_capacity_review");
  assert(before && !after, "needs_capacity_review clears after confirmation");
}

// 7. queueEmail skips when the admin_alert type is disabled.
async function testQueueSkipDisabled() {
  const db = new MockDb();
  db.seed("email_settings", [{ id: true, enabled_types: { admin_alert: false } }]);
  const res = await queueEmail(db as any, {
    eventKey: "admin_alert:x:ops@example.com",
    templateKey: "admin_alert",
    recipient: "ops@example.com",
    payload: { title: "t" },
  });
  assert(
    res.queued === false && res.skipped === "type_disabled",
    "disabled admin_alert type => skipped",
  );
}

// 8. queueEmail queues when enabled.
async function testQueueEnabled() {
  const db = new MockDb({ uniqueColumns: { email_messages: ["event_key"] } });
  db.seed("email_settings", [
    { id: true, enabled_types: { admin_alert: true }, production_sending: false },
  ]);
  const res = await queueEmail(db as any, {
    eventKey: "admin_alert:y:ops@example.com",
    templateKey: "admin_alert",
    recipient: "ops@example.com",
    payload: { title: "t" },
  });
  assert(res.queued === true, "enabled admin_alert type => queued");
  // duplicate key returns already_queued
  const dup = await queueEmail(db as any, {
    eventKey: "admin_alert:y:ops@example.com",
    templateKey: "admin_alert",
    recipient: "ops@example.com",
    payload: { title: "t" },
  });
  assert(
    dup.queued === false && dup.skipped === "already_queued",
    "duplicate event_key => already_queued",
  );
}

// 9. Badge count filter (mirrors getAccessHealthBadgeCounts).
{
  const attentionKinds = new Set<AlertKind>([
    "full",
    "expired",
    "login_problem",
    "suspended",
    "disabled_with_customers",
    "customers_on_unhealthy_account",
    "awaiting_assignment",
    "needs_capacity_review",
  ]);
  function badge(alerts: AccountAlert[]): number {
    return alerts.filter(
      (a) =>
        a.level !== "info" &&
        attentionKinds.has(a.kind) &&
        (["login_problem", "suspended"].includes(a.kind) ? a.affected_customers > 0 : true),
    ).length;
  }
  const accounts = [
    acc({ id: "b1", active_count: 10, max_capacity: 10, fill_pct: 100 }), // full → counts
    acc({ id: "b2", active_count: 8, max_capacity: 10, fill_pct: 80 }), // almost_full → excluded
    acc({ id: "b3", status: "suspended", active_count: 0 }), // suspended w/no cust → excluded from badge
  ];
  const orders: AlertInputOrder[] = [
    {
      id: "o9",
      tool_slug: "x",
      user_id: "u",
      access_type: "shared",
      created_at: new Date(now).toISOString(),
    },
  ];
  const alerts = buildAccountAlerts(accounts, orders, settings, now);
  const count = badge(alerts);
  // full(b1) + awaiting(o9) + disabled? none. suspended(b3) excluded (no customers).
  assert(count === 2, `badge counts full + awaiting only, got ${count}`);
}

(async () => {
  await testQueueSkipDisabled();
  await testQueueEnabled();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.error("  •", f);
    process.exit(1);
  }
})();
