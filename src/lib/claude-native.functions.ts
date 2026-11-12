import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { issueClaudeNativeAdminHandoff } from "@/lib/claude-native.server";
export const adminStartClaudeNativePilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => issueClaudeNativeAdminHandoff(context.userId));
