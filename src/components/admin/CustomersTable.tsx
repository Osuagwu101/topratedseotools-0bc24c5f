/**
 * Reusable platform-wide customers table used by every /admin/customers/* page.
 * Data always comes from listPlatformCustomers (admin-only, service-role backed).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { listPlatformCustomers, type CustomerSegment } from "@/lib/admin-analytics.functions";
import { AddCustomerDialog } from "@/components/admin/AddCustomerDialog";
import { Search } from "lucide-react";

const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  all: "All users",
  active: "Active subscribers",
  all_time: "All-time subscribers",
  inactive: "Inactive / expired subscribers",
  new: "New registrations",
};

export function CustomersTable({ segment }: { segment: CustomerSegment }) {
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<"today" | "7d" | "30d" | "custom">("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = useMemo(() => {
    if (segment !== "new") return { segment, search: search || undefined };
    const now = new Date();
    let f: Date | null = null;
    if (range === "today") { f = new Date(now); f.setUTCHours(0, 0, 0, 0); }
    else if (range === "7d") { f = new Date(now.getTime() - 7 * 86400_000); }
    else if (range === "30d") { f = new Date(now.getTime() - 30 * 86400_000); }
    return {
      segment,
      search: search || undefined,
      from: range === "custom" ? (from || undefined) : f?.toISOString(),
      to: range === "custom" ? (to || undefined) : now.toISOString(),
    };
  }, [segment, search, range, from, to]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-customers", params],
    queryFn: () => listPlatformCustomers({ data: params }),
  });

  const rows = data?.customers ?? [];

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{SEGMENT_LABEL[segment]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform-wide customer directory. Excludes passwords, card data, and tool credentials.
          </p>
        </div>
        <AddCustomerDialog />
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-56 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {segment === "new" && (
          <>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as typeof range)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom range</option>
            </select>
            {range === "custom" && (
              <>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                       className="rounded-md border bg-background px-2 py-1.5 text-sm" />
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                       className="rounded-md border bg-background px-2 py-1.5 text-sm" />
              </>
            )}
          </>
        )}
        <div className="ml-auto text-xs text-muted-foreground">
          {isLoading ? "Loading…" : `${data?.total ?? 0} customers`}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Registered</th>
                <th className="px-3 py-2 text-right">Purchases</th>
                <th className="px-3 py-2 text-right">Active</th>
                <th className="px-3 py-2 text-right">Total spent</th>
                <th className="px-3 py-2">Last payment</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.userId} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <Link
                      to="/admin/customers/$userId"
                      params={{ userId: r.userId }}
                      className="font-medium hover:underline"
                    >
                      {r.fullName ?? "—"}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.email ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(r.registeredAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">{r.purchases}</td>
                  <td className="px-3 py-2 text-right">{r.activeSubscriptions}</td>
                  <td className="px-3 py-2 text-right">₦{r.totalSpent.toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.lastPaymentAt ? new Date(r.lastPaymentAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        r.status === "active"
                          ? "rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-success"
                          : r.status === "inactive"
                            ? "rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-warning"
                            : "rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground"
                      }
                    >
                      {r.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !isLoading && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">No customers match this view.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
