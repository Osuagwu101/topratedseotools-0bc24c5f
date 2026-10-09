import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_TURNITIN_REPORT_PREFERENCES,
  prefsFromRow,
  prefsToRow,
  turnitinReportPreferencesSchema,
} from "@/lib/turnitin-report-preferences";

export const getMyTurnitinReportPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any).from("turnitin_report_preferences")
      .select("*").eq("user_id", context.userId).maybeSingle();
    if (error) throw new Error("Could not load your report settings.");
    return prefsFromRow(data as Record<string, unknown> | null);
  });

export const saveMyTurnitinReportPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) => turnitinReportPreferencesSchema.parse(value))
  .handler(async ({ data, context }) => {
    // Caller-controlled user IDs are not accepted. A trusted server validates the account.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("turnitin_report_preferences").upsert({
      ...prefsToRow(data),
      user_id: context.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw new Error("Could not save your report settings. Please try again.");
    return data;
  });

export const resetMyTurnitinReportPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("turnitin_report_preferences")
      .delete().eq("user_id", context.userId);
    if (error) throw new Error("Could not reset your report settings.");
    return { ...DEFAULT_TURNITIN_REPORT_PREFERENCES };
  });
