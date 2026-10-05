import { createFileRoute } from "@tanstack/react-router";
import { TurnitinProductPage } from "@/components/turnitin/TurnitinProductPage";

export const Route = createFileRoute("/turnitin/submit")({
  head: () => ({
    meta: [
      { title: "Submit File — Turnitin Checks — Top Rated SEO Tools" },
      {
        name: "description",
        content:
          "Upload a document and choose the Originality report options for your Turnitin check.",
      },
    ],
  }),
  component: () => <TurnitinProductPage section="submit" />,
});
