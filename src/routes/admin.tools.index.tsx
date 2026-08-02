/**
 * Admin — Tools list at /admin/tools.
 *
 * Clicking a row opens the per-tool management page at
 * /admin/tools/$slug, which consolidates settings, pricing, credentials,
 * and orders for that specific tool.
 */
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search, Settings2, ArrowRight, Plus } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { mergeToolCatalog } from "@/lib/tool-catalog";
import { listToolOverrides } from "@/lib/tool-overrides.functions";
import { getIsAdmin } from "@/lib/site-settings.functions";
import { listToolSettings } from "@/lib/access.functions";

const settingsQuery = queryOptions({
  queryKey: ["tool-settings"],
  queryFn: () => listToolSettings(),
});
const overridesQuery = queryOptions({
  queryKey: ["tool-overrides"],
  queryFn: () => listToolOverrides(),
});

export const Route = createFileRoute("/admin/tools/")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({
    meta: [
      { title: "Tools — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ context }) => {
    const [{ isAdmin }] = await Promise.all([
      getIsAdmin(),
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(overridesQuery),
    ]);
    return { isAdmin };
  },
  component: AdminToolsIndex,
});

function AdminToolsIndex() {
  const { data } = useSuspenseQuery(settingsQuery);
  const { data: overridesData } = useSuspenseQuery(overridesQuery);
  const [q, setQ] = useState("");
  // Built-in tools plus admin-created ones.
  const catalog = useMemo(() => mergeToolCatalog(overridesData.overrides), [overridesData]);
  const bySlug = useMemo(
    () => new Map(data.settings.map((s) => [s.tool_slug, s])),
    [data.settings],
  );
  const filtered = useMemo(
    () =>
      catalog.filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q.toLowerCase()) ||
          t.category.toLowerCase().includes(q.toLowerCase()),
      ),
    [q, catalog],
  );

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Settings2 className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Tools</h1>
            <p className="text-sm text-muted-foreground">
              Select a tool to manage its details, access, pricing, credentials, and orders in one place.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to="/admin/tools/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add new tool
          </Link>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-card sm:max-w-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tools…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {filtered.map((t) => {
            const s = bySlug.get(t.slug);
            const enabled = s?.enabled ?? true;
            return (
              <li key={t.slug}>
                <Link
                  to="/admin/tools/$slug"
                  params={{ slug: t.slug }}
                  className="group flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-card transition hover:border-primary/40 hover:shadow-glow"
                >
                  <ToolBrandMark tool={t} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{t.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.category}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      enabled
                        ? "bg-success/15 text-success"
                        : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {enabled ? "On" : "Off"}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </AdminShell>
  );
}
