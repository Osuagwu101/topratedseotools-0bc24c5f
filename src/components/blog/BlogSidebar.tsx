import { Link } from "@tanstack/react-router";

interface Cat {
  id: string;
  name: string;
  slug: string;
}
interface Tag {
  id: string;
  name: string;
  slug: string;
}

export function BlogSidebar({
  categories,
  tags,
  popular,
}: {
  categories: Cat[];
  tags: Tag[];
  popular: { id: string; title: string; slug: string }[];
}) {
  return (
    <aside className="space-y-6">
      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Categories
        </h4>
        <ul className="mt-3 space-y-1.5">
          {categories.slice(0, 12).map((c) => (
            <li key={c.id}>
              <Link
                to="/blog/category/$slug"
                params={{ slug: c.slug }}
                className="text-sm text-foreground hover:text-primary"
              >
                {c.name}
              </Link>
            </li>
          ))}
          {categories.length === 0 && (
            <li className="text-sm text-muted-foreground">No categories yet</li>
          )}
        </ul>
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Popular
        </h4>
        <ul className="mt-3 space-y-3">
          {popular.slice(0, 5).map((p) => (
            <li key={p.id}>
              <Link
                to="/blog/$slug"
                params={{ slug: p.slug }}
                className="text-sm font-medium text-foreground hover:text-primary"
              >
                {p.title}
              </Link>
            </li>
          ))}
          {popular.length === 0 && <li className="text-sm text-muted-foreground">Nothing yet</li>}
        </ul>
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Tags
        </h4>
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.slice(0, 30).map((t) => (
            <Link
              key={t.id}
              to="/blog/tag/$slug"
              params={{ slug: t.slug }}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              #{t.name}
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}
