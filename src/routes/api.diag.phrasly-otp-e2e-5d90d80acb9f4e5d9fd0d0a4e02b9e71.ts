import { createFileRoute } from "@tanstack/react-router";

const notFound = () => new Response("Not found", {
  status: 404,
  headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive" },
});

/** Inert tombstone. The former OTP E2E diagnostic was removed. */
export const Route = createFileRoute("/api/diag/phrasly-otp-e2e-5d90d80acb9f4e5d9fd0d0a4e02b9e71")({
  server: { handlers: { GET: async () => notFound(), POST: async () => notFound() } },
});
