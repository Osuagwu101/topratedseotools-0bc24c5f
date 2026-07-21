import { createFileRoute } from "@tanstack/react-router";
import { PhasePlaceholder } from "@/components/admin/PhasePlaceholder";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/settings/general")({
  ssr: false,
  head: () => ({ meta: [{ title: "General Website Settings — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  component: () => <PhasePlaceholder phase={2} name="General Website Settings" />,
});
