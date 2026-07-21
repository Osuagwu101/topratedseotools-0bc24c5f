import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getMarketingAnalytics } from "@/lib/marketing/analytics.functions";

const q = queryOptions({
  queryKey: ["admin-marketing-analytics"],
  queryFn: () => getMarketingAnalytics({ data: {} }),
});

export const Route = createFileRoute("/admin/marketing/analytics")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [
      { title: "Marketing analytics — Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { data } = useSuspenseQuery(q);
  return (
    <AdminShell>
      <section className="mx-auto max-w-6xl space-y-6 p-6">
        <header>
          <h1 className="text-xl font-semibold">Marketing analytics</h1>
          <p className="text-sm text-muted-foreground">
            Last 30 days, based on verified successful payments and captured
            campaign attribution.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat title="Revenue" value={`₦${data.totalRevenue.toLocaleString()}`} />
          <Stat title="Conversions" value={String(data.totalConversions)} />
          <Stat title="Checkout starts" value={String(data.checkoutStarts)} />
          <Stat title="Conv. rate" value={`${data.conversionRate.toFixed(1)}%`} />
          <Stat title="Registrations" value={String(data.registrations)} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Table title="Revenue by source" rows={data.bySource} labelKey="source" />
          <Table title="Revenue by campaign" rows={data.byCampaign} labelKey="campaign" />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Split title="Access" rows={[
            { label: "Shared", value: data.accessMix.shared },
            { label: "Private", value: data.accessMix.private },
          ]} />
          <Split title="Billing" rows={[
            { label: "Monthly", value: data.billingMix.monthly },
            { label: "Quarterly", value: data.billingMix.quarterly },
            { label: "Yearly", value: data.billingMix.yearly },
          ]} />
          <Split title="Payment type" rows={[
            { label: "Recurring", value: data.paymentTypeMix.recurring },
            { label: "One-time", value: data.paymentTypeMix.oneTime },
          ]} />
        </div>

        <Table title="Top tools" rows={data.byTool} labelKey="tool" />
      </section>
    </AdminShell>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Table({
  title,
  rows,
  labelKey,
}: {
  title: string;
  rows: Array<{ revenue: number; count: number } & Record<string, unknown>>;
  labelKey: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1">Label</th>
              <th className="pb-1 text-right">Conv.</th>
              <th className="pb-1 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-1.5">{String(r[labelKey] ?? "—")}</td>
                <td className="py-1.5 text-right">{r.count}</td>
                <td className="py-1.5 text-right">₦{r.revenue.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Split({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.label} className="flex justify-between">
            <span>{r.label}</span>
            <span className="text-muted-foreground">
              {r.value} ({Math.round((r.value / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
