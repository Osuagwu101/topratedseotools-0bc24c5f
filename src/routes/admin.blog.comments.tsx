import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, X, Trash2 } from "lucide-react";
import { BlogAdminNav } from "@/components/blog/BlogAdminNav";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { adminListComments, adminModerateComment } from "@/lib/blog.functions";
import { formatDate } from "@/lib/blog-text";

const q = queryOptions({ queryKey: ["admin", "blog", "comments"], queryFn: () => adminListComments() });

export const Route = createFileRoute("/admin/blog/comments")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({ meta: [{ title: "Comments — Admin" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: CommentsAdmin,
});

function CommentsAdmin() {
  const { data } = useSuspenseQuery(q);
  const qc = useQueryClient();
  const mod = useServerFn(adminModerateComment);
  const m = useMutation({
    mutationFn: mod,
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "blog", "comments"] });
      qc.invalidateQueries({ queryKey: ["blog", "comments"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">Comments</h1>
        </div>
        <div className="mt-6"><BlogAdminNav /></div>

        <div className="mt-6 space-y-3">
          {data.comments.map((c) => {
            const post = c.post as unknown as { id: string; title: string; slug: string } | null;
            return (
              <div key={c.id} className="rounded-2xl border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">{c.author_name}</span>{" "}
                    <span>({c.author_email})</span> · {formatDate(c.created_at)}
                    {post && (
                      <>
                        {" · on "}
                        <Link
                          to="/blog/$slug"
                          params={{ slug: post.slug }}
                          className="text-primary hover:underline"
                          target="_blank"
                        >
                          {post.title}
                        </Link>
                      </>
                    )}
                  </div>
                  <span
                    className={
                      c.status === "approved"
                        ? "rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-600"
                        : c.status === "rejected"
                          ? "rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive"
                          : "rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-600"
                    }
                  >
                    {c.status}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm">{c.content}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {c.status !== "approved" && (
                    <button
                      onClick={() => m.mutate({ data: { id: c.id, action: "approve" } })}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </button>
                  )}
                  {c.status !== "rejected" && (
                    <button
                      onClick={() => m.mutate({ data: { id: c.id, action: "reject" } })}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm("Delete this comment?"))
                        m.mutate({ data: { id: c.id, action: "delete" } });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
            );
          })}
          {data.comments.length === 0 && (
            <div className="rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              No comments yet.
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
