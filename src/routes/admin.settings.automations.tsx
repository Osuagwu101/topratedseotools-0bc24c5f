import { createFileRoute } from "@tanstack/react-router";
import { PhasePlaceholder } from "@/components/admin/PhasePlaceholder";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/settings/automations")({
  ssr: false,
  head: () => ({ meta: [{ title: "Automations — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  component: () => <PhasePlaceholder phase={7} name="Automations" />,
});
