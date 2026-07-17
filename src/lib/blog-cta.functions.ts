/**
 * CTA template CRUD (admin) + public list for rendering on blog posts.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function serverPublic() {
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

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const listCtaTemplates = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = serverPublic();
  const { data, error } = await supabase
    .from("blog_cta_templates" as never)
    .select("*")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return { templates: (data ?? []) as never[] };
});

const ctaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  button_label: z.string().trim().min(1).max(80),
  button_url: z.string().trim().min(1).max(300),
  target_tool_slugs: z.array(z.string().trim().min(1)).default([]),
  target_category_slugs: z.array(z.string().trim().min(1)).default([]),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
  is_default: z.boolean().default(false),
});

export const adminCreateCta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ctaSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.is_default) {
      await context.supabase
        .from("blog_cta_templates" as never)
        .update({ is_default: false } as never)
        .neq("id", "00000000-0000-0000-0000-000000000000");
    }
    const { data: inserted, error } = await (context.supabase as any)
      .from("blog_cta_templates")
      .insert(data)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id as string };
  });

export const adminUpdateCta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ctaSchema.extend({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.is_default) {
      await context.supabase
        .from("blog_cta_templates" as never)
        .update({ is_default: false } as never)
        .neq("id", data.id);
    }
    const { id, ...rest } = data;
    const { error } = await (context.supabase as any)
      .from("blog_cta_templates")
      .update(rest)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteCta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("blog_cta_templates" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
