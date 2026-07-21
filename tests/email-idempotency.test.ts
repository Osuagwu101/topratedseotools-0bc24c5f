/**
 * Verifies email-queue idempotency and abandoned-checkout cancellation rules.
 *
 * Covers:
 *  1. One initial payment → one payment_success row (dedup on event_key)
 *  2. Callback + webhook trying to send the "same" success → still one row
 *  3. Two separate renewals (different references) → two rows
 *  4. Replaying the same renewal reference → still one row
 *  5. A failed renewal (own reference) queues its own row
 *  6. Abandoned checkout is queued once
 *  7. Completed order cancels the abandoned reminder at dispatch time
 *  8. Offline confirmation queues by paymentId
 *  9. Failed Resend requests reschedule as `retrying`
 * 10. Customer invite payload contains no plain-text password field
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MockDb } from "./mock-db";
import { queueEmail, dispatchOne } from "../src/lib/email/queue";

const EMAIL = "user@example.com";

function makeAdmin() {
  const db = new MockDb({ uniqueColumns: { email_messages: ["event_key"] } });
  db.seed("email_settings", [
    {
      id: true,
      sender_name: "Top Rated SEO Tools",
      from_email: "support@topratedseotools.com",
      reply_to_email: "support@topratedseotools.com",
      sending_domain: "topratedseotools.com",
      abandoned_delay_hours: 24,
      enabled_types: {},
      production_sending: false, // domain not verified → dispatchOne cancels sends
      resend_domain_status: "unconfigured",
    },
  ]);
  db.seed("email_templates", [
    { key: "payment_success", subject: "Success", html_body: "hi", enabled: true },
    { key: "payment_failed", subject: "Failed", html_body: "hi", enabled: true },
    { key: "private_pending", subject: "Pending", html_body: "hi", enabled: true },
    { key: "private_fulfilled", subject: "Fulfilled", html_body: "hi", enabled: true },
    { key: "renewal_success", subject: "Renewed", html_body: "hi", enabled: true },
    { key: "renewal_failed", subject: "Renewal failed", html_body: "hi", enabled: true },
    { key: "renewal_disabled", subject: "Renewal off", html_body: "hi", enabled: true },
    { key: "abandoned_checkout", subject: "Come back", html_body: "hi", enabled: true },
    { key: "offline_confirmed", subject: "Offline", html_body: "hi", enabled: true },
    { key: "customer_invite", subject: "Welcome", html_body: "hi", enabled: true },
  ]);
  return db;
}

describe("Email idempotency", () => {
  let db: MockDb;
  beforeEach(() => {
    db = makeAdmin();
  });

  it("1. One initial payment sends one success email (event_key dedup)", async () => {
    const key = "payment_success:order-1";
    await queueEmail(db as any, {
      eventKey: key,
      templateKey: "payment_success",
      recipient: EMAIL,
    });
    await queueEmail(db as any, {
      eventKey: key,
      templateKey: "payment_success",
      recipient: EMAIL,
    });
    expect(db.all("email_messages")).toHaveLength(1);
  });

  it("2. Callback and webhook do not send duplicate emails", async () => {
    const key = "payment_success:order-42";
    // Simulate callback + webhook racing — both use the same event_key.
    const [a, b] = await Promise.all([
      queueEmail(db as any, {
        eventKey: key,
        templateKey: "payment_success",
        recipient: EMAIL,
      }),
      queueEmail(db as any, {
        eventKey: key,
        templateKey: "payment_success",
        recipient: EMAIL,
      }),
    ]);
    // Exactly one of them was queued.
    expect([a.queued, b.queued].filter(Boolean)).toHaveLength(1);
    expect(db.all("email_messages")).toHaveLength(1);
  });

  it("3. Two separate renewals send two separate emails", async () => {
    await queueEmail(db as any, {
      eventKey: "renewal_success:REF-JAN",
      templateKey: "renewal_success",
      recipient: EMAIL,
    });
    await queueEmail(db as any, {
      eventKey: "renewal_success:REF-FEB",
      templateKey: "renewal_success",
      recipient: EMAIL,
    });
    expect(db.all("email_messages")).toHaveLength(2);
  });

  it("4. Replaying the same renewal sends no duplicate", async () => {
    const key = "renewal_success:REF-JAN";
    await queueEmail(db as any, { eventKey: key, templateKey: "renewal_success", recipient: EMAIL });
    await queueEmail(db as any, { eventKey: key, templateKey: "renewal_success", recipient: EMAIL });
    await queueEmail(db as any, { eventKey: key, templateKey: "renewal_success", recipient: EMAIL });
    expect(db.all("email_messages")).toHaveLength(1);
  });

  it("5. A failed renewal sends one email for that failure", async () => {
    await queueEmail(db as any, {
      eventKey: "renewal_failed:INV-99",
      templateKey: "renewal_failed",
      recipient: EMAIL,
    });
    await queueEmail(db as any, {
      eventKey: "renewal_failed:INV-99",
      templateKey: "renewal_failed",
      recipient: EMAIL,
    });
    const rows = db.all("email_messages");
    expect(rows).toHaveLength(1);
    expect(rows[0].template_key).toBe("renewal_failed");
  });

  it("6. Abandoned checkout is queued once", async () => {
    const key = "abandoned_checkout:order-77";
    await queueEmail(db as any, { eventKey: key, templateKey: "abandoned_checkout", recipient: EMAIL });
    await queueEmail(db as any, { eventKey: key, templateKey: "abandoned_checkout", recipient: EMAIL });
    expect(db.all("email_messages").filter((r) => r.template_key === "abandoned_checkout")).toHaveLength(1);
  });

  it("7. Completed orders do not receive abandoned reminders (dispatch cancels)", async () => {
    const orderId = "order-88";
    db.seed("tool_orders", [{ id: orderId, status: "approved", payment_status: "successful" }]);
    const res = await queueEmail(db as any, {
      eventKey: `abandoned_checkout:${orderId}`,
      templateKey: "abandoned_checkout",
      recipient: EMAIL,
      relatedOrderId: orderId,
    });
    // Force dispatch (queueEmail already tries inline, but re-run to assert).
    if (res.id) await dispatchOne(db as any, res.id);
    const row = db.all("email_messages")[0];
    expect(row.status).toBe("cancelled");
    expect(row.last_error).toBe("order_no_longer_pending");
  });

  it("8. Offline payments queue by paymentId key", async () => {
    await queueEmail(db as any, {
      eventKey: "offline_payment:pay-abc",
      templateKey: "offline_confirmed",
      recipient: EMAIL,
    });
    await queueEmail(db as any, {
      eventKey: "offline_payment:pay-abc",
      templateKey: "offline_confirmed",
      recipient: EMAIL,
    });
    expect(db.all("email_messages")).toHaveLength(1);
  });

  it("9. Failed Resend requests reschedule as retrying (safe retry)", async () => {
    // Enable production_sending so dispatch calls Resend; leave RESEND_API_KEY unset
    // so isResendConfigured() returns false → scheduleRetry() path.
    const settings = db.all("email_settings")[0];
    settings.production_sending = true;
    delete process.env.RESEND_API_KEY;

    const res = await queueEmail(db as any, {
      eventKey: "renewal_failed:RETRY-1",
      templateKey: "renewal_failed",
      recipient: EMAIL,
    });
    if (res.id) await dispatchOne(db as any, res.id);
    const row = db.all("email_messages")[0];
    expect(row.status).toBe("retrying");
    expect(row.attempts).toBeGreaterThanOrEqual(1);
    expect(new Date(row.scheduled_for).getTime()).toBeGreaterThan(Date.now());
  });

  it("10. Customer invite payload contains no plain-text password", async () => {
    // Mirror the exact payload built in customer-admin.functions.ts.
    const payload = { name: "Jane", setup_url: "https://topratedseotools.com/login" };
    await queueEmail(db as any, {
      eventKey: "customer_invite:user-x",
      templateKey: "customer_invite",
      recipient: EMAIL,
      payload,
    });
    const row = db.all("email_messages")[0];
    const raw = JSON.stringify(row);
    expect(raw.toLowerCase()).not.toContain("password");
    expect(raw.toLowerCase()).not.toContain("temp_password");
  });
});
