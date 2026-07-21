import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { CustomersTable } from "@/components/admin/CustomersTable";

export const Route = createFileRoute("/admin/customers/all-time")({
  ssr: false,
  head: () => ({ meta: [{ title: "All-time subscribers — Admin" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AdminShell>
      <CustomersTable segment="all_time" />
    </AdminShell>
  ),
});
