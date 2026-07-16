import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { CATEGORIES, TOOLS, getToolLogo, type ToolCategory } from "@/lib/tools-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tools")({
  head: () => ({
    meta: [
      { title: "All AI Tools — Top Rated SEO Tools" },
      { name: "description", content: "Browse the full catalog of AI tools for writing, images, audio, video, code and data." },
      { property: "og:title", content: "All AI Tools — Top Rated SEO Tools" },
      { property: "og:description", content: "Browse the full catalog of AI tools." },
    ],
  }),
  component: ToolsDirectory,
});

function ToolsDirectory() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<ToolCategory | "All">("All");

  const filtered = useMemo(() => {
    return TOOLS.filter((t) => {
      const matchesCat = cat === "All" || t.category === cat;
      const matchesQ =
        !q ||
        t.name.toLowerCase().includes(q.toLowerCase()) ||
        t.tagline.toLowerCase().includes(q.toLowerCase()) ||
        t.description.toLowerCase().includes(q.toLowerCase());
      return matchesCat && matchesQ;
    });
  }, [q, cat]);

  return (
    <SiteLayout>
      <section className="bg-gradient-hero">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">All AI tools</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {TOOLS.length} tools — one subscription. Find the right one for the job.
          </p>

          <div className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-card">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tools..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap gap-2">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCat(c as ToolCategory | "All")}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                cat === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-16 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No tools match "<span className="font-medium text-foreground">{q}</span>". Try another search.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => {
              const Icon = t.icon;
              return (
                <Link
                  key={t.slug}
                  to="/tools/$slug"
                  params={{ slug: t.slug }}
                  className="group relative flex flex-col rounded-2xl border bg-card p-6 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow"
                >
                  <div className="flex items-center justify-between">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        t.access === "pro"
                          ? "bg-primary/10 text-primary"
                          : "bg-success/15 text-success",
                      )}
                    >
                      {t.access}
                    </span>
                  </div>
                  <div className="mt-4 text-lg font-semibold">{t.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{t.tagline}</div>
                  <div className="mt-4 text-xs text-muted-foreground">{t.category}</div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </SiteLayout>
  );
}
