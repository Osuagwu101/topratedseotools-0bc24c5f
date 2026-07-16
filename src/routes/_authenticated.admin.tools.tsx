/**
 * Admin — per-tool settings: enable/disable + access level.
 * Reads the static catalog (`TOOLS`) and overlays DB rows in `tool_settings`.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Settings2, ShieldAlert } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { TOOLS } from "@/lib/tools-data";
import { getIsAdmin } from "@/lib/site-settings.functions";
import {
  listToolSettings,
  adminUpsertToolSetting,
  type ToolAccessLevel,
} from "@/lib/access.functions";

const settingsQuery = queryOptions({
  queryKey: ["tool-settings"],
  queryFn: () => listToolSettings(),
});

export const Route = createFileRoute("/_authenticated/admin/tools")({
  head: () => ({
    meta: [
      { title: "Tool access — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ context }) => {
    const [{ isAdmin }] = await Promise.all([
      getIsAdmin(),
      context.queryClient.ensureQueryData(settingsQuery),
    ]);
    return { isAdmin };
  },
  component: AdminToolsPage,
});

function AdminToolsPage() {
  const { isAdmin } = Route.useLoaderData();
  const { data } = useSuspenseQuery(settingsQuery);
  const upsert = useServerFn(adminUpsertToolSetting);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const byslug = useMemo(() => {
    const m = new Map(data.settings.map((s) => [s.tool_slug, s]));
    return m;
  }, [data.settings]);

  const filtered = useMemo(
    () =>
      TOOLS.filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q.toLowerCase()) ||
          t.category.toLowerCase().includes(q.toLowerCase()),
      ),
    [q],
  );

  if (!isAdmin) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-3 text-2xl font-semibold">Admins only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You don't have permission to view this page.
          </p>
        </div>
      </SiteLayout>
    );
  }

  async function update(
    slug: string,
    patch: { enabled?: boolean; access_level?: ToolAccessLevel },
  ) {
    setBusy(slug);
    try {
      await upsert({ data: { tool_slug: slug, ...patch } });
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SiteLayout>
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Settings2 className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Tool access</h1>
            <p className="text-sm text-muted-foreground">
              Enable/disable each tool and choose who can access it.
            </p>
          </div>
          <AdminNav />
        </div>

        <div className="mt-6 flex items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-card sm:max-w-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tools…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Tool</th>
                <th className="px-4 py-3">Access level</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const s = byslug.get(t.slug);
                const enabled = s?.enabled ?? true;
                const level: ToolAccessLevel = s?.access_level ?? "purchased";
                const isBusy = busy === t.slug;
                return (
                  <tr key={t.slug} className="border-t">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ToolBrandMark tool={t} size="sm" />
                        <div className="min-w-0">
                          <div className="font-medium">{t.name}</div>
                          <div className="text-xs text-muted-foreground">{t.category}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={level}
                        disabled={isBusy}
                        onChange={(e) =>
                          update(t.slug, { access_level: e.target.value as ToolAccessLevel })
                        }
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      >
                        <option value="public">Public (anyone)</option>
                        <option value="logged_in">Logged-in only</option>
                        <option value="purchased">Subscribers only</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => update(t.slug, { enabled: !enabled })}
                        disabled={isBusy}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition ${
                          enabled
                            ? "bg-success/15 text-success hover:bg-success/25"
                            : "bg-destructive/10 text-destructive hover:bg-destructive/20"
                        } ${isBusy ? "opacity-60" : ""}`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            enabled ? "bg-success" : "bg-destructive"
                          }`}
                        />
                        {enabled ? "Enabled" : "Disabled"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </SiteLayout>
  );
}

export function AdminNav() {
  return (
    <nav className="flex flex-wrap gap-2 text-xs">
      <Link
        to="/admin/tools"
        activeProps={{ className: "!bg-primary/10 !text-primary" }}
        className="rounded-md border border-input px-2.5 py-1.5 font-medium hover:bg-muted"
      >
        Tools
      </Link>
      <Link
        to="/admin/orders"
        activeProps={{ className: "!bg-primary/10 !text-primary" }}
        className="rounded-md border border-input px-2.5 py-1.5 font-medium hover:bg-muted"
      >
        Orders
      </Link>
      <Link
        to="/admin/pricing"
        activeProps={{ className: "!bg-primary/10 !text-primary" }}
        className="rounded-md border border-input px-2.5 py-1.5 font-medium hover:bg-muted"
      >
        Pricing
      </Link>
      <Link
        to="/admin/credentials"
        activeProps={{ className: "!bg-primary/10 !text-primary" }}
        className="rounded-md border border-input px-2.5 py-1.5 font-medium hover:bg-muted"
      >
        Credentials
      </Link>

      <Link
        to="/admin/appearance"
        activeProps={{ className: "!bg-primary/10 !text-primary" }}
        className="rounded-md border border-input px-2.5 py-1.5 font-medium hover:bg-muted"
      >
        Appearance
      </Link>
    </nav>
  );
}
