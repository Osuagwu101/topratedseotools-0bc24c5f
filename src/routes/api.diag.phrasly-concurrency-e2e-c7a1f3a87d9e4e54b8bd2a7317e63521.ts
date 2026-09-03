import { createFileRoute } from "@tanstack/react-router";

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });

/** Inert tombstone. The temporary Phrasly three-writer concurrency diagnostic was removed after testing. */
export const Route = createFileRoute(
  "/api/diag/phrasly-concurrency-e2e-c7a1f3a87d9e4e54b8bd2a7317e63521",
)({
  server: {
    handlers: {
      GET: async () => notFound(),
      POST: async () => notFound(),
    },
  },
});
