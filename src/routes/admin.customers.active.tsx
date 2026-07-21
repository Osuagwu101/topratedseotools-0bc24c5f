import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { CustomersTable } from "@/components/admin/CustomersTable";

export const Route = createFileRoute("/admin/customers/active")({
  ssr: false,
  head: () => ({ meta: [{ title: "Active subscribers — Admin" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AdminShell>
      <CustomersTable segment="active" />
    </AdminShell>
  ),
});
