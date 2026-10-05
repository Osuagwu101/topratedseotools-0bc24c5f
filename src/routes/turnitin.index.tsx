import { createFileRoute } from "@tanstack/react-router";
import { TurnitinProductPage } from "@/components/turnitin/TurnitinProductPage";

export const Route = createFileRoute("/turnitin/")({
  head: () => ({
    meta: [
      { title: "Turnitin Checks — Top Rated SEO Tools" },
      {
        name: "description",
        content:
          "Manage Turnitin check credits, submissions, results and reports from your Top Rated SEO Tools account.",
      },
    ],
  }),
  component: () => <TurnitinProductPage section="overview" />,
});
