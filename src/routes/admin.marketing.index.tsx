import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Megaphone } from "lucide-react";
import { listIntegrations, setMarketingPause } from "@/lib/marketing/integrations.functions";

const q = queryOptions({
  queryKey: ["admin-marketing-integrations"],
  queryFn: () => listIntegrations(),
});

export const Route = createFileRoute("/admin/marketing/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Integrations — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: IntegrationsOverview,
});

function IntegrationsOverview() {
  const { data } = useSuspenseQuery(q);
  const setPause = useServerFn(setMarketingPause);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const meta = data.integrations.find((i) => i.provider === "meta_pixel");
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
      <section className="mx-auto max-w-4xl space-y-6 p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Megaphone className="h-5 w-5" /> Integrations
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect your marketing tools to measure ad performance.
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={data.marketing_pause}
              disabled={busy}
              onChange={(e) => togglePause(e.target.checked)}
            />
            Pause all tracking
          </label>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <IntegrationCard
            name="Facebook Pixel + Conversions API"
            connected={!!meta?.public_id}
            enabled={!!meta?.enabled}
            manageHref="/admin/marketing/meta"
          />
          <IntegrationCard
            name="Google Tag Manager"
            connected={!!gtm?.public_id}
            enabled={!!gtm?.enabled}
            manageHref="/admin/marketing/gtm"
          />
        </div>
      </section>
    </AdminShell>
  );
}

function IntegrationCard({
  name,
  connected,
  enabled,
  manageHref,
}: {
  name: string;
  connected: boolean;
  enabled: boolean;
  manageHref: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <h3 className="font-semibold">{name}</h3>
      <div className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          {connected ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground" />
          )}
          <span>{connected ? "Connected" : "Not connected"}</span>
        </div>
        <div className="flex items-center gap-2">
          {enabled ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground" />
          )}
          <span>{enabled ? "Enabled" : "Disabled"}</span>
        </div>
      </div>
      <Link
        to={manageHref}
        className="mt-4 inline-flex rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Manage
      </Link>
    </div>
  );
}