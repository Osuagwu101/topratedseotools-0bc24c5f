import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PostCard } from "@/components/blog/PostCard";
import { listPublishedPosts, listCategories } from "@/lib/blog.functions";

const postsQ = (slug: string) =>
  queryOptions({
    queryKey: ["blog", "posts", "category", slug],
    queryFn: () => listPublishedPosts({ data: { categorySlug: slug, limit: 36 } }),
  });
const catsQ = queryOptions({
  queryKey: ["blog", "categories"],
  queryFn: () => listCategories(),
});

export const Route = createFileRoute("/blog/category/$slug")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(postsQ(params.slug)),
      context.queryClient.ensureQueryData(catsQ),
    ]);
    return null;
  },
  head: ({ params }) => {
    const url = `https://topratedseotools.lovable.app/blog/category/${params.slug}`;
    return {
      meta: [
        { title: `${params.slug} — Blog — Top Rated SEO Tools` },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: CategoryPage,
});

function CategoryPage() {
  const params = Route.useParams();
  const { data } = useSuspenseQuery(postsQ(params.slug));
  const { data: cats } = useSuspenseQuery(catsQ);
  const cat = cats.categories.find((c) => c.slug === params.slug);

  return (
    <SiteLayout>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <nav className="mb-4 flex items-center gap-1 text-xs text-muted-foreground">
          <Link to="/blog" className="hover:text-foreground">
            Blog
          </Link>
          <span>/</span>
          <span>Category</span>
        </nav>
        <h1 className="text-3xl font-bold sm:text-4xl">{cat?.name ?? params.slug}</h1>
        {cat?.description && <p className="mt-2 text-muted-foreground">{cat.description}</p>}
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data.posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
        {data.posts.length === 0 && (
          <div className="mt-8 rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            No articles in this category yet.
          </div>
        )}
      </div>
    </SiteLayout>
  );
}
