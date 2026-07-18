import { Link } from "@tanstack/react-router";
import { CalendarDays, Clock } from "lucide-react";
import { formatDate } from "@/lib/blog-text";
import type { PostSummary } from "@/lib/blog.functions";

export function PostCard({ post, featured = false }: { post: PostSummary; featured?: boolean }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-card transition hover:border-primary/40 hover:shadow-glow"
    >
      <div className={`relative w-full overflow-hidden bg-muted ${featured ? "aspect-[16/8]" : "aspect-[16/9]"}`}>
        {post.featured_image ? (
          <img
            src={post.featured_image}
            alt={post.title}
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-primary text-primary-foreground">
            <span className="text-xs font-semibold uppercase tracking-widest">
              {post.category?.name ?? "Article"}
            </span>
          </div>
        )}
        {post.is_featured && (
          <span className="absolute left-3 top-3 rounded-full bg-primary/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
            Featured
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        {post.category && (
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary">
            {post.category.name}
          </span>
        )}
        <h3 className={`mt-2 font-semibold leading-tight text-foreground group-hover:text-primary ${featured ? "text-2xl" : "text-lg"}`}>
          {post.title}
        </h3>
        {post.excerpt && (
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{post.excerpt}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" /> {formatDate(post.published_at)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {post.reading_time_minutes} min read
          </span>
          {post.author?.full_name && <span>· {post.author.full_name}</span>}
        </div>
      </div>
    </Link>
  );
}
