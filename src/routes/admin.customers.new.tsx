import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { CustomersTable } from "@/components/admin/CustomersTable";

export const Route = createFileRoute("/admin/customers/new")({
  ssr: false,
  head: () => ({ meta: [{ title: "New registrations — Admin" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AdminShell>
      <CustomersTable segment="new" />
    </AdminShell>
  ),
});
