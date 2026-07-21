/**
 * Pure helpers for the Admin Access-Health surface.
 *
 * All functions here are side-effect free so they can be unit-tested
 * without a database. The server functions in
 * `account-pool.functions.ts` and `access-health.functions.ts` compose
 * these to build the Admin UI payloads.
 */

export type RawStatus =
  | "working"
  | "login_failed"
  | "password_changed"
  | "suspended"
  | "expired"
  | "tool_unavailable"
  | "maintenance"
  | "other";

export type HealthStatus =
  | "available"
  | "almost_full"
  | "full"
  | "under_maintenance"
  | "login_problem"
  | "expired"
  | "suspended"
  | "disabled";

export interface AccountLike {
  status: RawStatus;
  enabled: boolean;
  expires_at: string | null;
  active_count: number;
  max_capacity: number;
  fill_pct: number;
  needs_capacity_review: boolean;
}

export interface AlertSettings {
  almostFullPct: number; // e.g. 80
  expiryDays: number; // e.g. 7
  emailsEnabled: boolean;
  emailRecipients: string[];
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  almostFullPct: 80,
  expiryDays: 7,
  emailsEnabled: false,
  emailRecipients: [],
};

/** Classify an account into the Admin-visible health status. */
export function classifyHealth(
  account: AccountLike,
  settings: Pick<AlertSettings, "almostFullPct"> = DEFAULT_ALERT_SETTINGS,
  now: number = Date.now(),
): HealthStatus {
  if (!account.enabled) return "disabled";
  if (account.status === "suspended") return "suspended";
  if (account.status === "expired") return "expired";
  if (account.expires_at && new Date(account.expires_at).getTime() <= now) return "expired";
  if (account.status === "maintenance" || account.status === "tool_unavailable") {
    return "under_maintenance";
  }
  if (account.status === "login_failed" || account.status === "password_changed") {
    return "login_problem";
  }
  if (account.status === "other") return "login_problem";
  const cap = account.max_capacity || 0;
  const active = account.active_count || 0;
  if (cap > 0 && active >= cap) return "full";
  if (cap > 0 && (active / cap) * 100 >= (settings.almostFullPct ?? 80)) return "almost_full";
  return "available";
}

export function isExpiringSoon(
  account: Pick<AccountLike, "expires_at">,
  settings: Pick<AlertSettings, "expiryDays"> = DEFAULT_ALERT_SETTINGS,
  now: number = Date.now(),
): boolean {
  if (!account.expires_at) return false;
  const t = new Date(account.expires_at).getTime();
  const soon = now + (settings.expiryDays ?? 7) * 86_400_000;
  return t > now && t < soon;
}

export function healthIsUnhealthy(h: HealthStatus): boolean {
  return h === "full" || h === "under_maintenance" || h === "login_problem" || h === "expired" || h === "suspended";
}

// ------------- Alerts -------------

export type AlertLevel = "info" | "warning" | "critical";
export type AlertKind =
  | "almost_full"
  | "full"
  | "expiring_soon"
  | "expired"
  | "login_problem"
  | "suspended"
  | "disabled_with_customers"
  | "customers_on_unhealthy_account"
  | "awaiting_assignment"
  | "needs_capacity_review";

export interface AccountAlert {
  key: string; // deterministic dedupe key (used for email + resolve tracking)
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  message: string;
  tool_slug: string;
  account_id: string | null;
  order_id: string | null;
  affected_customers: number;
}

export interface AlertInputAccount extends AccountLike {
  id: string;
  tool_slug: string;
  label: string;
}

export interface AlertInputOrder {
  id: string;
  tool_slug: string;
  user_id: string;
  access_type: "shared" | "private";
  created_at: string;
}

export function buildAccountAlerts(
  accounts: AlertInputAccount[],
  awaitingOrders: AlertInputOrder[],
  settings: AlertSettings,
  now: number = Date.now(),
): AccountAlert[] {
  const alerts: AccountAlert[] = [];

  for (const a of accounts) {
    const health = classifyHealth(a, settings, now);
    const base = { tool_slug: a.tool_slug, account_id: a.id, order_id: null as string | null };

    if (health === "full") {
      alerts.push({
        ...base,
        key: `account:${a.id}:full`,
        kind: "full",
        level: "critical",
        title: `Full: ${a.tool_slug} · ${a.label}`,
        message: `Account is at ${a.active_count}/${a.max_capacity}. Add capacity or another account.`,
        affected_customers: a.active_count,
      });
    } else if (health === "almost_full") {
      alerts.push({
        ...base,
        key: `account:${a.id}:almost_full`,
        kind: "almost_full",
        level: "warning",
        title: `Almost full: ${a.tool_slug} · ${a.label}`,
        message: `Utilisation ${a.fill_pct}% (>= ${settings.almostFullPct}%).`,
        affected_customers: a.active_count,
      });
    }

    if (health === "expired") {
      alerts.push({
        ...base,
        key: `account:${a.id}:expired`,
        kind: "expired",
        level: "critical",
        title: `Expired: ${a.tool_slug} · ${a.label}`,
        message: `Account expired${a.expires_at ? " on " + new Date(a.expires_at).toLocaleDateString() : ""}.`,
        affected_customers: a.active_count,
      });
    } else if (isExpiringSoon(a, settings, now)) {
      alerts.push({
        ...base,
        key: `account:${a.id}:expiring`,
        kind: "expiring_soon",
        level: "warning",
        title: `Expiring soon: ${a.tool_slug} · ${a.label}`,
        message: `Expires on ${new Date(a.expires_at!).toLocaleDateString()}.`,
        affected_customers: a.active_count,
      });
    }

    if (health === "login_problem") {
      alerts.push({
        ...base,
        key: `account:${a.id}:login_problem`,
        kind: "login_problem",
        level: "critical",
        title: `Login problem: ${a.tool_slug} · ${a.label}`,
        message: `Status is "${a.status.replace(/_/g, " ")}". Refresh the credentials.`,
        affected_customers: a.active_count,
      });
    }

    if (health === "suspended") {
      alerts.push({
        ...base,
        key: `account:${a.id}:suspended`,
        kind: "suspended",
        level: "critical",
        title: `Suspended: ${a.tool_slug} · ${a.label}`,
        message: `Account is suspended. Move customers to another account.`,
        affected_customers: a.active_count,
      });
    }

    if (health === "disabled" && a.active_count > 0) {
      alerts.push({
        ...base,
        key: `account:${a.id}:disabled_with_customers`,
        kind: "disabled_with_customers",
        level: "critical",
        title: `Disabled with customers: ${a.tool_slug} · ${a.label}`,
        message: `${a.active_count} customer(s) still assigned. Reassign them.`,
        affected_customers: a.active_count,
      });
    }

    if (healthIsUnhealthy(health) && a.active_count > 0 && health !== "full") {
      alerts.push({
        ...base,
        key: `account:${a.id}:customers_on_unhealthy`,
        kind: "customers_on_unhealthy_account",
        level: "warning",
        title: `Customers on unhealthy account: ${a.tool_slug}`,
        message: `${a.active_count} customer(s) on "${a.label}" (${health.replace(/_/g, " ")}).`,
        affected_customers: a.active_count,
      });
    }

    if (a.needs_capacity_review) {
      alerts.push({
        ...base,
        key: `account:${a.id}:needs_review`,
        kind: "needs_capacity_review",
        level: "info",
        title: `Review capacity: ${a.tool_slug} · ${a.label}`,
        message: `This account was migrated. Confirm real capacity.`,
        affected_customers: a.active_count,
      });
    }
  }

  for (const o of awaitingOrders) {
    alerts.push({
      key: `order:${o.id}:awaiting`,
      kind: "awaiting_assignment",
      level: "critical",
      title: `Paid customer awaiting assignment (${o.tool_slug})`,
      message: `Order ${o.id.slice(0, 8)} is paid but no ${o.access_type} account has capacity.`,
      tool_slug: o.tool_slug,
      account_id: null,
      order_id: o.id,
      affected_customers: 1,
    });
  }

  return alerts;
}

// Aggregate per-tool summary used on the tool page and dashboard.
export interface ToolAccountSummary {
  tool_slug: string;
  totalAccounts: number;
  healthy: number;
  almostFull: number;
  full: number;
  unhealthy: number;
  totalCapacity: number;
  assigned: number;
  available: number;
  awaiting: number;
  expiringSoon: number;
  needsReview: number;
}

export function summariseByTool(
  accounts: AlertInputAccount[],
  awaitingOrders: AlertInputOrder[],
  settings: AlertSettings,
  now: number = Date.now(),
): ToolAccountSummary[] {
  const bySlug = new Map<string, ToolAccountSummary>();
  const ensure = (slug: string) => {
    let s = bySlug.get(slug);
    if (!s) {
      s = {
        tool_slug: slug,
        totalAccounts: 0, healthy: 0, almostFull: 0, full: 0, unhealthy: 0,
        totalCapacity: 0, assigned: 0, available: 0, awaiting: 0, expiringSoon: 0,
        needsReview: 0,
      };
      bySlug.set(slug, s);
    }
    return s;
  };
  for (const a of accounts) {
    const s = ensure(a.tool_slug);
    s.totalAccounts++;
    s.totalCapacity += a.max_capacity;
    s.assigned += a.active_count;
    s.available += Math.max(0, a.max_capacity - a.active_count);
    const h = classifyHealth(a, settings, now);
    if (h === "available") s.healthy++;
    else if (h === "almost_full") s.almostFull++;
    else if (h === "full") s.full++;
    else s.unhealthy++;
    if (isExpiringSoon(a, settings, now)) s.expiringSoon++;
    if (a.needs_capacity_review) s.needsReview++;
  }
  for (const o of awaitingOrders) {
    ensure(o.tool_slug).awaiting++;
  }
  return Array.from(bySlug.values()).sort((a, b) => a.tool_slug.localeCompare(b.tool_slug));
}

// Bulk reassignment planning — pure so it can be unit-tested.
export interface BulkTargetAccount {
  id: string;
  available: number;
  enabled: boolean;
  health: HealthStatus;
  expires_at: string | null;
}

export interface BulkPlanItem { order_id: string; target_account_id: string | null; }
export interface BulkPlanResult {
  assignments: BulkPlanItem[];
  remainingAwaiting: string[]; // order ids that could not be placed
}

/**
 * Given a list of orders that must be re-homed and a list of candidate
 * accounts, produce a plan that never exceeds any account's `available`
 * count and only uses healthy, enabled, non-expired accounts.
 */
export function planBulkReassignment(
  orderIds: string[],
  candidates: BulkTargetAccount[],
  now: number = Date.now(),
): BulkPlanResult {
  const remaining = new Map<string, number>();
  for (const c of candidates) {
    const usable =
      c.enabled &&
      (c.health === "available" || c.health === "almost_full") &&
      (!c.expires_at || new Date(c.expires_at).getTime() > now);
    remaining.set(c.id, usable ? c.available : 0);
  }
  const assignments: BulkPlanItem[] = [];
  const remainingAwaiting: string[] = [];
  for (const oid of orderIds) {
    // pick highest-availability remaining
    let chosen: string | null = null;
    let best = 0;
    for (const [id, free] of remaining) {
      if (free > best) { best = free; chosen = id; }
    }
    if (!chosen) {
      remainingAwaiting.push(oid);
      assignments.push({ order_id: oid, target_account_id: null });
      continue;
    }
    remaining.set(chosen, (remaining.get(chosen) ?? 0) - 1);
    assignments.push({ order_id: oid, target_account_id: chosen });
  }
  return { assignments, remainingAwaiting };
}
