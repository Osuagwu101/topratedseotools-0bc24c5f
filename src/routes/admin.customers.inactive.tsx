import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { CustomersTable } from "@/components/admin/CustomersTable";

export const Route = createFileRoute("/admin/customers/inactive")({
  ssr: false,
  head: () => ({ meta: [{ title: "Inactive subscribers — Admin" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AdminShell>
      <CustomersTable segment="inactive" />
    </AdminShell>
  ),
});
