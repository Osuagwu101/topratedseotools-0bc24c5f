import { createFileRoute, useSearch, useNavigate, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Search as SearchIcon, X } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PostCard } from "@/components/blog/PostCard";
import {
  listPublishedPosts,
  listCategories,
  listTags,
} from "@/lib/blog.functions";

const searchSchema = z.object({
  q: z.string().optional().default(""),
  category: z.string().optional().default(""),
  tag: z.string().optional().default(""),
  from: z.string().optional().default(""),
  to: z.string().optional().default(""),
});

type Filters = z.infer<typeof searchSchema>;

const postsQ = (f: Filters) =>
  queryOptions({
    queryKey: ["blog", "search", f],
    queryFn: () =>
      listPublishedPosts({
        data: {
          search: f.q || undefined,
          categorySlug: f.category || undefined,
          tagSlug: f.tag || undefined,
          dateFrom: f.from ? new Date(f.from).toISOString() : undefined,
          dateTo: f.to ? new Date(f.to + "T23:59:59").toISOString() : undefined,
          limit: 36,
        },
      }),
  });

const catsQ = queryOptions({ queryKey: ["blog", "cats"], queryFn: () => listCategories() });
const tagsQ = queryOptions({ queryKey: ["blog", "tags"], queryFn: () => listTags() });

export const Route = createFileRoute("/blog/search")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(postsQ(deps)),
      context.queryClient.ensureQueryData(catsQ),
      context.queryClient.ensureQueryData(tagsQ),
    ]);
    return null;
  },
  head: () => ({
    meta: [
      { title: "Search — Blog — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Search articles by keyword, category, tag, or date." },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const search = useSearch({ from: "/blog/search" });
  const navigate = useNavigate({ from: "/blog/search" });
  const { data } = useSuspenseQuery(postsQ(search));
  const { data: cats } = useSuspenseQuery(catsQ);
  const { data: tags } = useSuspenseQuery(tagsQ);

  const [draft, setDraft] = useState<Filters>(search);

  const active =
    !!search.q || !!search.category || !!search.tag || !!search.from || !!search.to;

  function apply(next: Partial<Filters>) {
    const merged = { ...draft, ...next };
    setDraft(merged);
    navigate({
      search: (prev) => ({ ...prev, ...merged }),
      replace: true,
    });
  }

  function clear() {
    const empty: Filters = { q: "", category: "", tag: "", from: "", to: "" };
    setDraft(empty);
    navigate({ search: empty as any, replace: true });
  }

  return (
    <SiteLayout>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <nav className="mb-4 flex items-center gap-1 text-xs text-muted-foreground">
          <Link to="/blog" className="hover:text-foreground">
            Blog
          </Link>
          <span>/</span>
          <span>Search</span>
        </nav>

        <h1 className="text-3xl font-bold sm:text-4xl">Search articles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Filter by keyword, category, tag, or date.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
          className="mt-6 grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <label className="lg:col-span-2">
            <span className="sr-only">Search keywords</span>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                placeholder="Search by keyword…"
                className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm"
              />
            </div>
          </label>
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All categories</option>
            {cats.categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={draft.tag}
            onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All tags</option>
            {tags.tags.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2 lg:col-span-1">
            <button
              type="submit"
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Search
            </button>
            {active && (
              <button
                type="button"
                onClick={clear}
                className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                aria-label="Clear filters"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <label className="text-xs text-muted-foreground">
            <span>Published from</span>
            <input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            <span>Published to</span>
            <input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          {data.posts.length} article{data.posts.length === 1 ? "" : "s"} found
        </p>

        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data.posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
        {data.posts.length === 0 && (
          <div className="mt-8 rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            No matches. Try different keywords or clear a filter.
          </div>
        )}
      </div>
    </SiteLayout>
  );
}
