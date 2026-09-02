import { createFileRoute } from "@tanstack/react-router";
import { PostEditor } from "@/components/blog/PostEditor";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/blog/new")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [{ title: "New article — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => <PostEditor mode="create" />,
});
