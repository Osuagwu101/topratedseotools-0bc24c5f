import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { AdminNav } from "@/routes/admin.tools";
import { BlogAdminNav } from "@/components/blog/BlogAdminNav";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { listTags, adminUpsertTag, adminDeleteTag } from "@/lib/blog.functions";

const q = queryOptions({ queryKey: ["blog", "tags"], queryFn: () => listTags() });

export const Route = createFileRoute("/admin/blog/tags")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({ meta: [{ title: "Tags — Admin" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: TagsAdmin,
});

function TagsAdmin() {
  const { data } = useSuspenseQuery(q);
  const qc = useQueryClient();
  const upsert = useServerFn(adminUpsertTag);
  const del = useServerFn(adminDeleteTag);
  const [name, setName] = useState("");

  const save = useMutation({
    mutationFn: upsert,
    onSuccess: () => {
      toast.success("Saved");
      setName("");
      qc.invalidateQueries({ queryKey: ["blog", "tags"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: del,
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["blog", "tags"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <SiteLayout>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">Blog tags</h1>
          <AdminNav />
        </div>
        <div className="mt-6"><BlogAdminNav /></div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate({ data: { name: name.trim() } });
          }}
          className="mt-6 flex gap-2"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add tag…"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>

        <div className="mt-6 flex flex-wrap gap-2">
          {data.tags.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-sm">
              #{t.name}
              <button
                onClick={() => {
                  if (confirm(`Delete tag "${t.name}"?`)) remove.mutate({ data: { id: t.id } });
                }}
                className="ml-1 text-muted-foreground hover:text-destructive"
                aria-label="Delete tag"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
          {data.tags.length === 0 && (
            <span className="text-sm text-muted-foreground">No tags yet.</span>
          )}
        </div>
      </div>
    </SiteLayout>
  );
}
