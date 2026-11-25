import { createFileRoute } from "@tanstack/react-router";
import { TurnitinProductPage } from "@/components/turnitin/TurnitinProductPage";
import { TURNITIN_CREDIT_UNIT_PRICE_LABEL } from "@/lib/turnitin-pricing";

const title = "Turnitin Checks in Nigeria & Ghana | TopRatedSEOTools";
const description = `Check your document with Turnitin for ${TURNITIN_CREDIT_UNIT_PRICE_LABEL} per check. Pay online, upload your file and download your similarity and eligible AI-writing reports.`;
const canonical = "https://topratedseotools.com/turnitin";

export const Route = createFileRoute("/turnitin/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: canonical },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: canonical }],
  }),
  component: () => <TurnitinProductPage section="overview" />,
});
