import { createFileRoute } from "@tanstack/react-router";

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });

/** Inert tombstone. The temporary writer frontend credential bridge was removed after successful E2E verification. */
export const Route = createFileRoute(
  "/api/diag/writer-frontend-credential-e2e-7d22f63e9ad14784b661d67e4e0d5b8f",
)({
  server: {
    handlers: {
      GET: async () => notFound(),
      POST: async () => notFound(),
    },
  },
});
