import { createFileRoute } from "@tanstack/react-router";
import { PhasePlaceholder } from "@/components/admin/PhasePlaceholder";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/settings/security")({
  ssr: false,
  head: () => ({ meta: [{ title: "Security Centre — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  component: () => <PhasePlaceholder phase={7} name="Security Centre" />,
});
