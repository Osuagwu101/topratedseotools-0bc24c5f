/**
 * Email queue & dispatcher — server-only.
 *
 * Idempotency: every queued email has a unique `event_key` (e.g. `payment_success:{orderId}`).
 * Re-queuing with the same key silently no-ops so duplicate webhooks or callbacks
 * cannot send duplicate emails.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderTemplate, wrapHtmlEmail, type TemplateVars } from "./templates";
import { isResendConfigured, resendSendEmail, ResendError } from "./resend";

const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [5, 30, 120, 600, 1440];

/** Resend tag values allow only ASCII letters, numbers, underscores and dashes. */
export function sanitizeTagValue(value: string): string {
  const cleaned = (value ?? "").replace(/[^A-Za-z0-9_-]/g, "-").replace(/-{2,}/g, "-");
  return cleaned.replace(/^-+|-+$/g, "") || "unknown";
}


export interface QueueEmailInput {
  eventKey: string;
  templateKey: string;
  recipient: string;
  payload?: TemplateVars;
  relatedOrderId?: string | null;
  relatedUserId?: string | null;
  scheduledFor?: Date | string | null;
}

export interface EmailSettingsRow {
  sender_name: string;
  from_email: string;
  reply_to_email: string;
  sending_domain: string;
  abandoned_delay_hours: number;
  enabled_types: Record<string, boolean>;
  production_sending: boolean;
  resend_domain_status: string;
}

export async function getEmailSettings(admin: any): Promise<EmailSettingsRow | null> {
  const { data } = await admin.from("email_settings").select("*").eq("id", true).maybeSingle();
  return (data as EmailSettingsRow | null) ?? null;
}

export async function queueEmail(admin: any, input: QueueEmailInput): Promise<{ queued: boolean; skipped?: string; id?: string }> {
  const settings = await getEmailSettings(admin);
  if (settings && settings.enabled_types && settings.enabled_types[input.templateKey] === false) {
    return { queued: false, skipped: "type_disabled" };
  }

  const scheduledFor = input.scheduledFor
    ? new Date(input.scheduledFor).toISOString()
    : new Date().toISOString();

  const row = {
    event_key: input.eventKey,
    template_key: input.templateKey,
    recipient: input.recipient,
    payload: input.payload ?? {},
    related_order_id: input.relatedOrderId ?? null,
    related_user_id: input.relatedUserId ?? null,
    scheduled_for: scheduledFor,
    status: "pending" as const,
  };

  // Insert; on unique violation (already queued), no-op.
  const { data, error } = await admin
    .from("email_messages")
    .insert(row)
    .select("id, scheduled_for")
    .maybeSingle();

  if (error) {
    if (String(error.code) === "23505" || String(error.message).includes("duplicate")) {
      return { queued: false, skipped: "already_queued" };
    }
    throw new Error(String(error.message));
  }

  const id = (data as { id: string } | null)?.id;
  const dueNow = new Date(scheduledFor).getTime() <= Date.now();
  if (id && dueNow) {
    // Best-effort inline dispatch; failures schedule a retry.
    try {
      await dispatchOne(admin, id);
    } catch {
      /* swallowed — cron will retry */
    }
  }
  return { queued: true, id };
}

export async function dispatchOne(admin: any, id: string): Promise<{ ok: boolean; reason?: string }> {
  const { data: row } = await admin.from("email_messages").select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "sent" || row.status === "cancelled") return { ok: true };
  if (row.scheduled_for && new Date(row.scheduled_for).getTime() > Date.now()) {
    return { ok: false, reason: "not_due" };
  }

  // Order-state guard for the abandoned-checkout reminder — checked first so
  // completed/failed orders never send even while production_sending is off.
  if (row.template_key === "abandoned_checkout" && row.related_order_id) {
    const { data: order } = await admin
      .from("tool_orders")
      .select("status, payment_status")
      .eq("id", row.related_order_id)
      .maybeSingle();
    if (order && (order.status === "approved" || order.payment_status === "successful" || order.payment_status === "failed")) {
      return await markCancelled(admin, id, "order_no_longer_pending");
    }
  }

  const settings = await getEmailSettings(admin);
  if (!settings) return await markCancelled(admin, id, "no_settings");
  if (!settings.production_sending) return await markCancelled(admin, id, "production_sending_disabled");
  if (settings.enabled_types?.[row.template_key] === false) return await markCancelled(admin, id, "type_disabled");
  if (!isResendConfigured()) return await scheduleRetry(admin, row, "RESEND_API_KEY missing");


  const { data: tpl } = await admin
    .from("email_templates")
    .select("*")
    .eq("key", row.template_key)
    .maybeSingle();
  if (!tpl) return await markCancelled(admin, id, "template_missing");
  if (tpl.enabled === false) return await markCancelled(admin, id, "template_disabled");

  const vars: TemplateVars = {
    ...(row.payload ?? {}),
    sender_name: settings.sender_name,
    reply_to: settings.reply_to_email,
  };
  const subject = renderTemplate(tpl.subject, vars);
  const bodyInner = renderTemplate(tpl.html_body, vars);
  const html = wrapHtmlEmail(bodyInner, {
    senderName: settings.sender_name,
    siteUrl: (row.payload as any)?.site_url ?? "https://topratedseotools.com",
  });

  try {
    const res = await resendSendEmail({
      from: `${settings.sender_name} <${settings.from_email}>`,
      to: row.recipient,
      replyTo: settings.reply_to_email,
      subject,
      html,
      // Resend only accepts ASCII letters, numbers, underscores and dashes in
      // tag values — event keys contain ':' and other separators, so sanitize.
      tags: [
        { name: "template", value: sanitizeTagValue(row.template_key) },
        { name: "event", value: sanitizeTagValue(row.event_key).slice(0, 60) },
      ],

    });
    await admin
      .from("email_messages")
      .update({
        status: "sent",
        subject,
        sent_at: new Date().toISOString(),
        resend_message_id: res.id,
        attempts: (row.attempts ?? 0) + 1,
        last_error: null,
      })
      .eq("id", id);
    return { ok: true };
  } catch (err) {
    const message = err instanceof ResendError ? `[${err.status}] ${err.message}` : err instanceof Error ? err.message : String(err);
    // Permanent failure — most 4xx (except 429) shouldn't retry endlessly.
    const status = err instanceof ResendError ? err.status : 0;
    const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
    if (permanent) {
      await admin
        .from("email_messages")
        .update({ status: "failed", subject, attempts: (row.attempts ?? 0) + 1, last_error: message.slice(0, 500) })
        .eq("id", id);
      return { ok: false, reason: message };
    }
    return await scheduleRetry(admin, { ...row, subject }, message);
  }
}

async function markCancelled(admin: any, id: string, reason: string) {
  await admin.from("email_messages").update({ status: "cancelled", last_error: reason }).eq("id", id);
  return { ok: true, reason };
}

async function scheduleRetry(admin: any, row: any, error: string) {
  const attempts = (row.attempts ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await admin
      .from("email_messages")
      .update({ status: "failed", attempts, last_error: error.slice(0, 500), subject: row.subject ?? null })
      .eq("id", row.id);
    return { ok: false, reason: error };
  }
  const nextMin = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
  const next = new Date(Date.now() + nextMin * 60_000).toISOString();
  await admin
    .from("email_messages")
    .update({
      status: "retrying",
      attempts,
      last_error: error.slice(0, 500),
      scheduled_for: next,
      subject: row.subject ?? null,
    })
    .eq("id", row.id);
  return { ok: false, reason: `retry_scheduled:${next}` };
}

/** Dispatch every due row (used by cron). Small cap per run to avoid long executions. */
export async function dispatchDue(admin: any, limit = 50): Promise<{ processed: number; sent: number; failed: number; paused?: boolean }> {
  // Emergency control — admin can pause all outgoing email without touching code.
  const { data: pauseRow } = await admin.from("site_settings").select("emails_paused").eq("id", true).maybeSingle();
  if (pauseRow?.emails_paused) return { processed: 0, sent: 0, failed: 0, paused: true };
  const { data } = await admin
    .from("email_messages")
    .select("id")
    .in("status", ["pending", "retrying"])
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  let sent = 0;
  let failed = 0;
  for (const r of (data ?? []) as { id: string }[]) {
    try {
      const res = await dispatchOne(admin, r.id);
      if (res.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { processed: (data ?? []).length, sent, failed };
}

/** Scan pending checkout orders and queue abandoned-checkout reminders. */
export async function queueAbandonedReminders(admin: any): Promise<{ queued: number }> {
  const settings = await getEmailSettings(admin);
  if (!settings) return { queued: 0 };
  if (settings.enabled_types?.abandoned_checkout === false) return { queued: 0 };
  const cutoff = new Date(Date.now() - settings.abandoned_delay_hours * 3600_000).toISOString();

  const { data: orders } = await admin
    .from("tool_orders")
    .select("id, user_id, tool_slug, price_amount, currency, access_type, billing_period, created_at, price_label")
    .eq("status", "pending")
    .lte("created_at", cutoff)
    .limit(200);

  const orderList = (orders ?? []) as any[];
  if (!orderList.length) return { queued: 0 };

  const userIds = Array.from(new Set(orderList.map((o) => o.user_id))) as string[];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);
  const pMap = new Map<string, { email: string | null; name: string | null }>(
    ((profiles ?? []) as any[]).map((p) => [p.id as string, { email: p.email as string | null, name: p.full_name as string | null }]),
  );

  let queued = 0;
  for (const o of orderList) {
    const p = pMap.get(o.user_id as string);
    if (!p?.email) continue;
    const res = await queueEmail(admin, {
      eventKey: `abandoned_checkout:${o.id}`,

      templateKey: "abandoned_checkout",
      recipient: p.email,
      relatedOrderId: o.id as string,
      relatedUserId: o.user_id as string,
      payload: {
        name: p.name ?? "there",
        tool: o.tool_slug,
        amount: o.price_amount ?? "",
        currency: o.currency ?? "NGN",
        access_type: o.access_type ?? "",
        billing_period: o.billing_period ?? "",
        resume_url: `https://topratedseotools.com/order/${o.tool_slug}`,
      },
    });
    if (res.queued) queued++;
  }
  return { queued };
}
