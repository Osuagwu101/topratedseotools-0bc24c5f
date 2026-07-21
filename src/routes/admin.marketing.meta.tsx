import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  listIntegrations,
  saveMetaSettings,
  testMetaConnection,
} from "@/lib/marketing/integrations.functions";

const q = queryOptions({
  queryKey: ["admin-marketing-integrations"],
  queryFn: () => listIntegrations(),
});

export const Route = createFileRoute("/admin/marketing/meta")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [
      { title: "Facebook Pixel Integration — Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: MetaPage,
});

const TRACKED = [
  "Website and tool page views",
  "Registration",
  "Tool selection",
  "Checkout started",
  "Successful purchase",
  "Subscription started",
  "Contact and WhatsApp clicks",
];

function MetaPage() {
  const { data } = useSuspenseQuery(q);
  const meta = data.integrations.find((i) => i.provider === "meta_pixel");
  const capi = data.integrations.find((i) => i.provider === "meta_capi");
  const save = useServerFn(saveMetaSettings);
  const test = useServerFn(testMetaConnection);
  const qc = useQueryClient();
  const [pixelId, setPixelId] = useState(meta?.public_id ?? capi?.public_id ?? "");
  const [pixelOn, setPixelOn] = useState(!!meta?.enabled);
  const [capiOn, setCapiOn] = useState(!!capi?.enabled);
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    try {
      await save({
        data: {
          pixel_enabled: pixelOn,
          pixel_id: pixelId.trim() || null,
          capi_enabled: capiOn && data.capi_token_configured,
          test_event_code: capi?.test_event_code ?? null,
        },
      });
      toast.success("Pixel settings updated.");
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
      if (r.ok) toast.success("Test event sent.");
      else toast.error(r.error ?? "Test failed");
      qc.invalidateQueries({ queryKey: ["admin-marketing-integrations"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  const connected = !!meta?.public_id;

  return (
    <AdminShell>
      <section className="mx-auto max-w-2xl space-y-6 p-6">
        <header>
          <h1 className="text-xl font-semibold">Facebook Pixel Integration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track how visitors interact with your website and ads.
          </p>
        </header>

        <div className="rounded-2xl border bg-card p-5">
          <h2 className="text-sm font-semibold">What this tracks</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {TRACKED.map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-4 rounded-2xl border bg-card p-5">
          <div>
            <label className="block text-sm font-medium">Pixel ID</label>
            <input
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 1371893314574468"
              inputMode="numeric"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Enter only the numeric Pixel ID from Meta Events Manager.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pixelOn} onChange={(e) => setPixelOn(e.target.checked)} />
            Enable Facebook Pixel
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onSave}
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              Update Pixel
            </button>
            <button
              onClick={onTest}
              disabled={busy || !connected}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
            >
              Send Test Event
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
              <div className="text-xs text-muted-foreground">Last successful event</div>
              <div>
                {meta?.last_event_at || capi?.last_event_at
                  ? new Date((capi?.last_event_at ?? meta?.last_event_at) as string).toLocaleString()
                  : "—"}
              </div>
            </div>
          </div>
        </div>

        <details className="rounded-2xl border bg-card p-5">
          <summary className="cursor-pointer text-sm font-semibold">
            Optional: Conversions API (server-side tracking)
          </summary>
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-muted-foreground">
              Send server events for more accurate purchase measurement.
              Deduplicated with your browser Pixel automatically.
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={capiOn}
                disabled={!data.capi_token_configured}
                onChange={(e) => setCapiOn(e.target.checked)}
              />
              Enable Conversions API
            </label>
            {!data.capi_token_configured ? (
              <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                Server-side tracking is not connected. Facebook Pixel browser tracking will continue to work.
              </p>
            ) : null}
            {capi?.last_error_message ? (
              <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                Last error: {capi.last_error_message}
              </p>
            ) : null}
          </div>
        </details>
      </section>
    </AdminShell>
  );
}
