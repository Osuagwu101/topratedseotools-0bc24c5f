/**
 * Admin — Payment Providers & API keys.
 *
 * Lets a non-technical admin add/edit payment providers, switch the
 * active provider, and test the live connection. Sensitive secret
 * keys stay in encrypted secret storage and are only edited through
 * the secure form; this page never displays them.
 */
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  adminListPaymentProviders,
  adminUpsertPaymentProvider,
  adminSetActiveProvider,
  adminTestProviderConnection,
  adminDeletePaymentProvider,
  type PaymentProviderRow,
} from "@/lib/payment-providers.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  KeyRound,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";

const providersQuery = queryOptions({
  queryKey: ["admin-payment-providers"],
  queryFn: () => adminListPaymentProviders(),
});

export const Route = createFileRoute("/admin/settings/api-keys")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Payment Providers — Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(providersQuery);
  },
  component: PaymentProvidersPage,
});

function PaymentProvidersPage() {
  const { data } = useSuspenseQuery(providersQuery);
  const router = useRouter();
  const upsert = useServerFn(adminUpsertPaymentProvider);
  const setActive = useServerFn(adminSetActiveProvider);
  const test = useServerFn(adminTestProviderConnection);
  const del = useServerFn(adminDeletePaymentProvider);
  const [editing, setEditing] = useState<Partial<PaymentProviderRow> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function save() {
    if (!editing) return;
    setBusy("save");
    try {
      await upsert({
        data: {
          id: editing.id,
          slug: (editing.slug ?? "").toLowerCase().trim(),
          display_name: editing.display_name ?? "",
          environment: (editing.environment ?? "test") as "test" | "live",
          public_key: editing.public_key ?? null,
          webhook_secret_hint: editing.webhook_secret_hint ?? null,
          enabled: editing.enabled ?? false,
          config: Object.fromEntries(
            Object.entries(editing.config ?? {}).map(([k, v]) => [k, v == null ? null : String(v)]),
          ),
        },
      });

      toast.success("Provider saved");
      setEditing(null);
      await router.invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runTest(id: string) {
    setBusy(`test:${id}`);
    try {
      const r = await test({ data: { id } });
      if (r.ok) toast.success(`Connected: ${r.message}`);
      else toast.error(`Connection failed: ${r.message}`);
      await router.invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function activate(id: string) {
    setBusy(`act:${id}`);
    try {
      await setActive({ data: { id } });
      toast.success("Active provider updated");
      await router.invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this provider?")) return;
    setBusy(`del:${id}`);
    try {
      await del({ data: { id } });
      toast.success("Provider removed");
      await router.invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Plug className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Payment Providers</h1>
            <p className="text-sm text-muted-foreground">
              Add, enable, and switch payment providers without deploying code. Secret keys are stored in encrypted secret storage and never shown here.
            </p>
          </div>
          <Button size="sm" onClick={() => setEditing({ slug: "", display_name: "", environment: "test", enabled: false })}>
            <Plus className="mr-1 h-4 w-4" /> Add provider
          </Button>
        </header>

        {editing && (
          <div className="mb-6 rounded-2xl border bg-card p-4 shadow-card">
            <h2 className="text-sm font-semibold">{editing.id ? "Edit provider" : "Add provider"}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Slug</Label>
                <Input
                  value={editing.slug ?? ""}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase() })}
                  placeholder="paystack"
                  disabled={!!editing.id}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Known: paystack, monnify, flutterwave. Slug can't change after creation.
                </p>
              </div>
              <div>
                <Label>Display name</Label>
                <Input
                  value={editing.display_name ?? ""}
                  onChange={(e) => setEditing({ ...editing, display_name: e.target.value })}
                  placeholder="Paystack"
                />
              </div>
              <div>
                <Label>Environment</Label>
                <select
                  value={editing.environment ?? "test"}
                  onChange={(e) => setEditing({ ...editing, environment: e.target.value as "test" | "live" })}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="test">Test</option>
                  <option value="live">Live</option>
                </select>
              </div>
              <div>
                <Label>Public key</Label>
                <Input
                  value={editing.public_key ?? ""}
                  onChange={(e) => setEditing({ ...editing, public_key: e.target.value })}
                  placeholder="pk_live_…"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Webhook secret hint (optional)</Label>
                <Input
                  value={editing.webhook_secret_hint ?? ""}
                  onChange={(e) => setEditing({ ...editing, webhook_secret_hint: e.target.value })}
                  placeholder="Last 4 chars of the webhook signing secret for reference"
                />
              </div>
              {(data.catalog.find((c) => c.slug === editing.slug)?.config_fields ?? []).map((f) => (
                <div key={f.key} className="sm:col-span-2">
                  <Label>
                    {f.label}
                    {f.required ? " *" : " (optional)"}
                  </Label>
                  <Input
                    value={String(editing.config?.[f.key] ?? "")}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        config: { ...(editing.config ?? {}), [f.key]: e.target.value },
                      })
                    }
                    placeholder={f.key === "base_url" ? "https://api.monnify.com" : ""}
                  />
                </div>
              ))}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.enabled ?? false}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                Enabled (available for checkout)
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={save} disabled={busy === "save"}>
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border bg-amber-50/50 p-4 text-sm dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <KeyRound className="mt-0.5 h-4 w-4 text-amber-600" />
            <div>
              <div className="font-medium">Where do secret keys go?</div>
              <p className="mt-1 text-muted-foreground">
                Secret keys (Paystack secret, Monnify secret, Flutterwave secret) are never stored in this page. They live in encrypted secret storage. To add or rotate a secret, open <b>Lovable Cloud → Secrets</b> and add e.g. <code>PAYSTACK_SECRET_KEY</code>. Test the connection here to confirm it is picked up.
              </p>
            </div>
          </div>
        </div>

        <ul className="mt-6 space-y-3">
          {data.providers.map((p) => (
            <li key={p.id} className="rounded-2xl border bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold">{p.display_name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      {p.environment}
                    </span>
                    {p.is_active && (
                      <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                        Active
                      </span>
                    )}
                    {!p.enabled && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">{p.slug}</div>
                  {p.public_key && (
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      Public key: {p.public_key.slice(0, 12)}…
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {p.has_secret_configured ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Secret key configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <XCircle className="h-3.5 w-3.5" /> Secret key missing
                      </span>
                    )}
                    {p.last_test_at && (
                      <span className="text-muted-foreground">
                        · Last test {new Date(p.last_test_at).toLocaleString()} —
                        <span className={p.last_test_status === "ok" ? "text-success" : "text-destructive"}>
                          {" "}{p.last_test_status}
                        </span>
                      </span>
                    )}
                  </div>
                  {p.last_test_message && (
                    <div className="mt-1 text-xs text-muted-foreground">{p.last_test_message}</div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => runTest(p.id)} disabled={busy === `test:${p.id}`}>
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> Test
                  </Button>
                  {!p.is_active && (
                    <Button size="sm" onClick={() => activate(p.id)} disabled={busy === `act:${p.id}`}>
                      Make active
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  {!p.is_active && (
                    <Button size="sm" variant="ghost" onClick={() => remove(p.id)} disabled={busy === `del:${p.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
          {data.providers.length === 0 && (
            <li className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No providers configured yet. Click <b>Add provider</b> to set one up.
            </li>
          )}
        </ul>

        <div className="mt-8 text-xs text-muted-foreground">
          Providers with a green tick have both configuration and a secret key installed. Use <b>Test</b> to verify each provider can reach its API before making it active.
        </div>
      </section>
    </AdminShell>
  );
}
