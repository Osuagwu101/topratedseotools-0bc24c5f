import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Check an authenticated admin using the user's own role under RLS.
 * Avoid server-only getIsAdmin() calls without a forwarded bearer token.
 */
export async function requireAdminOrRedirect() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (sessionError || !userId) throw redirect({ to: "/admin" });

  const { data: adminRole, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (roleError || !adminRole) throw redirect({ to: "/admin" });
}
