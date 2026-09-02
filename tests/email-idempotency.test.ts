/**
 * Email idempotency + retry + safety tests.
 * Run: bun tests/email-idempotency.test.ts
 *
 * No live Resend calls. No real DB. Uses the same in-memory mock as the
 * Paystack tests, seeded with an `email_settings` row so `queueEmail`
 * inserts, then verifies the unique event_key dedup behaviour.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MockDb } from "./mock-db";
import { queueEmail, dispatchOne } from "../src/lib/email/queue";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: any, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(msg);
    console.error("FAIL:", msg);
  }
}

const EMAIL = "user@example.com";

function makeDb(): MockDb {
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
      production_sending: false, // domain not verified → dispatchOne cancels
      resend_domain_status: "unconfigured",
    },
  ]);
  db.seed(
    "email_templates",
    [
      "payment_success",
      "payment_failed",
      "private_pending",
      "private_fulfilled",
      "renewal_success",
      "renewal_failed",
      "renewal_disabled",
      "abandoned_checkout",
      "offline_confirmed",
      "customer_invite",
    ].map((key) => ({ key, subject: key, html_body: "<p>{{name}}</p>", enabled: true })),
  );
  return db;
}

async function main() {
  // 1. One initial payment sends one success email.
  {
    const db = makeDb();
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
    assert(
      db.all("email_messages").length === 1,
      "T1: single payment_success row for same event_key",
    );
  }

  // 2. Callback + webhook race — still one row.
  {
    const db = makeDb();
    const key = "payment_success:order-42";
    const [a, b] = await Promise.all([
      queueEmail(db as any, { eventKey: key, templateKey: "payment_success", recipient: EMAIL }),
      queueEmail(db as any, { eventKey: key, templateKey: "payment_success", recipient: EMAIL }),
    ]);
    const queuedCount = [a.queued, b.queued].filter(Boolean).length;
    assert(queuedCount === 1, `T2: exactly one queue insert on race, got ${queuedCount}`);
    assert(db.all("email_messages").length === 1, "T2: one email_messages row after race");
  }

  // 3. Two separate renewals → two rows.
  {
    const db = makeDb();
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
    assert(db.all("email_messages").length === 2, "T3: two renewals → two rows");
  }

  // 4. Replay same renewal → no duplicate.
  {
    const db = makeDb();
    const key = "renewal_success:REF-JAN";
    for (let i = 0; i < 3; i++) {
      await queueEmail(db as any, {
        eventKey: key,
        templateKey: "renewal_success",
        recipient: EMAIL,
      });
    }
    assert(db.all("email_messages").length === 1, "T4: replay same renewal → one row");
  }

  // 5. A failed renewal sends one email for that failure.
  {
    const db = makeDb();
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
    assert(
      rows.length === 1 && rows[0].template_key === "renewal_failed",
      "T5: renewal_failed dedup by invoice code",
    );
  }

  // 6. Abandoned checkout queued once.
  {
    const db = makeDb();
    const key = "abandoned_checkout:order-77";
    await queueEmail(db as any, {
      eventKey: key,
      templateKey: "abandoned_checkout",
      recipient: EMAIL,
    });
    await queueEmail(db as any, {
      eventKey: key,
      templateKey: "abandoned_checkout",
      recipient: EMAIL,
    });
    assert(db.all("email_messages").length === 1, "T6: abandoned checkout queued once");
  }

  // 7. Completed order cancels the abandoned reminder at dispatch.
  {
    const db = makeDb();
    const orderId = "order-88";
    db.seed("tool_orders", [{ id: orderId, status: "approved", payment_status: "successful" }]);
    const res = await queueEmail(db as any, {
      eventKey: `abandoned_checkout:${orderId}`,
      templateKey: "abandoned_checkout",
      recipient: EMAIL,
      relatedOrderId: orderId,
    });
    if (res.id) await dispatchOne(db as any, res.id);
    const row = db.all("email_messages")[0];
    assert(
      row.status === "cancelled" && row.last_error === "order_no_longer_pending",
      `T7: completed order cancels reminder (status=${row.status}, err=${row.last_error})`,
    );
  }

  // 8. Offline payments keyed by paymentId.
  {
    const db = makeDb();
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
    assert(db.all("email_messages").length === 1, "T8: offline_payment dedup by paymentId");
  }

  // 9. Failed Resend → retrying (safe automatic retry).
  {
    const db = makeDb();
    // Turn on production_sending; leave RESEND_API_KEY unset so isResendConfigured()
    // returns false and dispatchOne takes the scheduleRetry() path.
    db.all("email_settings")[0].production_sending = true;
    delete process.env.RESEND_API_KEY;
    const res = await queueEmail(db as any, {
      eventKey: "renewal_failed:RETRY-1",
      templateKey: "renewal_failed",
      recipient: EMAIL,
    });
    if (res.id) await dispatchOne(db as any, res.id);
    const row = db.all("email_messages")[0];
    assert(row.status === "retrying", `T9: failed send scheduled retry (status=${row.status})`);
    assert((row.attempts ?? 0) >= 1, "T9: attempts incremented");
    assert(
      new Date(row.scheduled_for).getTime() > Date.now(),
      "T9: scheduled_for pushed into the future",
    );
  }

  // 10. Customer invite payload has no plain-text password.
  {
    const db = makeDb();
    // Mirror the exact payload built in customer-admin.functions.ts.
    const payload = { name: "Jane", setup_url: "https://topratedseotools.com/login" };
    await queueEmail(db as any, {
      eventKey: "customer_invite:user-x",
      templateKey: "customer_invite",
      recipient: EMAIL,
      payload,
    });
    const row = db.all("email_messages")[0];
    const raw = JSON.stringify(row).toLowerCase();
    assert(!raw.includes("password"), "T10: invite row has no 'password' field");
    assert(!raw.includes("temp_password"), "T10: invite row has no 'temp_password'");
  }

  // 11. API keys not exposed to browser (source check).
  {
    const fs = await import("fs");
    const path = await import("path");
    const bad: string[] = [];
    const scan = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          if (name === "node_modules" || name.startsWith(".")) continue;
          scan(p);
        } else if (/\.(tsx?|jsx?)$/.test(name)) {
          const body = fs.readFileSync(p, "utf8");
          if (/import\.meta\.env\.[A-Z0-9_]*RESEND[A-Z0-9_]*/i.test(body)) bad.push(p);
          if (/VITE_RESEND/i.test(body)) bad.push(p);
        }
      }
    };
    scan("src");
    assert(
      bad.length === 0,
      `T11: no browser bundle references RESEND (offenders: ${bad.join(", ")})`,
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("Failures:\n" + failures.map((f) => "  - " + f).join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
