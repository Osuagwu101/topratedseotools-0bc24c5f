/**
 * Admin — tool login credential vault.
 *
 * One row per tool (email + password + optional login URL + admin notes).
 * Stored in the RLS-protected `tool_credentials` table; only admins can
 * write here, and `getMyAccess` on the user side reads them via the
 * service role AFTER checking the caller has an active paid subscription.
 */
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Search, ShieldAlert, Save, Eye, EyeOff } from "lucide-react";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { TOOLS } from "@/lib/tools-data";
import { getIsAdmin } from "@/lib/site-settings.functions";
import {
  adminListToolCredentials,
  adminUpsertToolCredential,
  type ToolCredential,
} from "@/lib/access.functions";

const credsQuery = queryOptions({
  queryKey: ["admin-credentials"],
  queryFn: () => adminListToolCredentials(),
});

export const Route = createFileRoute("/admin/credentials")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({
    meta: [
      { title: "Credentials — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ context }) => {
    const [{ isAdmin }] = await Promise.all([
      getIsAdmin(),
      context.queryClient.ensureQueryData(credsQuery),
    ]);
    return { isAdmin };
  },
  component: CredentialsPage,
});

function CredentialsPage() {
  const { isAdmin } = Route.useLoaderData();
  const { data } = useSuspenseQuery(credsQuery);
  const upsert = useServerFn(adminUpsertToolCredential);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  const bySlug = useMemo(() => {
    const m = new Map<string, ToolCredential>();
    for (const c of data.credentials) m.set(c.tool_slug, c);
    return m;
  }, [data.credentials]);

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
      <AdminShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-3 text-2xl font-semibold">Admins only</h1>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <KeyRound className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Login credentials</h1>
            <p className="text-sm text-muted-foreground">
              These credentials are shown to subscribers with an active plan.
              They are hidden from everyone else and revoked automatically on expiry.
            </p>
          </div>
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
            const c = bySlug.get(t.slug);
            return (
              <CredentialRow
                key={t.slug}
                tool={t}
                current={c}
                showPassword={!!reveal[t.slug]}
                onToggleReveal={() =>
                  setReveal((r) => ({ ...r, [t.slug]: !r[t.slug] }))
                }
                onSave={async (patch) => {
                  await upsert({ data: { tool_slug: t.slug, ...patch } });
                  toast.success(`Saved credentials for ${t.name}`);
                  router.invalidate();
                }}
              />
            );
          })}
        </ul>
      </section>
    </AdminShell>
  );
}

function CredentialRow({
  tool,
  current,
  showPassword,
  onToggleReveal,
  onSave,
}: {
  tool: (typeof TOOLS)[number];
  current: ToolCredential | undefined;
  showPassword: boolean;
  onToggleReveal: () => void;
  onSave: (patch: {
    login_email: string | null;
    login_password: string | null;
    login_url: string | null;
    login_notes: string | null;
  }) => Promise<void>;
}) {
  const [email, setEmail] = useState(current?.login_email ?? "");
  const [password, setPassword] = useState(current?.login_password ?? "");
  const [url, setUrl] = useState(current?.login_url ?? `https://${tool.domain}`);
  const [notes, setNotes] = useState(current?.login_notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave({
        login_email: email || null,
        login_password: password || null,
        login_url: url || null,
        login_notes: notes || null,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <ToolBrandMark tool={tool} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{tool.name}</div>
          <div className="text-xs text-muted-foreground">{tool.domain}</div>
        </div>
        {current?.updated_at && (
          <span className="text-[11px] text-muted-foreground">
            Updated {new Date(current.updated_at).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium">
          <span className="text-muted-foreground">Login email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="account@example.com"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-medium">
          <span className="text-muted-foreground">Password</span>
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm"
            />
            <button
              type="button"
              onClick={onToggleReveal}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <label className="text-xs font-medium sm:col-span-2">
          <span className="text-muted-foreground">Login URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/login"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-medium sm:col-span-2">
          <span className="text-muted-foreground">Notes shown to subscriber (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Any special instructions, workspace name, etc."
          />
        </label>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </li>
  );
}
