/**
 * Unified tool catalogue.
 *
 * The built-in catalogue lives in `src/lib/tools-data.ts` (icon components,
 * feature bullets, per-use pricing). Admin-created tools live in the
 * `tool_overrides` table with `is_custom = true`, which also carries overrides
 * for built-in tools.
 *
 * Everything customer- or admin-facing should read the merged catalogue from
 * here so a newly created tool behaves exactly like a built-in one.
 */
import { Sparkles } from "lucide-react";
import { TOOLS, registerExtraTools, type Tool, type ToolCategory } from "@/lib/tools-data";
import { applyOverride, type ToolOverride } from "@/lib/tool-overrides.functions";

export type CatalogTool = Tool & { image_url: string | null; is_visible: boolean };

/** Build a full Tool object out of an admin-created override row. */
export function toolFromOverride(o: ToolOverride): CatalogTool {
  return {
    slug: o.tool_slug,
    name: o.name ?? o.tool_slug,
    tagline: o.tagline ?? "",
    description: o.description ?? "",
    icon: Sparkles,
    domain: o.domain ?? "",
    category: (o.category as ToolCategory) ?? "Productivity",
    access: o.access === "free" ? "free" : "pro",
    featured: o.featured ?? false,
    features: o.features ?? undefined,
    pricingModel: "subscription",
    image_url: o.image_url,
    is_visible: o.is_visible,
  };
}

/**
 * Built-in tools with overrides applied, plus admin-created tools.
 * Nothing is filtered here — call `.filter(t => t.is_visible)` for public UI.
 */
export function mergeToolCatalog(overrides: ToolOverride[]): CatalogTool[] {
  const bySlug = new Map(overrides.map((o) => [o.tool_slug, o]));
  const builtInSlugs = new Set(TOOLS.map((t) => t.slug));
  const builtIn = TOOLS.map((t) => applyOverride(t, bySlug.get(t.slug)) as CatalogTool);
  const custom = overrides
    .filter((o) => o.is_custom === true && !builtInSlugs.has(o.tool_slug))
    .map(toolFromOverride);
  // Keep the synchronous getTool() lookups (dashboard, orders, receipts,
  // transactions) aware of admin-created tools.
  registerExtraTools(custom);
  return [...builtIn, ...custom];
}

export function findCatalogTool(overrides: ToolOverride[], slug: string): CatalogTool | undefined {
  return mergeToolCatalog(overrides).find((t) => t.slug === slug);
}

/** True when a slug is already taken by a built-in or custom tool. */
export function slugTaken(overrides: ToolOverride[], slug: string): boolean {
  return mergeToolCatalog(overrides).some((t) => t.slug === slug);
}
