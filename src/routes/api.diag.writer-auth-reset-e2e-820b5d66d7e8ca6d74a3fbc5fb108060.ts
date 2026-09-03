import { createFileRoute } from "@tanstack/react-router";

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });

/** Inert tombstone. The temporary writer-auth reset diagnostic was removed after successful E2E verification. */
export const Route = createFileRoute(
  "/api/diag/writer-auth-reset-e2e-820b5d66d7e8ca6d74a3fbc5fb108060",
)({
  server: {
    handlers: {
      GET: async () => notFound(),
      POST: async () => notFound(),
    },
  },
});
