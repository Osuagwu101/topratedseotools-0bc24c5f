import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminClearStealthWriterSession,
  adminGetBrowserAuthSettings,
  adminGetStealthWriterSessionStatus,
  adminSaveBrowserAuthSecrets,
  adminSaveStealthWriterSession,
  adminTestBrowserAuthProvider,
  adminUpdateBrowserAuthSettings,
} from "@/lib/browser-auth.functions";
import type { BrowserAuthProvider } from "@/lib/browser-auth.server";

const browserAuthQuery = queryOptions({
  queryKey: ["admin-browser-auth"],
  queryFn: () => adminGetBrowserAuthSettings(),
});

const stealthWriterSessionQuery = queryOptions({
  queryKey: ["admin-stealthwriter-session"],
  queryFn: () => adminGetStealthWriterSessionStatus(),
});

export const Route = createFileRoute("/admin/settings/browser-auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "One-Click Browser Login — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(browserAuthQuery),
      context.queryClient.ensureQueryData(stealthWriterSessionQuery),
    ]);
  },
  component: BrowserAuthAdminPage,
});

function BrowserAuthAdminPage() {
  const { data } = useSuspenseQuery(browserAuthQuery);
  const { data: stealthWriterSession } = useSuspenseQuery(stealthWriterSessionQuery);
  const router = useRouter();
  const updateSettings = useServerFn(adminUpdateBrowserAuthSettings);
  const saveSecrets = useServerFn(adminSaveBrowserAuthSecrets);
  const saveStealthWriterSession = useServerFn(adminSaveStealthWriterSession);
  const clearStealthWriterSession = useServerFn(adminClearStealthWriterSession);
  const testProvider = useServerFn(adminTestBrowserAuthProvider);

  const [enabled, setEnabled] = useState(data.settings.enabled);
  const [provider, setProvider] = useState<BrowserAuthProvider>(data.settings.default_provider);
  const [timeout, setTimeoutMinutes] = useState(data.settings.session_timeout_minutes);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [stealthWriterSessionJson, setStealthWriterSessionJson] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(data.settings.enabled);
    setProvider(data.settings.default_provider);
    setTimeoutMinutes(data.settings.session_timeout_minutes);
  }, [data.settings]);

  const info = (p: BrowserAuthProvider) => data.providers.find((x) => x.provider === p)!;

  async function saveGeneral() {
    setBusy("settings");
    try {
      await updateSettings({ data: { enabled, default_provider: provider, session_timeout_minutes: timeout } });
      toast.success("One-Click Login settings saved");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings");
    } finally { setBusy(null); }
  }

  async function saveProviderSecrets(p: BrowserAuthProvider) {
    const fields = p === "browser_use"
      ? ["BROWSER_USE_API_KEY"]
      : ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_BROWSER_RUN_API_TOKEN"];
    const secrets = Object.fromEntries(fields.filter((f) => draft[f]?.trim()).map((f) => [f, draft[f].trim()]));
    if (!Object.keys(secrets).length) return toast.error("Enter at least one credential first.");
    setBusy(`save:${p}`);
    try {
      const result = await saveSecrets({ data: { provider: p, secrets } });
      if (result.ok) toast.success(result.message);
      else toast.error(`Saved, but connection test failed: ${result.message}`);
      setDraft((d) => { const next = { ...d }; for (const f of fields) delete next[f]; return next; });
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save credentials");
    } finally { setBusy(null); }
  }


  async function saveStealthWriterSessionData() {
    if (!stealthWriterSessionJson.trim()) {
      return toast.error("Paste the session JSON first.");
    }
    setBusy("save:stealthwriter");
    try {
      await saveStealthWriterSession({ data: { session_json: stealthWriterSessionJson } });
      setStealthWriterSessionJson("");
      toast.success("StealthWriter session data saved.");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save session data");
    } finally {
      setBusy(null);
    }
  }

  async function clearStealthWriterSessionData() {
    if (!window.confirm("Remove the stored StealthWriter session data? This does not change writer access because Phase 3 has not been built.")) {
      return;
    }
    setBusy("clear:stealthwriter");
    try {
      await clearStealthWriterSession({ data: undefined });
      toast.success("StealthWriter session data removed.");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove session data");
    } finally {
      setBusy(null);
    }
  }

  async function runTest(p: BrowserAuthProvider) {
    setBusy(`test:${p}`);
    try {
      const result = await testProvider({ data: { provider: p } });
      result.ok ? toast.success(result.message) : toast.error(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection test failed");
    } finally { setBusy(null); }
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow"><Zap className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">One-Click Browser Login</h1>
            <p className="mt-1 text-sm text-muted-foreground">Configure Browser Use and Cloudflare Browser Run. API credentials are write-only and never sent to customers.</p>
          </div>
        </header>

        <div className="rounded-2xl border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> Global behaviour</div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span><b>Enable One-Click Login</b> for tools whose per-tool switch is enabled.</span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default provider</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value as BrowserAuthProvider)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="browser_use">Browser Use</option>
                <option value="cloudflare">Cloudflare Browser Run</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">Leave a tool's provider blank to use this default.</p>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer session timeout</span>
              <Input type="number" min={5} max={60} value={timeout} onChange={(e) => setTimeoutMinutes(Math.max(5, Math.min(60, Number(e.target.value) || 30)))} />
              <p className="mt-1 text-xs text-muted-foreground">5–60 minutes.</p>
            </label>
          </div>
          <Button className="mt-4" onClick={saveGeneral} disabled={busy === "settings" || !data.is_super_admin}>{busy === "settings" ? "Saving…" : "Save settings"}</Button>
          {!data.is_super_admin && <span className="ml-2 text-xs text-muted-foreground">Super Admin only</span>}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <ProviderCard title="Browser Use" description="Private cloud browser with an interactive customer Live View." configured={info("browser_use").configured} missing={info("browser_use").missing_secrets} busy={busy} provider="browser_use" isSuper={data.is_super_admin} onTest={runTest} onSave={saveProviderSecrets}>
            <SecretField label="Browser Use API key" saved={info("browser_use").configured_secrets.includes("BROWSER_USE_API_KEY")} value={draft.BROWSER_USE_API_KEY ?? ""} onChange={(v) => setDraft((d) => ({ ...d, BROWSER_USE_API_KEY: v }))} placeholder="bu_…" />
          </ProviderCard>

          <ProviderCard title="Cloudflare Browser Run" description="Cloudflare remote browser with interactive tab-mode Live View." configured={info("cloudflare").configured} missing={info("cloudflare").missing_secrets} busy={busy} provider="cloudflare" isSuper={data.is_super_admin} onTest={runTest} onSave={saveProviderSecrets}>
            <SecretField label="Cloudflare Account ID" saved={info("cloudflare").configured_secrets.includes("CLOUDFLARE_ACCOUNT_ID")} value={draft.CLOUDFLARE_ACCOUNT_ID ?? ""} onChange={(v) => setDraft((d) => ({ ...d, CLOUDFLARE_ACCOUNT_ID: v }))} placeholder="Account ID" />
            <SecretField label="Browser Run API token" saved={info("cloudflare").configured_secrets.includes("CLOUDFLARE_BROWSER_RUN_API_TOKEN")} value={draft.CLOUDFLARE_BROWSER_RUN_API_TOKEN ?? ""} onChange={(v) => setDraft((d) => ({ ...d, CLOUDFLARE_BROWSER_RUN_API_TOKEN: v }))} placeholder="Browser Rendering Edit token" />
          </ProviderCard>
        </div>

        <div className="mt-5 rounded-2xl border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" /> StealthWriter session data</div>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                Paste the JSON session data from your authorised StealthWriter login. It is write-only: no administrator or writer can view it again after saving.
              </p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${stealthWriterSession.configured ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {stealthWriterSession.configured ? "Saved" : "Not saved"}
            </span>
          </div>
          <textarea
            value={stealthWriterSessionJson}
            onChange={(event) => setStealthWriterSessionJson(event.target.value)}
            placeholder={stealthWriterSession.configured ? "Paste new JSON to replace the saved session" : "Paste StealthWriter session JSON"}
            disabled={!stealthWriterSession.is_super_admin || busy === "save:stealthwriter" || busy === "clear:stealthwriter"}
            className="mt-4 min-h-36 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={saveStealthWriterSessionData} disabled={!stealthWriterSession.is_super_admin || busy === "save:stealthwriter"}>
              <KeyRound className="mr-1 h-3.5 w-3.5" /> {busy === "save:stealthwriter" ? "Saving…" : "Save session data"}
            </Button>
            {stealthWriterSession.configured && (
              <Button size="sm" variant="outline" onClick={clearStealthWriterSessionData} disabled={!stealthWriterSession.is_super_admin || busy === "clear:stealthwriter"}>
                {busy === "clear:stealthwriter" ? "Removing…" : "Remove saved data"}
              </Button>
            )}
            {stealthWriterSession.updated_at && <span className="text-xs text-muted-foreground">Last changed: {new Date(stealthWriterSession.updated_at).toLocaleString()}</span>}
            {!stealthWriterSession.is_super_admin && <span className="text-xs text-muted-foreground">Super Admin only</span>}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Phase 2 only: saving this data does not enable writer access, launch StealthWriter, or change any other tool.
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
          <b className="text-foreground">Customer flow:</b> the server verifies a successful active subscription, loads only that order's assigned account, injects its stored login credentials into the remote browser, submits the login form, and returns only the provider's signed Live View URL. CAPTCHA/2FA can be completed inside that same remote tab after handoff.
        </div>
      </section>
    </AdminShell>
  );
}

function ProviderCard({ title, description, configured, missing, busy, provider, isSuper, onTest, onSave, children }: { title: string; description: string; configured: boolean; missing: string[]; busy: string | null; provider: BrowserAuthProvider; isSuper: boolean; onTest: (p: BrowserAuthProvider) => void; onSave: (p: BrowserAuthProvider) => void; children: React.ReactNode; }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${configured ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{configured ? "Configured" : "Not ready"}</span>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
      {missing.length > 0 && <p className="mt-3 text-xs text-destructive">Missing: {missing.join(", ")}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onSave(provider)} disabled={!isSuper || busy === `save:${provider}`}><KeyRound className="mr-1 h-3.5 w-3.5" /> {busy === `save:${provider}` ? "Saving…" : "Save & validate"}</Button>
        <Button size="sm" variant="outline" onClick={() => onTest(provider)} disabled={busy === `test:${provider}`}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Test connection</Button>
      </div>
    </div>
  );
}

function SecretField({ label, saved, value, onChange, placeholder }: { label: string; saved: boolean; value: string; onChange: (v: string) => void; placeholder: string; }) {
  return (
    <div>
      <Label className="text-xs">{label} {saved ? <span className="text-success">· saved</span> : <span className="text-muted-foreground">· not set</span>}</Label>
      <Input type="password" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder={saved ? "Enter a new value to replace" : placeholder} />
    </div>
  );
}
