import { createFileRoute } from "@tanstack/react-router";

const notFound = () => new Response("Not found", {
  status: 404,
  headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive" },
});

/** Inert tombstone. The former OTP test diagnostic was removed. */
export const Route = createFileRoute("/api/diag/phrasly-otp-test-4d4dc2a5e7f64203a34e33f071a94554")({
  server: { handlers: { GET: async () => notFound(), POST: async () => notFound() } },
});
