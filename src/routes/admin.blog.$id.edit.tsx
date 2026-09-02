import { createFileRoute } from "@tanstack/react-router";
import { PostEditor } from "@/components/blog/PostEditor";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/blog/$id/edit")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [{ title: "Edit article — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditPage,
});

function EditPage() {
  const { id } = Route.useParams();
  return <PostEditor mode="edit" id={id} />;
}
