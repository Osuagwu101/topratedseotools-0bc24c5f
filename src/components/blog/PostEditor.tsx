import { useMutation, useQueryClient, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRouter, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, Save, Send, History } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { AdminNav } from "@/routes/admin.tools";
import { BlogAdminNav } from "@/components/blog/BlogAdminNav";
import {
  adminCreatePost,
  adminUpdatePost,
  adminGetPost,
  adminListRevisions,
  adminRestoreRevision,
  listCategories,
  listTags,
} from "@/lib/blog.functions";
import { renderMarkdown, slugify, formatDate, estimateReadingTime } from "@/lib/blog-utils";

type Mode = "create" | "edit";

const catsQuery = queryOptions({
  queryKey: ["blog", "categories"],
  queryFn: () => listCategories(),
});
const tagsQuery = queryOptions({
  queryKey: ["blog", "tags"],
  queryFn: () => listTags(),
});
const postQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "blog", "post", id],
    queryFn: () => adminGetPost({ data: { id } }),
    enabled: !!id,
  });
const revisionsQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "blog", "revisions", id],
    queryFn: () => adminListRevisions({ data: { postId: id } }),
    enabled: !!id,
  });

interface FormState {
  title: string;
  subtitle: string;
  slug: string;
  excerpt: string;
  content: string;
  featured_image: string;
  category_id: string;
  status: "draft" | "scheduled" | "published" | "archived";
  scheduled_for: string;
  is_featured: boolean;
  seo_title: string;
  seo_description: string;
  tag_ids: string[];
}

const empty: FormState = {
  title: "",
  subtitle: "",
  slug: "",
  excerpt: "",
  content: "",
  featured_image: "",
  category_id: "",
  status: "draft",
  scheduled_for: "",
  is_featured: false,
  seo_title: "",
  seo_description: "",
  tag_ids: [],
};

export function PostEditor({ mode, id }: { mode: Mode; id?: string }) {
  const { data: catsData } = useSuspenseQuery(catsQuery);
  const { data: tagsData } = useSuspenseQuery(tagsQuery);
  if (mode === "edit" && id) {
    return <EditPostEditor id={id} catsData={catsData} tagsData={tagsData} />;
  }
  return <EditorBody mode="create" catsData={catsData} tagsData={tagsData} initial={empty} />;
}

function EditPostEditor({
  id,
  catsData,
  tagsData,
}: {
  id: string;
  catsData: { categories: Array<{ id: string; name: string }> };
  tagsData: { tags: Array<{ id: string; name: string }> };
}) {
  const existing = useSuspenseQuery(postQuery(id));
  const d = existing.data as { post: Record<string, unknown>; tag_ids: string[] };
  const p = d.post;
  const initial: FormState = {
    title: (p.title as string) ?? "",
    subtitle: (p.subtitle as string) ?? "",
    slug: (p.slug as string) ?? "",
    excerpt: (p.excerpt as string) ?? "",
    content: (p.content as string) ?? "",
    featured_image: (p.featured_image as string) ?? "",
    category_id: (p.category_id as string) ?? "",
    status: ((p.status as FormState["status"]) ?? "draft"),
    scheduled_for: p.scheduled_for
      ? new Date(p.scheduled_for as string).toISOString().slice(0, 16)
      : "",
    is_featured: !!p.is_featured,
    seo_title: (p.seo_title as string) ?? "",
    seo_description: (p.seo_description as string) ?? "",
    tag_ids: d.tag_ids ?? [],
  };
  return <EditorBody mode="edit" id={id} catsData={catsData} tagsData={tagsData} initial={initial} />;
}

function EditorBody({
  mode,
  id,
  catsData,
  tagsData,
  initial,
}: {
  mode: Mode;
  id?: string;
  catsData: { categories: Array<{ id: string; name: string }> };
  tagsData: { tags: Array<{ id: string; name: string }> };
  initial: FormState;
}) {
  const router = useRouter();
  const qc = useQueryClient();

  const [form, setForm] = useState<FormState>(initial);
  const [preview, setPreview] = useState(false);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");

  const create = useServerFn(adminCreatePost);
  const update = useServerFn(adminUpdatePost);
  const restore = useServerFn(adminRestoreRevision);

  const saveMutation = useMutation({
    mutationFn: async (nextStatus?: FormState["status"]) => {
      const payload = {
        title: form.title,
        subtitle: form.subtitle || null,
        slug: form.slug || slugify(form.title),
        excerpt: form.excerpt || null,
        content: form.content,
        featured_image: form.featured_image || null,
        category_id: form.category_id || null,
        status: nextStatus ?? form.status,
        published_at: null as string | null,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
        is_featured: form.is_featured,
        seo_title: form.seo_title || null,
        seo_description: form.seo_description || null,
        tag_ids: form.tag_ids,
      };
      if (mode === "create") {
        const r = await create({ data: payload as never });
        return r;
      }
      await update({ data: { id: id!, ...payload } as never });
      return { id: id! };
    },
    onSuccess: (r: { id?: string } | undefined) => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["admin", "blog"] });
      qc.invalidateQueries({ queryKey: ["blog"] });
      if (mode === "create" && r?.id) {
        router.navigate({ to: "/admin/blog/$id/edit", params: { id: r.id } });
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const readingTime = estimateReadingTime(form.content);

  return (
    <SiteLayout>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{mode === "create" ? "New article" : "Edit article"}</h1>
            <p className="text-sm text-muted-foreground">
              {readingTime} min read · {form.content.trim().split(/\s+/).filter(Boolean).length} words
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AdminNav />
            <Link
              to="/admin/blog"
              className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
            >
              Back
            </Link>
          </div>
        </div>

        <div className="mt-6">
          <BlogAdminNav />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <input
              value={form.title}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) => ({ ...f, title: v, slug: slugTouched ? f.slug : slugify(v) }));
              }}
              placeholder="Article title"
              className="w-full rounded-md border border-input bg-background px-3 py-3 text-xl font-semibold"
            />
            <input
              value={form.subtitle}
              onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
              placeholder="Subtitle (optional)"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">/blog/</span>
              <input
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm((f) => ({ ...f, slug: slugify(e.target.value) }));
                }}
                placeholder="url-slug"
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Content (Markdown)
              </label>
              <button
                type="button"
                onClick={() => setPreview((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
              >
                <Eye className="h-3.5 w-3.5" /> {preview ? "Edit" : "Preview"}
              </button>
            </div>

            {preview ? (
              <div
                className="prose prose-neutral min-h-[24rem] max-w-none rounded-md border bg-card p-4 dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(form.content) }}
              />
            ) : (
              <textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                rows={20}
                placeholder="# Heading&#10;&#10;Write your article in Markdown. Use ##, ###, lists, **bold**, [links](url), images, etc."
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
              />
            )}

            <textarea
              value={form.excerpt}
              onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
              rows={3}
              placeholder="Excerpt (shown on listings & meta description fallback)"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Publish</h3>
              <div className="mt-3 space-y-3 text-sm">
                <label className="block">
                  <span className="text-muted-foreground">Status</span>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as FormState["status"] }))}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                  >
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                {form.status === "scheduled" && (
                  <label className="block">
                    <span className="text-muted-foreground">Publish at</span>
                    <input
                      type="datetime-local"
                      value={form.scheduled_for}
                      onChange={(e) => setForm((f) => ({ ...f, scheduled_for: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                )}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.is_featured}
                    onChange={(e) => setForm((f) => ({ ...f, is_featured: e.target.checked }))}
                  />
                  <span>Feature on homepage</span>
                </label>
                <div className="flex flex-col gap-2 pt-2">
                  <button
                    onClick={() => saveMutation.mutate(undefined)}
                    disabled={saveMutation.isPending}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" /> Save
                  </button>
                  <button
                    onClick={() => saveMutation.mutate("published")}
                    disabled={saveMutation.isPending}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  >
                    <Send className="h-4 w-4" /> Publish now
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Category & Tags</h3>
              <label className="mt-3 block text-sm">
                <span className="text-muted-foreground">Category</span>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                >
                  <option value="">— None —</option>
                  {catsData.categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <div className="mt-3">
                <span className="text-sm text-muted-foreground">Tags</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tagsData.tags.map((t) => {
                    const on = form.tag_ids.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            tag_ids: on ? f.tag_ids.filter((x) => x !== t.id) : [...f.tag_ids, t.id],
                          }))
                        }
                        className={
                          on
                            ? "rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs text-primary"
                            : "rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40"
                        }
                      >
                        #{t.name}
                      </button>
                    );
                  })}
                  {tagsData.tags.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      No tags yet — <Link to="/admin/blog/tags" className="text-primary">create some</Link>.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Featured image</h3>
              <input
                value={form.featured_image}
                onChange={(e) => setForm((f) => ({ ...f, featured_image: e.target.value }))}
                placeholder="https://…"
                className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              {form.featured_image && (
                <img src={form.featured_image} alt="" className="mt-2 aspect-[16/9] w-full rounded-md object-cover" />
              )}
            </div>

            <div className="rounded-2xl border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SEO</h3>
              <label className="mt-3 block text-sm">
                <span className="text-muted-foreground">Title tag</span>
                <input
                  value={form.seo_title}
                  onChange={(e) => setForm((f) => ({ ...f, seo_title: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="mt-3 block text-sm">
                <span className="text-muted-foreground">Meta description</span>
                <textarea
                  value={form.seo_description}
                  onChange={(e) => setForm((f) => ({ ...f, seo_description: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
            </div>

            {mode === "edit" && id && <RevisionsPanel postId={id} onRestore={(rid) => {
              if (confirm("Restore this revision? Current content will be snapshotted first.")) {
                restore({ data: { postId: id, revisionId: rid } }).then(() => {
                  toast.success("Revision restored");
                  qc.invalidateQueries({ queryKey: ["admin", "blog", "post", id] });
                  qc.invalidateQueries({ queryKey: ["admin", "blog", "revisions", id] });
                  router.invalidate();
                }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"));
              }
            }} />}
          </aside>
        </div>
      </div>
    </SiteLayout>
  );
}

function RevisionsPanel({ postId, onRestore }: { postId: string; onRestore: (rid: string) => void }) {
  const { data } = useSuspenseQuery(revisionsQuery(postId));
  return (
    <div className="rounded-2xl border bg-card p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Revision history
      </h3>
      <ul className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
        {data.revisions.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
            <div>
              <div className="font-medium">{r.title}</div>
              <div className="text-muted-foreground">{formatDate(r.created_at)}</div>
            </div>
            <button
              onClick={() => onRestore(r.id)}
              className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
            >
              Restore
            </button>
          </li>
        ))}
        {data.revisions.length === 0 && (
          <li className="text-xs text-muted-foreground">No revisions yet.</li>
        )}
      </ul>
    </div>
  );
}
