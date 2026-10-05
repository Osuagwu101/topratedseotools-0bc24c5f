import { createFileRoute } from "@tanstack/react-router";
import { TurnitinProductPage } from "@/components/turnitin/TurnitinProductPage";

export const Route = createFileRoute("/turnitin/buy")({
  head: () => ({
    meta: [
      { title: "Buy Checks — Turnitin Checks — Top Rated SEO Tools" },
      {
        name: "description",
        content:
          "Purchase prepaid Turnitin check credits securely from your Top Rated SEO Tools account.",
      },
    ],
  }),
  component: () => <TurnitinProductPage section="buy" />,
});
