import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CalendarDays, Clock, User as UserIcon, Share2 } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PostCard } from "@/components/blog/PostCard";
import {
  getPostBySlug,
  getBlogSettings,
  listApprovedComments,
  submitComment,
} from "@/lib/blog.functions";
import { renderMarkdown, extractToc, formatDate } from "@/lib/blog-utils";

const postQueryOpts = (slug: string) =>
  queryOptions({
    queryKey: ["blog", "post", slug],
    queryFn: () => getPostBySlug({ data: { slug } }),
  });
const settingsQuery = queryOptions({
  queryKey: ["blog", "settings"],
  queryFn: () => getBlogSettings(),
});
const commentsQueryOpts = (postId: string) =>
  queryOptions({
    queryKey: ["blog", "comments", postId],
    queryFn: () => listApprovedComments({ data: { postId } }),
    enabled: !!postId,
  });

export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(postQueryOpts(params.slug));
    if (!data.post) throw notFound();
    await context.queryClient.ensureQueryData(settingsQuery);
    await context.queryClient.ensureQueryData(commentsQueryOpts(data.post.id));
    const p = data.post as unknown as Record<string, unknown>;
    return {
      title: data.post.title,
      excerpt: data.post.excerpt ?? "",
      featured_image: data.post.featured_image ?? "",
      seo_title: data.post.seo_title ?? "",
      seo_description: data.post.seo_description ?? "",
      canonical_url: (p.canonical_url as string) ?? "",
      og_title: (p.og_title as string) ?? "",
      og_description: (p.og_description as string) ?? "",
      twitter_title: (p.twitter_title as string) ?? "",
      twitter_description: (p.twitter_description as string) ?? "",
      faq: (p.faq as Array<{ question: string; answer: string }>) ?? [],
      published_at: data.post.published_at,
      updated_at: data.post.updated_at,
      author_name: data.author?.full_name ?? null,
      category_name: data.post.category?.name ?? null,
      category_slug: data.post.category?.slug ?? null,
    };
  },
  head: ({ params, loaderData }) => {
    const fallback = `https://topratedseotools.lovable.app/blog/${params.slug}`;
    if (!loaderData) {
      return {
        meta: [
          { title: "Article not found — Top Rated SEO Tools" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const url = loaderData.canonical_url || fallback;
    const title = loaderData.seo_title || `${loaderData.title} — Top Rated SEO Tools`;
    const description = loaderData.seo_description || loaderData.excerpt || undefined;
    const ogTitle = loaderData.og_title || title;
    const ogDesc = loaderData.og_description || description;
    const twTitle = loaderData.twitter_title || ogTitle;
    const twDesc = loaderData.twitter_description || ogDesc;
    const meta: Array<Record<string, string>> = [
      { title },
      { property: "og:type", content: "article" },
      { property: "og:url", content: url },
      { property: "og:title", content: ogTitle },
      { property: "og:site_name", content: "Top Rated SEO Tools" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: twTitle },
    ];
    if (description) meta.push({ name: "description", content: description });
    if (ogDesc) meta.push({ property: "og:description", content: ogDesc });
    if (twDesc) meta.push({ name: "twitter:description", content: twDesc });
    if (loaderData.featured_image) {
      meta.push({ property: "og:image", content: loaderData.featured_image });
      meta.push({ name: "twitter:image", content: loaderData.featured_image });
    }
    if (loaderData.published_at) {
      meta.push({ property: "article:published_time", content: loaderData.published_at });
    }
    if (loaderData.updated_at) {
      meta.push({ property: "article:modified_time", content: loaderData.updated_at });
    }

    // JSON-LD schemas
    const articleLd = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: loaderData.title,
      description: description ?? undefined,
      image: loaderData.featured_image || undefined,
      datePublished: loaderData.published_at ?? undefined,
      dateModified: loaderData.updated_at ?? undefined,
      author: loaderData.author_name
        ? { "@type": "Person", name: loaderData.author_name }
        : { "@type": "Organization", name: "Top Rated SEO Tools" },
      publisher: {
        "@type": "Organization",
        name: "Top Rated SEO Tools",
        logo: {
          "@type": "ImageObject",
          url: "https://topratedseotools.lovable.app/favicon.ico",
        },
      },
      mainEntityOfPage: url,
    };
    const breadcrumbLd = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://topratedseotools.lovable.app/" },
        { "@type": "ListItem", position: 2, name: "Blog", item: "https://topratedseotools.lovable.app/blog" },
        ...(loaderData.category_slug
          ? [
              {
                "@type": "ListItem",
                position: 3,
                name: loaderData.category_name,
                item: `https://topratedseotools.lovable.app/blog/category/${loaderData.category_slug}`,
              },
            ]
          : []),
        {
          "@type": "ListItem",
          position: loaderData.category_slug ? 4 : 3,
          name: loaderData.title,
          item: url,
        },
      ],
    };
    const scripts: Array<{ type: string; children: string }> = [
      { type: "application/ld+json", children: JSON.stringify(articleLd) },
      { type: "application/ld+json", children: JSON.stringify(breadcrumbLd) },
    ];
    if (loaderData.faq && loaderData.faq.length > 0) {
      const faqLd = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: loaderData.faq.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: { "@type": "Answer", text: f.answer },
        })),
      };
      scripts.push({ type: "application/ld+json", children: JSON.stringify(faqLd) });
    }

    return {
      meta,
      links: [{ rel: "canonical", href: url }],
      scripts,
    };
  },
  errorComponent: ({ error }) => (
    <SiteLayout>
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </SiteLayout>
  ),
  notFoundComponent: NotFoundArticle,
  component: BlogPost,
});

function NotFoundArticle() {
  return (
    <SiteLayout>
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Article not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been moved or unpublished.
        </p>
        <Link to="/blog" className="mt-4 inline-block text-sm text-primary hover:underline">
          ← Back to blog
        </Link>
      </div>
    </SiteLayout>
  );
}

function BlogPost() {
  const params = Route.useParams();
  const { data } = useSuspenseQuery(postQueryOpts(params.slug));
  const { data: settingsData } = useSuspenseQuery(settingsQuery);
  const post = data.post!;
  const { data: commentsData } = useSuspenseQuery(commentsQueryOpts(post.id));

  const html = useMemo(() => renderMarkdown(post.content ?? ""), [post.content]);
  const toc = useMemo(() => extractToc(post.content ?? ""), [post.content]);

  const url = `https://topratedseotools.lovable.app/blog/${post.slug}`;
  const share = (net: "twitter" | "facebook" | "linkedin") => {
    const enc = encodeURIComponent(url);
    const t = encodeURIComponent(post.title);
    const map = {
      twitter: `https://twitter.com/intent/tweet?url=${enc}&text=${t}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc}`,
    };
    window.open(map[net], "_blank", "noopener,noreferrer");
  };

  return (
    <SiteLayout>
      <article className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <nav className="mb-4 flex items-center gap-1 text-xs text-muted-foreground" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <span>/</span>
          <Link to="/blog" className="hover:text-foreground">Blog</Link>
          {post.category && (
            <>
              <span>/</span>
              <Link
                to="/blog/category/$slug"
                params={{ slug: post.category.slug }}
                className="hover:text-foreground"
              >
                {post.category.name}
              </Link>
            </>
          )}
          <span>/</span>
          <span className="truncate text-foreground">{post.title}</span>
        </nav>

        {post.category && (
          <Link
            to="/blog/category/$slug"
            params={{ slug: post.category.slug }}
            className="text-[11px] font-semibold uppercase tracking-widest text-primary"
          >
            {post.category.name}
          </Link>
        )}
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">{post.title}</h1>
        {post.subtitle && <p className="mt-3 text-lg text-muted-foreground">{post.subtitle}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {data.author?.full_name && (
            <Link
              to="/blog/author/$id"
              params={{ id: data.author.id }}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <UserIcon className="h-4 w-4" /> {data.author.full_name}
            </Link>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4" /> {formatDate(post.published_at)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" /> {post.reading_time_minutes} min read
          </span>
          {post.updated_at && post.updated_at !== post.created_at && (
            <span className="text-xs">Updated {formatDate(post.updated_at)}</span>
          )}
        </div>

        {post.featured_image && (
          <img
            src={post.featured_image}
            alt={post.title}
            className="mt-6 aspect-[16/9] w-full rounded-2xl object-cover"
          />
        )}

        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div>
            {toc.length > 0 && (
              <details className="mb-8 rounded-xl border bg-muted/30 p-4 lg:hidden" open>
                <summary className="cursor-pointer text-sm font-semibold">Table of contents</summary>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {toc.map((e) => (
                    <li key={e.id} className={e.level === 3 ? "pl-4" : ""}>
                      <a href={`#${e.id}`} className="text-muted-foreground hover:text-primary">
                        {e.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div
              className="prose prose-neutral max-w-none dark:prose-invert prose-headings:scroll-mt-24 prose-a:text-primary prose-img:rounded-xl"
              dangerouslySetInnerHTML={{ __html: html }}
            />

            {data.tags.length > 0 && (
              <div className="mt-10 flex flex-wrap gap-2">
                {data.tags.map((t) => (
                  <Link
                    key={t.id}
                    to="/blog/tag/$slug"
                    params={{ slug: t.slug }}
                    className="rounded-full border px-3 py-1 text-xs hover:border-primary/40 hover:text-primary"
                  >
                    #{t.name}
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-8 flex items-center gap-3 border-t pt-6">
              <span className="text-sm font-medium">Share:</span>
              <button onClick={() => share("twitter")} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted">
                <Share2 className="mr-1 inline h-3.5 w-3.5" /> Twitter
              </button>
              <button onClick={() => share("facebook")} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted">
                Facebook
              </button>
              <button onClick={() => share("linkedin")} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted">
                LinkedIn
              </button>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {data.prev && (
                <Link
                  to="/blog/$slug"
                  params={{ slug: data.prev.slug }}
                  className="rounded-xl border p-4 hover:border-primary/40"
                >
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ChevronLeft className="h-3.5 w-3.5" /> Previous
                  </span>
                  <p className="mt-1 line-clamp-2 text-sm font-medium">{data.prev.title}</p>
                </Link>
              )}
              {data.next && (
                <Link
                  to="/blog/$slug"
                  params={{ slug: data.next.slug }}
                  className="rounded-xl border p-4 text-right hover:border-primary/40 sm:col-start-2"
                >
                  <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                  <p className="mt-1 line-clamp-2 text-sm font-medium">{data.next.title}</p>
                </Link>
              )}
            </div>

            {data.related.length > 0 && (
              <section className="mt-14">
                <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Related articles
                </h3>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  {data.related.map((r) => (
                    <PostCard key={r.id} post={r as never} />
                  ))}
                </div>
              </section>
            )}

            {settingsData.settings.comments_enabled && (
              <section className="mt-14 border-t pt-8">
                <h3 className="text-lg font-semibold">Comments ({commentsData.comments.length})</h3>
                <CommentForm postId={post.id} />
                <ul className="mt-6 space-y-4">
                  {commentsData.comments.map((c) => (
                    <li key={c.id} className="rounded-xl border bg-card p-4">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.author_name}</span>
                        <span>{formatDate(c.created_at)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{c.content}</p>
                    </li>
                  ))}
                  {commentsData.comments.length === 0 && (
                    <li className="text-sm text-muted-foreground">Be the first to comment.</li>
                  )}
                </ul>
              </section>
            )}
          </div>

          {toc.length > 0 && (
            <aside className="hidden lg:block">
              <div className="sticky top-24 rounded-xl border bg-card p-5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  On this page
                </h4>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {toc.map((e) => (
                    <li key={e.id} className={e.level === 3 ? "pl-4" : ""}>
                      <a href={`#${e.id}`} className="text-muted-foreground hover:text-primary">
                        {e.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          )}
        </div>
      </article>
    </SiteLayout>
  );
}

function CommentForm({ postId }: { postId: string }) {
  const submit = useServerFn(submitComment);
  const qc = useQueryClient();
  const [state, setState] = useState({ author_name: "", author_email: "", content: "" });
  const mutation = useMutation({
    mutationFn: submit,
    onSuccess: () => {
      toast.success("Comment submitted for review");
      setState({ author_name: "", author_email: "", content: "" });
      qc.invalidateQueries({ queryKey: ["blog", "comments", postId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to submit"),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate({ data: { postId, ...state } });
      }}
      className="mt-4 space-y-3 rounded-xl border bg-card p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          required
          placeholder="Your name"
          value={state.author_name}
          onChange={(e) => setState((s) => ({ ...s, author_name: e.target.value }))}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <input
          required
          type="email"
          placeholder="Email (not published)"
          value={state.author_email}
          onChange={(e) => setState((s) => ({ ...s, author_email: e.target.value }))}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <textarea
        required
        rows={4}
        placeholder="Add a comment…"
        value={state.content}
        onChange={(e) => setState((s) => ({ ...s, content: e.target.value }))}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {mutation.isPending ? "Submitting…" : "Post comment"}
      </button>
      <p className="text-xs text-muted-foreground">Comments are moderated before appearing.</p>
    </form>
  );
}
