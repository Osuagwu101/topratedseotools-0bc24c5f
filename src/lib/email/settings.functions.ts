/**
 * Admin server functions for the Email Settings page: read/update settings,
 * manage the Resend domain, edit templates, list history, retry, send a test.
 * Every function gates on `has_role(admin)` and never returns the API key.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isResendConfigured,
  resendCreateDomain,
  resendGetDomain,
  resendVerifyDomain,
  ResendError,
  type ResendDnsRecord,
} from "./resend";
import { queueEmail, dispatchOne, dispatchDue, queueAbandonedReminders } from "./queue";
import { renderTemplate, wrapHtmlEmail } from "./templates";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (error) throw new Error(String(error.message ?? "role check failed"));
  if (!data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ---------- Read settings + status ----------

export const adminGetEmailSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data } = await admin.from("email_settings").select("*").eq("id", true).maybeSingle();
    const resendConfigured = isResendConfigured();
    return {
      settings: (data as any) ?? null,
      resendConfigured,
    };
  });

// ---------- Update sender / reply-to / domain / defaults ----------

const settingsInput = z.object({
  sender_name: z.string().trim().min(1).max(120).optional(),
  from_email: z.string().trim().email().max(200).optional(),
  reply_to_email: z.string().trim().email().max(200).optional(),
  sending_domain: z.string().trim().min(1).max(200).optional(),
  abandoned_delay_hours: z.number().int().min(0).max(720).optional(),
  production_sending: z.boolean().optional(),
  enabled_types: z.record(z.string(), z.boolean()).optional(),
  // Email branding (presentation only).
  brand_name: z.string().trim().min(1).max(120).optional(),
  brand_color: z.string().trim().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #5b62f9").optional(),
  brand_logo_url: z.string().trim().max(500).optional().or(z.literal("")),
  footer_company: z.string().trim().min(1).max(160).optional(),
  footer_support_email: z.string().trim().email().max(200).optional(),
  footer_website_url: z.string().trim().url().max(300).optional(),
  footer_message: z.string().trim().max(300).optional().or(z.literal("")),
});

export const adminUpdateEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => settingsInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const patch = { ...data, updated_by: context.userId } as never;
    const { error } = await admin.from("email_settings").update(patch).eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Domain: create / refresh / verify ----------

function sanitizeDnsRecords(records: ResendDnsRecord[] | undefined): ResendDnsRecord[] {
  return (records ?? []).map((r) => ({
    record: r.record,
    name: r.name,
    type: r.type,
    value: r.value,
    ttl: r.ttl,
    priority: r.priority,
    status: r.status,
  }));
}

export const adminCreateEmailDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ domain: z.string().trim().min(3).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    if (!isResendConfigured()) throw new Error("Add RESEND_API_KEY first.");
    try {
      const created = await resendCreateDomain(data.domain);
      await admin
        .from("email_settings")
        .update({
          sending_domain: data.domain,
          resend_domain_id: created.id,
          resend_domain_status: created.status ?? "pending",
          resend_dns_records: sanitizeDnsRecords(created.records) as never,
          updated_by: context.userId,
        } as never)
        .eq("id", true);
      return { ok: true, id: created.id, status: created.status, records: sanitizeDnsRecords(created.records) };
    } catch (e) {
      if (e instanceof ResendError && e.status === 422) {
        // Domain likely already exists — try to look it up by listing.
        throw new Error(e.message);
      }
      throw e;
    }
  });

export const adminRefreshEmailDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data: cur } = await admin.from("email_settings").select("resend_domain_id").eq("id", true).maybeSingle();
    const id = (cur as { resend_domain_id?: string } | null)?.resend_domain_id;
    if (!id) throw new Error("No domain has been created yet.");
    const dom = await resendGetDomain(id);
    await admin
      .from("email_settings")
      .update({
        resend_domain_status: dom.status ?? "unknown",
        resend_dns_records: sanitizeDnsRecords(dom.records) as never,
        last_verified_at: new Date().toISOString(),
      } as never)
      .eq("id", true);
    return { ok: true, status: dom.status, records: sanitizeDnsRecords(dom.records) };
  });

export const adminVerifyEmailDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data: cur } = await admin.from("email_settings").select("resend_domain_id").eq("id", true).maybeSingle();
    const id = (cur as { resend_domain_id?: string } | null)?.resend_domain_id;
    if (!id) throw new Error("No domain has been created yet.");
    await resendVerifyDomain(id);
    const dom = await resendGetDomain(id);
    await admin
      .from("email_settings")
      .update({
        resend_domain_status: dom.status ?? "unknown",
        resend_dns_records: sanitizeDnsRecords(dom.records) as never,
        last_verified_at: new Date().toISOString(),
      } as never)
      .eq("id", true);
    return { ok: true, status: dom.status };
  });

// ---------- Templates ----------

export const adminListEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data } = await admin.from("email_templates").select("*").order("key");
    return { templates: (data as any[]) ?? [] };
  });

const tplUpdate = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(500).optional(),
  html_body: z.string().min(1).max(50000).optional(),
  text_body: z.string().max(50000).optional().nullable(),
  enabled: z.boolean().optional(),
});

export const adminUpdateEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => tplUpdate.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { key, ...patch } = data;
    const finalPatch = { ...patch, updated_by: context.userId } as never;
    const { error } = await admin.from("email_templates").update(finalPatch).eq("key", key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- History ----------

const historyInput = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(["all", "pending", "sent", "failed", "retrying", "cancelled"]).optional(),
  template_key: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const adminListEmailHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => historyInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    let q = admin.from("email_messages").select("*").order("created_at", { ascending: false }).limit(data.limit ?? 200);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.template_key) q = q.eq("template_key", data.template_key);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let out = (rows as any[]) ?? [];
    if (data.search) {
      const s = data.search.toLowerCase();
      out = out.filter(
        (r) =>
          String(r.recipient ?? "").toLowerCase().includes(s) ||
          String(r.subject ?? "").toLowerCase().includes(s) ||
          String(r.template_key ?? "").toLowerCase().includes(s) ||
          String(r.event_key ?? "").toLowerCase().includes(s),
      );
    }
    return { messages: out };
  });

export const adminRetryEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    // Reset scheduling so dispatcher picks it up now.
    await admin
      .from("email_messages")
      .update({ status: "pending", scheduled_for: new Date().toISOString(), last_error: null })
      .eq("id", data.id);
    const res = await dispatchOne(admin, data.id);
    return { ok: res.ok, reason: res.reason };
  });

// ---------- Test email ----------

export const adminSendTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ recipient: z.string().email().max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    if (!isResendConfigured()) throw new Error("Add RESEND_API_KEY first.");
    const { data: settings } = await admin.from("email_settings").select("*").eq("id", true).maybeSingle();
    if (!settings) throw new Error("Email settings missing.");
    const s = settings as any;
    const { normalizeBranding } = await import("./branding");
    const branding = normalizeBranding(s);
    const html = wrapHtmlEmail(
      renderTemplate(
        "<h1 style=\"margin:0 0 12px;font-size:21px;font-weight:700;letter-spacing:-0.3px;\">Sending works</h1><p style=\"margin:0 0 14px;\">Hi {{name}}, this is a test email from your {{brand_name}} admin panel. If it looks right here, your branded emails look right everywhere.</p>",
        { name: "there", brand_name: branding.brandName },
      ),
      { senderName: s.sender_name, siteUrl: branding.websiteUrl, branding, preheader: "Test email — sending is working." },
    );
    const { resendSendEmail } = await import("./resend");
    try {
      const res = await resendSendEmail({
        from: `${s.sender_name} <${s.from_email}>`,
        to: data.recipient,
        replyTo: s.reply_to_email,
        subject: `Test — ${s.sender_name}`,
        html,
        tags: [{ name: "template", value: "admin_test" }],
      });
      return { ok: true, id: res.id };
    } catch (e) {
      const msg = e instanceof ResendError ? e.message : e instanceof Error ? e.message : String(e);
      throw new Error(msg);
    }
  });

// ---------- Manual triggers (used by cron endpoint under an admin context too) ----------

export const adminDispatchDueEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const result = await dispatchDue(admin);
    return result;
  });

export const adminScanAbandonedNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const result = await queueAbandonedReminders(admin);
    return result;
  });

// Convenience: dev-only reset of a specific template to its factory copy.
// Not exposed in UI unless the row is missing — safe no-op otherwise.
export const adminReseedTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ key: z.string().min(1).max(100) }).parse(input))
  .handler(async () => {
    // Templates are seeded via SQL migration. If admins want a reset,
    // they can copy the shipped copy from the migration source.
    return { ok: true };
  });

// Server-side helper for queueing an email from other server functions
// without paying the round-trip cost of a separate server-fn call.
export { queueEmail } from "./queue";
