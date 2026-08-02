import { DEFAULT_EMAIL_BRANDING, renderBrandedEmail, type EmailBranding } from "./branding";
/**

 * Simple {{variable}} placeholder renderer. Escapes HTML in variables to
 * prevent injection unless the key is explicitly marked raw with {{{var}}}.
 */
export type TemplateVars = Record<string, string | number | null | undefined>;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, key) => String(vars[key as string] ?? ""))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => escapeHtml(String(vars[key as string] ?? "")));
}

/**
 * Wraps an email body in the shared branded layout. Branding comes from the
 * admin Email Branding settings; omitted fields fall back to defaults.
 */
export function wrapHtmlEmail(
  bodyHtml: string,
  opts: {
    logoUrl?: string;
    senderName: string;
    siteUrl: string;
    branding?: Partial<EmailBranding> | null;
    preheader?: string;
  },
): string {
  const branding: EmailBranding = {
    ...DEFAULT_EMAIL_BRANDING,
    brandName: opts.senderName || DEFAULT_EMAIL_BRANDING.brandName,
    websiteUrl: opts.siteUrl || DEFAULT_EMAIL_BRANDING.websiteUrl,
    logoUrl: opts.logoUrl ?? DEFAULT_EMAIL_BRANDING.logoUrl,
    ...(opts.branding ?? {}),
  };
  return renderBrandedEmail({ branding, bodyHtml, preheader: opts.preheader });
}

