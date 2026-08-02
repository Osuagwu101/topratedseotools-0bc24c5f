/**
 * Admin — Email Settings.
 * Tabs: Setup, Domain, Branding, Templates, History.
 * Every action goes through admin-gated server functions; the Resend API key
 * is never fetched or displayed here.
 */
import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, RefreshCw, Send, Copy, AlertTriangle } from "lucide-react";
import {
  adminGetEmailSettings,
  adminUpdateEmailSettings,
  adminCreateEmailDomain,
  adminRefreshEmailDomain,
  adminVerifyEmailDomain,
  adminListEmailTemplates,
  adminUpdateEmailTemplate,
  adminListEmailHistory,
  adminRetryEmail,
  adminSendTestEmail,
  adminScanAbandonedNow,
  adminDispatchDueEmails,
} from "@/lib/email/settings.functions";
import { BrandingTab } from "@/components/admin/EmailBrandingTab";

export const Route = createFileRoute("/admin/settings/email")({
  head: () => ({ meta: [{ title: "Email settings — Admin" }] }),
  component: () => (
    <AdminShell>
      <EmailSettingsPage />
    </AdminShell>
  ),
});

const EMAIL_TYPES: { key: string; label: string }[] = [
  { key: "payment_success", label: "Payment successful" },
  { key: "payment_failed", label: "Payment failed" },
  { key: "abandoned_checkout", label: "Abandoned checkout reminder" },
  { key: "offline_confirmed", label: "Offline payment confirmation" },
  { key: "private_pending", label: "Private Access — pending fulfilment" },
  { key: "private_fulfilled", label: "Private Access fulfilled" },
  { key: "renewal_success", label: "Renewal successful" },
  { key: "renewal_failed", label: "Renewal failed" },
  { key: "renewal_disabled", label: "Auto-renewal disabled" },
  { key: "customer_invite", label: "Customer invitation" },
  { key: "admin_alert", label: "Admin — Access Health alert" },
  { key: "admin_manual", label: "Admin manual message / announcement" },
];

function EmailSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["email-settings"],
    queryFn: () => adminGetEmailSettings(),
  });

  const s = data?.settings ?? null;
  const resendConfigured = data?.resendConfigured ?? false;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Email settings</h1>
        <p className="text-sm text-muted-foreground">
          Sender details, domain verification, templates, and delivery history — all managed here.
        </p>
      </div>

      {!resendConfigured && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div>
              <div className="font-medium">Resend API key not yet added</div>
              <div className="text-muted-foreground">
                Sending is disabled until <code>RESEND_API_KEY</code> is added as a server secret from
                Workspace &rarr; Secrets. You can still edit settings and templates.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading || !s ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <Tabs defaultValue="setup" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="domain">Domain</TabsTrigger>
            <TabsTrigger value="branding">Branding</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="setup">
            <SetupTab settings={s} resendConfigured={resendConfigured} onSaved={() => qc.invalidateQueries({ queryKey: ["email-settings"] })} />
          </TabsContent>
          <TabsContent value="domain">
            <DomainTab settings={s} onChanged={() => qc.invalidateQueries({ queryKey: ["email-settings"] })} />
          </TabsContent>
          <TabsContent value="branding">
            <BrandingTab settings={s} onSaved={() => qc.invalidateQueries({ queryKey: ["email-settings"] })} />
          </TabsContent>
          <TabsContent value="templates">
            <TemplatesTab />
          </TabsContent>
          <TabsContent value="history">
            <HistoryTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ---------- Setup ----------

function SetupTab({ settings, resendConfigured, onSaved }: { settings: any; resendConfigured: boolean; onSaved: () => void }) {
  const [form, setForm] = useState({
    sender_name: settings.sender_name ?? "",
    from_email: settings.from_email ?? "",
    reply_to_email: settings.reply_to_email ?? "",
    sending_domain: settings.sending_domain ?? "",
    abandoned_delay_hours: settings.abandoned_delay_hours ?? 24,
    production_sending: !!settings.production_sending,
    enabled_types: (settings.enabled_types ?? {}) as Record<string, boolean>,
  });

  const save = useMutation({
    mutationFn: (patch: Partial<typeof form>) => adminUpdateEmailSettings({ data: patch }),
    onSuccess: () => {
      toast.success("Saved");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [testTo, setTestTo] = useState("");
  const sendTest = useMutation({
    mutationFn: () => adminSendTestEmail({ data: { recipient: testTo } }),
    onSuccess: () => toast.success("Test email sent"),
    onError: (e: Error) => toast.error(e.message),
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const a = await adminScanAbandonedNow();
      const b = await adminDispatchDueEmails();
      return { ...a, ...b };
    },
    onSuccess: (r) => toast.success(`Queued ${r.queued ?? 0} · Sent ${r.sent ?? 0}`),
    onError: (e: Error) => toast.error(e.message),
  });

  const checklist = [
    { done: resendConfigured, label: "Add Resend API key (RESEND_API_KEY)" },
    { done: !!form.sending_domain, label: "Enter your sending domain" },
    { done: !!settings.resend_domain_id, label: "Create Resend domain (Domain tab)" },
    { done: settings.resend_domain_status === "verified", label: "Verify DNS records" },
    { done: !!form.from_email && !!form.reply_to_email, label: "Confirm From / Reply-To" },
    { done: !!settings.production_sending, label: "Enable production sending" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Setup checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {checklist.map((c) => (
            <div key={c.label} className="flex items-center gap-2">
              {c.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
              <span className={c.done ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sender details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Field label="Sender name" value={form.sender_name} onChange={(v) => setForm({ ...form, sender_name: v })} />
          <Field label="From email" value={form.from_email} onChange={(v) => setForm({ ...form, from_email: v })} />
          <Field label="Reply-to email" value={form.reply_to_email} onChange={(v) => setForm({ ...form, reply_to_email: v })} />
          <Field label="Sending domain" value={form.sending_domain} onChange={(v) => setForm({ ...form, sending_domain: v })} />
          <div>
            <Label>Abandoned-checkout reminder delay (hours)</Label>
            <Input
              type="number"
              min={0}
              max={720}
              value={form.abandoned_delay_hours}
              onChange={(e) => setForm({ ...form, abandoned_delay_hours: Number(e.target.value) })}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="text-sm">Production sending</Label>
              <p className="text-xs text-muted-foreground">When off, queued emails are cancelled instead of sent.</p>
            </div>
            <Switch checked={form.production_sending} onCheckedChange={(v) => setForm({ ...form, production_sending: v })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Enabled email types</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {EMAIL_TYPES.map((t) => {
            const on = form.enabled_types?.[t.key] !== false;
            return (
              <label key={t.key} className="flex items-center justify-between rounded-md border p-2.5 text-sm">
                <span>{t.label}</span>
                <Switch
                  checked={on}
                  onCheckedChange={(v) => setForm({ ...form, enabled_types: { ...form.enabled_types, [t.key]: v } })}
                />
              </label>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
        <Button variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
          {runNow.isPending ? "Running…" : "Run dispatcher now"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Send test email</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px]">
            <Label>Recipient</Label>
            <Input type="email" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </div>
          <Button onClick={() => sendTest.mutate()} disabled={!testTo || sendTest.isPending}>
            <Send className="mr-1.5 h-4 w-4" /> {sendTest.isPending ? "Sending…" : "Send test"}
          </Button>
          {settings.resend_domain_status !== "verified" && (
            <p className="basis-full text-xs text-amber-600">
              Domain not verified yet — the test will use Resend's default sender rules and may fail. Verify DNS first.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ---------- Domain ----------

function DomainTab({ settings, onChanged }: { settings: any; onChanged: () => void }) {
  const [domain, setDomain] = useState(settings.sending_domain ?? "");
  const create = useMutation({
    mutationFn: () => adminCreateEmailDomain({ data: { domain } }),
    onSuccess: () => { toast.success("Domain created — copy the DNS records into your DNS provider."); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const refresh = useMutation({
    mutationFn: () => adminRefreshEmailDomain(),
    onSuccess: (r) => { toast.success(`Status: ${r.status ?? "unknown"}`); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const verify = useMutation({
    mutationFn: () => adminVerifyEmailDomain(),
    onSuccess: (r) => { toast.success(`Verification requested — status: ${r.status ?? "pending"}`); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const status = settings.resend_domain_status ?? "unconfigured";
  const dns = (settings.resend_dns_records ?? []) as {
    record: string; name: string; type: string; value: string; ttl?: number | string; priority?: number; status?: string;
  }[];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Domain status
            <StatusBadge status={status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <Label>Domain</Label>
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="topratedseotools.com" />
            </div>
            {!settings.resend_domain_id ? (
              <Button onClick={() => create.mutate()} disabled={!domain || create.isPending}>
                {create.isPending ? "Creating…" : "Create in Resend"}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                  <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh status
                </Button>
                <Button onClick={() => verify.mutate()} disabled={verify.isPending}>
                  {verify.isPending ? "Verifying…" : "Verify DNS"}
                </Button>
              </>
            )}
          </div>
          {settings.last_verified_at && (
            <p className="text-xs text-muted-foreground">
              Last checked: {new Date(settings.last_verified_at).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      {dns.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">DNS records to add</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">
              Add these at your DNS provider (Cloudflare, Namecheap, etc.), then click <em>Verify DNS</em>.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-1.5">Type</th><th className="p-1.5">Name</th><th className="p-1.5">Value</th><th className="p-1.5">TTL</th><th className="p-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dns.map((r, i) => (
                    <tr key={i} className="border-b align-top">
                      <td className="p-1.5 font-mono">{r.type}</td>
                      <td className="p-1.5 font-mono break-all">{r.name}
                        <CopyBtn text={r.name} />
                      </td>
                      <td className="p-1.5 font-mono break-all">{r.value}
                        <CopyBtn text={r.value} />
                      </td>
                      <td className="p-1.5">{r.ttl ?? "Auto"}</td>
                      <td className="p-1.5">{r.status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    unconfigured: { label: "Unconfigured", className: "bg-muted text-muted-foreground" },
    pending: { label: "Pending verification", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    not_started: { label: "Not started", className: "bg-muted text-muted-foreground" },
    verified: { label: "Verified", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
    temporary_failure: { label: "Temporary failure", className: "bg-destructive/15 text-destructive" },
  };
  const cur = map[status] ?? { label: status, className: "bg-muted" };
  return <Badge className={cur.className}>{cur.label}</Badge>;
}

function CopyBtn({ text }: { text: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
      }}
      className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
    >
      <Copy className="h-3 w-3" />
    </button>
  );
}

// ---------- Templates ----------

function TemplatesTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["email-templates"], queryFn: () => adminListEmailTemplates() });
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const list = data?.templates ?? [];

  useEffect(() => {
    if (!activeKey && list.length > 0) setActiveKey(list[0].key);
  }, [list, activeKey]);

  const active = list.find((t) => t.key === activeKey) ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <Card className="h-fit">
        <CardContent className="p-2">
          {list.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveKey(t.key)}
              className={`block w-full rounded px-2 py-1.5 text-left text-sm ${activeKey === t.key ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
            >
              {t.name}
              {t.enabled === false && <span className="ml-1 text-xs text-muted-foreground">(off)</span>}
            </button>
          ))}
        </CardContent>
      </Card>
      {active && (
        <TemplateEditor
          template={active}
          onSaved={() => qc.invalidateQueries({ queryKey: ["email-templates"] })}
        />
      )}
    </div>
  );
}

function TemplateEditor({ template, onSaved }: { template: any; onSaved: () => void }) {
  const [subject, setSubject] = useState<string>(template.subject);
  const [html, setHtml] = useState<string>(template.html_body);
  const [enabled, setEnabled] = useState<boolean>(template.enabled !== false);

  useEffect(() => {
    setSubject(template.subject);
    setHtml(template.html_body);
    setEnabled(template.enabled !== false);
  }, [template.key]);

  const save = useMutation({
    mutationFn: () =>
      adminUpdateEmailTemplate({ data: { key: template.key, subject, html_body: html, enabled } }),
    onSuccess: () => { toast.success("Template saved"); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{template.name}</CardTitle>
        <div className="flex items-center gap-2 text-sm">
          <span>Enabled</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Label>HTML body</Label>
          <Textarea rows={16} value={html} onChange={(e) => setHtml(e.target.value)} className="font-mono text-xs" />
          <p className="mt-1 text-xs text-muted-foreground">
            Use <code>&#123;&#123;variable&#125;&#125;</code> placeholders — e.g. <code>&#123;&#123;name&#125;&#125;</code>, <code>&#123;&#123;tool&#125;&#125;</code>, <code>&#123;&#123;amount&#125;&#125;</code>.
          </p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save template"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------- History ----------

function HistoryTab() {
  const [status, setStatus] = useState<"all" | "pending" | "sent" | "failed" | "retrying" | "cancelled">("all");
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const { data, isFetching } = useQuery({
    queryKey: ["email-history", status, search],
    queryFn: () => adminListEmailHistory({ data: { status, search: search || undefined } }),
  });

  const retry = useMutation({
    mutationFn: (id: string) => adminRetryEmail({ data: { id } }),
    onSuccess: (r) => { toast.success(r.ok ? "Retry succeeded" : `Retry: ${r.reason ?? "queued"}`); qc.invalidateQueries({ queryKey: ["email-history"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const messages = data?.messages ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Delivery history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <Label>Search</Label>
            <Input placeholder="Recipient, subject, template…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <Label>Status</Label>
            <select value={status} onChange={(e) => setStatus(e.target.value as never)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="retrying">Retrying</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2">Created</th>
                <th className="p-2">Template</th>
                <th className="p-2">Recipient</th>
                <th className="p-2">Subject</th>
                <th className="p-2">Status</th>
                <th className="p-2">Attempts</th>
                <th className="p-2">Error</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {isFetching && messages.length === 0 && (
                <tr><td colSpan={8} className="p-3 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isFetching && messages.length === 0 && (
                <tr><td colSpan={8} className="p-3 text-center text-muted-foreground">No emails yet.</td></tr>
              )}
              {messages.map((m: any) => (
                <tr key={m.id} className="border-t align-top">
                  <td className="p-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                  <td className="p-2 font-mono">{m.template_key}</td>
                  <td className="p-2">{m.recipient}</td>
                  <td className="p-2 max-w-[240px] truncate" title={m.subject ?? ""}>{m.subject ?? "—"}</td>
                  <td className="p-2"><Badge variant="outline">{m.status}</Badge></td>
                  <td className="p-2">{m.attempts}</td>
                  <td className="p-2 max-w-[220px] truncate text-destructive" title={m.last_error ?? ""}>{m.last_error ?? ""}</td>
                  <td className="p-2 text-right">
                    {(m.status === "failed" || m.status === "retrying" || m.status === "cancelled") && (
                      <Button size="sm" variant="outline" onClick={() => retry.mutate(m.id)}>Retry</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
