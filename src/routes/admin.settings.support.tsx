import { createFileRoute } from "@tanstack/react-router";
import { PhasePlaceholder } from "@/components/admin/PhasePlaceholder";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/settings/support")({
  ssr: false,
  head: () => ({ meta: [{ title: "Support Tickets — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  component: () => <PhasePlaceholder phase={6} name="Support Tickets" />,
});
