/**
 * Branded copy for every customer-facing email body.
 *
 * These are the *inner* bodies only — the shared branded layout (header, logo,
 * footer) is applied by `wrapHtmlEmail`, so changing Email Branding settings
 * restyles every template below automatically.
 *
 * Kept in code as the factory copy; the live rows live in `email_templates`
 * and remain admin-editable.
 */

export interface TemplateSeed {
  key: string;
  name: string;
  subject: string;
  html_body: string;
}

const H = (text: string) =>
  `<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;font-weight:700;letter-spacing:-0.3px;color:#0f172a;">${text}</h1>`;
const P = (text: string) => `<p style="margin:0 0 14px;">${text}</p>`;
const MUTED = (text: string) => `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">${text}</p>`;
const CTA = (url: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;"><tr><td align="center" bgcolor="{{brand_color}}" style="border-radius:10px;"><a href="${url}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a></td></tr></table>`;

/** Tool name with its icon when one is available. */
const TOOL_LINE = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;"><tr><td style="padding-right:10px;">{{{tool_icon_img}}}</td><td style="font-size:16px;font-weight:700;color:#0f172a;">{{tool_name}}</td></tr></table>`;

const ROW = (label: string, value: string) =>
  `<tr><td style="padding:9px 0;font-size:14px;color:#64748b;">${label}</td><td align="right" style="padding:9px 0;font-size:14px;font-weight:600;color:#0f172a;">${value}</td></tr>`;

const PANEL = (rows: string) =>
  `<table role="presentation" class="l5-panel" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #eef1f7;border-radius:10px;margin:6px 0 4px;"><tr><td style="padding:6px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr></table>`;

export const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    key: "abandoned_checkout",
    name: "Complete your checkout",
    subject: "You were almost done — {{tool_name}} access",
    html_body:
      H("You were almost done getting your access to {{tool_name}}.") +
      P("Hi {{name}}, your checkout is still saved. Pick it back up whenever you're ready — it only takes a moment.") +
      TOOL_LINE +
      PANEL(
        ROW("Tool", "{{tool_name}}") +
          ROW("Plan", "{{price_label}}") +
          ROW("Access type", "{{access_type}}") +
          ROW("Billing period", "{{billing_period}}") +
          ROW("Amount", "{{currency}} {{amount}}"),
      ) +
      CTA("{{resume_url}}", "Resume Checkout") +
      MUTED("Need a hand? Just reply to this email or write to {{support_email}}."),
  },
  {
    key: "payment_success",
    name: "Payment successful",
    subject: "Payment received — {{tool_name}} access is active",
    html_body:
      H("Thank you — your payment went through.") +
      P("Hi {{name}}, your access to {{tool_name}} is active and ready to use.") +
      TOOL_LINE +
      PANEL(
        ROW("Tool", "{{tool_name}}") +
          ROW("Plan", "{{access_type}} — {{billing_period}}") +
          ROW("Amount paid", "{{currency}} {{amount}}") +
          ROW("Payment method", "{{gateway_label}}") +
          ROW("Reference", "{{reference}}") +
          ROW("Access status", "Active"),
      ) +
      CTA("{{dashboard_url}}", "Open your dashboard") +
      MUTED("{{coupon_note}}") +
      MUTED("Questions about this payment? Contact {{support_email}}."),
  },
  {
    key: "payment_failed",
    name: "Payment failed",
    subject: "We couldn't process your payment for {{tool_name}}",
    html_body:
      H("Your payment didn't go through") +
      P("Hi {{name}}, we couldn't complete your payment for {{tool_name}}. Nothing has been charged — you can try again safely.") +
      PANEL(ROW("Tool", "{{tool_name}}") + ROW("Reference", "{{reference}}") + ROW("Reason", "{{reason}}")) +
      CTA("{{retry_url}}", "Try again") +
      MUTED("If this keeps happening, reply to this email or contact {{support_email}}."),
  },
  {
    key: "private_pending",
    name: "Private Access — payment received",
    subject: "Payment received — Private Access setup in progress",
    html_body:
      H("We're preparing your private access") +
      P("Hi {{name}}, thanks for your payment. Your dedicated credentials for {{tool_name}} are being set up now.") +
      TOOL_LINE +
      PANEL(
        ROW("Tool", "{{tool_name}}") +
          ROW("Access type", "Private") +
          ROW("Billing period", "{{billing_period}}") +
          ROW("Amount paid", "{{currency}} {{amount}}") +
          ROW("Ready by", "{{fulfil_by}}"),
      ) +
      CTA("{{dashboard_url}}", "Track in dashboard") +
      MUTED("{{contact_admin_line}}"),
  },
  {
    key: "private_fulfilled",
    name: "Private Access is ready",
    subject: "Your Private Access for {{tool_name}} is ready",
    html_body:
      H("Your access to {{tool_name}} is ready") +
      P("Hi {{name}}, your private credentials are now available in your dashboard.") +
      TOOL_LINE +
      PANEL(ROW("Tool", "{{tool_name}}") + ROW("Access type", "Private") + ROW("Status", "Ready to use")) +
      P("Open your dashboard, choose {{tool_name}} and select <strong>Launch tool</strong> — your login details are shown there. Keep them private; they're issued to your account only.") +
      CTA("{{dashboard_url}}", "Open your dashboard") +
      MUTED("Trouble signing in? Contact {{support_email}} and we'll sort it out quickly."),
  },
  {
    key: "offline_confirmed",
    name: "Offline payment recorded",
    subject: "Access confirmed — {{tool_name}}",
    html_body:
      H("Your access is confirmed") +
      P("Hi {{name}}, we've recorded your payment for {{tool_name}}.") +
      TOOL_LINE +
      PANEL(
        ROW("Tool", "{{tool_name}}") +
          ROW("Access type", "{{access_type}}") +
          ROW("Billing period", "{{billing_period}}") +
          ROW("Amount", "{{currency}} {{amount}}") +
          ROW("Payment method", "{{payment_method}}") +
          ROW("Starts", "{{start_date}}") +
          ROW("Expires", "{{expiry_date}}") +
          ROW("Auto-renew", "{{auto_renew}}"),
      ) +
      CTA("{{dashboard_url}}", "Open your dashboard"),
  },
  {
    key: "renewal_success",
    name: "Subscription renewed",
    subject: "Your {{tool_name}} subscription renewed",
    html_body:
      H("Your subscription renewed") +
      P("Hi {{name}}, your {{tool_name}} subscription renewed successfully — nothing to do on your side.") +
      PANEL(ROW("Tool", "{{tool_name}}") + ROW("Amount", "{{currency}} {{amount}}") + ROW("Next billing", "{{next_billing_date}}")) +
      CTA("{{dashboard_url}}", "Open your dashboard"),
  },
  {
    key: "renewal_failed",
    name: "Renewal failed",
    subject: "Renewal failed for {{tool_name}}",
    html_body:
      H("We couldn't renew your subscription") +
      P("Hi {{name}}, the renewal for {{tool_name}} didn't go through. Update your payment details to keep your access active.") +
      PANEL(ROW("Tool", "{{tool_name}}") + ROW("Amount due", "{{currency}} {{amount}}")) +
      CTA("{{billing_url}}", "Manage billing") +
      MUTED("Need help? Contact {{support_email}}."),
  },
  {
    key: "renewal_disabled",
    name: "Auto-renewal disabled",
    subject: "Auto-renewal turned off for {{tool_name}}",
    html_body:
      H("Auto-renewal is now off") +
      P("Hi {{name}}, auto-renewal for {{tool_name}} has been turned off. Your access continues until {{expiry_date}}.") +
      CTA("{{dashboard_url}}", "Re-enable in dashboard") +
      MUTED("Changed your mind? You can switch auto-renewal back on any time."),
  },
  {
    key: "welcome",
    name: "Welcome email",
    subject: "Welcome to {{brand_name}}",
    html_body:
      H("Welcome to {{brand_name}}") +
      P("Hi {{name}}, thanks for joining. You now have one account for premium SEO, AI and productivity tools — pay only for the ones you need, when you need them.") +
      PANEL(
        ROW("Instant access", "Shared plans activate immediately") +
          ROW("Private access", "Dedicated credentials on request") +
          ROW("Flexible billing", "One-time or monthly"),
      ) +
      CTA("{{dashboard_url}}", "Go to your dashboard") +
      MUTED("Questions before you start? Write to {{support_email}} — a real person replies."),
  },
  {
    key: "password_reset",
    name: "Password reset",
    subject: "Reset your {{brand_name}} password",
    html_body:
      H("Reset your password") +
      P("Hi {{name}}, we received a request to reset the password for your {{brand_name}} account. Use the button below to choose a new one.") +
      CTA("{{reset_url}}", "Reset password") +
      P("This link expires shortly and can be used once. If you didn't request a reset, you can safely ignore this email — your password stays unchanged.") +
      MUTED("For your security we never include passwords in email. Need help? {{support_email}}"),
  },
  {
    key: "customer_invite",
    name: "Your account is ready",
    subject: "Your {{brand_name}} account is ready",
    html_body:
      H("Your account is ready") +
      P("Hi {{name}}, an account has been created for you at {{brand_name}}. Set your password to sign in.") +
      CTA("{{setup_url}}", "Set your password") +
      MUTED("For your security we never include passwords in email."),
  },
  {
    key: "review_request",
    name: "Review request",
    subject: "How is {{tool_name}} working for you?",
    html_body:
      H("How is {{tool_name}} working for you?") +
      P("Hi {{name}}, thanks for your purchase. If you have a moment, a short review helps other customers decide.") +
      TOOL_LINE +
      CTA("{{review_url}}", "Write a review") +
      MUTED("It takes under a minute, and we read every one."),
  },
  {
    key: "admin_manual",
    name: "Admin manual message",
    subject: "{{subject}}",
    html_body: P("Hi {{name}},") + "{{{body_html}}}" + MUTED("— {{brand_name}}"),
  },
];

export const TEMPLATE_SEED_BY_KEY: Record<string, TemplateSeed> = Object.fromEntries(
  TEMPLATE_SEEDS.map((t) => [t.key, t]),
);
