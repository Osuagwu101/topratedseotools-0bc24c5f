import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, MessageCircle, Palette, ShieldAlert, Tag } from "lucide-react";
import {
  getIsAdmin,
  getPublicSiteSettings,
  setActiveTheme,
  setAdminWhatsappNumber,
  type ActiveTheme,
} from "@/lib/site-settings.functions";

export const Route = createFileRoute("/admin/appearance")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [
      { title: "Appearance — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async () => {
    const [{ isAdmin }, site] = await Promise.all([getIsAdmin(), getPublicSiteSettings()]);
    return {
      isAdmin,
      activeTheme: site.activeTheme,
      adminWhatsappNumber: site.adminWhatsappNumber,
    };
  },
  component: AdminAppearancePage,
  errorComponent: () => (
    <AdminShell>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Couldn't load admin settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please try again.</p>
      </div>
    </AdminShell>
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
  const { isAdmin, activeTheme, adminWhatsappNumber } = Route.useLoaderData();
  const router = useRouter();
  const queryClient = useQueryClient();
  const setTheme = useServerFn(setActiveTheme);
  const saveWa = useServerFn(setAdminWhatsappNumber);
  const [saving, setSaving] = useState<ActiveTheme | null>(null);
  const [wa, setWa] = useState(adminWhatsappNumber ?? "");
  const [savingWa, setSavingWa] = useState(false);

  if (!isAdmin) {
    return (
      <AdminShell>
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-2xl font-semibold">Admins only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You don't have permission to view this page.
          </p>
        </div>
      </AdminShell>
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

  async function saveWhatsApp() {
    setSavingWa(true);
    try {
      const cleaned = wa.trim();
      await saveWa({ data: { number: cleaned } });
      toast.success(cleaned ? "WhatsApp number saved" : "WhatsApp number cleared");
      await queryClient.invalidateQueries();
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save WhatsApp number");
    } finally {
      setSavingWa(false);
    }
  }

  return (
    <AdminShell>
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

        <div className="mt-6">
          <Link
            to="/admin/pricing"
            className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Tag className="h-4 w-4" /> Manage tool pricing
          </Link>
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

        <div className="mt-8 rounded-2xl border bg-card p-6 shadow-card">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Private Access — Admin WhatsApp</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            The number customers use to contact you when they buy Private Access. Use international
            format with no plus sign, e.g. <code>2348012345678</code>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              value={wa}
              onChange={(e) => setWa(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="2348012345678"
              className="flex-1 min-w-[220px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={saveWhatsApp}
              disabled={savingWa || wa === (adminWhatsappNumber ?? "")}
              className="rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-60"
            >
              {savingWa ? "Saving…" : "Save number"}
            </button>
          </div>
        </div>

        <div className="mt-8 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          <strong className="text-foreground">Tip:</strong> Colour 2 is a placeholder. When you send
          the second palette, we swap the values in <code>.theme-2</code> inside
          <code>src/styles.css</code> — no other change needed.
        </div>
      </section>
    </AdminShell>
  );
}
