import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Edit3 } from "lucide-react";
import { BlogAdminNav } from "@/components/blog/BlogAdminNav";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  listCategories,
  adminUpsertCategory,
  adminDeleteCategory,
} from "@/lib/blog.functions";

const q = queryOptions({ queryKey: ["blog", "categories"], queryFn: () => listCategories() });

export const Route = createFileRoute("/admin/blog/categories")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({ meta: [{ title: "Categories — Admin" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: CategoriesAdmin,
});

function CategoriesAdmin() {
  const { data } = useSuspenseQuery(q);
  const qc = useQueryClient();
  const upsert = useServerFn(adminUpsertCategory);
  const del = useServerFn(adminDeleteCategory);
  const [editing, setEditing] = useState<{ id?: string; name: string; slug: string; description: string } | null>(null);

  const save = useMutation({
    mutationFn: upsert,
    onSuccess: () => {
      toast.success("Saved");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["blog", "categories"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: del,
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["blog", "categories"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <AdminShell>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">Blog categories</h1>
        </div>
        <div className="mt-6"><BlogAdminNav /></div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={() => setEditing({ name: "", slug: "", description: "" })}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> New category
          </button>
        </div>

        {editing && (
          <div className="mt-4 space-y-3 rounded-2xl border bg-card p-4">
            <input
              placeholder="Name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <input
              placeholder="Slug (optional — auto from name)"
              value={editing.slug}
              onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <textarea
              placeholder="Description (optional)"
              rows={2}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={() =>
                  save.mutate({
                    data: {
                      id: editing.id,
                      name: editing.name,
                      slug: editing.slug || undefined,
                      description: editing.description || null,
                    },
                  })
                }
                disabled={save.isPending}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(null)}
                className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 divide-y rounded-2xl border bg-card">
          {data.categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">/{c.slug}</div>
                {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing({ id: c.id, name: c.name, slug: c.slug, description: c.description ?? "" })}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  <Edit3 className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${c.name}"?`)) remove.mutate({ data: { id: c.id } });
                  }}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
          {data.categories.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">No categories yet.</div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
