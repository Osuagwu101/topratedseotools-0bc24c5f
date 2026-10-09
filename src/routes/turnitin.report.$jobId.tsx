import { createFileRoute } from "@tanstack/react-router";
import { TurnitinReportViewer } from "@/components/turnitin/TurnitinReportViewer";

export const Route = createFileRoute("/turnitin/report/$jobId")({
  head: () => ({
    meta: [{ title: "View Similarity Report — Top Rated SEO Tools" }],
  }),
  component: () => {
    const { jobId } = Route.useParams();
    return <TurnitinReportViewer jobId={jobId} />;
  },
});
