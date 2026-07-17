import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PostCard } from "@/components/blog/PostCard";
import { BlogSidebar } from "@/components/blog/BlogSidebar";
import {
  listPublishedPosts,
  listCategories,
  listTags,
  getBlogSettings,
} from "@/lib/blog.functions";

const postsQuery = queryOptions({
  queryKey: ["blog", "posts", "home"],
  queryFn: () => listPublishedPosts({ data: { limit: 24 } }),
});
const featuredQuery = queryOptions({
  queryKey: ["blog", "posts", "featured"],
  queryFn: () => listPublishedPosts({ data: { featured: true, limit: 3 } }),
});
const categoriesQuery = queryOptions({
  queryKey: ["blog", "categories"],
  queryFn: () => listCategories(),
});
const tagsQuery = queryOptions({
  queryKey: ["blog", "tags"],
  queryFn: () => listTags(),
});
const settingsQuery = queryOptions({
  queryKey: ["blog", "settings"],
  queryFn: () => getBlogSettings(),
});

export const Route = createFileRoute("/blog/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(postsQuery),
      context.queryClient.ensureQueryData(featuredQuery),
      context.queryClient.ensureQueryData(categoriesQuery),
      context.queryClient.ensureQueryData(tagsQuery),
      context.queryClient.ensureQueryData(settingsQuery),
    ]).then(() => null),
  head: () => ({
    meta: [
      { title: "Blog — Top Rated SEO Tools" },
      {
        name: "description",
        content:
          "Guides, comparisons, and playbooks on the best AI SEO tools — helping you write, rank, and grow.",
      },
      { property: "og:title", content: "Blog — Top Rated SEO Tools" },
      { property: "og:description", content: "Insights on AI SEO tools and content strategy." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://topratedseotools.lovable.app/blog" },
    ],
    links: [{ rel: "canonical", href: "https://topratedseotools.lovable.app/blog" }],
  }),
  component: BlogHome,
});

function BlogHome() {
  const { data: posts } = useSuspenseQuery(postsQuery);
  const { data: featured } = useSuspenseQuery(featuredQuery);
  const { data: cats } = useSuspenseQuery(categoriesQuery);
  const { data: tags } = useSuspenseQuery(tagsQuery);
  const { data: settingsData } = useSuspenseQuery(settingsQuery);
  const [q, setQ] = useState("");

  const featuredList = featured.posts;
  const latest = posts.posts.filter((p) => !featuredList.find((f) => f.id === p.id));
  const popular = posts.posts
    .slice()
    .sort((a, b) => b.view_count - a.view_count)
    .slice(0, 5)
    .map((p) => ({ id: p.id, title: p.title, slug: p.slug }));

  return (
    <SiteLayout>
      <section className="border-b bg-gradient-to-b from-primary/5 to-transparent">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              {settingsData.settings.hero_title}
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              {settingsData.settings.hero_subtitle}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim())
                  window.location.assign(`/blog/search?q=${encodeURIComponent(q.trim())}`);
              }}
              className="mx-auto mt-6 flex max-w-xl items-center gap-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search articles…"
                  className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Search
              </button>
            </form>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:px-8">
        <div className="space-y-12">
          {featuredList.length > 0 && (
            <section>
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Featured
              </h2>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {featuredList.map((p, i) => (
                  <PostCard key={p.id} post={p} featured={i === 0} />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Latest articles
              </h2>
              <Link to="/blog" className="text-sm text-primary hover:underline">
                View all
              </Link>
            </div>
            {latest.length === 0 ? (
              <div className="rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                No articles yet. Check back soon.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {latest.map((p) => (
                  <PostCard key={p.id} post={p} />
                ))}
              </div>
            )}
          </section>
        </div>

        <BlogSidebar categories={cats.categories} tags={tags.tags} popular={popular} />
      </div>
    </SiteLayout>
  );
}
