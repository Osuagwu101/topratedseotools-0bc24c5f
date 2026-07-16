import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Palette, ShieldAlert } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import {
  getActiveTheme,
  getIsAdmin,
  setActiveTheme,
  type ActiveTheme,
} from "@/lib/site-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/appearance")({
  head: () => ({
    meta: [
      { title: "Appearance — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async () => {
    const [{ isAdmin }, { activeTheme }] = await Promise.all([
      getIsAdmin(),
      getActiveTheme(),
    ]);
    return { isAdmin, activeTheme };
  },
  component: AdminAppearancePage,
  errorComponent: () => (
    <SiteLayout>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Couldn't load admin settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please try again.</p>
      </div>
    </SiteLayout>
  ),
});

const THEMES: { id: ActiveTheme; label: string; description: string; swatches: string[] }[] = [
  {
    id: "theme-1",
    label: "Colour 1 — Default",
    description: "The current violet / indigo palette.",
    swatches: ["oklch(0.58 0.22 275)", "oklch(0.72 0.19 300)", "oklch(0.94 0.03 275)"],
  },
  {
    id: "theme-2",
    label: "Colour 2 — Alternate",
    description: "Placeholder palette. Will use the palette you send next.",
    swatches: ["oklch(0.62 0.14 195)", "oklch(0.75 0.13 175)", "oklch(0.94 0.05 195)"],
  },
];

function AdminAppearancePage() {
  const { isAdmin, activeTheme } = Route.useLoaderData();
  const router = useRouter();
  const queryClient = useQueryClient();
  const setTheme = useServerFn(setActiveTheme);
  const [saving, setSaving] = useState<ActiveTheme | null>(null);

  if (!isAdmin) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-2xl font-semibold">Admins only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You don't have permission to view this page.
          </p>
        </div>
      </SiteLayout>
    );
  }

  async function apply(theme: ActiveTheme) {
    if (theme === activeTheme) return;
    setSaving(theme);
    try {
      await setTheme({ data: { theme } });
      toast.success(`Applied ${theme === "theme-1" ? "Colour 1" : "Colour 2"} site-wide`);
      await queryClient.invalidateQueries();
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update theme");
    } finally {
      setSaving(null);
    }
  }

  return (
    <SiteLayout>
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Palette className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Site appearance</h1>
            <p className="text-sm text-muted-foreground">
              Switch the active colour palette. Applies to every page instantly.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {THEMES.map((t) => {
            const active = t.id === activeTheme;
            return (
              <button
                key={t.id}
                onClick={() => apply(t.id)}
                disabled={saving !== null}
                className={`group relative rounded-2xl border bg-card p-6 text-left shadow-card transition hover:-translate-y-0.5 ${
                  active ? "border-primary ring-2 ring-primary/40" : "hover:border-primary/40"
                } ${saving !== null ? "opacity-70" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{t.label}</div>
                  {active && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                <div className="mt-4 flex gap-2">
                  {t.swatches.map((c, i) => (
                    <span
                      key={i}
                      className="h-10 w-10 rounded-lg border"
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <div className="mt-4 text-xs text-muted-foreground">
                  {saving === t.id ? "Applying…" : active ? "Currently applied" : "Click to apply"}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-8 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          <strong className="text-foreground">Tip:</strong> Colour 2 is a placeholder. When you send
          the second palette, we swap the values in <code>.theme-2</code> inside
          <code>src/styles.css</code> — no other change needed.
        </div>
      </section>
    </SiteLayout>
  );
}
