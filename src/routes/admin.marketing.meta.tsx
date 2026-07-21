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
      { title: "Meta — Marketing — Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: MetaPage,
});

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
  const [testCode, setTestCode] = useState(capi?.test_event_code ?? "");
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    try {
      await save({
        data: {
          pixel_enabled: pixelOn,
          pixel_id: pixelId || null,
          capi_enabled: capiOn,
          test_event_code: testCode || null,
        },
      });
      toast.success("Meta settings saved.");
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
      if (r.ok) toast.success("Meta CAPI reachable. Test event sent.");
      else toast.error(r.error ?? "Test failed");
      qc.invalidateQueries({ queryKey: ["admin-marketing-integrations"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-3xl space-y-6 p-6">
        <header>
          <h1 className="text-xl font-semibold">Meta Pixel &amp; Conversions API</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your Meta Pixel ID once. It powers both the browser Pixel
            (fires from the visitor) and the server Conversions API (fires from
            our server, deduped by shared event IDs). Access token is read from
            the <code>META_CAPI_ACCESS_TOKEN</code> environment variable.
          </p>
        </header>

        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium">Pixel ID</label>
            <input
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
              placeholder="e.g. 1234567890"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Numeric, 8–20 digits. Find it in Meta Events Manager.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pixelOn} onChange={(e) => setPixelOn(e.target.checked)} />
            Enable browser Pixel (Facebook Pixel snippet)
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={capiOn} onChange={(e) => setCapiOn(e.target.checked)} />
            Enable Conversions API (server events)
          </label>

          <div>
            <label className="block text-sm font-medium">Test event code (optional)</label>
            <input
              value={testCode}
              onChange={(e) => setTestCode(e.target.value)}
              placeholder="TEST123"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            <div className="font-semibold">Environment status</div>
            <div className="mt-1 flex items-center justify-between">
              <span>META_CAPI_ACCESS_TOKEN</span>
              <span className={data.capi_token_configured ? "text-emerald-600" : "text-destructive"}>
                {data.capi_token_configured ? "Set" : "Missing"}
              </span>
            </div>
            {!data.capi_token_configured ? (
              <p className="mt-2 text-muted-foreground">
                Add <code>META_CAPI_ACCESS_TOKEN</code> as an environment
                variable in your hosting settings, then reload this page.
              </p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              Save
            </button>
            <button
              onClick={onTest}
              disabled={busy || !data.capi_token_configured}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
            >
              Send test event
            </button>
          </div>

          {capi?.last_error_message ? (
            <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
              Last error: {capi.last_error_message}
            </div>
          ) : capi?.last_event_at ? (
            <div className="rounded-md bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
              Last event: {capi.last_event_name} · {new Date(capi.last_event_at).toLocaleString()}
            </div>
          ) : null}
        </div>
      </section>
    </AdminShell>
  );
}
