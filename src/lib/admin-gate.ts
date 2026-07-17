import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getIsAdmin } from "@/lib/site-settings.functions";

/**
 * Client-side admin gate for admin routes. Redirects to /admin (admin login)
 * when there is no session or the user is not an admin.
 *
 * Use as `beforeLoad` in admin routes. Routes must also set `ssr: false` so
 * this only runs in the browser where the session and bearer token exist.
 */
export async function requireAdminOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw redirect({ to: "/admin" });
  try {
    const { isAdmin } = await getIsAdmin();
    if (!isAdmin) throw redirect({ to: "/admin" });
  } catch (e) {
    // Re-throw redirects; treat any other failure (401, network) as not-admin
    if (e && typeof e === "object" && "to" in (e as Record<string, unknown>)) throw e;
    throw redirect({ to: "/admin" });
  }
}
