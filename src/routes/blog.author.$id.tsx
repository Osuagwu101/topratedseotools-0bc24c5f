import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PostCard } from "@/components/blog/PostCard";
import { getAuthor, listPublishedPosts } from "@/lib/blog.functions";

const authorQ = (id: string) =>
  queryOptions({ queryKey: ["blog", "author", id], queryFn: () => getAuthor({ data: { id } }) });
const postsQ = (id: string) =>
  queryOptions({
    queryKey: ["blog", "posts", "author", id],
    queryFn: () => listPublishedPosts({ data: { authorId: id, limit: 36 } }),
  });

export const Route = createFileRoute("/blog/author/$id")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(authorQ(params.id)),
      context.queryClient.ensureQueryData(postsQ(params.id)),
    ]);
    return null;
  },
  head: () => ({ meta: [{ title: "Author — Top Rated SEO Tools" }] }),
  component: AuthorPage,
});

function AuthorPage() {
  const params = Route.useParams();
  const { data: a } = useSuspenseQuery(authorQ(params.id));
  const { data: p } = useSuspenseQuery(postsQ(params.id));
  return (
    <SiteLayout>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <nav className="mb-4 flex items-center gap-1 text-xs text-muted-foreground">
          <Link to="/blog" className="hover:text-foreground">Blog</Link>
          <span>/</span>
          <span>Author</span>
        </nav>
        <div className="flex items-center gap-4">
          {a.author?.avatar_url && (
            <img src={a.author.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />
          )}
          <div>
            <h1 className="text-2xl font-bold">{a.author?.full_name ?? "Author"}</h1>
          </div>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {p.posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      </div>
    </SiteLayout>
  );
}
