import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ActiveTheme = "theme-1" | "theme-2";

/** Publicly readable — used by the root route to apply the theme site-wide. */
export const getActiveTheme = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const url = process.env.SUPABASE_URL!;
  const supabase = createClient<Database>(url, key, {
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
  const { data } = await supabase
    .from("site_settings")
    .select("active_theme")
    .eq("id", true)
    .maybeSingle();
  return { activeTheme: (data?.active_theme ?? "theme-1") as ActiveTheme };
});

/** Admin-only: update the active theme. */
export const setActiveTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ theme: z.enum(["theme-1", "theme-2"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: roleRow, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Forbidden");

    const { error } = await context.supabase
      .from("site_settings")
      .update({ active_theme: data.theme, updated_by: context.userId })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true, activeTheme: data.theme as ActiveTheme };
  });

/** Returns whether the current authenticated user is an admin. */
export const getIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });
