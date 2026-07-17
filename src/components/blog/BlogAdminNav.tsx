import { Link } from "@tanstack/react-router";

const LINKS: { to: string; label: string; exact?: boolean }[] = [
  { to: "/admin/blog", label: "Posts", exact: true },
  { to: "/admin/blog/ai-generator", label: "AI Generator" },
  { to: "/admin/blog/categories", label: "Categories" },
  { to: "/admin/blog/tags", label: "Tags" },
  { to: "/admin/blog/comments", label: "Comments" },
  { to: "/admin/blog/settings", label: "Settings" },
];

export function BlogAdminNav() {
  return (
    <nav className="flex flex-wrap gap-2 text-xs">
      {LINKS.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          activeOptions={{ exact: !!l.exact }}
          activeProps={{ className: "!bg-primary/10 !text-primary" }}
          className="rounded-md border border-input px-2.5 py-1.5 font-medium hover:bg-muted"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
