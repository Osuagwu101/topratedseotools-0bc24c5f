import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PostCard } from "@/components/blog/PostCard";
import { listPublishedPosts, listTags } from "@/lib/blog.functions";

const postsQ = (slug: string) =>
  queryOptions({
    queryKey: ["blog", "posts", "tag", slug],
    queryFn: () => listPublishedPosts({ data: { tagSlug: slug, limit: 36 } }),
  });
const tagsQ = queryOptions({
  queryKey: ["blog", "tags"],
  queryFn: () => listTags(),
});

export const Route = createFileRoute("/blog/tag/$slug")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(postsQ(params.slug)),
      context.queryClient.ensureQueryData(tagsQ),
    ]);
    return null;
  },
  head: ({ params }) => {
    const url = `https://topratedseotools.lovable.app/blog/tag/${params.slug}`;
    return {
      meta: [
        { title: `#${params.slug} — Blog — Top Rated SEO Tools` },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: TagPage,
});

function TagPage() {
  const params = Route.useParams();
  const { data } = useSuspenseQuery(postsQ(params.slug));
  const { data: tags } = useSuspenseQuery(tagsQ);
  const tag = tags.tags.find((t) => t.slug === params.slug);
  return (
    <SiteLayout>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <nav className="mb-4 flex items-center gap-1 text-xs text-muted-foreground">
          <Link to="/blog" className="hover:text-foreground">
            Blog
          </Link>
          <span>/</span>
          <span>Tag</span>
        </nav>
        <h1 className="text-3xl font-bold sm:text-4xl">#{tag?.name ?? params.slug}</h1>
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data.posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
        {data.posts.length === 0 && (
          <div className="mt-8 rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            No articles tagged with this yet.
          </div>
        )}
      </div>
    </SiteLayout>
  );
}
