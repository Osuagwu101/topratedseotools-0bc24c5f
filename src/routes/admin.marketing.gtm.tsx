import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  listIntegrations,
  saveGtmSettings,
  saveGoogleAdsSettings,
  testGtmConnection,
} from "@/lib/marketing/integrations.functions";

const q = queryOptions({
  queryKey: ["admin-marketing-integrations"],
  queryFn: () => listIntegrations(),
});

export const Route = createFileRoute("/admin/marketing/gtm")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [
      { title: "Google Tag Manager Integration — Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: GtmPage,
});

const TRACKED = [
  "Page views and traffic sources",
  "Tool views",
  "Registrations",
  "Checkout activity",
  "Successful purchases",
  "Advertising conversions",
];

function GtmPage() {
  const { data } = useSuspenseQuery(q);
  const gtm = data.integrations.find((i) => i.provider === "gtm");
  const save = useServerFn(saveGtmSettings);
  const test = useServerFn(testGtmConnection);
  const ads = data.integrations.find((i) => i.provider === "google_ads");
  const saveAds = useServerFn(saveGoogleAdsSettings);
  const qc = useQueryClient();
  const [adsId, setAdsId] = useState(ads?.public_id ?? "");
  const [adsLabel, setAdsLabel] = useState(
    typeof ads?.config?.purchase_label === "string" ? ads.config.purchase_label : "",
  );
  const [adsOn, setAdsOn] = useState(!!ads?.enabled);
  const [id, setId] = useState(gtm?.public_id ?? "");
  const [on, setOn] = useState(!!gtm?.enabled);
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    try {
      await save({ data: { enabled: on, container_id: id.trim() || null } });
      toast.success("GTM settings updated.");
      window.dispatchEvent(new CustomEvent("marketing-config-updated"));
      qc.invalidateQueries({ queryKey: ["admin-marketing-integrations"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveAds() {
    setBusy(true);
    try {
      await saveAds({
        data: {
          enabled: adsOn,
          ads_id: adsId.trim() || null,
          purchase_label: adsLabel.trim() || null,
        },
      });
      toast.success("Google Ads settings updated.");
      window.dispatchEvent(new CustomEvent("marketing-config-updated"));
      qc.invalidateQueries({ queryKey: ["admin-marketing-integrations"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setBusy(true);
    try {
      const r = await test();
      if (r.ok) toast.success("GTM container reachable.");
      else toast.error(r.error ?? "Test failed");
      qc.invalidateQueries({ queryKey: ["admin-marketing-integrations"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  const connected = !!gtm?.public_id;

  return (
    <AdminShell>
      <section className="mx-auto max-w-2xl space-y-6 p-6">
        <header>
          <h1 className="text-xl font-semibold">Google Tag Manager Integration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Route your website events to Google Ads, GA4 and other tags.
          </p>
        </header>

        <div className="rounded-2xl border bg-card p-5">
          <h2 className="text-sm font-semibold">What this can track</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {TRACKED.map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-4 rounded-2xl border bg-card p-5">
          <div>
            <label className="block text-sm font-medium">GTM Container ID</label>
            <input
              value={id}
              onChange={(e) => setId(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
              placeholder="GTM-XXXXXXX"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Enter only the container ID (e.g. GTM-XXXXXXX). Do not paste the full script.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
            Enable Google Tag Manager
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onSave}
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              Update GTM
            </button>
            <button
              onClick={onTest}
              disabled={busy || !connected}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
            >
              Test Integration
            </button>
          </div>

          <div className="grid gap-2 border-t pt-4 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <div className={connected ? "text-emerald-600" : "text-muted-foreground"}>
                {connected ? "Connected" : "Not connected"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Last detected event</div>
              <div>{gtm?.last_event_at ? new Date(gtm.last_event_at).toLocaleString() : "—"}</div>
            </div>
          </div>

          {gtm?.last_error_message ? (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              Last error: {gtm.last_error_message}
            </div>
          ) : null}
        </div>

        <div className="space-y-4 rounded-2xl border bg-card p-5">
          <div>
            <h2 className="text-sm font-semibold">Google Ads purchase conversion</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sends each confirmed purchase (with order value and order ID) straight to Google
              Ads, only after the visitor accepts Marketing cookies. Leave this off if your GTM
              container already fires a Google Ads conversion tag, or sales will be counted twice.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium">Conversion ID</label>
            <input
              value={adsId}
              onChange={(e) => setAdsId(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
              placeholder="AW-123456789"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Purchase conversion label</label>
            <input
              value={adsLabel}
              onChange={(e) => setAdsLabel(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))}
              placeholder="AbC-D_efG-h12345"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              In Google Ads, create a Purchase conversion (website), choose "Use Google tag" and
              copy the ID and label from <code>send_to: 'AW-…/label'</code>.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={adsOn} onChange={(e) => setAdsOn(e.target.checked)} />
            Enable Google Ads purchase conversion
          </label>
          <button
            onClick={onSaveAds}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            Update Google Ads
          </button>
        </div>
      </section>
    </AdminShell>
  );
}
