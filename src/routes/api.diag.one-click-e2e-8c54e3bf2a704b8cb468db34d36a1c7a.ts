import { createFileRoute } from "@tanstack/react-router";

const notFound = () => new Response("Not found", {
  status: 404,
  headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive" },
});

/** Inert tombstone. The former credential-bearing Browser Use diagnostic was removed. */
export const Route = createFileRoute("/api/diag/one-click-e2e-8c54e3bf2a704b8cb468db34d36a1c7a")({
  server: { handlers: { GET: async () => notFound(), POST: async () => notFound() } },
});
