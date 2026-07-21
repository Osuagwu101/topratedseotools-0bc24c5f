import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/settings")({
  ssr: false,
  head: () => ({ meta: [{ title: "Settings — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  component: () => <Outlet />,
});
