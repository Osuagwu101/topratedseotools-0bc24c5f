import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Megaphone } from "lucide-react";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  listIntegrations,
  setMarketingPause,
} from "@/lib/marketing/integrations.functions";

const q = queryOptions({
  queryKey: ["admin-marketing-integrations"],
  queryFn: () => listIntegrations(),
});

export const Route = createFileRoute("/admin/marketing")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [
      { title: "Marketing — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: MarketingOverview,
});

function MarketingOverview() {
  const { data } = useSuspenseQuery(q);
  const setPause = useServerFn(setMarketingPause);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const meta = data.integrations.find((i) => i.provider === "meta_pixel");
  const capi = data.integrations.find((i) => i.provider === "meta_capi");
  const gtm = data.integrations.find((i) => i.provider === "gtm");

  async function togglePause(v: boolean) {
    setBusy(true);
    try {
      await setPause({ data: { pause: v } });
      toast.success(v ? "Marketing paused." : "Marketing resumed.");
      qc.invalidateQueries({ queryKey: ["admin-marketing-integrations"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl space-y-6 p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Megaphone className="h-5 w-5" /> Marketing integrations
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect Meta (Facebook / Instagram) and Google Tag Manager so
              your ads report conversions accurately. Tracking runs only for
              visitors who accept marketing cookies.
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={data.marketing_pause}
              disabled={busy}
              onChange={(e) => togglePause(e.target.checked)}
            />
            Pause all marketing tracking
          </label>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <ProviderCard
            title="Meta Pixel + Conversions API"
            state={{
              enabled: !!(meta?.enabled || capi?.enabled),
              connected: !!capi?.connected,
              publicId: meta?.public_id ?? capi?.public_id ?? null,
              lastEventAt: capi?.last_event_at ?? meta?.last_event_at ?? null,
              lastError: capi?.last_error_message ?? meta?.last_error_message ?? null,
            }}
            tokenReady={data.capi_token_configured}
            manageHref="/admin/marketing/meta"
          />
          <ProviderCard
            title="Google Tag Manager"
            state={{
              enabled: !!gtm?.enabled,
              connected: !!gtm?.connected,
              publicId: gtm?.public_id ?? null,
              lastEventAt: gtm?.last_event_at ?? null,
              lastError: gtm?.last_error_message ?? null,
            }}
            manageHref="/admin/marketing/gtm"
          />
        </div>

        <div className="rounded-2xl border bg-card p-5 text-sm">
          <h2 className="font-semibold">Portability</h2>
          <p className="mt-1 text-muted-foreground">
            The Meta CAPI access token is read from the environment variable
            <code className="mx-1 rounded bg-muted px-1">META_CAPI_ACCESS_TOKEN</code>
            and is not tied to any Lovable-specific runtime. If you export this
            project, set the same variable on your new host and everything
            keeps working. See <code>MIGRATION.md</code> for the full list of
            environment variables.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link to="/admin/marketing/analytics" className="rounded-md border px-3 py-1.5 hover:bg-muted">
            Marketing analytics →
          </Link>
          <Link to="/admin/marketing/events" className="rounded-md border px-3 py-1.5 hover:bg-muted">
            Event history →
          </Link>
        </div>
      </section>
    </AdminShell>
  );
}

function ProviderCard({
  title,
  state,
  tokenReady,
  manageHref,
}: {
  title: string;
  state: {
    enabled: boolean;
    connected: boolean;
    publicId: string | null;
    lastEventAt: string | null;
    lastError: string | null;
  };
  tokenReady?: boolean;
  manageHref: string;
}) {
  const ok = state.enabled && state.connected && (tokenReady ?? true);
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
            ok
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : state.enabled
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          {ok ? "Connected" : state.enabled ? "Needs attention" : "Off"}
        </span>
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Public ID</dt>
          <dd className="font-mono text-xs">{state.publicId ?? "—"}</dd>
        </div>
        {tokenReady !== undefined ? (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Access token</dt>
            <dd>{tokenReady ? "Set" : "Missing"}</dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Last event</dt>
          <dd>{state.lastEventAt ? new Date(state.lastEventAt).toLocaleString() : "—"}</dd>
        </div>
        {state.lastError ? (
          <div className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {state.lastError}
          </div>
        ) : null}
      </dl>
      <Link
        to={manageHref}
        className="mt-4 inline-flex rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Manage
      </Link>
    </div>
  );
}
