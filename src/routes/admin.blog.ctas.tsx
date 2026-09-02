import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Edit3, Save, X } from "lucide-react";
import { BlogAdminNav } from "@/components/blog/BlogAdminNav";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  listCtaTemplates,
  adminCreateCta,
  adminUpdateCta,
  adminDeleteCta,
} from "@/lib/blog-cta.functions";

const q = queryOptions({ queryKey: ["blog", "ctas"], queryFn: () => listCtaTemplates() });

export const Route = createFileRoute("/admin/blog/ctas")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [{ title: "CTA Templates — Admin" }, { name: "robots", content: "noindex" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: CtaAdmin,
});

interface Draft {
  id?: string;
  name: string;
  title: string;
  body: string;
  button_label: string;
  button_url: string;
  target_tool_slugs: string;
  target_category_slugs: string;
  priority: number;
  enabled: boolean;
  is_default: boolean;
}

const emptyDraft: Draft = {
  name: "",
  title: "",
  body: "",
  button_label: "Get started",
  button_url: "/pricing",
  target_tool_slugs: "",
  target_category_slugs: "",
  priority: 0,
  enabled: true,
  is_default: false,
};

function CtaAdmin() {
  const { data } = useSuspenseQuery(q);
  const qc = useQueryClient();
  const create = useServerFn(adminCreateCta);
  const update = useServerFn(adminUpdateCta);
  const del = useServerFn(adminDeleteCta);
  const [editing, setEditing] = useState<Draft | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["blog", "ctas"] });

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const payload = {
        name: d.name,
        title: d.title,
        body: d.body,
        button_label: d.button_label,
        button_url: d.button_url,
        target_tool_slugs: d.target_tool_slugs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        target_category_slugs: d.target_category_slugs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        priority: Number.isFinite(d.priority) ? d.priority : 0,
        enabled: d.enabled,
        is_default: d.is_default,
      };
      return d.id ? update({ data: { id: d.id, ...payload } }) : create({ data: payload });
    },
    onSuccess: () => {
      toast.success("Saved");
      setEditing(null);
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: del,
    onSuccess: () => {
      toast.success("Deleted");
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const templates = data.templates as unknown as Array<Draft & { id: string; created_at?: string }>;

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">CTA templates</h1>
        </div>
        <div className="mt-6">
          <BlogAdminNav />
        </div>

        <p className="mt-6 max-w-2xl text-sm text-muted-foreground">
          Reusable calls-to-action rendered on blog posts. Targets are matched against the article's
          detected tools and category. Higher{" "}
          <span className="font-medium text-foreground">priority</span> wins ties; the{" "}
          <span className="font-medium text-foreground">default</span> template is used when nothing
          matches.
        </p>

        <div className="mt-6 flex justify-end">
          <button
            onClick={() => setEditing({ ...emptyDraft })}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> New CTA
          </button>
        </div>

        {editing && (
          <div className="mt-4 space-y-3 rounded-2xl border bg-card p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs">
                <span className="mb-1 block font-medium">Internal name</span>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Semrush upsell"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-medium">Button URL</span>
                <input
                  value={editing.button_url}
                  onChange={(e) => setEditing({ ...editing, button_url: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="/pricing or /tools/semrush"
                />
              </label>
            </div>
            <label className="block text-xs">
              <span className="mb-1 block font-medium">Headline (title)</span>
              <input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Ready to rank higher?"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium">Body</span>
              <textarea
                rows={3}
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Get instant access to the exact SEO tools used in this article."
              />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-xs">
                <span className="mb-1 block font-medium">Button label</span>
                <input
                  value={editing.button_label}
                  onChange={(e) => setEditing({ ...editing, button_label: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-medium">Target tool slugs (comma-separated)</span>
                <input
                  value={editing.target_tool_slugs}
                  onChange={(e) => setEditing({ ...editing, target_tool_slugs: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="semrush, grammarly"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-medium">
                  Target category slugs (comma-separated)
                </span>
                <input
                  value={editing.target_category_slugs}
                  onChange={(e) =>
                    setEditing({ ...editing, target_category_slugs: e.target.value })
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="seo, ai-writing"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
              <label className="inline-flex items-center gap-2">
                <span>Priority</span>
                <input
                  type="number"
                  value={editing.priority}
                  onChange={(e) =>
                    setEditing({ ...editing, priority: Number(e.target.value) || 0 })
                  }
                  className="w-20 rounded-md border border-input bg-background px-2 py-1"
                />
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                Enabled
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.is_default}
                  onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })}
                />
                Default
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                disabled={save.isPending || !editing.name || !editing.title || !editing.body}
                onClick={() => save.mutate(editing)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm"
              >
                <X className="h-4 w-4" /> Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {templates.length === 0 && !editing && (
            <p className="rounded-xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              No CTA templates yet.
            </p>
          )}
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-foreground">{t.name}</span>
                  {t.is_default && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                      Default
                    </span>
                  )}
                  {!t.enabled && (
                    <span className="rounded-full bg-muted px-2 py-0.5">Disabled</span>
                  )}
                  <span className="text-muted-foreground">Priority {t.priority}</span>
                </div>
                <p className="mt-1 truncate text-sm font-medium">{t.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  → <span className="font-mono">{t.button_url}</span>
                  {(t.target_tool_slugs?.length ?? 0) > 0 && (
                    <span className="ml-2">
                      tools: {(t.target_tool_slugs as unknown as string[]).join(", ")}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() =>
                    setEditing({
                      id: t.id,
                      name: t.name,
                      title: t.title,
                      body: t.body,
                      button_label: t.button_label,
                      button_url: t.button_url,
                      target_tool_slugs:
                        (t.target_tool_slugs as unknown as string[])?.join(", ") ?? "",
                      target_category_slugs:
                        (t.target_category_slugs as unknown as string[])?.join(", ") ?? "",
                      priority: t.priority ?? 0,
                      enabled: t.enabled,
                      is_default: t.is_default,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
                >
                  <Edit3 className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete CTA "${t.name}"?`)) remove.mutate({ data: { id: t.id } });
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
