/**
 * Admin → Settings → Analytics — Phase 6 business analytics dashboard.
 *
 * Consolidates revenue, customer growth, marketing, tool performance, and
 * CSV export into a single tabbed page. All data comes from existing
 * server-side aggregates plus the thin filtered wrappers in
 * `src/lib/analytics.functions.ts`. Marketing tab reuses the existing
 * `getMarketingAnalytics` output — no duplicate tracking is created.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  getRevenueAnalytics,
  getCustomerAnalytics,
  getToolPerformance,
  exportAnalyticsCsv,
} from "@/lib/analytics.functions";
import { getMarketingAnalytics } from "@/lib/marketing/analytics.functions";
import { TOOLS } from "@/lib/tools-data";
import {
  PAYMENT_GATEWAYS,
  PAYMENT_CURRENCIES,
  GATEWAY_LABELS,
} from "@/lib/transaction-display";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings/analytics")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [
      { title: "Business Analytics — Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalyticsPage,
});

function money(n: number) {
  return "₦" + Math.round(n).toLocaleString();
}

function defaultFrom() {
  return new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

function AnalyticsPage() {
  const [from, setFrom] = useState<string>(defaultFrom());
  const [to, setTo] = useState<string>(defaultTo());
  const [toolFilter, setToolFilter] = useState<string>("");
  const [methodFilter, setMethodFilter] = useState<string>("");
  const [gatewayFilter, setGatewayFilter] = useState<string>("");
  const [currencyFilter, setCurrencyFilter] = useState<string>("");

  const rangePayload = {
    from: new Date(from + "T00:00:00Z").toISOString(),
    to: new Date(to + "T23:59:59Z").toISOString(),
    tool_slug: toolFilter || undefined,
    payment_method: methodFilter || undefined,
    gateway: gatewayFilter || undefined,
    payment_currency: currencyFilter || undefined,
  };

  const revenue = useQuery({
    queryKey: ["analytics-revenue", rangePayload],
    queryFn: () => getRevenueAnalytics({ data: rangePayload }),
  });
  const customers = useQuery({
    queryKey: ["analytics-customers", rangePayload],
    queryFn: () =>
      getCustomerAnalytics({
        data: {
          from: rangePayload.from,
          to: rangePayload.to,
          gateway: rangePayload.gateway,
          payment_currency: rangePayload.payment_currency,
        },
      }),
  });
  const tools = useQuery({
    queryKey: ["analytics-tools"],
    queryFn: () => getToolPerformance(),
  });
  const marketing = useQuery({
    queryKey: ["analytics-marketing", { from: rangePayload.from, to: rangePayload.to }],
    queryFn: () => getMarketingAnalytics({ data: { from: rangePayload.from, to: rangePayload.to } }),
  });

  async function downloadCsv(report: "revenue" | "customers" | "orders") {
    try {
      const res = await exportAnalyticsCsv({
        data: {
          report,
          from: rangePayload.from,
          to: rangePayload.to,
          tool_slug: rangePayload.tool_slug,
          payment_method: rangePayload.payment_method,
          gateway: rangePayload.gateway,
          payment_currency: rangePayload.payment_currency,
        },
      });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${report} report`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }


  return (
    <AdminShell>
      <section className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:flex sm:flex-wrap">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Business Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Revenue, customers, marketing attribution, tool performance, and exports.
            </p>
          </div>
        </header>


        {/* Filters */}
        <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="from" className="text-xs">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to" className="text-xs">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tool" className="text-xs">Tool</Label>
            <select
              id="tool"
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            >
              <option value="">All tools</option>
              {TOOLS.map((t) => (
                <option key={t.slug} value={t.slug}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="method" className="text-xs">Payment method</Label>
            <select
              id="method"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            >
              <option value="">All methods</option>
              {(revenue.data?.methodOptions ?? []).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="gateway" className="text-xs">Payment gateway</Label>
            <select
              id="gateway"
              value={gatewayFilter}
              onChange={(e) => setGatewayFilter(e.target.value)}
              className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            >
              <option value="">All gateways</option>
              {PAYMENT_GATEWAYS.map((g) => (
                <option key={g} value={g}>{GATEWAY_LABELS[g] ?? g}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="currency" className="text-xs">Payment currency</Label>
            <select
              id="currency"
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            >
              <option value="">All currencies</option>
              {PAYMENT_CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Revenue totals always use NGN accounting values. Currency filters and the
          charged-currency table show what customers actually paid.
        </p>


        <Tabs defaultValue="revenue">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="marketing">Marketing</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>


          {/* Revenue */}
          <TabsContent value="revenue" className="space-y-4">
            {revenue.isLoading ? <Loading /> : revenue.error ? <Err e={revenue.error} /> : revenue.data && (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
                  <Stat title="Total revenue" value={money(revenue.data.totalRevenue)} />
                  <Stat title="This month" value={money(revenue.data.revenueThisMonth)} />
                  <Stat title="Successful" value={String(revenue.data.successfulPayments)} />
                  <Stat title="Failed" value={String(revenue.data.failedPayments)} accent={revenue.data.failedPayments > 0 ? "warn" : undefined} />
                  <Stat title="Refunds" value={String(revenue.data.refunds)} />
                  <Stat title="Avg / payment" value={
                    revenue.data.successfulPayments
                      ? money(revenue.data.totalRevenue / revenue.data.successfulPayments)
                      : "₦0"
                  } />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <RevTable title="By tool" rows={revenue.data.byTool} />
                  <RevTable title="By subscription plan" rows={revenue.data.byPlan} />
                  <RevTable
                    title="By payment gateway (NGN equivalent)"
                    rows={revenue.data.byProvider.map((r) => ({
                      ...r,
                      label: GATEWAY_LABELS[r.label] ?? r.label,
                    }))}
                  />
                  <RevTable title="By access type" rows={revenue.data.byAccess} />
                </div>
                <SimpleTable
                  title="By charged currency (what customers actually paid)"
                  head={["Currency", "Payments", "Original amount paid", "NGN accounting"]}
                  rows={revenue.data.byCurrency.map((r) => [
                    r.label,
                    String(r.count),
                    `${r.label} ${r.original.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                    money(r.revenue),
                  ])}
                />

              </>
            )}
          </TabsContent>

          {/* Customers */}
          <TabsContent value="customers" className="space-y-4">
            {customers.isLoading ? <Loading /> : customers.error ? <Err e={customers.error} /> : customers.data && (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                  <Stat title="Total customers" value={String(customers.data.totalCustomers)} />
                  <Stat title="New (in range)" value={String(customers.data.newCustomers)} />
                  <Stat title="Active" value={String(customers.data.activeCustomers)} />
                  <Stat title="Expired" value={String(customers.data.expiredCustomers)} />
                  <Stat title="Renewing" value={String(customers.data.renewingCustomers)} />
                  <Stat title="Expiring ≤7d" value={String(customers.data.expiringSoon)} />
                </div>
                <SimpleTable
                  title="Customers by tool (active)"
                  head={["Tool", "Customers"]}
                  rows={customers.data.byTool.map((r) => [r.tool, String(r.customers)])}
                />
              </>
            )}
          </TabsContent>

          {/* Marketing */}
          <TabsContent value="marketing" className="space-y-4">
            {marketing.isLoading ? <Loading /> : marketing.error ? <Err e={marketing.error} /> : marketing.data && (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <Stat title="Revenue" value={money(marketing.data.totalRevenue)} />
                  <Stat title="Purchases" value={String(marketing.data.totalConversions)} />
                  <Stat title="Checkout starts" value={String(marketing.data.checkoutStarts)} />
                  <Stat title="Signups" value={String(marketing.data.registrations)} />
                  <Stat title="Conv. rate" value={`${marketing.data.conversionRate.toFixed(1)}%`} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <SimpleTable
                    title="Traffic source (utm_source)"
                    head={["Source", "Conv.", "Revenue"]}
                    rows={marketing.data.bySource.map((r) => [r.source, String(r.count), money(r.revenue)])}
                  />
                  <SimpleTable
                    title="Campaign (utm_campaign)"
                    head={["Campaign", "Conv.", "Revenue"]}
                    rows={marketing.data.byCampaign.map((r) => [r.campaign, String(r.count), money(r.revenue)])}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Facebook/Meta and Google campaigns appear as their utm_source values
                  (e.g. <code>facebook</code>, <code>google</code>). Referrer, medium,
                  and full event stream live in{" "}
                  <a href="/admin/marketing/events" className="underline">
                    Marketing → Events
                  </a>.
                </p>
              </>
            )}
          </TabsContent>

          {/* Tools */}
          <TabsContent value="tools" className="space-y-4">
            {tools.isLoading ? <Loading /> : tools.error ? <Err e={tools.error} /> : tools.data && (
              <SimpleTable
                title="Per-tool performance"
                head={["Tool", "Customers", "Revenue", "Active accounts", "Expiring ≤7d", "Rating"]}
                rows={tools.data.map((r) => [
                  r.tool,
                  String(r.customers),
                  money(r.revenue),
                  String(r.activeAccounts),
                  String(r.expiring),
                  r.reviews ? `${r.rating.toFixed(1)} (${r.reviews})` : "—",
                ])}
              />
            )}
          </TabsContent>

          {/* Export */}
          <TabsContent value="export" className="space-y-4">
            <div className="rounded-xl border bg-card p-5">
              <h3 className="mb-1 text-sm font-semibold">CSV Export</h3>
              <p className="mb-4 text-xs text-muted-foreground">
                Exports respect the From / To date range above.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => downloadCsv("revenue")}>
                  <Download className="mr-2 h-4 w-4" /> Revenue report
                </Button>
                <Button variant="outline" onClick={() => downloadCsv("customers")}>
                  <Download className="mr-2 h-4 w-4" /> Customers report
                </Button>
                <Button variant="outline" onClick={() => downloadCsv("orders")}>
                  <Download className="mr-2 h-4 w-4" /> Orders report
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </section>
    </AdminShell>
  );
}

function Stat({ title, value, accent }: { title: string; value: string; accent?: "warn" }) {
  return (
    <div className={`rounded-xl border bg-card p-3 ${accent === "warn" ? "border-destructive/40" : ""}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className={`mt-1 text-lg font-semibold ${accent === "warn" ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function RevTable({ title, rows }: { title: string; rows: Array<{ label: string; revenue: number; count: number }> }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data in range.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1">Label</th>
              <th className="pb-1 text-right">Count</th>
              <th className="pb-1 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-1.5">{r.label}</td>
                <td className="py-1.5 text-right">{r.count}</td>
                <td className="py-1.5 text-right">{money(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SimpleTable({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {head.map((h, i) => (
                  <th key={i} className={`pb-1 ${i > 0 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {r.map((c, j) => (
                    <td key={j} className={`py-1.5 ${j > 0 ? "text-right" : ""}`}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Loading() {
  return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Loading…</div>;
}
function Err({ e }: { e: unknown }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      {(e as Error).message}
    </div>
  );
}
