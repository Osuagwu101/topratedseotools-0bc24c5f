/**
 * Admin — per-tool settings: enable/disable + access level + One-Click Login.
 * Reads the static catalog (`TOOLS`) and overlays DB rows in `tool_settings`.
 */
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Search,
  Settings2,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Zap,
  ExternalLink,
  Save,
} from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { TOOLS, type Tool } from "@/lib/tools-data";
import { getIsAdmin } from "@/lib/site-settings.functions";
import {
  listToolSettings,
  adminUpsertToolSetting,
  type LaunchMode,
  type ToolAccessLevel,
  type ToolSetting,
} from "@/lib/access.functions";
import { launchTool } from "@/lib/tool-launcher";

const settingsQuery = queryOptions({
  queryKey: ["tool-settings"],
  queryFn: () => listToolSettings(),
});

export const Route = createFileRoute("/admin/tools")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
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
  const [openOneClick, setOpenOneClick] = useState<Record<string, boolean>>({});

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
        </div>
      </SiteLayout>
    );
  }

  async function update(
    slug: string,
    patch: {
      enabled?: boolean;
      access_level?: ToolAccessLevel;
      one_click_auth_enabled?: boolean;
      official_login_url?: string | null;
      auth_provider?: string | null;
      launch_mode?: LaunchMode;
      display_manual_credentials?: boolean;
    },
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
              Enable/disable each tool, choose who can access it, and configure One-Click Login.
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

        <ul className="mt-6 space-y-3">
          {filtered.map((t) => {
            const s = byslug.get(t.slug);
            const enabled = s?.enabled ?? true;
            const level: ToolAccessLevel = s?.access_level ?? "purchased";
            const isBusy = busy === t.slug;
            const isOpen = !!openOneClick[t.slug];
            return (
              <li
                key={t.slug}
                className="rounded-2xl border bg-card p-4 shadow-card"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <ToolBrandMark tool={t} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.category}</div>
                  </div>

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
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setOpenOneClick((o) => ({ ...o, [t.slug]: !o[t.slug] }))
                  }
                  className="mt-3 inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <Zap className="h-3.5 w-3.5" />
                  One-Click Login
                  {s?.one_click_auth_enabled && (
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                      On
                    </span>
                  )}
                  {isOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>

                {isOpen && (
                  <OneClickPanel
                    tool={t}
                    current={s}
                    onSave={(patch) => update(t.slug, patch)}
                    busy={isBusy}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </SiteLayout>
  );
}

function OneClickPanel({
  tool,
  current,
  onSave,
  busy,
}: {
  tool: Tool;
  current: ToolSetting | undefined;
  onSave: (patch: {
    one_click_auth_enabled?: boolean;
    official_login_url?: string | null;
    auth_provider?: string | null;
    launch_mode?: LaunchMode;
    display_manual_credentials?: boolean;
  }) => Promise<void>;
  busy: boolean;
}) {
  const [enabled, setEnabled] = useState(current?.one_click_auth_enabled ?? false);
  const [url, setUrl] = useState(
    current?.official_login_url ??
      (tool.domain ? `https://${tool.domain}` : ""),
  );
  const [provider, setProvider] = useState(current?.auth_provider ?? "");
  const [mode, setMode] = useState<LaunchMode>(current?.launch_mode ?? "new_tab");
  const [displayCreds, setDisplayCreds] = useState(
    current?.display_manual_credentials ?? true,
  );

  async function save() {
    if (enabled && !url.trim()) {
      toast.error("Add an Official Login URL before enabling One-Click Login.");
      return;
    }
    try {
      await onSave({
        one_click_auth_enabled: enabled,
        official_login_url: url.trim() ? url.trim() : null,
        auth_provider: provider.trim() ? provider.trim() : null,
        launch_mode: mode,
        display_manual_credentials: displayCreds,
      });
      toast.success(
        enabled
          ? `One-Click Login enabled for ${tool.name}`
          : `One-Click Login updated for ${tool.name}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  function testLaunch() {
    if (!url.trim()) {
      toast.error("Enter an Official Login URL first.");
      return;
    }
    launchTool(tool, {
      one_click_auth_enabled: true,
      official_login_url: url.trim(),
      launch_mode: mode,
    });
  }

  return (
    <div className="mt-3 rounded-xl border bg-background/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">One-Click Login</div>
          <p className="text-xs text-muted-foreground">
            Subscribers see a single "Launch Tool" button that opens the
            official login page. Stored credentials stay saved but are hidden
            from the dashboard while this is on.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <span className="text-xs font-medium">
            {enabled ? "Enabled" : "Disabled"}
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-8 cursor-pointer appearance-none rounded-full bg-muted transition-colors checked:bg-primary relative before:absolute before:left-0.5 before:top-0.5 before:h-3 before:w-3 before:rounded-full before:bg-background before:transition-transform checked:before:translate-x-4"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium sm:col-span-2">
          <span className="text-muted-foreground">Official Login URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/login"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="text-xs font-medium">
          <span className="text-muted-foreground">
            Authentication Provider (optional)
          </span>
          <input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="e.g. OAuth, SAML, Magic Link"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="text-xs font-medium">
          <span className="text-muted-foreground">Launch Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as LaunchMode)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="new_tab">New tab (recommended)</option>
            <option value="popup">Popup window</option>
            <option value="same_tab">Same tab</option>
          </select>
        </label>

        <label className="inline-flex items-center gap-2 text-xs font-medium sm:col-span-2">
          <input
            type="checkbox"
            checked={displayCreds}
            onChange={(e) => setDisplayCreds(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          <span>
            When One-Click Login is OFF, keep showing the stored login
            credentials to subscribers.
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          onClick={testLaunch}
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Test Launch
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" />
          {busy ? "Saving…" : "Save One-Click settings"}
        </button>
      </div>
    </div>
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
        to="/admin/blog"
        activeProps={{ className: "!bg-primary/10 !text-primary" }}
        className="rounded-md border border-input px-2.5 py-1.5 font-medium hover:bg-muted"
      >
        Blog
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
