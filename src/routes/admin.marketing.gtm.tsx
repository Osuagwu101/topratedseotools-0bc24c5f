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
      { title: "GTM — Marketing — Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: GtmPage,
});

function GtmPage() {
  const { data } = useSuspenseQuery(q);
  const gtm = data.integrations.find((i) => i.provider === "gtm");
  const save = useServerFn(saveGtmSettings);
  const test = useServerFn(testGtmConnection);
  const qc = useQueryClient();
  const [id, setId] = useState(gtm?.public_id ?? "");
  const [on, setOn] = useState(!!gtm?.enabled);
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    try {
      await save({ data: { enabled: on, container_id: id || null } });
      toast.success("GTM settings saved.");
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

  return (
    <AdminShell>
      <section className="mx-auto max-w-3xl space-y-6 p-6">
        <header>
          <h1 className="text-xl font-semibold">Google Tag Manager</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your GTM container ID and we'll push the standard events
            (<code>page_view</code>, <code>view_item</code>,
            <code>begin_checkout</code>, <code>purchase</code>, etc.) to the
            data layer for Google Ads and GA4 to pick up.
          </p>
        </header>

        <div className="space-y-4 rounded-2xl border bg-card p-5">
          <div>
            <label className="block text-sm font-medium">GTM container ID</label>
            <input
              value={id}
              onChange={(e) => setId(e.target.value.toUpperCase())}
              placeholder="GTM-XXXXXXX"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
            Enable GTM
          </label>
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
              disabled={busy}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
            >
              Check container
            </button>
          </div>
          {gtm?.last_error_message ? (
            <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
              Last error: {gtm.last_error_message}
            </div>
          ) : null}
        </div>
      </section>
    </AdminShell>
  );
}
