import { useMutation, useQueryClient, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRouter, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, Save, Send, History, Highlighter, Plus, Trash2 } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { BlogAdminNav } from "@/components/blog/BlogAdminNav";
import {
  adminCreatePost,
  adminUpdatePost,
  adminGetPost,
  adminListRevisions,
  adminRestoreRevision,
  listCategories,
  listTags,
  getBlogSettings,
} from "@/lib/blog.functions";
import { listCtaTemplates } from "@/lib/blog-cta.functions";
import { renderMarkdown, slugify, formatDate, estimateReadingTime } from "@/lib/blog-utils";
import { FeaturedImagePicker } from "@/components/blog/FeaturedImagePicker";

type Mode = "create" | "edit";

const catsQuery = queryOptions({
  queryKey: ["blog", "categories"],
  queryFn: () => listCategories(),
});
const tagsQuery = queryOptions({
  queryKey: ["blog", "tags"],
  queryFn: () => listTags(),
});
const blogSettingsQuery = queryOptions({
  queryKey: ["blog", "settings"],
  queryFn: () => getBlogSettings(),
});
const ctasQuery = queryOptions({
  queryKey: ["blog", "ctas"],
  queryFn: () => listCtaTemplates(),
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

interface FaqItem {
  question: string;
  answer: string;
}

interface FormState {
  title: string;
  subtitle: string;
  slug: string;
  excerpt: string;
  content: string;
  featured_image: string;
  featured_image_alt: string;
  featured_image_source: "ai" | "stock" | "upload" | "manual";
  featured_image_credit: string;
  category_id: string;
  status: "draft" | "scheduled" | "published" | "archived";
  scheduled_for: string;
  is_featured: boolean;
  seo_title: string;
  seo_description: string;
  canonical_url: string;
  og_title: string;
  og_description: string;
  twitter_title: string;
  twitter_description: string;
  semantic_keywords: string[];
  faq: FaqItem[];
  cta_template_id: string;
  tag_ids: string[];
}

const empty: FormState = {
  title: "",
  subtitle: "",
  slug: "",
  excerpt: "",
  content: "",
  featured_image: "",
  featured_image_alt: "",
  featured_image_source: "manual",
  featured_image_credit: "",
  category_id: "",
  status: "draft",
  scheduled_for: "",
  is_featured: false,
  seo_title: "",
  seo_description: "",
  canonical_url: "",
  og_title: "",
  og_description: "",
  twitter_title: "",
  twitter_description: "",
  semantic_keywords: [],
  faq: [],
  cta_template_id: "",
  tag_ids: [],
};

export function PostEditor({ mode, id }: { mode: Mode; id?: string }) {
  const { data: catsData } = useSuspenseQuery(catsQuery);
  const { data: tagsData } = useSuspenseQuery(tagsQuery);
  const { data: settingsData } = useSuspenseQuery(blogSettingsQuery);
  const { data: ctasData } = useSuspenseQuery(ctasQuery);
  const ctxProps = { catsData, tagsData, settingsData, ctasData };
  if (mode === "edit" && id) {
    return <EditPostEditor id={id} {...ctxProps} />;
  }
  return <EditorBody mode="create" {...ctxProps} initial={empty} />;
}

interface CtxProps {
  catsData: { categories: Array<{ id: string; name: string }> };
  tagsData: { tags: Array<{ id: string; name: string }> };
  settingsData: {
    settings: { keyword_highlight_enabled: boolean; keyword_highlight_color: string };
  };
  ctasData: { templates: Array<{ id: string; name: string; title: string }> };
}

function EditPostEditor({
  id,
  catsData,
  tagsData,
  settingsData,
  ctasData,
}: CtxProps & { id: string }) {
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
    featured_image_alt: (p.featured_image_alt as string) ?? "",
    featured_image_source:
      (p.featured_image_source as FormState["featured_image_source"]) ?? "manual",
    featured_image_credit: (p.featured_image_credit as string) ?? "",
    category_id: (p.category_id as string) ?? "",
    status: (p.status as FormState["status"]) ?? "draft",
    scheduled_for: p.scheduled_for
      ? new Date(p.scheduled_for as string).toISOString().slice(0, 16)
      : "",
    is_featured: !!p.is_featured,
    seo_title: (p.seo_title as string) ?? "",
    seo_description: (p.seo_description as string) ?? "",
    canonical_url: (p.canonical_url as string) ?? "",
    og_title: (p.og_title as string) ?? "",
    og_description: (p.og_description as string) ?? "",
    twitter_title: (p.twitter_title as string) ?? "",
    twitter_description: (p.twitter_description as string) ?? "",
    semantic_keywords: Array.isArray(p.semantic_keywords) ? (p.semantic_keywords as string[]) : [],
    faq: Array.isArray(p.faq) ? (p.faq as FaqItem[]) : [],
    cta_template_id: (p.cta_template_id as string) ?? "",
    tag_ids: d.tag_ids ?? [],
  };
  return (
    <EditorBody
      mode="edit"
      id={id}
      catsData={catsData}
      tagsData={tagsData}
      settingsData={settingsData}
      ctasData={ctasData}
      initial={initial}
    />
  );
}

function EditorBody({
  mode,
  id,
  catsData,
  tagsData,
  settingsData,
  ctasData,
  initial,
}: CtxProps & { mode: Mode; id?: string; initial: FormState }) {
  const router = useRouter();
  const qc = useQueryClient();

  const [form, setForm] = useState<FormState>(initial);
  const [preview, setPreview] = useState(false);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [highlightOn, setHighlightOn] = useState<boolean>(
    settingsData.settings.keyword_highlight_enabled,
  );
  const highlightColor = settingsData.settings.keyword_highlight_color || "#fde68a";

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
        featured_image_alt: form.featured_image_alt || null,
        featured_image_source: form.featured_image_source,
        featured_image_credit: form.featured_image_credit || null,
        category_id: form.category_id || null,
        status: nextStatus ?? form.status,
        published_at: null as string | null,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
        is_featured: form.is_featured,
        seo_title: form.seo_title || null,
        seo_description: form.seo_description || null,
        canonical_url: form.canonical_url || null,
        og_title: form.og_title || null,
        og_description: form.og_description || null,
        twitter_title: form.twitter_title || null,
        twitter_description: form.twitter_description || null,
        semantic_keywords: form.semantic_keywords,
        faq: form.faq.filter((f) => f.question.trim() && f.answer.trim()),
        cta_template_id: form.cta_template_id || null,
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
            <h1 className="text-2xl font-bold">
              {mode === "create" ? "New article" : "Edit article"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {readingTime} min read · {form.content.trim().split(/\s+/).filter(Boolean).length}{" "}
              words
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/admin/blog" className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
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
              <div className="flex items-center gap-2">
                {form.semantic_keywords.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setHighlightOn((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    style={
                      highlightOn
                        ? { borderColor: highlightColor, background: `${highlightColor}30` }
                        : undefined
                    }
                    title="Highlight semantic keywords in preview"
                  >
                    <Highlighter className="h-3.5 w-3.5" /> Keywords
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreview((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  <Eye className="h-3.5 w-3.5" /> {preview ? "Edit" : "Preview"}
                </button>
              </div>
            </div>

            {preview ? (
              <PreviewPane
                markdown={form.content}
                keywords={form.semantic_keywords}
                highlight={highlightOn}
                highlightColor={highlightColor}
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Publish
              </h3>
              <div className="mt-3 space-y-3 text-sm">
                <label className="block">
                  <span className="text-muted-foreground">Status</span>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, status: e.target.value as FormState["status"] }))
                    }
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Category & Tags
              </h3>
              <label className="mt-3 block text-sm">
                <span className="text-muted-foreground">Category</span>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                >
                  <option value="">— None —</option>
                  {catsData.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
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
                            tag_ids: on
                              ? f.tag_ids.filter((x) => x !== t.id)
                              : [...f.tag_ids, t.id],
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
                      No tags yet —{" "}
                      <Link to="/admin/blog/tags" className="text-primary">
                        create some
                      </Link>
                      .
                    </span>
                  )}
                </div>
              </div>
            </div>

            <FeaturedImagePicker
              value={{
                url: form.featured_image,
                alt: form.featured_image_alt,
                source: form.featured_image_source,
                credit: form.featured_image_credit,
              }}
              articleTitle={form.title || form.seo_title}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  featured_image: v.url,
                  featured_image_alt: v.alt,
                  featured_image_source: v.source,
                  featured_image_credit: v.credit ?? "",
                }))
              }
            />

            <div className="rounded-2xl border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                SEO
              </h3>
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
              <label className="mt-3 block text-sm">
                <span className="text-muted-foreground">Canonical URL</span>
                <input
                  value={form.canonical_url}
                  onChange={(e) => setForm((f) => ({ ...f, canonical_url: e.target.value }))}
                  placeholder="https://…"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  Open Graph & Twitter overrides
                </summary>
                <div className="mt-2 space-y-2">
                  <input
                    value={form.og_title}
                    onChange={(e) => setForm((f) => ({ ...f, og_title: e.target.value }))}
                    placeholder="og:title"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <textarea
                    value={form.og_description}
                    onChange={(e) => setForm((f) => ({ ...f, og_description: e.target.value }))}
                    placeholder="og:description"
                    rows={2}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <input
                    value={form.twitter_title}
                    onChange={(e) => setForm((f) => ({ ...f, twitter_title: e.target.value }))}
                    placeholder="twitter:title"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <textarea
                    value={form.twitter_description}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, twitter_description: e.target.value }))
                    }
                    placeholder="twitter:description"
                    rows={2}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </details>
            </div>

            <SemanticKeywordsPanel
              content={form.content}
              keywords={form.semantic_keywords}
              highlightColor={highlightColor}
              onChange={(kws) => setForm((f) => ({ ...f, semantic_keywords: kws }))}
            />

            <FaqPanel faq={form.faq} onChange={(faq) => setForm((f) => ({ ...f, faq }))} />

            <div className="rounded-2xl border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                CTA template
              </h3>
              <select
                value={form.cta_template_id}
                onChange={(e) => setForm((f) => ({ ...f, cta_template_id: e.target.value }))}
                className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— Auto / none —</option>
                {ctasData.templates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.title.slice(0, 40)}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-muted-foreground">
                Leave blank to let the AI generator pick the best match. Manage templates in{" "}
                <Link to="/admin/blog/ctas" className="text-primary">
                  CTAs
                </Link>
                .
              </p>
            </div>

            {mode === "edit" && id && (
              <RevisionsPanel
                postId={id}
                onRestore={(rid) => {
                  if (
                    confirm("Restore this revision? Current content will be snapshotted first.")
                  ) {
                    restore({ data: { postId: id, revisionId: rid } })
                      .then(() => {
                        toast.success("Revision restored");
                        qc.invalidateQueries({ queryKey: ["admin", "blog", "post", id] });
                        qc.invalidateQueries({ queryKey: ["admin", "blog", "revisions", id] });
                        router.invalidate();
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"));
                  }
                }}
              />
            )}
          </aside>
        </div>
      </div>
    </SiteLayout>
  );
}

function RevisionsPanel({
  postId,
  onRestore,
}: {
  postId: string;
  onRestore: (rid: string) => void;
}) {
  const { data } = useSuspenseQuery(revisionsQuery(postId));
  return (
    <div className="rounded-2xl border bg-card p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Revision history
      </h3>
      <ul className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
        {data.revisions.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs"
          >
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

/* ---------------- helper components ---------------- */

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function PreviewPane({
  markdown,
  keywords,
  highlight,
  highlightColor,
}: {
  markdown: string;
  keywords: string[];
  highlight: boolean;
  highlightColor: string;
}) {
  const html = useMemo(() => {
    let h = renderMarkdown(markdown);
    if (highlight && keywords.length > 0) {
      // Highlight outside HTML tags only.
      const parts = h.split(/(<[^>]+>)/g);
      for (const kw of keywords) {
        if (!kw.trim()) continue;
        const re = new RegExp(`\\b(${escapeReg(kw)})\\b`, "gi");
        for (let i = 0; i < parts.length; i++) {
          if (parts[i].startsWith("<")) continue;
          parts[i] = parts[i].replace(
            re,
            `<mark style="background:${highlightColor};color:inherit;padding:0 2px;border-radius:3px">$1</mark>`,
          );
        }
      }
      h = parts.join("");
    }
    return h;
  }, [markdown, keywords, highlight, highlightColor]);
  return (
    <div
      className="prose prose-neutral min-h-[24rem] max-w-none rounded-md border bg-card p-4 dark:prose-invert"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function SemanticKeywordsPanel({
  content,
  keywords,
  highlightColor,
  onChange,
}: {
  content: string;
  keywords: string[];
  highlightColor: string;
  onChange: (kws: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const counts = useMemo(() => {
    const lower = content.toLowerCase();
    return keywords.map((kw) => {
      const re = new RegExp(`\\b${escapeReg(kw)}\\b`, "gi");
      return (lower.match(re) ?? []).length;
    });
  }, [content, keywords]);
  return (
    <div className="rounded-2xl border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Semantic keywords
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        3–5 semantic phrases. Highlighted in the preview.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {keywords.map((kw, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
            style={{ background: `${highlightColor}30`, borderColor: `${highlightColor}80` }}
          >
            {kw}
            <span className="text-[10px] text-muted-foreground">×{counts[i] ?? 0}</span>
            <button
              type="button"
              onClick={() => onChange(keywords.filter((_, j) => j !== i))}
              className="ml-1 text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${kw}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) {
              e.preventDefault();
              const next = input.trim();
              if (!keywords.some((k) => k.toLowerCase() === next.toLowerCase())) {
                onChange([...keywords, next]);
              }
              setInput("");
            }
          }}
          placeholder="Add keyword and press Enter"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}

function FaqPanel({ faq, onChange }: { faq: FaqItem[]; onChange: (f: FaqItem[]) => void }) {
  const add = () => onChange([...faq, { question: "", answer: "" }]);
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          FAQ
        </h3>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {faq.length === 0 && (
          <p className="text-xs text-muted-foreground">Emitted in-page and as FAQPage JSON-LD.</p>
        )}
        {faq.map((f, i) => (
          <div key={i} className="rounded-md border p-2">
            <div className="flex items-center gap-2">
              <input
                value={f.question}
                onChange={(e) => {
                  const next = [...faq];
                  next[i] = { ...next[i], question: e.target.value };
                  onChange(next);
                }}
                placeholder="Question"
                className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => onChange(faq.filter((_, j) => j !== i))}
                className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
                aria-label="Remove FAQ"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              value={f.answer}
              onChange={(e) => {
                const next = [...faq];
                next[i] = { ...next[i], answer: e.target.value };
                onChange(next);
              }}
              rows={2}
              placeholder="Answer"
              className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
