/**
 * Admin — /admin/tools layout.
 *
 * Wraps the tool list (`admin.tools.index.tsx`) and per-tool management
 * page (`admin.tools.$slug.tsx`) with a shared <Outlet />.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/tools")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  component: () => <Outlet />,
});
