import { createFileRoute } from "@tanstack/react-router";
import { TurnitinProductPage } from "@/components/turnitin/TurnitinProductPage";

export const Route = createFileRoute("/turnitin/history")({
  head: () => ({
    meta: [
      { title: "Check History — Turnitin Checks — Top Rated SEO Tools" },
      {
        name: "description",
        content:
          "Review Turnitin check status, similarity and AI results, and download available reports.",
      },
    ],
  }),
  component: () => <TurnitinProductPage section="history" />,
});
