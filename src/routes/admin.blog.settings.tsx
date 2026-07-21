import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { BlogAdminNav } from "@/components/blog/BlogAdminNav";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getBlogSettings, adminUpdateBlogSettings } from "@/lib/blog.functions";

const q = queryOptions({ queryKey: ["blog", "settings"], queryFn: () => getBlogSettings() });

export const Route = createFileRoute("/admin/blog/settings")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({ meta: [{ title: "Blog settings — Admin" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: SettingsAdmin,
});

function SettingsAdmin() {
  const { data } = useSuspenseQuery(q);
  const qc = useQueryClient();
  const save = useServerFn(adminUpdateBlogSettings);
  const [form, setForm] = useState(data.settings);
  useEffect(() => setForm(data.settings), [data.settings]);
  const mutation = useMutation({
    mutationFn: save,
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["blog", "settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <AdminShell>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">Blog settings</h1>
        </div>
        <div className="mt-6"><BlogAdminNav /></div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({
              data: {
                id: form.id || undefined,
                comments_enabled: form.comments_enabled,
                hero_title: form.hero_title,
                hero_subtitle: form.hero_subtitle,
                posts_per_page: form.posts_per_page,
              },
            });
          }}
          className="mt-6 space-y-4 rounded-2xl border bg-card p-6"
        >
          <label className="block text-sm">
            <span className="text-muted-foreground">Homepage hero title</span>
            <input
              value={form.hero_title}
              onChange={(e) => setForm({ ...form, hero_title: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Homepage hero subtitle</span>
            <input
              value={form.hero_subtitle}
              onChange={(e) => setForm({ ...form, hero_subtitle: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Posts per page</span>
            <input
              type="number"
              min={3}
              max={48}
              value={form.posts_per_page}
              onChange={(e) => setForm({ ...form, posts_per_page: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.comments_enabled}
              onChange={(e) => setForm({ ...form, comments_enabled: e.target.checked })}
            />
            <span>Comments enabled</span>
          </label>
          <button
            disabled={mutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            Save settings
          </button>
        </form>
      </div>
    </AdminShell>
  );
}
