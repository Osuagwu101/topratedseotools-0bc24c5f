/**
 * Admin — Add a new tool at /admin/tools/new.
 *
 * Admin-created tools are stored in `tool_overrides` with `is_custom = true`
 * and are merged into the catalogue by `src/lib/tool-catalog.ts`, so a new tool
 * behaves exactly like a built-in one: it shows in the customer catalogue and
 * gets the same access, pricing, accounts, and orders management.
 *
 * Pricing and access assignment are configured on the tool's management page
 * right after creation (the form links straight there).
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ToolIconUpload } from "@/components/admin/ToolIconUpload";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { CATEGORIES } from "@/lib/tools-data";
import { slugTaken } from "@/lib/tool-catalog";
import { listToolOverrides, adminUpsertToolOverride } from "@/lib/tool-overrides.functions";

const overridesQuery = queryOptions({
  queryKey: ["tool-overrides"],
  queryFn: () => listToolOverrides(),
});

export const Route = createFileRoute("/admin/tools/new")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [
      { title: "Add a tool — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(overridesQuery);
  },
  component: AdminNewTool,
});

function slugify(v: string): string {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function AdminNewTool() {
  const { data } = useSuspenseQuery(overridesQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const upsert = useServerFn(adminUpsertToolOverride);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [access, setAccess] = useState<"pro" | "free">("pro");
  const [domain, setDomain] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [features, setFeatures] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [isVisible, setIsVisible] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [busy, setBusy] = useState(false);

  const effectiveSlug = slugEdited ? slugify(slug) : slugify(name);
  const taken = useMemo(
    () => (effectiveSlug ? slugTaken(data.overrides, effectiveSlug) : false),
    [data.overrides, effectiveSlug],
  );

  const canSave = !!name.trim() && !!effectiveSlug && !taken && !busy;

  async function create() {
    if (!canSave) return;
    setBusy(true);
    try {
      await upsert({
        data: {
          tool_slug: effectiveSlug,
          name: name.trim(),
          tagline: tagline.trim() || null,
          description: description.trim() || null,
          category: category || null,
          domain: domain.trim() || null,
          image_url: imageUrl.trim() || null,
          is_visible: isVisible,
          is_custom: true,
          access,
          features: features
            .split("\n")
            .map((f) => f.trim())
            .filter(Boolean)
            .slice(0, 20),
          featured,
        },
      });
      await qc.invalidateQueries({ queryKey: ["tool-overrides"] });
      toast.success("Tool created — set its pricing and access next");
      navigate({ to: "/admin/tools/$slug", params: { slug: effectiveSlug } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the tool");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/admin/tools"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All tools
        </Link>

        <div className="mt-3 flex items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Plus className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Add a new tool</h1>
            <p className="text-sm text-muted-foreground">
              Create the tool here, then set pricing, access, and accounts on its management page.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Tool name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Ahrefs"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Slug (used in the URL)">
            <input
              value={effectiveSlug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              maxLength={60}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
            />
            {taken ? (
              <p className="mt-1 text-xs text-destructive">
                That slug is already used by another tool.
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">/tools/{effectiveSlug || "…"}</p>
            )}
          </Field>
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Access badge">
            <select
              value={access}
              onChange={(e) => setAccess(e.target.value as "pro" | "free")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="pro">Pro (paid subscription)</option>
              <option value="free">Free</option>
            </select>
          </Field>
          <Field label="Brand domain (used for the fallback logo)">
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              maxLength={160}
              placeholder="example.com"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Visibility">
            <div className="flex flex-wrap items-center gap-4 py-2 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={(e) => setIsVisible(e.target.checked)}
                  className="h-4 w-4"
                />
                Visible to customers
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={(e) => setFeatured(e.target.checked)}
                  className="h-4 w-4"
                />
                Featured
              </label>
            </div>
          </Field>
          <Field label="Tool icon (resized & optimised automatically)" full>
            <ToolIconUpload slug={effectiveSlug} value={imageUrl} onChange={setImageUrl} />
          </Field>
          <Field label="Tagline" full>
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              maxLength={240}
              placeholder="One short line shown under the tool name"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Description" full>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
              rows={5}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed"
            />
          </Field>
          <Field label="Feature bullets (one per line)" full>
            <textarea
              value={features}
              onChange={(e) => setFeatures(e.target.value)}
              rows={4}
              placeholder={"Keyword research\nBacklink audits\nRank tracking"}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed"
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Link to="/admin/tools" className="rounded-full border px-4 py-2 text-sm hover:bg-muted">
            Cancel
          </Link>
          <button
            onClick={create}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {busy ? "Creating…" : "Create tool"}
          </button>
        </div>
      </section>
    </AdminShell>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </label>
  );
}
