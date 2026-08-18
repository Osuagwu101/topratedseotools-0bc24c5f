import { createFileRoute } from "@tanstack/react-router";
import bundledLogoUrl from "@/assets/top-rated-seo-tools-logo.png";

export const Route = createFileRoute("/api/public/brand-logo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const target = new URL(bundledLogoUrl, request.url);
        return new Response(null, {
          status: 302,
          headers: {
            Location: target.toString(),
            "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});
