import { createFileRoute } from "@tanstack/react-router";
import { PhasePlaceholder } from "@/components/admin/PhasePlaceholder";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/settings/api-keys")({
  ssr: false,
  head: () => ({ meta: [{ title: "API Keys & Providers — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  component: () => <PhasePlaceholder phase={5} name="API Keys & Providers" />,
});
