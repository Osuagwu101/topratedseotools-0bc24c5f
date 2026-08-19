import { createFileRoute } from "@tanstack/react-router";

function gone() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

/**
 * Tombstone for the superseded ticket-based SneakWrite SSO route.
 * Kept inert until the generated route tree is refreshed; no ticket or credential logic remains.
 */
export const Route = createFileRoute("/api/sso/sneakwrite-consume")({
  server: {
    handlers: {
      GET: async () => gone(),
      POST: async () => gone(),
    },
  },
});
