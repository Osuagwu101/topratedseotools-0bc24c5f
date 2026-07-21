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

export function wrapHtmlEmail(bodyHtml: string, opts: { logoUrl?: string; senderName: string; siteUrl: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(opts.senderName)}</title></head>
<body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 8px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:20px 28px;border-bottom:1px solid #eef0f4;">
          <div style="font-weight:700;font-size:16px;color:#0f172a;">${escapeHtml(opts.senderName)}</div>
        </td></tr>
        <tr><td style="padding:24px 28px;font-size:14px;line-height:1.55;color:#0f172a;">${bodyHtml}</td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eef0f4;font-size:12px;color:#64748b;">
          You're receiving this email because of activity on your ${escapeHtml(opts.senderName)} account.
          <br/><a href="${escapeHtml(opts.siteUrl)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(opts.siteUrl)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
