import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/blog")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  component: () => <Outlet />,
});
