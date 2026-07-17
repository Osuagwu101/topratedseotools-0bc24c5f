/**
 * Admin — dashboard landing page.
 *
 * Central hub showing high-level counts and links into each admin section
 * (Tools, Orders, Pricing, Credentials, Appearance). Only admins can see it.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import {
  ShieldCheck,
  Settings2,
  ClipboardList,
  Tag,
  KeyRound,
  Palette,
  ArrowRight,
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  BookOpen,
} from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { adminListOrders, adminListToolCredentials } from "@/lib/access.functions";
import { TOOLS } from "@/lib/tools-data";
import { AdminNav } from "./admin.tools";
import { requireAdminOrRedirect } from "@/lib/admin-gate";


const ordersQuery = queryOptions({
  queryKey: ["admin-orders"],
  queryFn: () => adminListOrders(),
});
const credsQuery = queryOptions({
  queryKey: ["admin-credentials"],
  queryFn: () => adminListToolCredentials(),
});

export const Route = createFileRoute("/admin/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin dashboard — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(ordersQuery),
      context.queryClient.ensureQueryData(credsQuery),
    ]);
    return { isAdmin: true as const };
  },
  component: AdminIndexPage,
});


function AdminIndexPage() {
  return <AdminDashboardInner />;
}


function AdminDashboardInner() {
  const { data: ordersData } = useSuspenseQuery(ordersQuery);
  const { data: credsData } = useSuspenseQuery(credsQuery);

  const orders = ordersData.orders;
  const approved = orders.filter((o) => o.status === "approved").length;
  const pending = orders.filter((o) => o.status === "pending").length;
  const rejected = orders.filter(
    (o) => o.status === "rejected" || o.status === "cancelled" || o.status === "expired",
  ).length;
  const uniqueBuyers = new Set(orders.map((o) => o.user_id)).size;

  const stats = [
    {
      label: "Active subscriptions",
      value: approved,
      icon: CheckCircle2,
      tone: "text-success",
    },
    { label: "Pending orders", value: pending, icon: Clock, tone: "text-warning" },
    { label: "Cancelled / expired", value: rejected, icon: XCircle, tone: "text-destructive" },
    { label: "Unique buyers", value: uniqueBuyers, icon: Users, tone: "text-primary" },
  ];

  const sections = [
    {
      title: "Tools",
      to: "/admin/tools" as const,
      description: "Enable or disable tools and set who can access them.",
      icon: Settings2,
      meta: `${TOOLS.length} tools in catalog`,
    },
    {
      title: "Orders",
      to: "/admin/orders" as const,
      description: "Review payments and manage subscription statuses.",
      icon: ClipboardList,
      meta: `${orders.length} total orders`,
    },
    {
      title: "Pricing",
      to: "/admin/pricing" as const,
      description: "Set monthly, quarterly and yearly prices per tool.",
      icon: Tag,
      meta: "Manage plans & durations",
    },
    {
      title: "Credentials",
      to: "/admin/credentials" as const,
      description: "Save the login email & password shown to subscribers.",
      icon: KeyRound,
      meta: `${credsData.credentials.length} tools configured`,
    },
    {
      title: "Blog",
      to: "/admin/blog" as const,
      description: "Write, schedule and publish articles; manage categories, tags and comments.",
      icon: BookOpen,
      meta: "Content marketing",
    },
    {
      title: "Appearance",
      to: "/admin/appearance" as const,
      description: "Switch the site-wide color theme.",
      icon: Palette,
      meta: "Theme control",
    },
  ];

  const recent = orders.slice(0, 6);

  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Admin dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Control the entire site from one place.
            </p>
          </div>
          <AdminNav />
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border bg-card p-5 shadow-card">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </span>
                <s.icon className={`h-4 w-4 ${s.tone}`} />
              </div>
              <div className="mt-3 text-3xl font-semibold">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <h2 className="text-lg font-semibold">Manage the site</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="group rounded-2xl border bg-card p-5 shadow-card transition hover:border-primary/40 hover:shadow-glow"
              >
                <div className="flex items-start justify-between">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <s.icon className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
                <div className="mt-4 font-semibold">{s.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                <div className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {s.meta}
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-10 rounded-2xl border bg-card shadow-card">
          <div className="flex items-center justify-between border-b p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Recent orders
            </h2>
            <Link
              to="/admin/orders"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No orders yet.</div>
          ) : (
            <ul className="divide-y">
              {recent.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{o.tool_slug}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(o.created_at).toLocaleString()} · {o.price_label ?? "—"}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ${
                      o.status === "approved"
                        ? "bg-success/15 text-success"
                        : o.status === "pending"
                          ? "bg-warning/15 text-warning"
                          : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {o.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </SiteLayout>
  );
}
