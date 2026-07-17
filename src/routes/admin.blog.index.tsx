import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Edit3, Trash2, Archive, RotateCcw, Copy, Send, Eye } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { AdminNav } from "@/routes/admin.tools";
import { BlogAdminNav } from "@/components/blog/BlogAdminNav";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { adminListPosts, adminPostAction } from "@/lib/blog.functions";
import { formatDate } from "@/lib/blog-utils";

const postsQuery = queryOptions({
  queryKey: ["admin", "blog", "posts"],
  queryFn: () => adminListPosts(),
});

export const Route = createFileRoute("/admin/blog/")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({ meta: [{ title: "Blog — Admin" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(postsQuery),
  component: AdminBlogList,
});

function AdminBlogList() {
  const { data } = useSuspenseQuery(postsQuery);
  const qc = useQueryClient();
  const act = useServerFn(adminPostAction);
  const mutation = useMutation({
    mutationFn: act,
    onSuccess: () => {
      toast.success("Done");
      qc.invalidateQueries({ queryKey: ["admin", "blog", "posts"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <SiteLayout>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Blog</h1>
            <p className="text-sm text-muted-foreground">Manage articles, categories, tags and comments.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AdminNav />
            <Link
              to="/admin/blog/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New article
            </Link>
          </div>
        </div>

        <div className="mt-6">
          <BlogAdminNav />
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.posts.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.title}</div>
                    <div className="text-xs text-muted-foreground">/{p.slug}</div>
                  </td>
                  <td className="px-4 py-3">{p.category?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        p.status === "published"
                          ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600"
                          : p.status === "scheduled"
                            ? "rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600"
                            : p.status === "archived"
                              ? "rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
                              : "rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-600"
                      }
                    >
                      {p.status}
                    </span>
                    {p.is_featured && <span className="ml-2 text-xs text-primary">★ featured</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(p.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      {p.status === "published" && (
                        <Link
                          to="/blog/$slug"
                          params={{ slug: p.slug }}
                          target="_blank"
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        >
                          <Eye className="h-3.5 w-3.5" /> View
                        </Link>
                      )}
                      <Link
                        to="/admin/blog/$id/edit"
                        params={{ id: p.id }}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        <Edit3 className="h-3.5 w-3.5" /> Edit
                      </Link>
                      {p.status !== "published" && (
                        <button
                          onClick={() => mutation.mutate({ data: { id: p.id, action: "publish" } })}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        >
                          <Send className="h-3.5 w-3.5" /> Publish
                        </button>
                      )}
                      <button
                        onClick={() => mutation.mutate({ data: { id: p.id, action: "duplicate" } })}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        <Copy className="h-3.5 w-3.5" /> Duplicate
                      </button>
                      {p.status !== "archived" ? (
                        <button
                          onClick={() => mutation.mutate({ data: { id: p.id, action: "archive" } })}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        >
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </button>
                      ) : (
                        <button
                          onClick={() => mutation.mutate({ data: { id: p.id, action: "restore" } })}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${p.title}"? This cannot be undone.`))
                            mutation.mutate({ data: { id: p.id, action: "delete" } });
                        }}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {data.posts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No articles yet. Create your first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </SiteLayout>
  );
}
