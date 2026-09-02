/**
 * Admin — Email Branding.
 *
 * Presentation only: controls the shared branded layout (logo, brand name,
 * colour, footer) used by every outgoing customer email. Triggers, queueing and
 * delivery are untouched by anything on this screen.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Trash2 } from "lucide-react";
import { adminUpdateEmailSettings } from "@/lib/email/settings.functions";
import { uploadEmailLogo } from "@/lib/tool-images.functions";
import { resizeEmailLogo } from "@/lib/tool-image-resize";
import { DEFAULT_EMAIL_BRANDING, normalizeBranding, sanitizeColor } from "@/lib/email/branding";
import { renderTemplate, wrapHtmlEmail } from "@/lib/email/templates";
import { TEMPLATE_SEED_BY_KEY } from "@/lib/email/template-seeds";

const PREVIEW_KEYS = [
  { key: "payment_success", label: "Payment successful" },
  { key: "private_fulfilled", label: "Tool access ready" },
  { key: "abandoned_checkout", label: "Checkout reminder" },
  { key: "welcome", label: "Welcome" },
  { key: "password_reset", label: "Password reset" },
] as const;

const SAMPLE_VARS: Record<string, string> = {
  name: "Ada",
  tool_name: "Semrush Guru",
  tool_icon_img: "",
  price_label: "Shared access — monthly",
  access_type: "Shared",
  billing_period: "Monthly",
  currency: "NGN",
  amount: "12,000",
  gateway_label: "Paystack",
  reference: "TRST-9F42A7",
  coupon_note: "Coupon WELCOME10 saved you NGN 1,200.",
  fulfil_by: "Today, 6:00 PM",
  contact_admin_line: "Need it sooner? Message us on WhatsApp.",
  resume_url: "https://topratedseotools.com/checkout",
  dashboard_url: "https://topratedseotools.com/dashboard",
  reset_url: "https://topratedseotools.com/reset",
  review_url: "https://topratedseotools.com/reviews",
  retry_url: "https://topratedseotools.com/checkout",
  billing_url: "https://topratedseotools.com/billing",
  setup_url: "https://topratedseotools.com/set-password",
  expiry_date: "12 Jun 2026",
  next_billing_date: "12 Jun 2026",
  start_date: "12 May 2026",
  auto_renew: "On",
  payment_method: "Bank transfer",
  reason: "Card declined by issuer",
  subject: "Scheduled maintenance",
  body_html: "<p>We will be performing brief maintenance this weekend.</p>",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function BrandingTab({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const initial = normalizeBranding(settings);
  const [form, setForm] = useState({
    brand_name: initial.brandName,
    brand_color: initial.brandColor,
    brand_logo_url: settings?.brand_logo_url ?? "",
    footer_company: initial.footerCompany,
    footer_support_email: initial.supportEmail,
    footer_website_url: initial.websiteUrl,
    footer_message: initial.footerMessage,
  });
  const [previewKey, setPreviewKey] = useState<string>("payment_success");
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: () =>
      adminUpdateEmailSettings({ data: { ...form, brand_color: sanitizeColor(form.brand_color) } }),
    onSuccess: () => {
      toast.success("Branding saved — applies to every email");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const resized = await resizeEmailLogo(file);
      return uploadEmailLogo({
        data: { base64: resized.base64, contentType: resized.contentType },
      });
    },
    onSuccess: (r) => {
      setForm((f) => ({ ...f, brand_logo_url: r.url }));
      toast.success("Logo optimised and uploaded — remember to save");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const previewHtml = useMemo(() => {
    const seed = TEMPLATE_SEED_BY_KEY[previewKey] ?? TEMPLATE_SEED_BY_KEY["payment_success"];
    const branding = normalizeBranding({ ...settings, ...form });
    const vars = {
      ...SAMPLE_VARS,
      brand_name: branding.brandName,
      brand_color: branding.brandColor,
      support_email: branding.supportEmail,
    };
    const body = renderTemplate(seed?.html_body ?? "", vars);
    return wrapHtmlEmail(body, {
      senderName: branding.brandName,
      siteUrl: branding.websiteUrl,
      logoUrl: branding.logoUrl,
      branding,
      preheader: renderTemplate(seed?.subject ?? "", vars),
    });
  }, [previewKey, form, settings]);

  const subject = useMemo(() => {
    const seed = TEMPLATE_SEED_BY_KEY[previewKey];
    return renderTemplate(seed?.subject ?? "", { ...SAMPLE_VARS, brand_name: form.brand_name });
  }, [previewKey, form.brand_name]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Brand identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Brand name</Label>
              <Input
                value={form.brand_name}
                onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Shown in the email header and footer.
              </p>
            </div>
            <div>
              <Label>Primary colour</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  className="h-10 w-14 p-1"
                  value={sanitizeColor(form.brand_color)}
                  onChange={(e) => setForm({ ...form, brand_color: e.target.value })}
                />
                <Input
                  value={form.brand_color}
                  onChange={(e) => setForm({ ...form, brand_color: e.target.value })}
                  placeholder="#1e4e8c"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Used for buttons, links and the header accent.
              </p>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <Label>Header logo</Label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                {form.brand_logo_url ? (
                  <img
                    src={form.brand_logo_url}
                    alt="Email logo preview"
                    className="max-h-14 max-w-36 object-contain"
                  />
                ) : (
                  <span className="px-2 text-center text-xs text-muted-foreground">
                    No logo — brand name is used
                  </span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={upload.isPending}
              >
                <Upload className="mr-2 h-4 w-4" />
                {upload.isPending ? "Optimising…" : "Upload logo"}
              </Button>
              {form.brand_logo_url && (
                <Button variant="ghost" onClick={() => setForm({ ...form, brand_logo_url: "" })}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Automatically fitted to 480×160 and re-encoded as PNG so it stays sharp and loads in
              every email client.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Footer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Company / legal name</Label>
            <Input
              value={form.footer_company}
              onChange={(e) => setForm({ ...form, footer_company: e.target.value })}
            />
          </div>
          <div>
            <Label>Support email</Label>
            <Input
              value={form.footer_support_email}
              onChange={(e) => setForm({ ...form, footer_support_email: e.target.value })}
            />
          </div>
          <div>
            <Label>Website URL</Label>
            <Input
              value={form.footer_website_url}
              onChange={(e) => setForm({ ...form, footer_website_url: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Footer message</Label>
            <Textarea
              rows={2}
              value={form.footer_message}
              onChange={(e) => setForm({ ...form, footer_message: e.target.value })}
              placeholder={DEFAULT_EMAIL_BRANDING.footerMessage}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save branding"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Applies to every customer email — no template edits needed.
        </span>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Live preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {PREVIEW_KEYS.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={previewKey === p.key ? "default" : "outline"}
                onClick={() => setPreviewKey(p.key)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            Subject: <span className="font-medium text-foreground">{subject}</span>
          </div>
          <div className="overflow-hidden rounded-md border">
            <iframe
              title="Email preview"
              srcDoc={previewHtml}
              className="h-[620px] w-full bg-white"
              sandbox=""
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
