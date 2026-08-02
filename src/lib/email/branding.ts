/**
 * Email branding — single source of truth for the look of every outgoing email.
 *
 * Client-safe (no server imports) so the Admin -> Email Branding preview panel
 * renders exactly the same HTML the dispatcher sends. Presentation only: this
 * module never touches triggers, the queue, or delivery.
 */

export interface EmailBranding {
  brandName: string;
  brandColor: string;
  logoUrl: string;
  footerCompany: string;
  footerMessage: string;
  supportEmail: string;
  websiteUrl: string;
}

export const DEFAULT_EMAIL_BRANDING: EmailBranding = {
  brandName: "Top Rated SEO Tools",
  brandColor: "#1e4e8c",
  logoUrl: "https://topratedseotools.com/__l5e/assets-v1/147b0b3f-0398-4309-87ad-9624e5934639/top-rated-seo-tools-logo.png",
  footerCompany: "Top Rated SEO Tools",
  footerMessage: "Premium SEO, AI and productivity tools.",
  supportEmail: "support@topratedseotools.com",
  websiteUrl: "https://topratedseotools.com",
};

/** Accepts an `email_settings` row (snake_case) and fills in any gaps. */
export function normalizeBranding(row: Record<string, unknown> | null | undefined): EmailBranding {
  const r = (row ?? {}) as Record<string, unknown>;
  const str = (k: string, fallback: string) => {
    const v = r[k];
    return typeof v === "string" && v.trim() ? v.trim() : fallback;
  };
  return {
    brandName: str("brand_name", str("sender_name", DEFAULT_EMAIL_BRANDING.brandName)),
    brandColor: sanitizeColor(str("brand_color", DEFAULT_EMAIL_BRANDING.brandColor)),
    logoUrl: absoluteUrl(str("brand_logo_url", DEFAULT_EMAIL_BRANDING.logoUrl), str("footer_website_url", DEFAULT_EMAIL_BRANDING.websiteUrl)),
    footerCompany: str("footer_company", DEFAULT_EMAIL_BRANDING.footerCompany),
    footerMessage: str("footer_message", DEFAULT_EMAIL_BRANDING.footerMessage),
    supportEmail: str("footer_support_email", DEFAULT_EMAIL_BRANDING.supportEmail),
    websiteUrl: str("footer_website_url", DEFAULT_EMAIL_BRANDING.websiteUrl),
  };
}

/** Only `#rgb`/`#rrggbb` is allowed — anything else falls back to the default. */
export function sanitizeColor(value: string): string {
  const v = (value ?? "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : DEFAULT_EMAIL_BRANDING.brandColor;
}

/** Email clients need absolute image URLs — relative asset paths get prefixed. */
export function absoluteUrl(url: string, base: string): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const b = (base || DEFAULT_EMAIL_BRANDING.websiteUrl).replace(/\/+$/, "");
  return `${b}/${u.replace(/^\/+/, "")}`;
}

export function escapeHtmlValue(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Rounded, table-based CTA button (bulletproof in Outlook / mobile Gmail). */
export function emailButton(url: string, label: string, color = DEFAULT_EMAIL_BRANDING.brandColor): string {
  const c = sanitizeColor(color);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center" bgcolor="${c}" style="border-radius:10px;">
<a href="${escapeHtmlValue(url)}" style="display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtmlValue(label)}</a>
</td></tr></table>`;
}

/** Two-column detail table used by receipts / access emails. */
export function emailDetails(rows: [string, string][]): string {
  const body = rows
    .filter(([, v]) => String(v ?? "").trim() !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:9px 0;font-size:14px;color:#64748b;width:44%;">${escapeHtmlValue(k)}</td><td style="padding:9px 0;font-size:14px;color:#0f172a;font-weight:600;" align="right">${escapeHtmlValue(v)}</td></tr>`,
    )
    .join("");
  if (!body) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#f8fafc;border:1px solid #eef0f4;border-radius:10px;padding:6px 14px;margin:8px 0 4px;"><tr><td style="padding:4px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table></td></tr></table>`;
}

export interface BrandedEmailOptions {
  branding: EmailBranding;
  bodyHtml: string;
  /** Inbox preview line. Falls back to the brand name. */
  preheader?: string;
  title?: string;
}

/**
 * Wraps body HTML in the shared branded layout: logo + brand header, content
 * card, configurable footer. Table-based, mobile-first, dark-mode aware.
 */
export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  const b = opts.branding;
  const color = sanitizeColor(b.brandColor);
  const title = escapeHtmlValue(opts.title || b.brandName);
  const preheader = escapeHtmlValue(opts.preheader || b.footerMessage || b.brandName);
  const logo = b.logoUrl
    ? `<img src="${escapeHtmlValue(b.logoUrl)}" width="36" height="36" alt="" style="display:block;border:0;border-radius:8px;width:36px;height:36px;object-fit:contain;" />`
    : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<meta name="supported-color-schemes" content="light dark"/>
<title>${title}</title>
<style>
  @media only screen and (max-width:600px){
    .l5-card{border-radius:0 !important;}
    .l5-pad{padding-left:20px !important;padding-right:20px !important;}
    .l5-shell{padding:12px 0 !important;}
  }
  @media (prefers-color-scheme: dark){
    .l5-bg{background:#0b1020 !important;}
    .l5-card{background:#141a2e !important;border-color:#243049 !important;}
    .l5-text,.l5-text *{color:#e8ecf7 !important;}
    .l5-muted,.l5-muted *{color:#9aa5bd !important;}
    .l5-panel{background:#1b2340 !important;border-color:#2a3552 !important;}
  }
</style>
</head>
<body class="l5-bg" style="margin:0;padding:0;background:#f4f6fb;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#f4f6fb;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<table role="presentation" class="l5-bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fb;">
  <tr><td align="center" class="l5-shell" style="padding:28px 10px;">
    <table role="presentation" class="l5-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #eaeef6;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="height:4px;background:${color};line-height:4px;font-size:0;">&nbsp;</td></tr>
      <tr><td class="l5-pad" style="padding:22px 32px 6px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          ${logo ? `<td style="padding-right:10px;">${logo}</td>` : ""}
          <td class="l5-text" style="font-size:17px;font-weight:700;color:#0f172a;letter-spacing:-0.2px;">${escapeHtmlValue(b.brandName)}</td>
        </tr></table>
      </td></tr>
      <tr><td class="l5-pad l5-text" style="padding:14px 32px 26px;font-size:15px;line-height:1.6;color:#0f172a;">
        ${opts.bodyHtml}
      </td></tr>
      <tr><td class="l5-pad" style="padding:0 32px;"><div style="height:1px;background:#eef1f7;line-height:1px;font-size:0;">&nbsp;</div></td></tr>
      <tr><td class="l5-pad l5-muted" style="padding:20px 32px 28px;font-size:12px;line-height:1.6;color:#64748b;">
        <div style="font-weight:600;color:#475569;">${escapeHtmlValue(b.footerCompany)}</div>
        ${b.footerMessage ? `<div>${escapeHtmlValue(b.footerMessage)}</div>` : ""}
        <div style="margin-top:8px;">
          ${b.supportEmail ? `<a href="mailto:${escapeHtmlValue(b.supportEmail)}" style="color:${color};text-decoration:none;">${escapeHtmlValue(b.supportEmail)}</a>` : ""}
          ${b.supportEmail && b.websiteUrl ? ` &nbsp;·&nbsp; ` : ""}
          ${b.websiteUrl ? `<a href="${escapeHtmlValue(b.websiteUrl)}" style="color:${color};text-decoration:none;">${escapeHtmlValue(b.websiteUrl.replace(/^https?:\/\//, ""))}</a>` : ""}
        </div>
        <div style="margin-top:10px;">You're receiving this email because of activity on your ${escapeHtmlValue(b.brandName)} account.</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
