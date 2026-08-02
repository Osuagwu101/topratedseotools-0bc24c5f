/**
 * Admin-editable metadata for existing tools.
 *
 * The canonical catalog stays in `src/lib/tools-data.ts` (TOOLS array) — it
 * carries icon components, feature bullets, and per-use pricing that cannot
 * live in the database as-is. This module lets admins override the mutable,
 * customer-visible fields (name/tagline/description/category/domain/image
 * and visibility) without a code change.
 *
 * Consumers apply overrides at read time with `applyOverride()`.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ToolOverride {
  tool_slug: string;
  name: string | null;
  tagline: string | null;
  description: string | null;
  category: string | null;
  domain: string | null;
  image_url: string | null;
  is_visible: boolean;
  updated_at: string;
  /** True when this row *is* the tool (admin-created), not an override of a built-in one. */
  is_custom?: boolean | null;
  access?: string | null;
  features?: string[] | null;
  featured?: boolean | null;
}

function publicClient() {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const url = process.env.SUPABASE_URL!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/** Public — everyone reads this to merge into the hardcoded catalog. */
export const listToolOverrides = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = publicClient();
  const { data, error } = await supabase.from("tool_overrides").select("*");
  if (error) throw new Error(error.message);
  return { overrides: (data ?? []) as ToolOverride[] };
});

const upsertInput = z.object({
  tool_slug: z.string().min(1).max(120),
  name: z.string().max(120).nullable().optional(),
  tagline: z.string().max(240).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  domain: z.string().max(160).nullable().optional(),
  image_url: z.string().url().max(600).nullable().optional(),
  is_visible: z.boolean().optional(),
  is_custom: z.boolean().optional(),
  access: z.enum(["free", "pro"]).optional(),
  features: z.array(z.string().max(240)).max(20).nullable().optional(),
  featured: z.boolean().optional(),
});

export const adminUpsertToolOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const row = {
      tool_slug: data.tool_slug,
      name: data.name ?? null,
      tagline: data.tagline ?? null,
      description: data.description ?? null,
      category: data.category ?? null,
      domain: data.domain ?? null,
      image_url: data.image_url ?? null,
      is_visible: data.is_visible ?? true,
      is_custom: data.is_custom ?? false,
      access: data.access ?? null,
      features: data.features ?? null,
      featured: data.featured ?? false,
    };
    const { error } = await context.supabase
      .from("tool_overrides")
      .upsert(row, { onConflict: "tool_slug" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminResetToolOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tool_slug: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("tool_overrides")
      .delete()
      .eq("tool_slug", data.tool_slug);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Client-safe helper. Applies an override on top of a base Tool object. */
export function applyOverride<T extends { slug: string; name: string; tagline: string; description: string; category: string; domain: string }>(
  tool: T,
  override: ToolOverride | undefined,
): T & { image_url: string | null; is_visible: boolean } {
  if (!override) return { ...tool, image_url: null, is_visible: true };
  return {
    ...tool,
    name: override.name ?? tool.name,
    tagline: override.tagline ?? tool.tagline,
    description: override.description ?? tool.description,
    category: (override.category as T["category"]) ?? tool.category,
    domain: override.domain ?? tool.domain,
    image_url: override.image_url,
    is_visible: override.is_visible,
  };
}
