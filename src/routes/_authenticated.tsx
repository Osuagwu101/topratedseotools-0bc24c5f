import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    // Force password change for admin-created customers before letting them
    // reach any sensitive account surface.
    const mustChange =
      (data.user.user_metadata as { must_change_password?: boolean } | null)
        ?.must_change_password === true;
    if (mustChange && location.pathname !== "/change-password") {
      throw redirect({ to: "/change-password" });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
