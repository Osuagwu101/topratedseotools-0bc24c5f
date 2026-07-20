import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ActiveTheme = "theme-1" | "theme-2";

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

/** Publicly readable — theme + admin WhatsApp number (used for private-access fulfilment CTAs). */
export const getPublicSiteSettings = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = publicClient();
  const { data } = await supabase
    .from("site_settings")
    .select("active_theme, admin_whatsapp_number")
    .eq("id", true)
    .maybeSingle();
  return {
    activeTheme: (data?.active_theme ?? "theme-1") as ActiveTheme,
    adminWhatsappNumber: (data?.admin_whatsapp_number as string | null) ?? null,
  };
});

/** Back-compat alias — used by root route. */
export const getActiveTheme = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = publicClient();
  const { data } = await supabase
    .from("site_settings")
    .select("active_theme")
    .eq("id", true)
    .maybeSingle();
  return { activeTheme: (data?.active_theme ?? "theme-1") as ActiveTheme };
});

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

/**
 * Admin — save the WhatsApp number used for Private Access fulfilment.
 * Accepts international digits only (e.g. 2348012345678). Empty clears it.
 */
export const setAdminWhatsappNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        number: z
          .string()
          .trim()
          .max(20)
          .regex(/^\d{7,20}$|^$/, "Enter international digits only, e.g. 2348012345678")
          .nullable()
          .transform((v) => (v === "" ? null : v)),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: roleRow } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw new Error("Forbidden");

    const { error } = await context.supabase
      .from("site_settings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ admin_whatsapp_number: data.number, updated_by: context.userId } as any)
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true, adminWhatsappNumber: data.number };
  });

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
