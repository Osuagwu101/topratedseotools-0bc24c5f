import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/customers")({
  ssr: false,
  head: () => ({ meta: [{ title: "Customers — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  component: () => <Outlet />,
});
