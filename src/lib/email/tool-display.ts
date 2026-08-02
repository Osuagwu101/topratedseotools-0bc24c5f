/**
 * Presentation-only helpers that turn a tool slug into a friendly name and an
 * email-safe icon URL. Used to enrich email payloads — no trigger or delivery
 * behaviour depends on this module.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export function titleCaseSlug(slug: string): string {
  return String(slug ?? "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function faviconUrl(domain: string): string {
  const d = (domain ?? "").trim();
  if (!d) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`;
}

export interface ToolDisplay {
  name: string;
  icon: string;
}

/** Best-effort lookup: admin overrides first, then the built-in catalogue. */
export async function resolveToolDisplay(admin: any, slug: string): Promise<ToolDisplay> {
  const fallback: ToolDisplay = { name: titleCaseSlug(slug), icon: "" };
  if (!slug) return fallback;
  try {
    const { data } = await admin
      .from("tool_overrides")
      .select("name, domain, image_url")
      .eq("tool_slug", slug)
      .maybeSingle();
    const row = (data ?? null) as { name?: string | null; domain?: string | null; image_url?: string | null } | null;
    let name = row?.name?.trim() || "";
    let icon = row?.image_url?.trim() || faviconUrl(row?.domain ?? "");

    if (!name || !icon) {
      const { TOOLS } = await import("@/lib/tools-data");
      const builtin = TOOLS.find((t) => t.slug === slug);
      if (builtin) {
        name = name || builtin.name;
        icon = icon || faviconUrl(builtin.domain);
      }
    }
    return { name: name || fallback.name, icon };
  } catch {
    return fallback;
  }
}
