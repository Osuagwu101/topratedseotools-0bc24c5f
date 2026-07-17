import { createFileRoute, useSearch, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PostCard } from "@/components/blog/PostCard";
import { listPublishedPosts } from "@/lib/blog.functions";

const searchSchema = z.object({ q: z.string().optional().default("") });

const postsQ = (q: string) =>
  queryOptions({
    queryKey: ["blog", "search", q],
    queryFn: () => listPublishedPosts({ data: { search: q, limit: 36 } }),
  });

export const Route = createFileRoute("/blog/search")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(postsQ(deps.q)).then(() => null),
  head: () => ({ meta: [{ title: "Search — Blog — Top Rated SEO Tools" }, { name: "robots", content: "noindex" }] }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = useSearch({ from: "/blog/search" });
  const { data } = useSuspenseQuery(postsQ(q));
  return (
    <SiteLayout>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <nav className="mb-4 flex items-center gap-1 text-xs text-muted-foreground">
          <Link to="/blog" className="hover:text-foreground">Blog</Link>
          <span>/</span>
          <span>Search</span>
        </nav>
        <h1 className="text-3xl font-bold sm:text-4xl">
          Results for <span className="text-primary">"{q}"</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{data.posts.length} article(s) found</p>
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data.posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
        {data.posts.length === 0 && (
          <div className="mt-8 rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            Try different keywords or browse by category.
          </div>
        )}
      </div>
    </SiteLayout>
  );
}
